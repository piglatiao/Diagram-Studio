/** 时序图专用渲染（参与者成列 / 消息成行 / 生命线 / 激活框 / 组合片段） */
import { DiagramIR } from '../../ir/types';
import { FONT_SIZE, layoutSequence } from '../../layout';
import { wrapText, textWidth } from '../measure';
import { Svg, Theme, esc, centeredText, markerDefs, markerFor, renderNote } from './shapes';

export function renderSequenceSvg(ir: DiagramIR, th: Theme): string {
  const L = layoutSequence(ir);
  const padTop = ir.title || ir.header ? 50 : 18;
  const svg = new Svg();
  const W = Math.ceil(L.width);
  const H = Math.ceil(L.height + padTop + 30);

  svg.add(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" font-family="system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif">`);
  svg.add(`<defs>${markerDefs(th)}</defs>`);
  svg.add(`<rect x="0" y="0" width="100%" height="100%" fill="${th.bg}"/>`);
  svg.add(`<g transform="translate(0,${padTop})">`);

  const boxH = 44;
  const lifeTop = L.headerY + boxH;
  const lifeBottom = L.endY + 20;

  // 生命线
  for (const p of L.participants) {
    svg.add(`<line x1="${p.x}" y1="${lifeTop}" x2="${p.x}" y2="${lifeBottom + boxH}" stroke="${th.lifeline}" stroke-width="1.2" stroke-dasharray="5 4"/>`);
  }

  // 组合片段（先画，作为背景）
  for (const f of L.fragments) {
    svg.add(`<rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="6" fill="none" stroke="${th.groupStroke}" stroke-width="1.3" stroke-dasharray="6 4"/>`);
    const label = f.type === 'alt' ? `[${f.type}] ${f.label.startsWith('[else]') ? 'else' : f.label}` : `[${f.type}]${f.label ? ' ' + f.label : ''}`;
    const lw = Math.max(56, textWidth(label, FONT_SIZE - 1) + 18);
    svg.add(`<rect x="${f.x}" y="${f.y}" width="${lw}" height="24" rx="4" fill="${th.group}" stroke="${th.groupStroke}" stroke-width="1.1"/>`);
    svg.add(`<text x="${f.x + 9}" y="${f.y + 13}" font-size="${FONT_SIZE - 1}" fill="${th.textDim}" dominant-baseline="central" font-style="italic">${esc(label)}</text>`);
  }

  // 激活框
  for (const a of L.activations) {
    const w = 14;
    const x = a.x - w / 2 + a.depth * 8;
    svg.add(`<rect x="${x}" y="${a.y0}" width="${w}" height="${Math.max(6, a.y1 - a.y0)}" rx="2" fill="${th.group}" stroke="${th.line}" stroke-width="1.2"/>`);
  }

  // 消息
  const autonumber = ir.meta?.autonumber === true;
  let counter = 0;
  const msgs = ir.edges.filter((e) => !e.data?.activation).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  for (const e of msgs) {
    const o = e.order ?? 0;
    const y = (L.rowY[o] ?? L.startY) + 22;
    const a = L.participants.find((p) => p.id === e.from);
    const b = L.participants.find((p) => p.id === e.to);
    if (!a || !b) continue;
    counter++;
    let label = e.label ?? '';
    if (autonumber) label = `${counter}${label ? '. ' + label : ''}`;

    let d: string;
    let midX: number;
    if (a.id === b.id) {
      d = `M ${a.x} ${y - 12} L ${a.x + 46} ${y - 12} L ${a.x + 46} ${y + 10} L ${a.x + 4} ${y + 10}`;
      midX = a.x + 26;
    } else {
      d = `M ${a.x} ${y} L ${b.x} ${y}`;
      midX = (a.x + b.x) / 2;
    }
    const mk = markerFor(e.head ?? 'arrow', th);
    const dash = e.dashed ? ' stroke-dasharray="6 4"' : '';
    svg.add(`<path d="${d}" fill="none" stroke="${th.line}" stroke-width="1.5"${dash}${mk} data-ds-edge="${esc(e.id)}" data-ds-node="${esc(e.from)}"/>`);

    if (label) {
      const lines = wrapText(label, Math.max(90, Math.abs(a.x - b.x) - 16), FONT_SIZE - 1);
      const w = Math.max(...lines.map((l) => textWidth(l, FONT_SIZE - 1))) + 12;
      svg.add(`<rect x="${midX - w / 2}" y="${y - 22}" width="${w}" height="${lines.length * (FONT_SIZE + 3) + 4}" rx="3" fill="${th.bg}" opacity="0.95"/>`);
      lines.forEach((l, i) => {
        svg.add(`<text x="${midX}" y="${y - 20 + i * (FONT_SIZE + 3)}" font-size="${FONT_SIZE - 1}" fill="${th.text}" text-anchor="middle" dominant-baseline="central">${esc(l)}</text>`);
      });
    }
  }

  // 分隔线
  for (const s of L.separators) {
    svg.add(`<line x1="20" y1="${s.y}" x2="${W - 20}" y2="${s.y}" stroke="${th.groupStroke}" stroke-width="1.6"/>`);
    if (s.text) {
      const w = textWidth(s.text, FONT_SIZE + 1) + 20;
      svg.add(`<rect x="${W / 2 - w / 2}" y="${s.y - 13}" width="${w}" height="26" rx="4" fill="${th.bg}"/>`);
      svg.add(centeredText(W / 2, s.y, [s.text], FONT_SIZE + 1, th.text, { bold: true }));
    }
  }

  // 便签
  for (const n of L.notes) {
    const note = ir.notes.find((x) => x.id === n.id);
    if (!note) continue;
    svg.add(renderNote(n.x, n.y, n.w, n.h, wrapText(note.text, n.w - 22, FONT_SIZE - 1), th));
  }

  // 参与者头尾
  for (const p of L.participants) {
    const node = ir.nodes.find((n) => n.id === p.id);
    const label = node?.label ?? p.id;
    const x0 = p.x - p.boxW / 2;
    const drawBox = (yy: number) => {
      svg.add(`<rect x="${x0}" y="${yy}" width="${p.boxW}" height="${boxH}" rx="6" fill="${th.node}" stroke="${th.nodeStroke}" stroke-width="1.5" data-ds-node="${esc(p.id)}"/>`);
      svg.add(centeredText(p.x, yy + boxH / 2, wrapText(label, p.boxW - 16, FONT_SIZE), FONT_SIZE, th.text, { bold: true }));
    };
    drawBox(L.headerY);
    drawBox(lifeBottom);
  }

  svg.add('</g>');

  if (ir.header) svg.add(centeredText(W / 2, 16, [ir.header], FONT_SIZE - 1, th.textDim));
  if (ir.title) svg.add(centeredText(W / 2, padTop - 14, [ir.title], FONT_SIZE + 3, th.text, { bold: true }));
  if (ir.footer) svg.add(centeredText(W / 2, H - 12, [ir.footer], FONT_SIZE - 1, th.textDim));
  svg.add('</svg>');
  return svg.toString();
}
