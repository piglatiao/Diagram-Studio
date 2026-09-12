/**
 * 自绘 SVG 的基础图元与节点渲染
 *
 * 视觉基线：draw.io / ISO 5807 经典线稿 —— 白底、近黑描边、直角为主，
 * 圆角只留给语义上本就该圆的形状（stadium / round / circle）。
 * 这是「导出即所见」的唯一真相：图例缩略图、画布节点、导出 PNG/SVG 共用本文件。
 */
import { NodeIR } from '../../ir/types';
import { FONT_SIZE, TITLE_SIZE } from '../../layout';
import { textWidth, wrapText } from '../measure';

export interface Theme {
  key: string;
  bg: string;
  node: string;
  nodeStroke: string;
  headline: string;
  text: string;
  textDim: string;
  line: string;
  group: string;
  groupStroke: string;
  note: string;
  noteStroke: string;
  lifeline: string;
  accent: string;
}

/** 主轮廓线宽 */
const SW = 1.4;
/** 内部细节线宽（分隔线 / 折角线 / 波浪线） */
const SW2 = 1.1;

export const LIGHT: Theme = {
  key: 'light',
  bg: '#ffffff',
  node: '#ffffff',
  nodeStroke: '#1a1a1a',
  headline: '#f5f5f5',
  text: '#1a1a1a',
  textDim: '#6b7280',
  line: '#1a1a1a',
  group: '#fafafa',
  groupStroke: '#9ca3af',
  note: '#fffbeb',
  noteStroke: '#b45309',
  lifeline: '#9ca3af',
  accent: '#2563eb',
};

export const DARK: Theme = {
  key: 'dark',
  bg: '#111827',
  node: '#1f2937',
  nodeStroke: '#e5e7eb',
  headline: '#111827',
  text: '#f3f4f6',
  textDim: '#9ca3af',
  line: '#e5e7eb',
  group: '#0f172a',
  groupStroke: '#475569',
  note: '#3f3a22',
  noteStroke: '#a3a380',
  lifeline: '#475569',
  accent: '#60a5fa',
};

export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export class Svg {
  parts: string[] = [];
  add(s: string): this { this.parts.push(s); return this; }
  toString(): string { return this.parts.join('\n'); }
}

/** 多行居中文本 */
export function centeredText(
  x: number, y: number, lines: string[], size: number, fill: string, opts?: { bold?: boolean; anchor?: 'middle' | 'start' }
): string {
  const anchor = opts?.anchor ?? 'middle';
  const lh = size + 4;
  const start = y - ((lines.length - 1) * lh) / 2;
  return lines
    .map((l, i) => {
      const yy = start + i * lh;
      return `<text x="${x}" y="${yy.toFixed(1)}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" font-weight="${opts?.bold ? 600 : 400}" dominant-baseline="central" font-family="system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif">${esc(l)}</text>`;
    })
    .join('');
}

/** 多边形辅助 */
function poly(pts: Array<[number, number]>, fill: string, stroke: string, sw = SW): string {
  const p = pts.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
  return `<polygon points="${p}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>`;
}

