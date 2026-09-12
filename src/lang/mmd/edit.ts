/** L3 · Mermaid：IR 补丁 → 最小化源码文本编辑 */
import { DiagramIR, TextEdit } from '../../ir/types';
import { DiagramPatch, editAt, expandToLine, insertLineEdit } from '../../ir/patch';

const WORD = /[A-Za-z0-9_一-龥]/;

function replaceInRange(source: string, base: number, text: string, oldWord: string, newWord: string): TextEdit[] {
  const out: TextEdit[] = [];
  let i = 0;
  for (;;) {
    const idx = text.indexOf(oldWord, i);
    if (idx < 0) break;
    const before = idx > 0 ? text[idx - 1] : '';
    const after = idx + oldWord.length < text.length ? text[idx + oldWord.length] : '';
    if ((!before || !WORD.test(before)) && (!after || !WORD.test(after))) {
      out.push(editAt(source, base + idx, base + idx + oldWord.length, newWord));
    }
    i = idx + 1;
  }
  return out;
}

function escRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const HEADER_RE =
  /^\s*(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|quadrantChart|requirementDiagram|sankey-beta|architecture-beta|C4Context)\b/im;

/** 源码里是否已有图表类型声明 */
function hasHeader(source: string): boolean {
  return HEADER_RE.test(source);
}

function stmtEnds(ir: DiagramIR): number[] {
  return [
    ...ir.nodes.map((n) => n.ref?.span.end ?? 0),
    ...ir.edges.map((e) => e.ref?.span.end ?? 0),
  ];
}

function updateNode(ir: DiagramIR, source: string, id: string, label: string): TextEdit[] {
  const n = ir.nodes.find((x) => x.id === id);
  if (!n?.ref) return [];
  const { start, end } = n.ref.span;
  const txt = source.slice(start, end);

  // A[旧标签] / A(旧) / A{旧}
  const re = new RegExp(escRe(n.id) + '\\s*([(\\[{])([^)\\]}]*)([)\\]}])');
  const m = txt.match(re);
  if (m && m.index !== undefined && m[2] !== undefined) {
    const innerStart = start + m.index + m[0].lastIndexOf(m[2]);
    return [editAt(source, innerStart, innerStart + m[2].length, label)];
  }
  // 重命名标识符
  if (n.label === n.id) {
    const edits: TextEdit[] = replaceInRange(source, start, txt, n.id, label);
    for (const e of ir.edges) {
      if (e.from !== id && e.to !== id) continue;
      if (!e.ref) continue;
      const et = source.slice(e.ref.span.start, e.ref.span.end);
      edits.push(...replaceInRange(source, e.ref.span.start, et, id, label));
    }
    return edits;
  }
  const idx = txt.indexOf(n.label);
  if (idx < 0) return [];
  return [editAt(source, start + idx, start + idx + n.label.length, label)];
}

function removeNode(ir: DiagramIR, source: string, id: string): TextEdit[] {
  const n = ir.nodes.find((x) => x.id === id);
  if (!n?.ref) return [];
  const { start, end } = n.ref.span;
  const txt = source.slice(start, end);
  // 该行同时也是关系声明时不做删除，避免误删边
  if (/-->|---|-\.->|==>/.test(txt)) return [];

  const edits: TextEdit[] = [];
  const r = expandToLine(source, n.ref.span);
  edits.push(editAt(source, r.start, r.end, ''));
  for (const e of ir.edges) {
    if (e.from !== id && e.to !== id) continue;
    if (!e.ref) continue;
    const er = expandToLine(source, e.ref.span);
    edits.push(editAt(source, er.start, er.end, ''));
  }
  return edits;
}

function removeEdge(ir: DiagramIR, source: string, id: string): TextEdit[] {
  const e = ir.edges.find((x) => x.id === id);
  if (!e?.ref) return [];
  const r = expandToLine(source, e.ref.span);
  return [editAt(source, r.start, r.end, '')];
}

function updateEdge(ir: DiagramIR, source: string, id: string, label: string): TextEdit[] {
  const e = ir.edges.find((x) => x.id === id);
  if (!e?.ref) return [];
  const { start, end } = e.ref.span;
  const txt = source.slice(start, end);

  const pipe = txt.match(/\|[^|]*\|/);
  if (pipe && pipe.index !== undefined) {
    return [editAt(source, start + pipe.index, start + pipe.index + pipe[0].length, `|${label}|`)];
  }
  const arrowIdx = txt.search(/-\.->|==*>?|--*>?/);
  if (arrowIdx >= 0) {
    const head = txt.slice(arrowIdx).match(/^(-\.->|==*>?|--*>?)/);
    const aEnd = arrowIdx + (head ? head[0].length : 0);
    return [editAt(source, start + aEnd, start + aEnd, `|${label}|`)];
  }
  return [editAt(source, end, end, ` --> ${label}`)];
}

export function mmdEdits(ir: DiagramIR, source: string, patch: DiagramPatch): TextEdit[] {
  switch (patch.op) {
    case 'update-node':
      return updateNode(ir, source, patch.id, patch.label);
    case 'add-node': {
      const shape = `${patch.id}[${patch.label}]`;
      // 从已有节点拖出来：一行同时完成「声明 + 连线」
      const text = patch.connectFrom ? `${patch.connectFrom} --> ${shape}` : shape;
      // 源码被清空时补上图表头，否则 mermaid 渲染不出来
      const body = hasHeader(source) ? text : `flowchart TD\n${text}`;
      return [insertLineEdit(source, stmtEnds(ir), body)];
    }
    case 'remove-node':
      return removeNode(ir, source, patch.id);
    case 'add-edge': {
      const text = `${patch.from} --> ${patch.to}${patch.label ? `|${patch.label}|` : ''}`;
      return [insertLineEdit(source, stmtEnds(ir), text)];
    }
    case 'remove-edge':
      return removeEdge(ir, source, patch.id);
    case 'update-edge':
      return updateEdge(ir, source, patch.id, patch.label);
    case 'move-node':
      return [];
    default:
      return [];
  }
}

export function nextMmdId(ir: DiagramIR, prefix = 'N'): string {
  let i = 1;
  const used = new Set(ir.nodes.map((n) => n.id));
  while (used.has(`${prefix}${i}`)) i++;
  return `${prefix}${i}`;
}
