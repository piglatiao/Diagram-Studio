/**
 * L3 · 补丁与事务
 *
 * 源码是唯一真相 —— 任何可视化编辑最终都收敛为「最小化的文本编辑」，
 * 而不是重新生成整份源码（否则会抹掉注释、空行与未知语法）。
 */
import { SourceSpan, TextEdit } from './types';

export type DiagramPatch =
  | { op: 'update-node'; id: string; label: string }
  /** connectFrom：新建节点的同时从该节点连一条边（「画」流程图的核心） */
  | { op: 'add-node'; id: string; label: string; afterId?: string; connectFrom?: string }
  | { op: 'remove-node'; id: string }
  | { op: 'add-edge'; from: string; to: string; label?: string; id?: string }
  | { op: 'remove-edge'; id: string }
  | { op: 'update-edge'; id: string; label: string }
  | { op: 'move-node'; id: string; x: number; y: number };

export type TxOrigin = 'canvas' | 'source' | 'import' | 'ai';

export interface Transaction {
  id: string;
  label: string;
  origin: TxOrigin;
  edits: TextEdit[];
  inverse: TextEdit[];
  timestamp: number;
}

const CJK_WORD = /[A-Za-z0-9_一-龥]/;

/** 按「词边界」替换，避免把 OrderService 里的 Order 也换掉 */
export function replaceWord(text: string, oldWord: string, newWord: string): string {
  if (!oldWord) return text;
  let out = '';
  let i = 0;
  while (i < text.length) {
    const idx = text.indexOf(oldWord, i);
    if (idx < 0) { out += text.slice(i); break; }
    const before = idx > 0 ? text[idx - 1] : '';
    const after = idx + oldWord.length < text.length ? text[idx + oldWord.length] : '';
    const okBefore = !before || !CJK_WORD.test(before);
    const okAfter = !after || !CJK_WORD.test(after);
    if (okBefore && okAfter) {
      out += text.slice(i, idx) + newWord;
      i = idx + oldWord.length;
    } else {
      out += text.slice(i, idx + 1);
      i = idx + 1;
    }
  }
  return out;
}

function lineOf(source: string, off: number): { line: number; col: number } {
  let line = 0;
  let last = 0;
  const end = Math.min(off, source.length);
  for (let i = 0; i < end; i++) {
    if (source[i] === '\n') { line++; last = i + 1; }
  }
  return { line, col: end - last };
}

export function spanAt(source: string, start: number, end: number): SourceSpan {
  const s = Math.max(0, Math.min(start, source.length));
  const e = Math.max(s, Math.min(end, source.length));
  const a = lineOf(source, s);
  const b = lineOf(source, e);
  return { start: s, end: e, startLine: a.line, startCol: a.col, endLine: b.line, endCol: b.col };
}

export function editAt(source: string, start: number, end: number, newText: string): TextEdit {
  return { span: spanAt(source, start, end), newText };
}

/**
 * 应用一组编辑，并同时算出反向编辑（用于撤销）。
 * 关键点：反向编辑的坐标要换算到「新文档」坐标系。
 */
export function applyEdits(source: string, edits: TextEdit[]): { text: string; inverse: TextEdit[] } {
  const sorted = [...edits].sort((a, b) => a.span.start - b.span.start);
  let out = '';
  let cursor = 0;
  let delta = 0;
  const inverse: TextEdit[] = [];

  for (const e of sorted) {
    const s = Math.max(cursor, Math.max(0, Math.min(e.span.start, source.length)));
    const en = Math.max(s, Math.max(0, Math.min(e.span.end, source.length)));
    out += source.slice(cursor, s) + e.newText;
    cursor = en;
    inverse.push({
      span: { start: s + delta, end: s + e.newText.length + delta, startLine: 0, startCol: 0, endLine: 0, endCol: 0 },
      newText: source.slice(s, en),
    });
    delta += e.newText.length - (en - s);
  }
  out += source.slice(cursor);
  return { text: out, inverse };
}

/** 把区间扩展到整行（含行尾换行），用于「删除这条语句」 */
export function expandToLine(source: string, span: { start: number; end: number }): { start: number; end: number } {
  let s = Math.max(0, Math.min(span.start, source.length));
  let e = Math.max(s, Math.min(span.end, source.length));
  while (s > 0 && source[s - 1] !== '\n') s--;
  while (e < source.length && source[e] !== '\n') e++;
  if (e < source.length && source[e] === '\n') e++;
  return { start: s, end: e };
}

/** 新建语句的插入位置：优先 @enduml 之前，否则追加到末尾 */
export function insertionPoint(source: string, irStatementEnds: number[]): number {
  const m = source.match(/^\s*@end\w*/im);
  if (m && m.index !== undefined) {
    const lineStart = source.lastIndexOf('\n', m.index) + 1;
    return lineStart;
  }
  if (irStatementEnds.length) {
    const last = Math.max(...irStatementEnds);
    const p = source.indexOf('\n', last);
    if (p < 0) return source.length;
    return p + 1;
  }
  return source.length;
}

/** 插入一整行语句：自动处理「文档末尾没有换行」的情况 */
export function insertLineEdit(source: string, statementEnds: number[], text: string): TextEdit {
  const pos = insertionPoint(source, statementEnds);
  const atEnd = pos >= source.length;
  const prefix = atEnd && source.length > 0 && !source.endsWith('\n') ? '\n' : '';
  return editAt(source, pos, pos, prefix + text + '\n');
}