/** 绘制单个节点（含形状与文本），返回 SVG 片段 */
export function renderNode(n: NodeIR, th: Theme): string {
  if (!n.geometry) return '';
  const { x, y, w, h } = n.geometry;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const fill = n.style?.fill ?? th.node;
  const stroke = n.style?.stroke ?? th.nodeStroke;
  const out: string[] = [];
  out.push(`<g data-ds-node="${esc(n.id)}" data-ds-label="${esc(n.label)}" class="ds-node">`);

  switch (n.shape) {
    case 'actor': {
      out.push(`<circle cx="${cx}" cy="${y + 16}" r="11" fill="${fill}" stroke="${stroke}" stroke-width="${SW}"/>`);
      out.push(`<line x1="${cx}" y1="${y + 27}" x2="${cx}" y2="${y + 60}" stroke="${stroke}" stroke-width="${SW}"/>`);
      out.push(`<line x1="${cx - 20}" y1="${y + 38}" x2="${cx + 20}" y2="${y + 38}" stroke="${stroke}" stroke-width="${SW}"/>`);
      out.push(`<line x1="${cx}" y1="${y + 60}" x2="${cx - 16}" y2="${y + 82}" stroke="${stroke}" stroke-width="${SW}"/>`);
      out.push(`<line x1="${cx}" y1="${y + 60}" x2="${cx + 16}" y2="${y + 82}" stroke="${stroke}" stroke-width="${SW}"/>`);
      out.push(centeredText(cx, y + 92, wrapText(n.label, 110, FONT_SIZE), FONT_SIZE, th.text));
      break;
    }
    case 'cylinder': {
      const ry = 10;
      out.push(`<path d="M ${x} ${y + ry} A ${w / 2} ${ry} 0 0 1 ${x + w} ${y + ry} L ${x + w} ${y + h - ry} A ${w / 2} ${ry} 0 0 1 ${x} ${y + h - ry} Z" fill="${fill}" stroke="${stroke}" stroke-width="${SW}"/>`);
      out.push(`<ellipse cx="${cx}" cy="${y + ry}" rx="${w / 2}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="${SW}"/>`);
      out.push(centeredText(cx, cy + 4, wrapText(n.label, w - 24, FONT_SIZE), FONT_SIZE, th.text));
      break;
    }
    case 'cloud': {
      out.push(`<path d="M ${x + 18} ${y + h - 14} Q ${x} ${y + h - 14} ${x + 4} ${y + h / 2} Q ${x - 2} ${y + 10} ${x + 26} ${y + 14} Q ${x + 34} ${y} ${x + w / 2} ${y + 8} Q ${x + w - 30} ${y - 2} ${x + w - 20} ${y + 18} Q ${x + w + 2} ${y + 26} ${x + w - 6} ${y + h - 16} Q ${x + w} ${y + h - 12} ${x + w - 20} ${y + h - 12} Z" fill="${fill}" stroke="${stroke}" stroke-width="${SW}"/>`);
      out.push(centeredText(cx, cy, wrapText(n.label, w - 30, FONT_SIZE), FONT_SIZE, th.text));
      break;
    }
    case 'frame': {
      out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="${SW}"/>`);
      out.push(`<rect x="${x + 5}" y="${y + 5}" width="${w - 10}" height="${h - 10}" fill="none" stroke="${stroke}" stroke-width="${SW2}"/>`);
      out.push(centeredText(cx, cy, wrapText(n.label, w - 26, FONT_SIZE), FONT_SIZE, th.text));
      break;
    }
    case 'diamond': {
      out.push(`<polygon points="${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}" fill="${fill}" stroke="${stroke}" stroke-width="${SW}"/>`);
      out.push(centeredText(cx, cy, wrapText(n.label, (w * 0.6) | 0, FONT_SIZE), FONT_SIZE, th.text));
      break;
    }
    case 'stadium': {
      out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${SW}"/>`);
      out.push(centeredText(cx, cy, wrapText(n.label, w - 30, FONT_SIZE), FONT_SIZE, th.text));
      break;
    }
    case 'dot': {
      out.push(`<circle cx="${cx}" cy="${cy}" r="${Math.min(w, h) / 2}" fill="${th.line}"/>`);
      break;
    }
    case 'bullseye': {
      out.push(`<circle cx="${cx}" cy="${cy}" r="${Math.min(w, h) / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${SW}"/>`);
      out.push(`<circle cx="${cx}" cy="${cy}" r="${Math.min(w, h) / 5}" fill="${stroke}"/>`);
      break;
    }
    case 'bar': {
      out.push(`<rect x="${x}" y="${y}" width="${w}" height="${Math.max(10, h)}" fill="${th.line}"/>`);
      break;
    }
    case 'circle': {
      out.push(`<circle cx="${cx}" cy="${cy}" r="${Math.min(w, h) / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${SW}"/>`);
      out.push(centeredText(cx, cy, wrapText(n.label, w - 30, FONT_SIZE), FONT_SIZE, th.text));
      break;
    }

    // ---------------------------------------------------------------- 流程图图例库
    case 'hexagon': {
      const k = Math.min(h * 0.42, w * 0.2);
      out.push(poly([[x + k, y], [x + w - k, y], [x + w, cy], [x + w - k, y + h], [x + k, y + h], [x, cy]], fill, stroke));
      out.push(centeredText(cx, cy, wrapText(n.label, w - k * 2 - 12, FONT_SIZE), FONT_SIZE, th.text));
      break;
    }
    case 'parallelogram': {
      const k = Math.min(h * 0.45, w * 0.22);
      out.push(poly([[x + k, y], [x + w, y], [x + w - k, y + h], [x, y + h]], fill, stroke));
      out.push(centeredText(cx, cy, wrapText(n.label, w - k * 2 - 12, FONT_SIZE), FONT_SIZE, th.text));
      break;
    }
    case 'trapezoid': {
      const k = Math.min(h * 0.42, w * 0.2);
      out.push(poly([[x + k, y], [x + w - k, y], [x + w, y + h], [x, y + h]], fill, stroke));
      out.push(centeredText(cx, cy + 2, wrapText(n.label, w - k * 2 - 12, FONT_SIZE), FONT_SIZE, th.text));
      break;
    }
    case 'manualInput': {
      const k = Math.min(h * 0.32, w * 0.24);
      out.push(poly([[x, y + k], [x + w, y], [x + w, y + h], [x, y + h]], fill, stroke));
      out.push(centeredText(cx, cy + k / 2, wrapText(n.label, w - 20, FONT_SIZE), FONT_SIZE, th.text));
      break;
    }
    case 'delay': {
      const r = h / 2;
      out.push(`<path d="M ${x} ${y} L ${x + w - r} ${y} A ${r} ${r} 0 0 1 ${x + w - r} ${y + h} L ${x} ${y + h} Z" fill="${fill}" stroke="${stroke}" stroke-width="${SW}"/>`);
      out.push(centeredText(cx - r / 4, cy, wrapText(n.label, w - r - 16, FONT_SIZE), FONT_SIZE, th.text));
      break;
    }
    case 'display': {
      const r = h / 2;
      const k = Math.min(h * 0.6, w * 0.16);
      out.push(`<path d="M ${x + k} ${y} L ${x + w - r} ${y} A ${r} ${r} 0 0 1 ${x + w - r} ${y + h} L ${x + k} ${y + h} L ${x} ${cy} Z" fill="${fill}" stroke="${stroke}" stroke-width="${SW}"/>`);
      out.push(centeredText(cx + k / 3, cy, wrapText(n.label, w - k - r, FONT_SIZE), FONT_SIZE, th.text));
      break;
    }
    case 'document': {
      const wave = Math.min(h * 0.22, 16);
      out.push(`<path d="M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h - wave} C ${x + w * 0.72} ${y + h - wave * 3.1} ${x + w * 0.28} ${y + h + wave * 1.5} ${x} ${y + h - wave * 1.1} Z" fill="${fill}" stroke="${stroke}" stroke-width="${SW}"/>`);
      out.push(centeredText(cx, cy - wave / 2, wrapText(n.label, w - 24, FONT_SIZE), FONT_SIZE, th.text));
      break;
    }
    case 'multiDocument': {
      const o = 7;
      const wave = Math.min(h * 0.22, 14);
      out.push(`<path d="M ${x + o * 2} ${y} L ${x + w} ${y} L ${x + w} ${y + h - o * 2}" fill="none" stroke="${stroke}" stroke-width="${SW2}"/>`);
      out.push(`<path d="M ${x + o} ${y + o} L ${x + w - o} ${y + o} L ${x + w - o} ${y + h - o}" fill="none" stroke="${stroke}" stroke-width="${SW2}"/>`);
      out.push(`<path d="M ${x} ${y + o * 2} L ${x + w - o * 2} ${y + o * 2} L ${x + w - o * 2} ${y + h - wave - o} C ${x + (w - o * 2) * 0.72} ${y + h - wave * 3} ${x + (w - o * 2) * 0.28} ${y + h + wave} ${x} ${y + h - wave - o} Z" fill="${fill}" stroke="${stroke}" stroke-width="${SW}"/>`);
      out.push(centeredText(cx - o, cy, wrapText(n.label, w - o * 2 - 20, FONT_SIZE), FONT_SIZE, th.text));
      break;
    }
    case 'internalStorage': {
      const d = Math.min(14, w * 0.2);
      out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="${SW}"/>`);
      out.push(`<path d="M ${x + d} ${y} L ${x + d} ${y + d} L ${x + w} ${y + d}" fill="none" stroke="${stroke}" stroke-width="${SW2}"/>`);
      out.push(centeredText(cx + d / 2, cy + d / 2, wrapText(n.label, w - d - 20, FONT_SIZE), FONT_SIZE, th.text));
      break;
    }
    case 'subprocess': {
      out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="${SW}"/>`);
      out.push(`<path d="M ${x + 11} ${y} L ${x + 11} ${y + h} M ${x + w - 11} ${y} L ${x + w - 11} ${y + h}" stroke="${stroke}" stroke-width="${SW2}"/>`);
      out.push(centeredText(cx, cy, wrapText(n.label, w - 34, FONT_SIZE), FONT_SIZE, th.text));
      break;
    }
    case 'offPage': {
      const k = Math.min(14, h * 0.24);
      out.push(poly([[x, y], [x + w, y], [x + w, y + h - k], [x + w - k, y + h], [x + k, y + h], [x, y + h - k]], fill, stroke));
      out.push(centeredText(cx, cy - k / 2, wrapText(n.label, w - k * 2 - 16, FONT_SIZE), FONT_SIZE, th.text));
      break;
    }
    case 'note': {
      const f = 13;
      out.push(`<path d="M ${x} ${y} L ${x + w - f} ${y} L ${x + w} ${y + f} L ${x + w} ${y + h} L ${x} ${y + h} Z" fill="${th.note}" stroke="${th.noteStroke}" stroke-width="${SW}"/>`);
      out.push(`<path d="M ${x + w - f} ${y} L ${x + w - f} ${y + f} L ${x + w} ${y + f}" fill="none" stroke="${th.noteStroke}" stroke-width="${SW2}"/>`);
      out.push(centeredText(cx, cy, wrapText(n.label, w - 22, FONT_SIZE), FONT_SIZE, th.text));
      break;
    }

    // ---------------------------------------------------------------- 补充形状（对齐 D2 shape catalog）
    /**
     * 队列：右端半圆的管道 + 内部两条横线表示排队元素。
     * 外轮廓与 delay 同源，靠内部横线区分（delay 是纯空管）。
     */
    case 'queue': {
      const r = h / 2;
      out.push(`<path d="M ${x} ${y} L ${x + w - r} ${y} A ${r} ${r} 0 0 1 ${x + w - r} ${y + h} L ${x} ${y + h} Z" fill="${fill}" stroke="${stroke}" stroke-width="${SW}"/>`);
      const qx0 = x + 12;
      const qx1 = x + w - r - 12;
      if (qx1 > qx0) {
        out.push(`<line x1="${qx0}" y1="${y + h * 0.33}" x2="${qx1}" y2="${y + h * 0.33}" stroke="${stroke}" stroke-width="${SW2}"/>`);
        out.push(`<line x1="${qx0}" y1="${y + h * 0.67}" x2="${qx1}" y2="${y + h * 0.67}" stroke="${stroke}" stroke-width="${SW2}"/>`);
      }
      out.push(centeredText(cx - r / 4, cy, wrapText(n.label, w - r - 24, FONT_SIZE), FONT_SIZE, th.text));
      break;
    }
    /** 包 / 模块：左上角带标签小格的文件夹轮廓（UML package） */
    case 'package': {
      const tabW = Math.min(w * 0.42, 72);
      const tabH = Math.min(14, h * 0.24);
      out.push(`<path d="M ${x} ${y} L ${x} ${y + h} L ${x + w} ${y + h} L ${x + w} ${y + tabH} L ${x + tabW} ${y + tabH} L ${x + tabW} ${y} Z" fill="${fill}" stroke="${stroke}" stroke-width="${SW}" stroke-linejoin="round"/>`);
      out.push(centeredText(cx, cy + tabH / 2, wrapText(n.label, w - 24, FONT_SIZE), FONT_SIZE, th.text));
      break;
    }
    /** 用户 / 角色：头 + 肩剪影，标签压在下方 */
    case 'person': {
      const gw = Math.min(w * 0.46, 46);
      const headR = Math.max(6, Math.min(gw * 0.28, h * 0.16));
      const headCy = y + 8 + headR;
      out.push(`<circle cx="${cx}" cy="${headCy}" r="${headR}" fill="none" stroke="${stroke}" stroke-width="${SW}"/>`);
      const shTop = headCy + headR + 4;
      const shH = Math.max(7, Math.min(h * 0.24, 20));
      out.push(`<path d="M ${cx - gw / 2} ${shTop + shH} L ${cx - gw / 2} ${shTop + shH * 0.45} A ${gw / 2} ${shH * 0.55} 0 0 1 ${cx + gw / 2} ${shTop + shH * 0.45} L ${cx + gw / 2} ${shTop + shH}" fill="none" stroke="${stroke}" stroke-width="${SW}" stroke-linecap="round"/>`);
      out.push(centeredText(cx, Math.min(y + h - 10, shTop + shH + 14), wrapText(n.label, w - 12, FONT_SIZE), FONT_SIZE, th.text));
      break;
    }
    /** 页面：右下折角的纸张，与 note 的右上折角区分开 */
    case 'page': {
      const f = Math.min(20, h * 0.32);
      out.push(`<path d="M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h - f} L ${x + w - f} ${y + h} L ${x} ${y + h} Z" fill="${fill}" stroke="${stroke}" stroke-width="${SW}" stroke-linejoin="round"/>`);
      out.push(`<path d="M ${x + w - f} ${y + h} L ${x + w - f} ${y + h - f} L ${x + w} ${y + h - f}" fill="none" stroke="${stroke}" stroke-width="${SW2}"/>`);
      out.push(centeredText(cx - f / 3, cy - f / 3, wrapText(n.label, w - f - 20, FONT_SIZE), FONT_SIZE, th.text));
      break;
    }
    /** 步骤：左上 + 右下切角的卡片 */
    case 'step': {
      const k = Math.min(h * 0.34, w * 0.14);
      out.push(poly([[x + k, y], [x + w, y], [x + w, y + h - k], [x + w - k, y + h], [x, y + h], [x, y + k]], fill, stroke));
      out.push(centeredText(cx, cy, wrapText(n.label, w - k * 2 - 16, FONT_SIZE), FONT_SIZE, th.text));
      break;
    }
    /** 注释气泡：左下角带下指三角尾巴 */
    case 'callout': {
      const tailW = Math.min(20, w * 0.2);
      const tailH = Math.min(13, h * 0.24);
      out.push(`<path d="M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h - tailH} L ${x + tailW} ${y + h - tailH} L ${x + tailW * 0.5} ${y + h} L ${x} ${y + h - tailH} Z" fill="${fill}" stroke="${stroke}" stroke-width="${SW}" stroke-linejoin="round"/>`);
      out.push(centeredText(cx, cy - tailH / 2, wrapText(n.label, w - 22, FONT_SIZE), FONT_SIZE, th.text));
      break;
    }
    /**
     * 已存数据（ISO 5807）：平行四边形 + 右缘外凸弧。
     * 左缘斜切让它和 delay（纯管道）、display（左尖 + 右半圆）三者互不撞脸。
     */
    case 'storedData': {
      const k = Math.min(w * 0.12, h * 0.45);
      const r = Math.min(w * 0.16, h * 0.85);
      out.push(`<path d="M ${x + k} ${y} L ${x + w - r} ${y} A ${r} ${h / 2} 0 0 1 ${x + w - r} ${y + h} L ${x + k * 0.3} ${y + h} Z" fill="${fill}" stroke="${stroke}" stroke-width="${SW}" stroke-linejoin="round"/>`);
      out.push(centeredText(cx - r / 4, cy, wrapText(n.label, w - k - r - 18, FONT_SIZE), FONT_SIZE, th.text));
      break;
    }

    default: {
      if (n.kind === 'class' || n.members?.length) {
        out.push(renderClassBox(n, th));
      } else {
        const r = n.shape === 'round' ? 12 : 0;
        out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${SW}"/>`);
        out.push(centeredText(cx, cy, wrapText(n.label, w - 26, FONT_SIZE), FONT_SIZE, th.text, { bold: n.kind === 'root' }));
      }
    }
  }
  out.push('</g>');
  return out.join('');
}

