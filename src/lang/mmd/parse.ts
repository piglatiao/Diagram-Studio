/**
 * L3 · Mermaid 轻量解析器
 *
 * 说明（重要设计决策）：
 * Mermaid 的**渲染**交给 mermaid.js 原生完成（保证与官方产出一致）。
 * 这里的解析器只用于产出「尽力而为」的 IR，服务三件事：
 *   1. 大纲树 / 结构视图
 *   2. 图形 → 源码定位（点击 SVG 节点跳到源码行）
 *   3. 后续补丁回写（M2）
 * 解析失败不影响渲染 —— IR 是可选能力，不是主链路。
 */
import {
  DiagramIR, Diagnostic, ParseResult, SourceRef, NodeIR, emptyIR, hashString,
} from '../../ir/types';

interface Ln { text: string; start: number; end: number; no: number }

function toLines(src: string): Ln[] {
  const out: Ln[] = [];
  let off = 0, no = 0;
  for (const raw of src.split('\n')) {
    out.push({ text: raw.trim(), start: off, end: off + raw.length, no: no++ });
    off += raw.length + 1;
  }
  return out;
}

function refOf(l: Ln): SourceRef {
  return {
    span: { start: l.start, end: l.end, startLine: l.no, startCol: 0, endLine: l.no, endCol: l.text.length },
    text: l.text,
  };
}

/**
 * 节点 token 的形状包裹语法。
 *
 * 顺序即优先级：复合括号（((t)) / [[t]] / {{t}} / [(t)] / ([t]) / [/t/] / [/t\] / >t]）
 * 必须排在单括号（(t) / [t] / {t}）之前，否则 `([起点])` 会被 `(t)` 截成半截，
 * 连带把整条连线吃掉 —— 这是画布「读 Mermaid」时最常见的失真来源。
 */
export const MMD_WRAPPERS: Array<[string, string, string]> = [
  ['((', '))', 'circle'],
  ['[[', ']]', 'subprocess'],
  ['{{', '}}', 'hexagon'],
  ['[(', ')]', 'cylinder'],
  ['([', '])', 'stadium'],
  ['[/', '/]', 'parallelogram'],
  ['[/', '\\]', 'trapezoid'],
  ['>', ']', 'note'],
  ['(', ')', 'round'],
  ['[', ']', 'rect'],
  ['{', '}', 'diamond'],
];

const MMD_ID = '[A-Za-z0-9_\\u4e00-\\u9fff]+';
const MMD_WRAP = MMD_WRAPPERS.map(([o, c]) => `${esc(o)}.*?${esc(c)}`).join('|');
const MMD_TOK = `(${MMD_ID}(?:\\s*(?:${MMD_WRAP}))?)`;

function esc(s: string): string {
  return s.replace(/[\\^$.*+?()[\]{}|]/g, (ch) => `\\${ch}`);
}

/** 形如 `A -->|标签| B[文字]` 的连线 */
const MMD_EDGE_RE = new RegExp(
  `${MMD_TOK}\\s*(-\\.->|-->|---|==>)\\s*(?:\\|([^|]*)\\|)?\\s*${MMD_TOK}`,
);
/** 形如 `B[文字]` 的孤立节点声明（至少带一层形状括号） */
const MMD_SOLO_RE = new RegExp(`^${MMD_ID}\\s*(?:${MMD_WRAP})$`);

