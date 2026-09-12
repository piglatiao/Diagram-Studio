/** 通用图形渲染：类图 / 用例图 / 状态图 / 组件图 / 活动图 / 思维导图 */
import { DiagramIR, NodeIR } from '../../ir/types';
import { FONT_SIZE } from '../../layout';
import { textWidth, wrapText } from '../measure';
import {
  Svg, Theme, esc, renderNode, renderNote, markerDefs, markerFor, boundaryPoint, labelBg, centeredText,
} from './shapes';

export function renderGraphSvg(ir: DiagramIR, width: number, height: number, th: Theme): string {
  const svg = new Svg();
  const nodeById = new Map(ir.nodes.map((n) => [n.id, n]));
  const padTop = ir.title || ir.header ? 46 : 16;

  svg.add(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.ceil(width)} ${Math.ceil(height + padTop)}" width="100%" role="img" font-family="system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif">`);
  svg.add(`<defs>${markerDefs(th)}</defs>`);
  svg.add(`<rect x="0" y="0" width="100%" height="100%" fill="${th.bg}"/>`);
  svg.add(`<g transform="translate(0,${padTop})">`);

  // 分组容器
  for (const g of ir.groups) {
    if (g.kind === 'fragment' || !g.geometry) continue;
    const { x, y, w, h } = g.geometry;
    if (w <= 0 || h <= 0) continue;
    svg.add(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${th.group}" stroke="${th.groupStroke}" stroke-width="1.3"/>`);
    if (g.label) {
      const lw = Math.max(60, textWidth(g.label, FONT_SIZE) + 24);
      svg.add(`<path d="M ${x} ${y + 26} L ${x + lw} ${y + 26} L ${x + lw} ${y}" stroke="${th.groupStroke}" stroke-width="1.3" fill="none"/>`);
      svg.add(`<text x="${x + 12}" y="${y + 14}" font-size="${FONT_SIZE}" fill="${th.textDim}" dominant-baseline="central">${esc(g.label)}</text>`);
    }
  }

  // 边
  for (const e of ir.edges) {
    const a = nodeById.get(e.from);
    const b = nodeById.get(e.to);
    if (!a?.geometry || !b?.geometry) continue;

    let d: string;
    let midX: number;
    let midY: number;

    if (a.id === b.id) {
      const g = a.geometry;
      const cx = g.x + g.w / 2;
      const y0 = g.y + g.h;
      d = `M ${cx - 18} ${y0} C ${cx - 46} ${y0 + 46}, ${cx + 46} ${y0 + 46}, ${cx + 18} ${y0}`;
      midX = cx;
      midY = y0 + 38;
    } else {
      const p1 = boundaryPoint(a, b.geometry.x + b.geometry.w / 2, b.geometry.y + b.geometry.h / 2);
      const p2 = boundaryPoint(b, a.geometry.x + a.geometry.w / 2, a.geometry.y + a.geometry.h / 2);
      d = `M ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} L ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
      midX = (p1.x + p2.x) / 2;
      midY = (p1.y + p2.y) / 2;
    }

    const mk = markerFor(e.head ?? 'arrow', th);
    const dash = e.dashed ? ' stroke-dasharray="6 4"' : '';
    svg.add(`<path d="${d}" fill="none" stroke="${th.line}" stroke-width="1.5"${dash}${mk} data-ds-edge="${esc(e.id)}"/>`);

    if (e.label) {
      svg.add(labelBg(midX, midY, e.label, th));
      svg.add(`<text x="${midX}" y="${midY}" font-size="${FONT_SIZE - 1}" fill="${th.text}" text-anchor="middle" dominant-baseline="central">${esc(e.label)}</text>`);
    }
  }

  // 节点
  for (const n of ir.nodes) svg.add(renderNode(n, th));

  // 便签（非时序图：贴在被附着节点右侧）
  const noteOffset = new Map<string, number>();
  for (const note of ir.notes) {
    const target = note.attachTo?.type === 'node' ? nodeById.get(note.attachTo.id) : undefined;
    let nx = 40;
    let ny = 40;
    if (target?.geometry) {
      const k = noteOffset.get(target.id) ?? 0;
      noteOffset.set(target.id, k + 1);
      nx = target.geometry.x + target.geometry.w + 30;
      ny = target.geometry.y + k * 10;
    }
    const lines = wrapText(note.text, 200, FONT_SIZE - 1);
    const w = Math.max(90, Math.max(...lines.map((l) => textWidth(l, FONT_SIZE - 1))) + 24);
    const h = 20 + lines.length * (FONT_SIZE + 3);
    svg.add(renderNote(nx, ny, w, h, lines, th));
  }

  svg.add('</g>');

  if (ir.header) {
    svg.add(centeredText(Math.ceil(width) / 2, 16, [ir.header], FONT_SIZE - 1, th.textDim));
  }
  if (ir.title) {
    svg.add(centeredText(Math.ceil(width) / 2, padTop - 12, [ir.title], FONT_SIZE + 3, th.text, { bold: true }));
  }
  if (ir.footer) {
    svg.add(centeredText(Math.ceil(width) / 2, Math.ceil(height + padTop) - 12, [ir.footer], FONT_SIZE - 1, th.textDim));
  }
  svg.add('</svg>');
  return svg.toString();
}

/** 用例图的边界矩形需要包住用例，布局后按实际节点范围回算一次 */
export function fitGroupToChildren(ir: DiagramIR, pad = 24) {
  for (const g of ir.groups) {
    if (g.kind === 'fragment') continue;
    const kids = ir.nodes.filter((n) => n.groupId === g.id && n.geometry);
    if (!kids.length) continue;
    const x0 = Math.min(...kids.map((n) => n.geometry!.x));
    const y0 = Math.min(...kids.map((n) => n.geometry!.y));
    const x1 = Math.max(...kids.map((n) => n.geometry!.x + n.geometry!.w));
    const y1 = Math.max(...kids.map((n) => n.geometry!.y + n.geometry!.h));
    g.geometry = { x: x0 - pad, y: y0 - pad - 26, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 + 26 };
  }
}

export function ensureNodeGeometry(ir: DiagramIR, fallback: (n: NodeIR, i: number) => { x: number; y: number }) {
  ir.nodes.forEach((n, i) => {
    if (!n.geometry) n.geometry = { ...fallback(n, i), w: 140, h: 50 };
  });
}
