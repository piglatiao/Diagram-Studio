/**
 * L3 · PlantUML 本地解析器（行式状态机）
 *
 * 纯本地渲染的关键：PlantUML 官方实现依赖 Java，浏览器无稳定 WASM 构建。
 * 因此这里自研行式解析器，把常用图类型解析成统一的 DiagramIR，
 * 再由本地布局 + 自绘 SVG 完成渲染（见 src/render）。
 *
 * 设计原则：
 * - 每个元素都带 SourceRef，支撑「点击图形定位源码」与后续补丁回写
 * - 解析失败不抛异常，降级为 warning，保证上层永远拿得到一份 IR
 */
import {
  DiagramIR,
  Diagnostic,
  ParseResult,
  SourceRef,
  NodeIR,
  EdgeIR,
  GroupIR,
  NoteIR,
  emptyIR,
  hashString,
  ArrowHead,
} from '../../ir/types';

interface Line {
  text: string;
  raw: string;
  start: number;
  end: number;
  no: number;
}

function toLines(src: string): Line[] {
  const out: Line[] = [];
  let off = 0;
  let no = 0;
  for (const raw of src.split('\n')) {
    out.push({ raw, text: raw.trim(), start: off, end: off + raw.length, no: no++ });
    off += raw.length + 1;
  }
  return out;
}

function refOf(l: Line, text?: string): SourceRef {
  const t = text ?? l.text;
  return {
    span: {
      start: l.start,
      end: l.end,
      startLine: l.no,
      startCol: 0,
      endLine: l.no,
      endCol: l.raw.length,
    },
    text: t,
  };
}

function stripQuotes(s: string): string {
  const t = s.trim();
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) return t.slice(1, -1);
  return t;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------- 方言识别

type Dialect = 'sequence' | 'class' | 'usecase' | 'state' | 'component' | 'activity' | 'mindmap' | 'gantt';

export function detectDialect(src: string): Dialect {
  if (/@startmindmap/i.test(src)) return 'mindmap';
  if (/@startgantt/i.test(src)) return 'gantt';
  if (/@startsalt|@startjson|@startyaml|@startlatex|@startebnf/i.test(src)) return 'activity';

  const lines = src.split('\n').map((l) => l.trim()).filter(Boolean);
  const score: Record<Dialect, number> = {
    sequence: 0, class: 0, usecase: 0, state: 0, component: 0, activity: 0, mindmap: 0, gantt: 0,
  };

  for (const l of lines) {
    // 参与者关键字：participant 系是时序图强信号；actor 在用例图里同样常见，权重分开
    if (/^(participant|boundary|control|entity|collections|queue)\b/i.test(l)) score.sequence += 3;
    if (/^database\b/i.test(l)) { score.sequence += 2; score.component += 2; }
    if (/^actor\b/i.test(l)) { score.sequence += 1; score.usecase += 2; }
    // 箭头消息：带括号的多半是用例图
    if (/^\S+\s*(->|-->|->>|-\\|<-)/.test(l)) {
      if (/\(/.test(l)) score.usecase += 1; else score.sequence += 1;
    }
    if (/^(class|abstract\s+class|interface|enum|annotation)\b/i.test(l)) score.class += 3;
    if (/(\.\.>|--\|>|--\*>|--o>|--o\b|--\*\b)/.test(l)) score.class += 2;
    if (/^usecase\b/i.test(l)) score.usecase += 4;
    if (/^\([^)]+\)\s*$/.test(l)) score.usecase += 3;
    if (/^rectangle\b/i.test(l)) score.usecase += 3;
    if (/^package\b/i.test(l)) { score.component += 2; score.class += 1; }
    if (/^state\b/i.test(l)) score.state += 2;
    if (/\[\s*\*\s*\]/.test(l)) score.state += 3;
    if (/^(component|cloud|node|folder|frame|queue|storage)\b/i.test(l)) score.component += 2;
    if (/^(start|stop|end)\b/i.test(l)) score.activity += 2;
    if (/^:/.test(l) && /;\s*$/.test(l)) score.activity += 3;
    if (/^(if|while|fork|partition|switch|case|repeat)\b/i.test(l)) score.activity += 2;
    if (/\(\s*\*\s*\)/.test(l)) score.activity += 2;
    if (/^\*+\s+\S/.test(l)) score.mindmap += 3;
  }

  let best: Dialect = 'sequence';
  for (const k of Object.keys(score) as Dialect[]) if (score[k] > score[best]) best = k;
  return best;
}

// ---------------------------------------------------------------- 公共入口