function renderClassBox(n: NodeIR, th: Theme): string {
  const g = n.geometry!;
  const { x, y, w } = g;
  const members = n.members ?? [];
  const out: string[] = [];
  const hasStereo = !!n.stereotype;
  const titleH = 34;
  const stereoH = hasStereo ? 18 : 0;
  const bodyH = members.length ? members.length * 19 + 10 : 0;

  out.push(`<rect x="${x}" y="${y}" width="${w}" height="${g.h}" fill="${n.style?.fill ?? th.node}" stroke="${th.nodeStroke}" stroke-width="${SW}"/>`);
  out.push(`<path d="M ${x} ${y + stereoH} L ${x + w} ${y + stereoH}" stroke="${th.nodeStroke}" stroke-width="${SW2}"/>`);
  out.push(`<rect x="${x}" y="${y}" width="${w}" height="${stereoH + titleH}" fill="${th.headline}"/>`);
  out.push(`<path d="M ${x} ${y + stereoH + titleH} L ${x + w} ${y + stereoH + titleH}" stroke="${th.nodeStroke}" stroke-width="${SW2}"/>`);
  if (bodyH) {
    out.push(`<path d="M ${x} ${y + stereoH + titleH + bodyH} L ${x + w} ${y + stereoH + titleH + bodyH}" stroke="${th.nodeStroke}" stroke-width="${SW2}" stroke-dasharray="4 3"/>`);
  }
  if (hasStereo) {
    out.push(centeredText(x + w / 2, y + stereoH / 2 + 1, [`«${n.stereotype}»`], FONT_SIZE - 2, th.textDim, { bold: true }));
  }
  out.push(centeredText(x + w / 2, y + stereoH + titleH / 2 + 1, wrapText(n.label, w - 20, FONT_SIZE), TITLE_SIZE, th.text, { bold: true }));
  let my = y + stereoH + titleH + 15;
  for (const m of members) {
    const vis = m.visibility ?? '';
    out.push(`<text x="${x + 10}" y="${my}" font-size="${FONT_SIZE - 1}" fill="${th.text}" font-family="ui-monospace, Consolas, 'PingFang SC', monospace" dominant-baseline="central">${esc(vis + ' ' + m.text)}</text>`);
    my += 19;
  }
  return out.join('');
}

