/** L3 · PlantUML：IR 补丁 → 最小化源码文本编辑 */
import { DiagramIR, NodeIR, TextEdit } from '../../ir/types';
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

function stmtEnds(ir: DiagramIR): number[] {
  return [
    ...ir.nodes.map((n) => n.ref?.span.end ?? 0),
    ...ir.edges.map((e) => e.ref?.span.end ?? 0),
  ];
}

function declFor(kind: string, id: string, label: string): string {
  switch (kind) {
    case 'class': return `class ${id}`;
    case 'usecase': return `usecase "${label}" as ${id}`;
    case 'state': return `state "${label}" as ${id}`;
    case 'component': return `component "${label}" as ${id}`;
    case 'mindmap': return `* ${label}`;
    case 'activity': return `:${label};`;
    default: return `component "${label}" as ${id}`;
  }
}

function updateNode(ir: DiagramIR, source: string, id: string, label: string): TextEdit[] {
  const n = ir.nodes.find((x) => x.id === id);
  if (!n?.ref) return [];
  const { start, end } = n.ref.span;
  const txt = source.slice(start, end);

  // 1) 引号形式：participant "旧名" as A
  const q = `"${n.label}"`;
  const qi = txt.indexOf(q);
  if (qi >= 0) {
    return [editAt(source, start + qi + 1, start + qi + 1 + n.label.length, label)];
  }
  // 2) 重命名标识符：节点声明 + 所有引用它的关系
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
  // 3) 裸文本
  const idx = txt.indexOf(n.label);
  if (idx < 0) return [];
  return [editAt(source, start + idx, start + idx + n.label.length, label)];
}

function removeNode(ir: DiagramIR, source: string, id: string): TextEdit[] {
  const edits: TextEdit[] = [];
  const n = ir.nodes.find((x) => x.id === id);
  if (n?.ref) {
    const r = expandToLine(source, n.ref.span);
    edits.push(editAt(source, r.start, r.end, ''));
  }
  for (const e of ir.edges) {
    if (e.from !== id && e.to !== id) continue;
    if (!e.ref) continue;
    const r = expandToLine(source, e.ref.span);
    edits.push(editAt(source, r.start, r.end, ''));
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
  const ci = txt.indexOf(':');
  if (ci >= 0) {
    const nl = txt.indexOf('\n', ci);
    const stop = nl >= 0 ? nl : txt.length;
    return [editAt(source, start + ci + 1, start + stop, ' ' + label)];
  }
  return [editAt(source, end, end, ' : ' + label)];
}

export function pumlEdits(ir: DiagramIR, source: string, patch: DiagramPatch): TextEdit[] {
  switch (patch.op) {
    case 'update-node':
      return updateNode(ir, source, patch.id, patch.label);
    case 'add-node': {
      const decl = declFor(ir.kind, patch.id, patch.label);
      // 从已有节点拖出来：声明 + 关系一并写入（mindmap / activity 无关系语法）
      const linkable = patch.connectFrom && !['mindmap', 'activity'].includes(ir.kind);
      const body = linkable ? `${decl}\n${patch.connectFrom} --> ${patch.id}` : decl;
      // 源码被清空（连 @startuml 都没有）时补上外壳，否则解析不出任何东西
      if (!/@start\w+/i.test(source)) {
        return [editAt(source, 0, source.length, `@startuml\n${body}\n@enduml\n`)];
      }
      return [insertLineEdit(source, stmtEnds(ir), body)];
    }
    case 'remove-node':
      return removeNode(ir, source, patch.id);
    case 'add-edge': {
      const text = `${patch.from} --> ${patch.to}${patch.label ? ' : ' + patch.label : ''}`;
      return [insertLineEdit(source, stmtEnds(ir), text)];
    }
    case 'remove-edge':
      return removeEdge(ir, source, patch.id);
    case 'update-edge':
      return updateEdge(ir, source, patch.id, patch.label);
    case 'move-node':
      return []; // 纯几何变更走 overlay，不污染源码
    default:
      return [];
  }
}

/** 生成画布上「新建节点」的默认 id */
export function nextPumlId(ir: DiagramIR, prefix = 'N'): string {
  let i = 1;
  const used = new Set(ir.nodes.map((n: NodeIR) => n.id));
  while (used.has(`${prefix}${i}`)) i++;
  return `${prefix}${i}`;
}