export function parsePlantUml(source: string): ParseResult {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const ir = emptyIR('plantuml', hashString(source));
  const diagnostics: Diagnostic[] = [];

  try {
    const all = toLines(source);
    const { lines, unparsed } = preprocess(all);
    const dialect = detectDialect(source);
    ir.origin.dialect = dialect;

    switch (dialect) {
      case 'sequence': ir.kind = 'sequence'; parseSequence(lines, ir, diagnostics); break;
      case 'class': ir.kind = 'class'; parseClass(lines, ir, diagnostics); break;
      case 'usecase': ir.kind = 'usecase'; parseUsecase(lines, ir, diagnostics); break;
      case 'state': ir.kind = 'state'; parseState(lines, ir, diagnostics); break;
      case 'component': ir.kind = 'component'; parseComponent(lines, ir, diagnostics); break;
      case 'mindmap': ir.kind = 'mindmap'; parseMindmap(lines, ir, diagnostics); break;
      case 'gantt':
        ir.kind = 'gantt';
        diagnostics.push({
          severity: 'warning', message: '本地渲染器暂不支持甘特图（gantt）', code: 'PUML_UNSUPPORTED_GANTT',
        });
        break;
      default: ir.kind = 'activity'; parseActivity(lines, ir, diagnostics); break;
    }
    ir.unparsed = unparsed;
  } catch (e) {
    diagnostics.push({
      severity: 'error',
      message: `解析失败：${e instanceof Error ? e.message : String(e)}`,
      code: 'PUML_PARSE_ERROR',
    });
    ir.fidelity.complete = false;
  }

  ir.fidelity.complete = diagnostics.every((d) => d.severity !== 'error');
  const t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  return { ir, diagnostics, durationMs: t1 - t0 };
}

/** 去注释、抽取 @start/@end 之间的有效行、收集标题等全局指令 */
function preprocess(all: Line[]): { lines: Line[]; unparsed: Array<{ text: string; line: number }> } {
  const lines: Line[] = [];
  const unparsed: Array<{ text: string; line: number }> = [];
  let inBlockComment = false;
  let started = false;

  for (const l of all) {
    const t = l.text;
    if (inBlockComment) {
      if (t.includes("'/")) inBlockComment = false;
      continue;
    }
    if (t.startsWith("/'")) { inBlockComment = !t.includes("'/"); continue; }
    if (t.startsWith("'") || t.startsWith('!') || t.startsWith('skinparam') || t.startsWith('hide ')) {
      unparsed.push({ text: t, line: l.no });
      continue;
    }
    if (/^@start/i.test(t)) { started = true; continue; }
    if (/^@end/i.test(t)) { started = false; continue; }
    if (!t) continue;
    if (!started && lines.length === 0 && !/^@/.test(t)) started = true; // 允许省略 @startuml
    lines.push(l);
  }
  return { lines, unparsed };
}

function readGlobals(lines: Line[], ir: DiagramIR): Line[] {
  const rest: Line[] = [];
  for (const l of lines) {
    const t = l.text;
    let m: RegExpMatchArray | null;
    if ((m = t.match(/^title\s+(.+)$/i))) { ir.title = stripQuotes(m[1]); continue; }
    if ((m = t.match(/^header\s+(.+)$/i))) { ir.header = stripQuotes(m[1]); continue; }
    if ((m = t.match(/^footer\s+(.+)$/i))) { ir.footer = stripQuotes(m[1]); continue; }
    if (/^left to right direction$/i.test(t)) { ir.direction = 'LR'; continue; }
    if (/^top to bottom direction$/i.test(t)) { ir.direction = 'TB'; continue; }
    rest.push(l);
  }
  return rest;
}

let uid = 0;
function nid(prefix: string): string {
  return `${prefix}_${(uid++).toString(36)}`;
}

function addNode(ir: DiagramIR, n: NodeIR): NodeIR {
  ir.nodes.push(n);
  return n;
}

// ---------------------------------------------------------------- 时序图

const SEQ_ARROW: Array<{ tok: string; dashed: boolean; head: ArrowHead; reverse?: boolean }> = [
  { tok: '<<--', dashed: true, head: 'arrow', reverse: true },
  { tok: '<--', dashed: true, head: 'arrow', reverse: true },
  { tok: '-->>', dashed: true, head: 'arrow' },
  { tok: '->>', dashed: false, head: 'arrow' },
  { tok: '-->', dashed: true, head: 'arrow' },
  { tok: '->x', dashed: false, head: 'cross' },
  { tok: '->o', dashed: false, head: 'arrow' },
  { tok: 'o->', dashed: false, head: 'arrow' },
  { tok: '-\\', dashed: false, head: 'halfArrow' },
  { tok: '->', dashed: false, head: 'arrow' },
  { tok: '<-', dashed: false, head: 'arrow', reverse: true },
];

function arrowInfo(tok: string) {
  return SEQ_ARROW.find((a) => a.tok === tok) ?? SEQ_ARROW[SEQ_ARROW.length - 2];
}

