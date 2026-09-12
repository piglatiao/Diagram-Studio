/** L3 · 补丁 → 源码编辑的统一入口 */
import { DiagramIR, TextEdit } from '../ir/types';
import { DiagramPatch } from '../ir/patch';
import { pumlEdits } from './puml/edit';
import { mmdEdits } from './mmd/edit';
import type { Lang } from '../render';

export function toSourceEdits(
  ir: DiagramIR,
  source: string,
  patch: DiagramPatch,
  lang: Lang
): TextEdit[] {
  return lang === 'plantuml' ? pumlEdits(ir, source, patch) : mmdEdits(ir, source, patch);
}
