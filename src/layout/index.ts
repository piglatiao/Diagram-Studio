/**
 * L4/L3 · 布局引擎（全部本地执行，无网络）
 *
 * - sequence：自研网格布局（参与者成列、消息成行、片段嵌套）
 * - mindmap：自研横向树布局
 * - layered：elkjs（Eclipse Layout Kernel 的 GWT/JS 构建，本地 WASM-free 纯 JS）
 * - grid：用例图的 Actor 列 + 用例网格（含边界矩形）
 */
import { DiagramIR, Geometry, NodeIR } from '../ir/types';
import { textWidth, wrapText } from '../render/measure';

export const FONT_SIZE = 13;
export const TITLE_SIZE = 14;

// ---------------------------------------------------------------- 节点尺寸

export function nodeSize(n: NodeIR): { w: number; h: number } {
  const labelW = textWidth(n.label, FONT_SIZE);
  switch (n.shape) {
    case 'actor':
      return { w: Math.max(70, labelW + 30), h: 96 };
    case 'cylinder':
      return { w: Math.max(110, labelW + 44), h: 62 };
    case 'cloud':
      return { w: Math.max(130, labelW + 56), h: 66 };
    case 'frame':
      return { w: Math.max(120, labelW + 50), h: 60 };
    case 'diamond':
      return { w: Math.max(130, labelW + 60), h: 76 };
    case 'stadium':
      return { w: Math.max(120, labelW + 52), h: 52 };
    case 'dot':
      return { w: 26, h: 26 };
    case 'bullseye':
      return { w: 30, h: 30 };
    case 'bar':
      return { w: 90, h: 12 };
    case 'circle':
      return { w: Math.max(90, labelW + 40), h: Math.max(90, labelW + 40) };
    // 流程图图例库：斜边/带装饰的形状留出更多内边距
    case 'hexagon':
      return { w: Math.max(140, labelW + 76), h: 68 };
    case 'parallelogram':
      return { w: Math.max(140, labelW + 76), h: 60 };
    case 'trapezoid':
      return { w: Math.max(140, labelW + 76), h: 60 };
    case 'manualInput':
      return { w: Math.max(140, labelW + 44), h: 66 };
    case 'display':
      return { w: Math.max(140, labelW + 66), h: 60 };
    case 'delay':
      return { w: Math.max(140, labelW + 60), h: 58 };
    case 'document':
      return { w: Math.max(130, labelW + 48), h: 74 };
    case 'multiDocument':
      return { w: Math.max(140, labelW + 60), h: 82 };
    case 'internalStorage':
      return { w: Math.max(130, labelW + 56), h: 66 };
    case 'subprocess':
      return { w: Math.max(140, labelW + 60), h: 58 };
    case 'offPage':
      return { w: Math.max(120, labelW + 48), h: 58 };
    case 'note':
      return { w: Math.max(130, labelW + 44), h: 62 };
    default:
      break;
  }
  if (n.kind === 'class' || n.members?.length) {
    const members = n.members ?? [];
    const mw = Math.max(0, ...members.map((m) => textWidth(m.text, FONT_SIZE - 1)));
    const w = Math.max(labelW + 36, mw + 36, 120);
    return { w, h: 40 + members.length * 19 + 12 };
  }
  return { w: Math.max(110, labelW + 40), h: 50 };
}

// ---------------------------------------------------------------- 时序图布局

export interface SeqActivation { id: string; x: number; y0: number; y1: number; depth: number }
export interface SeqFragment {
  id: string; x: number; y: number; w: number; h: number;
  label: string; type: string; depth: number;
}
export interface SequenceLayout {
  width: number;
  height: number;
  participants: Array<{ id: string; x: number; boxW: number }>;
  headerY: number;
  startY: number;
  endY: number;
  rowY: number[];
  activations: SeqActivation[];
  fragments: SeqFragment[];
  notes: Array<{ id: string; x: number; y: number; w: number; h: number }>;
  separators: Array<{ y: number; text: string; kind: string }>;
}