function parseSequence(srcLines: Line[], ir: DiagramIR, diagnostics: Diagnostic[]) {
  const lines = readGlobals(srcLines, ir);
  const participants = new Map<string, NodeIR>();
  const fragStack: GroupIR[] = [];
  let order = 0;
  const separators: Array<{ order: number; text: string; kind: string }> = [];

  const ensure = (id: string, label?: string, kind?: string, line?: Line): NodeIR => {
    let n = participants.get(id);
    if (!n) {
      const shape = kind === 'actor' ? 'actor' : kind === 'database' ? 'cylinder' : 'rect';
      n = addNode(ir, {
        id,
        label: label ?? id,
        kind: kind ?? 'participant',
        shape,
        order: participants.size,
        ref: line ? refOf(line) : undefined,
      });
      participants.set(id, n);
    } else if (label && n.label === n.id) {
      n.label = label;
    }
    return n;
  };

  const pushFrag = (type: string, label: string | undefined, line: Line) => {
    const g: GroupIR = {
      id: nid('frag'),
      label,
      kind: 'fragment',
      parentId: fragStack.length ? fragStack[fragStack.length - 1].id : undefined,
      children: [],
      fragmentType: type,
      condition: label,
      orderRange: [order, order],
      ref: refOf(line),
    };
    ir.groups.push(g);
    fragStack.push(g);
  };
  const popFrag = () => {
    const g = fragStack.pop();
    if (g && g.orderRange) g.orderRange[1] = order;
  };

  let pendingNote: NoteIR | null = null;

  for (const l of lines) {
    const t = l.text;

    // 多行 note 收集
    if (pendingNote) {
      if (/^end\s+note$/i.test(t)) { pendingNote = null; continue; }
      pendingNote.text += '\n' + t;
      continue;
    }

    // 参与者声明
    let m = t.match(/^(participant|actor|boundary|control|entity|database|collections|queue)\s+(.+?)\s*$/i);
    if (m) {
      const kind = m[1].toLowerCase();
      const rest = m[2];
      let id = rest;
      let label = rest;
      const asQuoted = rest.match(/^"([^"]*)"\s+as\s+(\S+)$/i);
      const asPlain = rest.match(/^(\S+)\s+as\s+(.+)$/i);
      if (asQuoted) { label = asQuoted[1]; id = asQuoted[2]; }
      else if (asPlain) { id = asPlain[1]; label = stripQuotes(asPlain[2]); }
      else if (/^"[^"]*"$/.test(rest)) { id = stripQuotes(rest); label = id; }
      ensure(id, label, kind, l);
      continue;
    }

    // 片段
    if ((m = t.match(/^(alt|opt|loop|par|critical|group|break)\b\s*(.*)$/i))) {
      pushFrag(m[1].toLowerCase(), m[2] || undefined, l);
      continue;
    }
    if ((m = t.match(/^else\b\s*(.*)$/i))) {
      const cur = fragStack.pop();
      if (cur && cur.orderRange) cur.orderRange[1] = order;
      pushFrag(cur?.fragmentType ?? 'alt', m[1] ? `[else] ${m[1]}` : '[else]', l);
      continue;
    }
    if (/^end\b\s*$/i.test(t) || /^end\s+(alt|opt|loop|par|critical|group|break)$/i.test(t)) { popFrag(); continue; }

    // 分隔 / 延迟
    if ((m = t.match(/^==+\s*(.*?)\s*==+$/))) { separators.push({ order, text: m[1], kind: 'divider' }); order++; continue; }
    if ((m = t.match(/^\.\.+\s*(.*?)\s*\.\.+$/))) { separators.push({ order, text: m[1], kind: 'delay' }); order++; continue; }
    if (/^\|\|/.test(t)) { separators.push({ order, text: '', kind: 'space' }); order++; continue; }

    // ref over
    if ((m = t.match(/^ref\s+over\s+(.+?)\s*(?::\s*(.*))?$/i))) {
      const over = m[1].split(',').map((s) => s.trim());
      over.forEach((o) => ensure(o, undefined, undefined, l));
      const n: NoteIR = { id: nid('note'), text: m[2] ?? '', over, position: 'over', order, ref: refOf(l) };
      ir.notes.push(n);
      order++;
      continue;
    }

    // note
    if ((m = t.match(/^note\s+(left|right|top|bottom)\s+of\s+([^:]+)\s*(?::\s*(.*))?$/i))) {
      const target = m[2].trim();
      ensure(target, undefined, undefined, l);
      const n: NoteIR = { id: nid('note'), text: m[3] ?? '', attachTo: { type: 'node', id: target }, position: m[1].toLowerCase() as NoteIR['position'], order, ref: refOf(l) };
      ir.notes.push(n);
      if (!m[3]) pendingNote = n;
      order++;
      continue;
    }
    if ((m = t.match(/^note\s+over\s+([^:]+)\s*(?::\s*(.*))?$/i))) {
      const over = m[1].split(',').map((s) => s.trim());
      over.forEach((o) => ensure(o, undefined, undefined, l));
      const n: NoteIR = { id: nid('note'), text: m[2] ?? '', over, position: 'over', order, ref: refOf(l) };
      ir.notes.push(n);
      if (!m[2]) pendingNote = n;
      order++;
      continue;
    }
    if ((m = t.match(/^note\s+(left|right)\s*(?::\s*(.*))?$/i))) {
      const n: NoteIR = { id: nid('note'), text: m[2] ?? '', position: m[1].toLowerCase() as NoteIR['position'], order, ref: refOf(l) };
      ir.notes.push(n);
      if (!m[2]) pendingNote = n;
      order++;
      continue;
    }

    // 激活 / 去激活
    if ((m = t.match(/^activate\s+(\S+)$/i))) { ensure(m[1], undefined, undefined, l); pushActivate(ir, m[1], order, 'start'); continue; }
    if ((m = t.match(/^deactivate\s+(\S+)$/i))) { ensure(m[1], undefined, undefined, l); pushActivate(ir, m[1], order, 'end'); continue; }
    if ((m = t.match(/^destroy\s+(\S+)$/i))) { ensure(m[1], undefined, undefined, l); continue; }

    // 消息
    const msgRe = new RegExp(
      `^(\\S+)\\s*(${SEQ_ARROW.map((a) => escapeRe(a.tok)).join('|')})\\s*(\\S+?)\\s*(\\+\\+|--|\\*\\*|!!)?\\s*(?::\\s*([\\s\\S]*))?$`
    );
    if ((m = t.match(msgRe))) {
      const info = arrowInfo(m[2]);
      let from = m[1];
      let to = m[3];
      if (info.reverse) { const tmp = from; from = to; to = tmp; }
      ensure(from, undefined, undefined, l);
      ensure(to, undefined, undefined, l);
      const e: EdgeIR = {
        id: nid('msg'),
        from,
        to,
        label: (m[5] ?? '').trim() || undefined,
        dashed: info.dashed,
        head: info.head,
        order: order++,
        ref: refOf(l),
        data: { seq: true },
      };
      ir.edges.push(e);
      if (m[4] === '++' || m[4] === '**') pushActivate(ir, to, order, 'start');
      if (m[4] === '--' || m[4] === '!!') pushActivate(ir, from, order, 'end');
      continue;
    }

    if (/^autonumber\b/i.test(t)) { ir.meta = { ...(ir.meta ?? {}), autonumber: true }; continue; }
    if (/^activate|deactivate/i.test(t)) continue;

    diagnostics.push({
      severity: 'info',
      message: `未识别的语句：${t.slice(0, 40)}`,
      code: 'PUML_UNRECOGNIZED',
      span: refOf(l).span,
    });
    ir.unparsed.push({ text: t, line: l.no });
  }

  while (fragStack.length) popFrag();
  ir.meta = { ...(ir.meta ?? {}), separators, participantCount: participants.size };
}