/** 折角便签 */
export function renderNote(x: number, y: number, w: number, h: number, lines: string[], th: Theme): string {
  const f = 12;
  const out: string[] = [];
  out.push(`<path d="M ${x} ${y} L ${x + w - f} ${y} L ${x + w} ${y + f} L ${x + w} ${y + h} L ${x} ${y + h} Z" fill="${th.note}" stroke="${th.noteStroke}" stroke-width="${SW}"/>`);
  out.push(`<path d="M ${x + w - f} ${y} L ${x + w - f} ${y + f} L ${x + w} ${y + f}" fill="none" stroke="${th.noteStroke}" stroke-width="${SW2}"/>`);
  const lh = FONT_SIZE + 3;
  lines.forEach((l, i) => {
    out.push(`<text x="${x + 10}" y="${y + 14 + i * lh}" font-size="${FONT_SIZE - 1}" fill="${th.text}" dominant-baseline="central" font-family="system-ui, -apple-system, 'PingFang SC', sans-serif">${esc(l)}</text>`);
  });
  return out.join('');
}

/** 箭头 marker 定义（按主题生成，避免颜色写死） */
export function markerDefs(th: Theme): string {
  const c = th.line;
  const m = (id: string, inner: string) =>
    `<marker id="${id}" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="9" markerHeight="9" orient="auto-start-reverse">${inner}</marker>`;
  return [
    m(`ds-arrow-${th.key}`, `<path d="M1 1 L11 6 L1 11" fill="none" stroke="${c}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`),
    m(`ds-triangle-${th.key}`, `<path d="M1 1 L11 6 L1 11 Z" fill="${th.bg}" stroke="${c}" stroke-width="1.5"/>`),
    m(`ds-diamond-${th.key}`, `<path d="M1 6 L6 1 L11 6 L6 11 Z" fill="${c}" stroke="${c}" stroke-width="1"/>`),
    m(`ds-diamondOpen-${th.key}`, `<path d="M1 6 L6 1 L11 6 L6 11 Z" fill="${th.bg}" stroke="${c}" stroke-width="1.4"/>`),
    m(`ds-cross-${th.key}`, `<path d="M2 2 L10 10 M10 2 L2 10" fill="none" stroke="${c}" stroke-width="1.8" stroke-linecap="round"/>`),
    m(`ds-half-${th.key}`, `<path d="M1 11 L11 6" fill="none" stroke="${c}" stroke-width="1.8" stroke-linecap="round"/>`),
  ].join('\n');
}