export function layoutSequence(ir: DiagramIR): SequenceLayout {
  const parts = ir.nodes.filter((n) => n.kind !== 'pseudo');
  const boxes = parts.map((p) => {
    const w = Math.max(90, textWidth(p.label, FONT_SIZE) + 40);
    return { id: p.id, w };
  });

  const GAP = 80;
  const LEFT = 60;
  let x = LEFT;
  const xs: Array<{ id: string; x: number; boxW: number }> = [];
  for (const b of boxes) {
    xs.push({ id: b.id, x: x + b.w / 2, boxW: b.w });
    x += b.w + GAP;
  }
  const totalW = Math.max(520, x - GAP + LEFT);

  const maxOrder = Math.max(
    0,
    ...ir.edges.map((e) => e.order ?? 0),
    ...ir.notes.map((n) => n.order ?? 0),
    ...((ir.meta?.separators as Array<{ order: number }>) ?? []).map((s) => s.order)
  );

  const heights: number[] = new Array(maxOrder + 2).fill(0);
  const bump = (o: number, h: number) => {
    const i = Math.max(0, Math.min(heights.length - 1, o));
    heights[i] = Math.max(heights[i], h);
  };
  for (const e of ir.edges) {
    if (e.data?.activation) continue;
    bump(e.order ?? 0, e.label ? 44 : 36);
  }
  for (const n of ir.notes) bump(n.order ?? 0, 26 + wrapText(n.text, 220, FONT_SIZE - 1).length * 17);
  for (const s of (ir.meta?.separators as Array<{ order: number }>) ?? []) bump(s.order, 40);

  const headerY = 30;
  const startY = headerY + 70;
  const rowY: number[] = [];
  let y = startY;
  for (let i = 0; i <= maxOrder + 1; i++) {
    rowY[i] = y;
    y += Math.max(30, heights[i] ?? 30);
  }
  const endY = y;

  // 激活框
  const activations: SeqActivation[] = [];
  const stacks = new Map<string, Array<{ y0: number; depth: number }>>();
  const depthOf = new Map<string, number>();
  const acts = ir.edges
    .filter((e) => e.data?.activation)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  for (const a of acts) {
    const pid = a.from;
    const px = xs.find((p) => p.id === pid)?.x ?? 0;
    const yy = rowY[a.order ?? 0] ?? startY;
    if (a.activate === 'start') {
      const d = depthOf.get(pid) ?? 0;
      stacks.set(pid, [...(stacks.get(pid) ?? []), { y0: yy, depth: d }]);
      depthOf.set(pid, d + 1);
    } else {
      const st = stacks.get(pid);
      const top = st?.pop();
      depthOf.set(pid, Math.max(0, (depthOf.get(pid) ?? 1) - 1));
      if (top) {
        activations.push({ id: pid, x: px, y0: top.y0, y1: yy, depth: top.depth });
      }
    }
  }
  // 未闭合的激活框补到末尾
  for (const [pid, st] of stacks) {
    const px = xs.find((p) => p.id === pid)?.x ?? 0;
    for (const t of st) activations.push({ id: pid, x: px, y0: t.y0, y1: endY, depth: t.depth });
  }

  // 片段：按覆盖的消息序号反推涉及的参与者
  const msgByOrder = new Map<number, string[]>();
  for (const e of ir.edges) {
    if (e.data?.activation) continue;
    const arr = msgByOrder.get(e.order ?? 0) ?? [];
    arr.push(e.from, e.to);
    msgByOrder.set(e.order ?? 0, arr);
  }
  const fragments: SeqFragment[] = [];
  const frags = ir.groups.filter((g) => g.kind === 'fragment');
  const depthMap = new Map<string, number>();
  for (const g of frags) {
    let d = 0;
    let p = g.parentId ? frags.find((f) => f.id === g.parentId) : undefined;
    while (p) { d++; p = p.parentId ? frags.find((f) => f.id === p!.parentId) : undefined; }
    depthMap.set(g.id, d);
  }
  for (const g of frags) {
    const [a, b] = g.orderRange ?? [0, 0];
    const involved = new Set<string>();
    for (let o = a; o <= b; o++) (msgByOrder.get(o) ?? []).forEach((p) => involved.add(p));
    const px = xs.filter((p) => involved.has(p.id)).map((p) => p.x);
    const d = depthMap.get(g.id) ?? 0;
    const inset = 14 + d * 12;
    const x0 = px.length ? Math.min(...px) - 46 : LEFT;
    const x1 = px.length ? Math.max(...px) + 46 : totalW - LEFT;
    const y0 = (rowY[a] ?? startY) - 16;
    const y1 = (rowY[b] ?? startY) + Math.max(30, heights[b] ?? 30) - 4;
    fragments.push({
      id: g.id,
      x: x0 - inset,
      y: y0,
      w: Math.max(90, x1 - x0 + inset * 2),
      h: Math.max(40, y1 - y0),
      label: g.label ?? g.fragmentType ?? '',
      type: g.fragmentType ?? 'group',
      depth: d,
    });
  }

  // 便签
  const notes = ir.notes.map((n) => {
    const lines = wrapText(n.text, 210, FONT_SIZE - 1);
    const w = Math.max(80, Math.max(0, ...lines.map((l) => textWidth(l, FONT_SIZE - 1))) + 24);
    const h = 20 + lines.length * 17;
    let nx = totalW / 2 - w / 2;
    if (n.over?.length) {
      const px = n.over.map((o) => xs.find((p) => p.id === o)?.x ?? 0).filter(Boolean);
      if (px.length) nx = (Math.min(...px) + Math.max(...px)) / 2 - w / 2;
    } else if (n.attachTo?.type === 'node') {
      const px = xs.find((p) => p.id === n.attachTo!.id)?.x ?? totalW / 2;
      nx = n.position === 'left' ? px - w - 60 : n.position === 'right' ? px + 60 : px - w / 2;
    }
    return { id: n.id, x: Math.max(8, nx), y: rowY[n.order ?? 0] ?? startY, w, h };
  });

  const seps = ((ir.meta?.separators as Array<{ order: number; text: string; kind: string }>) ?? []).map((s) => ({
    y: (rowY[s.order] ?? startY) + 14,
    text: s.text,
    kind: s.kind,
  }));

  return {
    width: totalW,
    height: endY + 90,
    participants: xs,
    headerY,
    startY,
    endY,
    rowY,
    activations,
    fragments,
    notes,
    separators: seps,
  };
}