export function parseMermaid(source: string): ParseResult {
  const t0 = performance.now();
  const ir = emptyIR('mermaid', hashString(source));
  const diagnostics: Diagnostic[] = [];
  const lines = toLines(source);

  const head = lines.find((l) => l.text && !l.text.startsWith('%%'))?.text ?? '';
  let kind: DiagramIR['kind'] = 'unknown';
  if (/^flowchart|^graph\b/i.test(head)) kind = 'flowchart';
  else if (/^sequenceDiagram/i.test(head)) kind = 'sequence';
  else if (/^classDiagram/i.test(head)) kind = 'class';
  else if (/^stateDiagram/i.test(head)) kind = 'state';
  else if (/^erDiagram/i.test(head)) kind = 'class';
  else if (/^mindmap/i.test(head)) kind = 'mindmap';
  else if (/^gantt/i.test(head)) kind = 'gantt';
  ir.kind = kind;

  const byId = new Map<string, NodeIR>();
  let uid = 0;
  const ensure = (id: string, label?: string, shape?: NodeIR['shape'], line?: Ln): NodeIR => {
    let n = byId.get(id);
    if (!n) {
      n = { id, label: label ?? id, shape: shape ?? 'rect', kind, ref: line ? refOf(line) : undefined };
      ir.nodes.push(n);
      byId.set(id, n);
    } else if (label && n.label === n.id) n.label = label;
    return n;
  };
  const nid = (p: string) => `${p}${(uid++).toString(36)}`;

  try {
    for (const l of lines) {
      const t = l.text;
      if (!t || t.startsWith('%%')) continue;

      if (kind === 'flowchart') {
        // subgraph
        let m = t.match(/^subgraph\s+(\S+)\s*(?:\[(.*?)\])?/i);
        if (m) {
          const g = { id: m[1], label: m[2] ?? m[1], kind: 'cluster' as const, children: [] as string[], ref: refOf(l) };
          ir.groups.push(g);
          continue;
        }
        if (/^end$/i.test(t)) continue;

        // 边：A[文本] -->|标签| B{判断}（含 ([开始]) / [(DB)] / [[子流程]] 等复合形状）
        if ((m = t.match(MMD_EDGE_RE))) {
          const a = parseNodeToken(m[1], ensure, l);
          const b = parseNodeToken(m[4], ensure, l);
          ir.edges.push({
            id: nid('e'), from: a, to: b,
            label: m[3]?.trim() || undefined,
            dashed: m[2] === '-.->',
            head: m[2] === '---' ? 'none' : 'arrow',
            ref: refOf(l),
          });
          continue;
        }
        // 孤立节点声明
        if (MMD_SOLO_RE.test(t)) { parseNodeToken(t, ensure, l); continue; }
        continue;
      }

      if (kind === 'sequence') {
        let m = t.match(/^participant\s+(\S+)(?:\s+as\s+(.+))?$/i);
        if (m) { ensure(m[1], m[2]?.trim(), 'rect', l).kind = 'participant'; continue; }
        m = t.match(/^actor\s+(\S+)(?:\s+as\s+(.+))?$/i);
        if (m) { ensure(m[1], m[2]?.trim(), 'actor', l).kind = 'participant'; continue; }
        m = t.match(/^(\S+)\s*(->>|-->>|->|-->|--x|-x)\s*(\S+)\s*(?::\s*(.*))?$/);
        if (m) {
          ensure(m[1], undefined, 'rect', l).kind = 'participant';
          ensure(m[3], undefined, 'rect', l).kind = 'participant';
          ir.edges.push({
            id: nid('e'), from: m[1], to: m[3], label: m[4]?.trim() || undefined,
            dashed: m[2].includes('--'), head: 'arrow', order: ir.edges.length, ref: refOf(l),
          });
          continue;
        }
        continue;
      }

      if (kind === 'class') {
        let m = t.match(/^class\s+(\S+)\s*\{?$/i);
        if (m) { ensure(m[1], undefined, 'rect', l).kind = 'class'; continue; }
        m = t.match(/^(\S+)\s*:\s*(.*)$/);
        if (m && byId.has(m[1])) {
          const n = byId.get(m[1])!;
          n.members = [...(n.members ?? []), { text: m[2].trim(), isMethod: /\(\s*\)/.test(m[2]) }];
          continue;
        }
        m = t.match(/^(\S+)\s*(<\|--|--\*>|--o>|\.\.>|--\|>|<\|\.\.|-->)\s*(\S+)\s*(?::\s*(.*))?$/);
        if (m) {
          ensure(m[1], undefined, 'rect', l).kind = 'class';
          ensure(m[3], undefined, 'rect', l).kind = 'class';
          ir.edges.push({ id: nid('e'), from: m[1], to: m[3], label: m[4]?.trim() || undefined, dashed: m[2].startsWith('..'), head: 'arrow', ref: refOf(l) });
          continue;
        }
        continue;
      }

      if (kind === 'mindmap') {
        const m = t.match(/^([\s]*)((?:\(|\[|\(\(|\[\[)?)\s*(.+?)$/);
        if (m) {
          const depth = Math.floor(m[1].replace(/\t/g, '  ').length / 2) + 1;
          const n: NodeIR = { id: nid('mm'), label: m[3].trim(), shape: 'round', kind: 'topic', ref: refOf(l), data: { depth } };
          ir.nodes.push(n);
        }
        continue;
      }
    }
  } catch (e) {
    diagnostics.push({
      severity: 'info',
      message: `IR 解析降级（不影响渲染）：${e instanceof Error ? e.message : String(e)}`,
      code: 'MMD_IR_DEGRADED',
    });
  }

  ir.fidelity.complete = ir.nodes.length > 0;
  if (ir.nodes.length === 0) {
    ir.fidelity.lossy.push('mermaid.ir.notExtracted');
  }
  return { ir, diagnostics, durationMs: performance.now() - t0 };
}

function parseNodeToken(tok: string, ensure: (id: string, label?: string, shape?: NodeIR['shape'], line?: Ln) => NodeIR, l: Ln): string {
  const t = tok.trim();
  const m = t.match(/^([A-Za-z0-9_\u4e00-\u9fff]+)\s*(.*)$/);
  if (!m) return ensure(t, undefined, 'rect', l).id;
  const id = m[1];
  const rest = m[2].trim();
  if (!rest) return ensure(id, undefined, 'rect', l).id;
  for (const [open, close, shape] of MMD_WRAPPERS) {
    if (rest.length > open.length + close.length && rest.startsWith(open) && rest.endsWith(close)) {
      const text = rest.slice(open.length, rest.length - close.length).trim();
      return ensure(id, text || id, shape as NodeIR['shape'], l).id;
    }
  }
  // 包裹不成对（例如只写了 `A[没有右括号`）：仍认下这个节点，标签按原文兜底
  return ensure(id, rest || id, 'rect', l).id;
}