function pushActivate(ir: DiagramIR, who: string, order: number, kind: 'start' | 'end') {
  ir.edges.push({
    id: nid('act'),
    from: who,
    to: who,
    order,
    activate: kind,
    head: 'none',
    ref: undefined,
    data: { activation: true },
  });
}

// ---------------------------------------------------------------- 类图

const REL_OPS = ['--|>', '..|>', '..|>', '--*>', '--o>', '..o>', '-->', '..>', '--*', '--o', '--', '..'];

function opToEdge(op: string): { head: ArrowHead; dashed: boolean } {
  if (op === '--|>' || op === '..|>') return { head: 'triangle', dashed: op.startsWith('..') };
  if (op === '--*>' || op === '--*') return { head: 'diamond', dashed: op.startsWith('..') };
  if (op === '--o>' || op === '--o' || op === '..o>') return { head: 'diamondOpen', dashed: op.startsWith('..') };
  if (op === '-->') return { head: 'arrow', dashed: false };
  if (op === '..>') return { head: 'arrow', dashed: true };
  return { head: 'none', dashed: op.startsWith('..') };
}

function parseClass(srcLines: Line[], ir: DiagramIR, diagnostics: Diagnostic[]) {
  const lines = readGlobals(srcLines, ir);
  const byId = new Map<string, NodeIR>();
  const groupStack: GroupIR[] = [];

  const ensure = (id: string, kind = 'class', line?: Line): NodeIR => {
    let n = byId.get(id);
    if (!n) {
      n = addNode(ir, { id, label: id, kind, shape: 'rect', ref: line ? refOf(line) : undefined });
      byId.set(id, n);
      if (groupStack.length) {
        n.groupId = groupStack[groupStack.length - 1].id;
        groupStack[groupStack.length - 1].children.push(id);
      }
    }
    return n;
  };

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const t = l.text;

    let m = t.match(/^(package|namespace)\s+(.+?)\s*\{$/i);
    if (m) {
      const g: GroupIR = {
        id: nid('pkg'), label: stripQuotes(m[2]), kind: 'package',
        parentId: groupStack.length ? groupStack[groupStack.length - 1].id : undefined,
        children: [], ref: refOf(l),
      };
      ir.groups.push(g);
      groupStack.push(g);
      continue;
    }
    if (/^\}$/.test(t)) { groupStack.pop(); continue; }

    // class 声明（可能带块）
    m = t.match(/^(abstract\s+class|abstract|class|interface|enum|annotation)\s+([^{\n]+?)\s*(\{([\s\S]*))?$/i);
    if (m) {
      let kindWord = m[1].toLowerCase().replace(/\s+/g, ' ');
      if (kindWord === 'abstract') kindWord = 'abstract class';
      let decl = m[2].trim();
      const stereoMatch = decl.match(/<<\s*(?:\([^)]*\)\s*)?([^>]+?)>>/);
      let stereo: string | undefined;
      if (stereoMatch) { stereo = stereoMatch[1].trim(); decl = decl.replace(stereoMatch[0], '').trim(); }
      const idMatch = decl.match(/^(\S+)/);
      if (!idMatch) { continue; }
      const id = stripQuotes(idMatch[1]);
      const n = ensure(id, kindWord === 'abstract class' ? 'class' : kindWord, l);
      if (stereo) n.stereotype = stereo;
      if (kindWord === 'abstract class') n.stereotype = n.stereotype ?? 'abstract';
      if (kindWord === 'interface') n.stereotype = n.stereotype ?? 'interface';
      if (kindWord === 'enum') n.stereotype = n.stereotype ?? 'enumeration';

      // 块内成员
      if (t.includes('{')) {
        const body: string[] = [];
        let j = i;
        const first = t.slice(t.indexOf('{') + 1);
        if (first.trim()) body.push(first.trim());
        if (!/\}$/.test(t)) {
          j = i + 1;
          for (; j < lines.length; j++) {
            if (/^\}$/.test(lines[j].text)) break;
            body.push(lines[j].text);
          }
        }
        n.members = body.filter((b) => b && !/^\}$/.test(b)).map(parseMember);
        i = j;
      }
      continue;
    }

    // 外部成员定义：ClassName : +field
    m = t.match(/^(\S+)\s*:\s*(.+)$/);
    if (m && byId.has(m[1])) {
      const n = byId.get(m[1])!;
      n.members = [...(n.members ?? []), parseMember(m[2])];
      continue;
    }

    // 关系
    const relRe = new RegExp(`^\\s*(.+?)\\s*(${REL_OPS.map(escapeRe).join('|')})\\s*(.+?)\\s*(?::\\s*(.*))?$`);
    if ((m = t.match(relRe))) {
      const { head, dashed } = opToEdge(m[2]);
      const leftRaw = m[1].trim();
      const rightRaw = m[3].trim();
      const leftCard = leftRaw.match(/"([^"]*)"\s*$/);
      const rightCard = rightRaw.match(/^"([^"]*)"/);
      const leftId = stripQuotes(leftCard ? leftRaw.replace(leftCard[0], '') : leftRaw).trim();
      const rightId = stripQuotes(rightCard ? rightRaw.replace(rightCard[0], '') : rightRaw).trim();
      if (!leftId || !rightId) continue;
      ensure(leftId, 'class', l);
      ensure(rightId, 'class', l);
      const labelParts = [m[4] ?? '', leftCard ? leftCard[1] : '', rightCard ? rightCard[1] : ''].filter(Boolean);
      ir.edges.push({
        id: nid('rel'), from: leftId, to: rightId,
        label: labelParts.join(' ') || undefined,
        head, dashed, ref: refOf(l), data: { uml: m[2] },
      });
      continue;
    }

    if (/^note\b/i.test(t)) { ir.unparsed.push({ text: t, line: l.no }); continue; }
    if (t) {
      ir.unparsed.push({ text: t, line: l.no });
      diagnostics.push({ severity: 'info', message: `未识别：${t.slice(0, 30)}`, span: refOf(l).span, code: 'PUML_CLASS_UNRECOGNIZED' });
    }
  }
}