// ---------------------------------------------------------------- 思维导图布局

export function layoutMindmap(ir: DiagramIR): { width: number; height: number } {
  const children = new Map<string, NodeIR[]>();
  const roots: NodeIR[] = [];
  for (const n of ir.nodes) {
    if (n.groupId && ir.nodes.some((p) => p.id === n.groupId)) {
      children.set(n.groupId, [...(children.get(n.groupId) ?? []), n]);
    } else roots.push(n);
  }
  if (!roots.length) roots.push(...ir.nodes.filter((n) => !n.groupId));

  const depthW = new Map<number, number>();
  for (const n of ir.nodes) {
    const d = (n.data?.depth as number) ?? 1;
    depthW.set(d, Math.max(depthW.get(d) ?? 0, nodeSize(n).w));
  }
  const colGap = 70;
  const colX: number[] = [];
  let cx = 30;
  const maxD = Math.max(...[...depthW.keys()], 1);
  for (let d = 1; d <= maxD; d++) {
    colX[d] = cx;
    cx += (depthW.get(d) ?? 120) + colGap;
  }

  let cursor = 20;
  const place = (n: NodeIR): number => {
    const d = (n.data?.depth as number) ?? 1;
    const { w, h } = nodeSize(n);
    const kids = children.get(n.id) ?? [];
    n.geometry = { x: colX[d] ?? 30, y: 0, w, h };
    if (!kids.length) {
      n.geometry.y = cursor;
      cursor += h + 14;
      return n.geometry.y + h / 2;
    }
    const centers = kids.map((k) => place(k));
    const first = kids[0].geometry!;
    const last = kids[kids.length - 1].geometry!;
    const blockH = last.y + last.h - first.y;
    n.geometry.y = first.y + blockH / 2 - h / 2;
    // 父节点高度可能超过子块，需下移子块
    if (n.geometry.h > blockH) {
      const delta = (n.geometry.h - blockH) / 2;
      for (const k of kids) shift(k, delta);
      cursor += delta;
      n.geometry.y = first.y + delta + (blockH) / 2 - h / 2;
    }
    return centers.length ? (centers[0] + centers[centers.length - 1]) / 2 : n.geometry.y + h / 2;
  };
  const shift = (n: NodeIR, dy: number) => {
    if (!n.geometry) return;
    n.geometry.y += dy;
    for (const k of children.get(n.id) ?? []) shift(k, dy);
  };

  for (const r of roots) place(r);

  let maxY = 0;
  let maxX = 0;
  for (const n of ir.nodes) {
    if (!n.geometry) continue;
    maxY = Math.max(maxY, n.geometry.y + n.geometry.h);
    maxX = Math.max(maxX, n.geometry.x + n.geometry.w);
  }
  return { width: maxX + 40, height: maxY + 40 };
}

