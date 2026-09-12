/**
 * L3 · 流程图文档模型（lang = 'flow'）
 *
 * 与 Mermaid / PlantUML 并列的第三种文档类型，互不隶属：
 *   - 数据即真相：整份模型序列化成 JSON 存进 DocRow.source，
 *     所以持久化、导入导出、撤销栈、文件夹写回全部沿用既有机制；
 *   - 编辑是「模型级」的：不存在字符补丁与源码锚点的问题；
 *   - 渲染走自绘引擎（render/svg/graph），不依赖 mermaid.js。
 */
import type { FlowShape } from '../ir/types';

export const FLOW_SCHEMA = 'diagram-studio/flow@1';

export interface FlowNode {
  id: string;
  label: string;
  shape: FlowShape;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FlowEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  dashed?: boolean;
}

export interface FlowModel {
  schema: string;
  title?: string;
  direction: 'TB' | 'LR';
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export function emptyFlowModel(direction: 'TB' | 'LR' = 'TB'): FlowModel {
  return { schema: FLOW_SCHEMA, direction, nodes: [], edges: [] };
}

/** 稳定序列化：键序固定，便于 diff 与人工查看 */
export function serializeFlow(m: FlowModel): string {
  const out = {
    schema: FLOW_SCHEMA,
    ...(m.title ? { title: m.title } : {}),
    direction: m.direction,
    nodes: m.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      shape: n.shape,
      x: Math.round(n.x),
      y: Math.round(n.y),
      w: Math.round(n.w),
      h: Math.round(n.h),
    })),
    edges: m.edges.map((e) => ({
      id: e.id,
      from: e.from,
      to: e.to,
      ...(e.label ? { label: e.label } : {}),
      ...(e.dashed ? { dashed: true } : {}),
    })),
  };
  return JSON.stringify(out, null, 2) + '\n';
}

function num(v: unknown, d: number): number {
  return typeof v === 'number' && isFinite(v) ? v : d;
}

/** 容错解析：字段缺失走默认值，只有「完全不是流程图数据」才报错 */
export function parseFlow(source: string): { model: FlowModel; error?: string } {
  const fallback = emptyFlowModel();
  const text = source.trim();
  if (!text) return { model: fallback };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { model: fallback, error: `流程图数据不是合法 JSON：${e instanceof Error ? e.message : e}` };
  }
  const o = raw as Partial<FlowModel>;
  if (!o || typeof o !== 'object') {
    return { model: fallback, error: '这不是一份流程图数据' };
  }
  // 带自身 schema 的文档视为流程图：缺 nodes 就当作「空的流程图」，而不是报错
  const owns = typeof o.schema === 'string' && o.schema.startsWith('diagram-studio/flow');
  const rawNodes: unknown[] | null = Array.isArray(o.nodes) ? o.nodes : owns ? [] : null;
  if (rawNodes === null) {
    return { model: fallback, error: '这不是一份流程图数据（缺少 nodes 数组）' };
  }
  const model: FlowModel = {
    schema: typeof o.schema === 'string' ? o.schema : FLOW_SCHEMA,
    title: typeof o.title === 'string' ? o.title : undefined,
    direction: o.direction === 'LR' ? 'LR' : 'TB',
    nodes: rawNodes
      .filter((n) => n && typeof n === 'object')
      .map((n, i) => {
        const node = n as Record<string, unknown>;
        return {
          id: String(node.id ?? `N${i + 1}`),
          label: String(node.label ?? ''),
          shape: (node.shape ?? 'rect') as FlowShape,
          x: num(node.x, NaN),
          y: num(node.y, NaN),
          w: num(node.w, 140),
          h: num(node.h, 56),
        };
      }),
    edges: (Array.isArray(o.edges) ? o.edges : [])
      .filter((e) => e && typeof e === 'object' && e.from && e.to)
      .map((e, i) => ({
        id: String(e.id ?? `E${i + 1}`),
        from: String(e.from),
        to: String(e.to),
        label: e.label ? String(e.label) : undefined,
        dashed: !!e.dashed,
      })),
  };
  return { model };
}