function parseMember(s: string) {
  const t = s.trim();
  const vis = t.match(/^([+\-#~])/);
  const visibility = vis ? (vis[1] as '+' | '-' | '#' | '~') : undefined;
  const isMethod = /\(\s*\)/.test(t);
  const isStatic = /\{static\}/.test(t) || /\$/.test(t);
  const isAbstract = /\{abstract\}/.test(t);
  const text = t.replace(/\{[^}]*\}/g, '').trim();
  return { text, visibility, isMethod, static: isStatic, abstract: isAbstract };
}

// ---------------------------------------------------------------- 用例图

function parseUsecase(srcLines: Line[], ir: DiagramIR, _diagnostics: Diagnostic[]) {
  const lines = readGlobals(srcLines, ir);
  const byId = new Map<string, NodeIR>();
  const groupStack: GroupIR[] = [];

  const idOfUsecase = (raw: string): string | null => {
    const m = raw.trim().match(/^\(?\s*(?:"([^"]+)"|([^():]+?))\s*\)?$/);
    if (!m) return null;
    return m[1] ?? m[2] ?? null;
  };

  const ensure = (id: string, kind: 'actor' | 'usecase' | 'scope', line?: Line): NodeIR => {
    let n = byId.get(id);
    if (!n) {
      n = addNode(ir, {
        id,
        label: id,
        kind,
        shape: kind === 'actor' ? 'actor' : kind === 'usecase' ? 'stadium' : 'rect',
        ref: line ? refOf(line) : undefined,
      });
      byId.set(id, n);
      if (groupStack.length && kind !== 'scope') {
        n.groupId = groupStack[groupStack.length - 1].id;
        groupStack[groupStack.length - 1].children.push(id);
      }
    }
    return n;
  };

  for (const l of lines) {
    const t = l.text;
    let m: RegExpMatchArray | null;

    if ((m = t.match(/^(rectangle|package|frame|cloud)\s+(.+?)\s*\{$/i))) {
      const g: GroupIR = { id: nid('scope'), label: stripQuotes(m[2]), kind: 'boundary', children: [], ref: refOf(l) };
      ir.groups.push(g);
      groupStack.push(g);
      continue;
    }
    if (/^\}$/.test(t)) { groupStack.pop(); continue; }

    if ((m = t.match(/^(actor|usecase)\s+(.+?)\s*$/i))) {
      const kind = m[1].toLowerCase() === 'actor' ? 'actor' : 'usecase';
      const rest = m[2];
      const asQuoted = rest.match(/^"([^"]*)"\s+as\s+(\S+)$/i);
      const asPlain = rest.match(/^(\S+)\s+as\s+(.+)$/i);
      if (asQuoted) ensure(asQuoted[2], kind, l).label = asQuoted[1];
      else if (asPlain) ensure(asPlain[1], kind, l).label = stripQuotes(asPlain[2]);
      else if (/^"[^"]*"$/.test(rest)) ensure(stripQuotes(rest), kind, l);
      else if (/^:.+:$/.test(rest)) ensure(rest.replace(/:/g, ''), kind, l);
      else ensure(rest, kind, l);
      continue;
    }
    if ((m = t.match(/^actor\s+:(.+):$/i))) { ensure(m[1].trim(), 'actor', l); continue; }

    // 关系
    const rel = t.match(/^(.+?)\s*(-->|<--|\.\.>|<-\.|\.\.<|--)\s*(.+?)\s*(?::\s*(.*))?$/);
    if (rel) {
      const rev = rel[2].startsWith('<');
      const a = idOfUsecase(rev ? rel[3] : rel[1]);
      const b = idOfUsecase(rev ? rel[1] : rel[3]);
      if (a && b) {
        const ka: 'actor' | 'usecase' = /^\(/.test(rel[1].trim()) ? 'usecase' : 'actor';
        const kb: 'actor' | 'usecase' = /^\(/.test(rel[3].trim()) ? 'usecase' : 'actor';
        ensure(a, rev ? kb : ka, l);
        ensure(b, rev ? ka : kb, l);
        ir.edges.push({
          id: nid('urel'), from: a, to: b,
          label: rel[4] || undefined,
          dashed: /\.\./.test(rel[2]),
          head: 'arrow',
          ref: refOf(l),
        });
      }
      continue;
    }

    // 单独的用例 (Login)
    if ((m = t.match(/^\(\s*(.+?)\s*\)$/))) { ensure(m[1], 'usecase', l); continue; }
    if (t) ir.unparsed.push({ text: t, line: l.no });
  }
}

// ---------------------------------------------------------------- 状态图

function parseState(srcLines: Line[], ir: DiagramIR, _diagnostics: Diagnostic[]) {
  const lines = readGlobals(srcLines, ir);
  const byId = new Map<string, NodeIR>();
  const groupStack: GroupIR[] = [];

  const ensure = (id: string, line?: Line): NodeIR => {
    let n = byId.get(id);
    if (!n) {
      n = addNode(ir, { id, label: id, kind: 'state', shape: 'round', ref: line ? refOf(line) : undefined });
      byId.set(id, n);
      if (groupStack.length) {
        n.groupId = groupStack[groupStack.length - 1].id;
        groupStack[groupStack.length - 1].children.push(id);
      }
    }
    return n;
  };
  const ensurePseudo = (line?: Line): NodeIR => {
    const id = '__pseudo__';
    let n = byId.get(id);
    if (!n) { n = addNode(ir, { id, label: '', kind: 'pseudo', shape: 'dot', ref: line ? refOf(line) : undefined }); byId.set(id, n); }
    return n;
  };

  for (const l of lines) {
    const t = l.text;
    let m: RegExpMatchArray | null;

    if ((m = t.match(/^state\s+(.+?)\s*\{$/i))) {
      const label = stripQuotes(m[1]);
      const g: GroupIR = {
        id: nid('st'), label, kind: 'stateGroup',
        parentId: groupStack.length ? groupStack[groupStack.length - 1].id : undefined,
        children: [], ref: refOf(l),
      };
      ir.groups.push(g);
      groupStack.push(g);
      ensure(label, l);
      continue;
    }
    if (/^\}$/.test(t)) { groupStack.pop(); continue; }

    if ((m = t.match(/^state\s+(.+?)\s*$/i))) {
      const rest = m[1];
      const asPlain = rest.match(/^"([^"]*)"\s+as\s+(\S+)$/i);
      if (asPlain) ensure(asPlain[2], l).label = asPlain[1];
      else ensure(stripQuotes(rest), l);
      continue;
    }

    const rel = t.match(/^(.+?)\s*(-(?:up|down|left|right)?-?>-?|-?->|-->)\s*(.+?)\s*(?::\s*(.*))?$/);
    if (rel) {
      const left = rel[1].trim();
      const right = rel[3].trim();
      const lid = left === '[*]' ? ensurePseudo(l).id : stripQuotes(left);
      const rid = right === '[*]' ? ensurePseudo(l).id : stripQuotes(right);
      if (left !== '[*]') ensure(lid, l);
      if (right !== '[*]') ensure(rid, l);
      ir.edges.push({
        id: nid('srel'), from: lid, to: rid,
        label: rel[4] || undefined,
        dashed: rel[2].includes('--'),
        head: 'arrow',
        ref: refOf(l),
      });
      continue;
    }
    if (t) ir.unparsed.push({ text: t, line: l.no });
  }
}

// ---------------------------------------------------------------- 组件 / 部署图

const COMPONENT_SHAPES: Record<string, NodeIR['shape']> = {
  database: 'cylinder', storage: 'cylinder', queue: 'cylinder',
  cloud: 'cloud', node: 'frame', frame: 'frame', folder: 'frame',
  interface: 'circle', component: 'rect', package: 'rect', rectangle: 'rect',
};

function parseComponent(srcLines: Line[], ir: DiagramIR, _diagnostics: Diagnostic[]) {
  const lines = readGlobals(srcLines, ir);
  const byId = new Map<string, NodeIR>();
  const groupStack: GroupIR[] = [];

  const ensure = (id: string, kind = 'component', line?: Line): NodeIR => {
    let n = byId.get(id);
    if (!n) {
      n = addNode(ir, {
        id, label: id, kind,
        shape: COMPONENT_SHAPES[kind] ?? 'rect',
        ref: line ? refOf(line) : undefined,
      });
      byId.set(id, n);
      if (groupStack.length) {
        n.groupId = groupStack[groupStack.length - 1].id;
        groupStack[groupStack.length - 1].children.push(id);
      }
    }
    return n;
  };

  const declare = (rest: string, kind: string, line: Line) => {
    const asQuoted = rest.match(/^"([^"]*)"\s+as\s+(\S+)$/i);
    if (asQuoted) { ensure(asQuoted[2], kind, line).label = asQuoted[1]; return; }
    const bracket = rest.match(/^\[\s*(.+?)\s*\]$/);
    if (bracket) { ensure(bracket[1], kind, line); return; }
    if (/^"[^"]*"$/.test(rest)) { ensure(stripQuotes(rest), kind, line); return; }
    const asPlain = rest.match(/^(\S+)\s+as\s+(.+)$/i);
    if (asPlain) { ensure(asPlain[1], kind, line).label = stripQuotes(asPlain[2]); return; }
    ensure(rest, kind, line);
  };

  for (const l of lines) {
    const t = l.text;
    let m: RegExpMatchArray | null;

    if ((m = t.match(/^(package|node|cloud|folder|frame|rectangle|database)\s+(.+?)\s*\{$/i))) {
      const g: GroupIR = {
        id: nid('cpkg'), label: stripQuotes(m[2]), kind: 'package',
        parentId: groupStack.length ? groupStack[groupStack.length - 1].id : undefined,
        children: [], ref: refOf(l),
      };
      ir.groups.push(g);
      groupStack.push(g);
      continue;
    }
    if (/^\}$/.test(t)) { groupStack.pop(); continue; }

    if ((m = t.match(/^(component|interface|database|cloud|node|queue|storage|folder|frame|package|rectangle|actor|boundary|control|entity)\s+(.+?)\s*$/i))) {
      declare(m[2].trim(), m[1].toLowerCase(), l);
      continue;
    }
    if ((m = t.match(/^\[\s*(.+?)\s*\]$/))) { ensure(m[1], 'component', l); continue; }

    const rel = t.match(/^(.+?)\s*(-->>|--|-->|\.\.>|\.\.)\s*(.+?)\s*(?::\s*(.*))?$/);
    if (rel) {
      const a = stripQuotes(rel[1].trim()).replace(/^\[|\]$/g, '');
      const b = stripQuotes(rel[3].trim()).replace(/^\[|\]$/g, '');
      if (a && b) {
        ensure(a, 'component', l);
        ensure(b, 'component', l);
        ir.edges.push({
          id: nid('crel'), from: a, to: b,
          label: rel[4] || undefined,
          dashed: /\.\./.test(rel[2]),
          head: rel[2].includes('>') ? 'arrow' : 'none',
          ref: refOf(l),
        });
      }
      continue;
    }
    if (t) ir.unparsed.push({ text: t, line: l.no });
  }
}

// ---------------------------------------------------------------- 思维导图

function parseMindmap(srcLines: Line[], ir: DiagramIR, _diagnostics: Diagnostic[]) {
  const lines = readGlobals(srcLines, ir);
  const stack: Array<{ depth: number; id: string }> = [];

  for (const l of lines) {
    const t = l.text;
    const m = t.match(/^(\*+)\s*(?:\[([^\]]*)\]\s*)?(.*)$/);
    if (!m) continue;
    const depth = m[1].length;
    const colorRaw = (m[2] ?? '').replace(/^#/, '').trim();
    let label = (m[3] ?? '').trim();
    label = label.replace(/^:|;$/g, '').trim();

    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    const parent = stack.length ? stack[stack.length - 1].id : undefined;

    const node: NodeIR = {
      id: nid('mm'),
      label,
      kind: depth === 1 ? 'root' : 'topic',
      shape: 'round',
      ref: refOf(l),
      data: { depth },
      style: colorRaw ? { fill: normalizeColor(colorRaw) } : undefined,
    };
    addNode(ir, node);
    stack.push({ depth, id: node.id });

    if (parent) {
      ir.edges.push({ id: nid('mme'), from: parent, to: node.id, head: 'none', ref: refOf(l) });
      node.groupId = parent;
    }
  }
}

function normalizeColor(c: string): string {
  if (/^[0-9a-fA-F]{6}$/.test(c)) return '#' + c;
  if (/^[0-9a-fA-F]{3}$/.test(c)) return '#' + c;
  const named: Record<string, string> = {
    pink: '#f6b6c8', red: '#f2a3a3', orange: '#f7c08a', yellow: '#f5dd8a',
    green: '#a9d6a0', blue: '#9fc5e8', indigo: '#a8b3e8', violet: '#c3a8e0',
    purple: '#c3a8e0', gray: '#c9c9c9', grey: '#c9c9c9', white: '#ffffff', black: '#333333',
  };
  return named[c.toLowerCase()] ?? '#e8eef7';
}

// ---------------------------------------------------------------- 活动图

function parseActivity(srcLines: Line[], ir: DiagramIR, _diagnostics: Diagnostic[]) {
  const lines = readGlobals(srcLines, ir);
  const byId = new Map<string, NodeIR>();
  let current: string | null = null;
  let pendingLabel: string | undefined;
  const ifStack: Array<{ decision: string; ends: string[]; noLabel?: string }> = [];
  const forkStack: Array<{ bar: string; ends: string[] }> = [];
  const whileStack: Array<{ decision: string; noLabel?: string }> = [];

  const node = (kind: string, shape: NodeIR['shape'], label: string, line?: Line): NodeIR => {
    const n: NodeIR = {
      id: nid('a'), label, kind, shape, ref: line ? refOf(line) : undefined,
    };
    addNode(ir, n);
    byId.set(n.id, n);
    return n;
  };
  const link = (from: string | null, to: string, label?: string, line?: Line) => {
    if (!from) return;
    ir.edges.push({ id: nid('ae'), from, to, label, head: 'arrow', ref: line ? refOf(line) : undefined });
  };
  const emit = (kind: string, shape: NodeIR['shape'], label: string, line?: Line): NodeIR => {
    const n = node(kind, shape, label, line);
    link(current, n.id, pendingLabel, line);
    pendingLabel = undefined;
    current = n.id;
    return n;
  };

  for (const l of lines) {
    const t = l.text;
    let m: RegExpMatchArray | null;

    if (/^(start)$/i.test(t) || /\(\s*\*\s*\)/.test(t) && /^(\(\s*\*\s*\)|-->\s*\(\s*\*\s*\)|\(\s*\*\s*\)\s*-->)/.test(t)) {
      // 兼容旧语法 (*) 作为起点/终点
      if (current === null) { const n = node('start', 'dot', '', l); current = n.id; }
      else { const n = node('end', 'bullseye', '', l); link(current, n.id, pendingLabel, l); pendingLabel = undefined; current = null; }
      continue;
    }
    if (/^(stop|end)$/i.test(t)) {
      const n = node('end', 'bullseye', '', l);
      link(current, n.id, pendingLabel, l);
      pendingLabel = undefined;
      current = null;
      continue;
    }
    if ((m = t.match(/^:\s*([\s\S]*?)\s*;?$/))) {
      let text = m[1];
      if (text.endsWith(';')) text = text.slice(0, -1);
      emit('activity', 'round', text.trim(), l);
      continue;
    }
    if ((m = t.match(/^if\s*\((.*?)\)\s*then\s*(\((.*?)\))?\s*$/i))) {
      const d = node('decision', 'diamond', m[1].trim(), l);
      link(current, d.id, pendingLabel, l);
      pendingLabel = m[3]?.trim();
      current = d.id;
      ifStack.push({ decision: d.id, ends: [], noLabel: undefined });
      continue;
    }
    if ((m = t.match(/^else\s*(\((.*?)\))?\s*$/i))) {
      const ctx = ifStack[ifStack.length - 1];
      if (ctx) { ctx.ends.push(current ?? ctx.decision); current = ctx.decision; pendingLabel = m[2]?.trim(); }
      continue;
    }
    if (/^endif$/i.test(t)) {
      const ctx = ifStack.pop();
      if (ctx) {
        ctx.ends.push(current ?? ctx.decision);
        const merge = node('merge', 'dot', '', l);
        for (const e of ctx.ends) if (e !== merge.id) ir.edges.push({ id: nid('ae'), from: e, to: merge.id, head: 'arrow', ref: refOf(l) });
        current = merge.id;
        pendingLabel = undefined;
      }
      continue;
    }
    if ((m = t.match(/^while\s*\((.*?)\)\s*(?:is\s*(\((.*?)\)))?\s*$/i))) {
      const d = node('decision', 'diamond', m[1].trim(), l);
      link(current, d.id, pendingLabel, l);
      pendingLabel = m[3]?.trim();
      current = d.id;
      whileStack.push({ decision: d.id, noLabel: undefined });
      continue;
    }
    if (/^endwhile$/i.test(t)) {
      const ctx = whileStack.pop();
      if (ctx) {
        ir.edges.push({ id: nid('ae'), from: current ?? ctx.decision, to: ctx.decision, head: 'arrow', ref: refOf(l) });
        current = ctx.decision;
        pendingLabel = ctx.noLabel;
      }
      continue;
    }
    if (/^fork$/i.test(t)) {
      const bar = node('fork', 'bar', '', l);
      link(current, bar.id, pendingLabel, l);
      pendingLabel = undefined;
      current = bar.id;
      forkStack.push({ bar: bar.id, ends: [] });
      continue;
    }
    if (/^fork again$/i.test(t)) {
      const ctx = forkStack[forkStack.length - 1];
      if (ctx) { ctx.ends.push(current ?? ctx.bar); current = ctx.bar; }
      continue;
    }
    if (/^end (fork|merge)$/i.test(t)) {
      const ctx = forkStack.pop();
      if (ctx) {
        ctx.ends.push(current ?? ctx.bar);
        const bar = node('join', 'bar', '', l);
        for (const e of ctx.ends) ir.edges.push({ id: nid('ae'), from: e, to: bar.id, head: 'arrow', ref: refOf(l) });
        current = bar.id;
      }
      continue;
    }
    if ((m = t.match(/^-\s*>\s*(.*?)\s*;?$/))) { pendingLabel = m[1].trim() || undefined; continue; }
    if ((m = t.match(/^(\S+)\s*-->\s*(\S+)\s*(?::\s*(.*))?$/))) {
      const a = byId.get(m[1]) ?? node('activity', 'round', m[1], l);
      const b = byId.get(m[2]) ?? node('activity', 'round', m[2], l);
      link(a.id, b.id, m[3]?.trim(), l);
      current = b.id;
      continue;
    }
    if (/^partition\s+/i.test(t)) continue;
    if (t) ir.unparsed.push({ text: t, line: l.no });
  }
}