export function markerFor(head: string | undefined, th: Theme): string {
  const map: Record<string, string> = {
    arrow: `ds-arrow-${th.key}`,
    triangle: `ds-triangle-${th.key}`,
    diamond: `ds-diamond-${th.key}`,
    diamondOpen: `ds-diamondOpen-${th.key}`,
    cross: `ds-cross-${th.key}`,
    halfArrow: `ds-half-${th.key}`,
  };
  const id = map[head ?? ''] ?? '';
  return id ? ` marker-end="url(#${id})"` : '';
}

/** 从节点中心朝目标方向求边界点 */
export function boundaryPoint(n: NodeIR, tx: number, ty: number): { x: number; y: number } {
  const g = n.geometry!;
  const cx = g.x + g.w / 2;
  const cy = g.y + g.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  if (n.shape === 'diamond') {
    const t = 1 / (Math.abs(dx) / (g.w / 2) + Math.abs(dy) / (g.h / 2));
    return { x: cx + dx * t, y: cy + dy * t };
  }
  if (n.shape === 'parallelogram' || n.shape === 'trapezoid' || n.shape === 'hexagon') {
    // 斜边形状按外接矩形近似取边界，够用且不会跑出框
    const k = n.shape === 'hexagon' ? Math.min(g.h * 0.42, g.w * 0.2) : Math.min(g.h * 0.45, g.w * 0.22);
    const hw = g.w / 2 + k / 2 + 2;
    const hh = g.h / 2 + 2;
    const sx = dx === 0 ? Infinity : hw / Math.abs(dx);
    const sy = dy === 0 ? Infinity : hh / Math.abs(dy);
    const s = Math.min(sx, sy);
    return { x: cx + dx * s, y: cy + dy * s };
  }
  if (n.shape === 'circle' || n.shape === 'dot' || n.shape === 'bullseye') {
    const r = Math.min(g.w, g.h) / 2;
    const len = Math.hypot(dx, dy);
    return { x: cx + (dx / len) * r, y: cy + (dy / len) * r };
  }
  const hw = g.w / 2 + 2;
  const hh = g.h / 2 + 2;
  const sx = dx === 0 ? Infinity : hw / Math.abs(dx);
  const sy = dy === 0 ? Infinity : hh / Math.abs(dy);
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}

export function labelBg(x: number, y: number, text: string, th: Theme, size = FONT_SIZE - 1): string {
  const w = textWidth(text, size) + 10;
  const h = size + 8;
  return `<rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="3" fill="${th.bg}" opacity="0.92"/>`;
}