// ---------------------------------------------------------------- 分层布局（ELK）

let elkPromise: Promise<any> | null = null;
async function getElk(): Promise<any | null> {
  try {
    if (!elkPromise) {
      elkPromise = import('elkjs/lib/elk.bundled.js').then((m) => new (m.default ?? m)());
    }
    return await elkPromise;
  } catch {
    return null;
  }
}

export interface LayoutResult {
  width: number;
  height: number;
  /** 时序图专用布局结果；非空时画布模式不可用 */
  sequence?: SequenceLayout;
}

/** 统一的布局入口：渲染器与可视化画布共用 */
export async function layoutDiagram(ir: DiagramIR): Promise<LayoutResult> {
  if (ir.kind === 'sequence') {
    const L = layoutSequence(ir);
    return { width: L.width, height: L.height + 60, sequence: L };
  }
  if (ir.kind === 'mindmap') return layoutMindmap(ir);
  if (ir.kind === 'usecase') return layoutUsecase(ir);
  return layoutLayered(ir, ir.direction === 'LR' ? 'RIGHT' : 'DOWN');
}

export async function layoutLayered(ir: DiagramIR, direction: 'DOWN' | 'RIGHT' = 'DOWN'): Promise<{ width: number; height: number }> {
  for (const n of ir.nodes) {
    const s = nodeSize(n);
    n.geometry = { x: 0, y: 0, w: s.w, h: s.h };
  }

  const elk = await getElk();
  if (!elk) {
    layoutLayeredFallback(ir, direction);
    return bounds(ir);
  }

  const groups = ir.groups.filter((g) => g.kind !== 'fragment');
  const nodeById = new Map(ir.nodes.map((n) => [n.id, n]));

  const buildChild = (id: string): any => {
    const n = nodeById.get(id)!;
    return { id: n.id, width: n.geometry!.w, height: n.geometry!.h };
  };
  const buildGroup = (g: (typeof groups)[number]): any => ({
    id: g.id,
    layoutOptions: { 'elk.padding': '[top=34,left=20,bottom=20,right=20]' },
    children: [
      ...g.children.filter((c) => nodeById.has(c)).map(buildChild),
      ...groups.filter((x) => x.parentId === g.id).map(buildGroup),
    ],
  });

  const topNodes = ir.nodes.filter((n) => !n.groupId || !groups.some((g) => g.id === n.groupId));
  const graph: any = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction,
      'elk.layered.spacing.nodeNodeBetweenLayers': '70',
      'elk.spacing.nodeNode': '46',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.edgeRouting': 'POLYLINE',
    },
    children: [
      ...topNodes.map((n) => ({ id: n.id, width: n.geometry!.w, height: n.geometry!.h })),
      ...groups.filter((g) => !g.parentId).map(buildGroup),
    ],
    edges: ir.edges
      .filter((e) => nodeById.has(e.from) && nodeById.has(e.to))
      .map((e) => ({ id: e.id, sources: [e.from], targets: [e.to] })),
  };

  try {
    const res = await elk.layout(graph);
    const apply = (n: any, offX: number, offY: number) => {
      for (const c of n.children ?? []) {
        const target = nodeById.get(c.id);
        if (target) {
          target.geometry = { x: (c.x ?? 0) + offX, y: (c.y ?? 0) + offY, w: c.width ?? target.geometry!.w, h: c.height ?? target.geometry!.h };
        } else {
          const g = groups.find((x) => x.id === c.id);
          if (g) {
            g.geometry = { x: (c.x ?? 0) + offX, y: (c.y ?? 0) + offY, w: c.width ?? 0, h: c.height ?? 0 };
            apply(c, (c.x ?? 0) + offX, (c.y ?? 0) + offY);
          } else {
            apply(c, offX, offY);
          }
        }
      }
    };
    apply(res, 24, 24);
    for (const g of groups) if (!g.geometry) g.geometry = { x: 0, y: 0, w: 0, h: 0 };
    return bounds(ir);
  } catch {
    layoutLayeredFallback(ir, direction);
    return bounds(ir);
  }
}

