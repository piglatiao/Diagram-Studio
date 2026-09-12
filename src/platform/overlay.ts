/**
 * L5 · 手动布局 Overlay（sidecar）
 *
 * Mermaid / PlantUML 都没有坐标语法，用户在画布上拖拽的位置不回写源码，
 * 而是作为旁路数据与文档一起持久化；源码一变（sourceHash 不匹配）即自动失效。
 */
import { hashString } from '../ir/types';

export interface OverlayNode { x: number; y: number; pinned: boolean }

export interface ManualLayoutOverlay {
  sourceHash: string;
  nodes: Record<string, OverlayNode>;
  updatedAt: number;
}

const key = (docId: string) => `ds.overlay.${docId}`;

export function loadOverlay(docId: string, source: string): ManualLayoutOverlay | null {
  try {
    const raw = localStorage.getItem(key(docId));
    if (!raw) return null;
    const o = JSON.parse(raw) as ManualLayoutOverlay;
    if (!o || o.sourceHash !== hashString(source)) return null;
    return o;
  } catch {
    return null;
  }
}

export function saveOverlay(docId: string, o: ManualLayoutOverlay): void {
  try {
    localStorage.setItem(key(docId), JSON.stringify(o));
  } catch {
    /* 忽略配额错误 */
  }
}

export function clearOverlay(docId: string): void {
  try {
    localStorage.removeItem(key(docId));
  } catch {
    /* noop */
  }
}