export function cloneFlow(m: FlowModel): FlowModel {
  return {
    schema: m.schema,
    title: m.title,
    direction: m.direction,
    nodes: m.nodes.map((n) => ({ ...n })),
    edges: m.edges.map((e) => ({ ...e })),
  };
}

export function nextFlowId(m: FlowModel, prefix = 'N'): string {
  const used = new Set(m.nodes.map((n) => n.id));
  let i = m.nodes.length + 1;
  while (used.has(`${prefix}${i}`)) i++;
  return `${prefix}${i}`;
}

export function nextFlowEdgeId(m: FlowModel): string {
  const used = new Set(m.edges.map((e) => e.id));
  let i = m.edges.length + 1;
  while (used.has(`e${i}`)) i++;
  return `e${i}`;
}

export const FLOW_BOX = { w: 140, h: 56 };

/** 有坐标用坐标，没有的按 direction 顺次排下来 */
export function autoPlace(m: FlowModel): void {
  const placed = m.nodes.filter((n) => isFinite(n.x) && isFinite(n.y));
  let i = placed.length;
  for (const n of m.nodes) {
    if (isFinite(n.x) && isFinite(n.y)) continue;
    if (m.direction === 'LR') {
      n.x = 60 + i * 210;
      n.y = 80;
    } else {
      n.x = 120;
      n.y = 60 + i * 110;
    }
    if (!n.w) n.w = FLOW_BOX.w;
    if (!n.h) n.h = FLOW_BOX.h;
    i++;
  }
}

/** 图形外接尺寸（含留白），供渲染视口与导出使用 */
export function flowBounds(m: FlowModel): { x: number; y: number; width: number; height: number } {
  if (!m.nodes.length) return { x: 0, y: 0, width: 320, height: 220 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of m.nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.w);
    maxY = Math.max(maxY, n.y + n.h);
  }
  const pad = 40;
  return {
    x: minX - pad,
    y: minY - pad,
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
  };
}

/**
 * 模型转 Mermaid flowchart 源码（便于把画好的图交给代码侧继续用）
 *
 * 注意：矩形必须写成 `[文字]`，只写裸文字会被 Mermaid 当成「节点 id」，
 * 于是导出结果里会凭空多出一个节点、连线也对不上（已由冒烟用例守住）。
 * 没有原生对应形状的（文档 / 离页 / 延时 …）统一退化成矩形。
 */
const MMD_SHAPE: Partial<Record<FlowShape, (label: string) => string>> = {
  rect: (l) => `[${l}]`,
  round: (l) => `(${l})`,
  stadium: (l) => `([${l}])`,
  circle: (l) => `((${l}))`,
  diamond: (l) => `{${l}}`,
  hexagon: (l) => `{{${l}}}`,
  cylinder: (l) => `[(${l})]`,
  parallelogram: (l) => `[/${l}/]`,
  trapezoid: (l) => `[/${l}\\]`,
  subprocess: (l) => `[[${l}]]`,
  note: (l) => `>${l}]`,
  // Mermaid 没有「已存数据」这个符号，退化成最接近的圆柱（数据存储）
  storedData: (l) => `[(${l})]`,
};

export function flowToMermaid(m: FlowModel): string {
  const head = m.direction === 'LR' ? 'flowchart LR' : 'flowchart TD';
  const safe = (s: string) => s.replace(/[[\]{}()"|]/g, (c) => `#${c.charCodeAt(0)};`);
  const lines = [head];
  const declared = new Set<string>();
  const declare = (n: FlowNode): string => {
    const shape = MMD_SHAPE[n.shape] ?? ((l: string) => `[${l}]`);
    declared.add(n.id);
    return `${n.id}${shape(safe(n.label) || n.id)}`;
  };
  const byId = new Map(m.nodes.map((n) => [n.id, n]));
  for (const e of m.edges) {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) continue;
    const from = declared.has(a.id) ? a.id : declare(a);
    const to = declared.has(b.id) ? b.id : declare(b);
    const arrow = e.dashed ? '-.->' : '-->';
    lines.push(`  ${from} ${arrow}${e.label ? `|${safe(e.label)}|` : ''} ${to}`);
  }
  for (const n of m.nodes) {
    if (!declared.has(n.id)) lines.push(`  ${declare(n)}`);
  }
  return lines.join('\n') + '\n';
}