/** ELK 不可用时的兜底：BFS 分层 + 层内顺序排列 */
function layoutLayeredFallback(ir: DiagramIR, _direction: 'DOWN' | 'RIGHT') {
  const adj = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  for (const n of ir.nodes) { adj.set(n.id, []); indeg.set(n.id, 0); }
  for (const e of ir.edges) {
    if (!adj.has(e.from) || !indeg.has(e.to)) continue;
    adj.get(e.from)!.push(e.to);
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  }
  const layer = new Map<string, number>();
  const q: string[] = [];
  for (const [id, d] of indeg) if (d === 0) { layer.set(id, 0); q.push(id); }
  for (const id of ir.nodes.map((n) => n.id)) if (!layer.has(id)) { layer.set(id, 0); q.push(id); }
  let i = 0;
  while (i < q.length) {
    const cur = q[i++];
    for (const nx of adj.get(cur) ?? []) {
      const nl = (layer.get(cur) ?? 0) + 1;
      if (nl > (layer.get(nx) ?? -1)) { layer.set(nx, nl); q.push(nx); }
    }
  }
  const byLayer = new Map<number, NodeIR[]>();
  for (const n of ir.nodes) {
    const l = layer.get(n.id) ?? 0;
    byLayer.set(l, [...(byLayer.get(l) ?? []), n]);
  }
  let y = 24;
  for (const l of [...byLayer.keys()].sort((a, b) => a - b)) {
    const row = byLayer.get(l)!;
    let x = 24;
    let maxH = 0;
    for (const n of row) {
      const s = nodeSize(n);
      n.geometry = { x, y, w: s.w, h: s.h };
      x += s.w + 70;
      maxH = Math.max(maxH, s.h);
    }
    y += maxH + 80;
  }
}

function bounds(ir: DiagramIR): { width: number; height: number } {
  let w = 0;
  let h = 0;
  for (const n of ir.nodes) {
    if (!n.geometry) continue;
    w = Math.max(w, n.geometry.x + n.geometry.w);
    h = Math.max(h, n.geometry.y + n.geometry.h);
  }
  for (const g of ir.groups) {
    if (!g.geometry) continue;
    w = Math.max(w, g.geometry.x + g.geometry.w);
    h = Math.max(h, g.geometry.y + g.geometry.h);
  }
  return { width: w + 40, height: h + 40 };
}

// ---------------------------------------------------------------- 用例图网格布局

export function layoutUsecase(ir: DiagramIR): { width: number; height: number } {
  const actors = ir.nodes.filter((n) => n.kind === 'actor');
  const usecases = ir.nodes.filter((n) => n.kind === 'usecase');
  const scopes = ir.groups.filter((g) => g.kind === 'boundary');

  const PAD = 30;
  const cols = Math.max(1, Math.min(3, Math.ceil(Math.sqrt(Math.max(1, usecases.length)))));
  let uw = 180;
  let uh = 56;
  if (usecases.length) {
    uw = Math.max(180, ...usecases.map((u) => nodeSize(u).w));
    uh = Math.max(56, ...usecases.map((u) => nodeSize(u).h));
  }
  const gridX = 220;
  const gridY = 70;
  usecases.forEach((u, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    u.geometry = { x: gridX + c * (uw + 50), y: gridY + r * (uh + 46), w: uw, h: uh };
  });

  const gridW = cols * uw + (cols - 1) * 50;
  const gridH = Math.ceil(usecases.length / cols) * uh + Math.max(0, Math.ceil(usecases.length / cols) - 1) * 46;

  if (scopes.length) {
    scopes[0].geometry = { x: gridX - PAD, y: gridY - PAD - 8, w: gridW + PAD * 2, h: Math.max(120, gridH + PAD * 2) };
  }

  const actorX = 40;
  let ay = 70;
  actors.forEach((a) => {
    a.geometry = { x: actorX, y: ay, w: 80, h: 96 };
    ay += 130;
  });

  return {
    width: Math.max(560, gridX + gridW + 80),
    height: Math.max(300, Math.max(ay, gridY + gridH) + 60),
  };
}

export type { Geometry };
