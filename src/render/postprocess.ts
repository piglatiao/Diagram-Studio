/**
 * 渲染后处理（对所有引擎统一执行）
 * 1. 消毒：任何 SVG（含本地引擎产出）都视为不可信
 * 2. viewBox 归一化
 * 3. 元素打标 data-ds-node —— 图形 ↔ 源码定位的物理桥梁
 */
import DOMPurify from 'dompurify';

const EXTRA_ATTR = ['data-ds-node', 'data-ds-label', 'data-ds-edge', 'viewBox', 'preserveAspectRatio'];

export function postProcessSvg(svg: string): string {
  const clean = DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ['foreignObject', 'style'],
    ADD_ATTR: EXTRA_ATTR,
  });
  return ensureViewBox(clean);
}

function ensureViewBox(svg: string): string {
  const vb = svg.match(/viewBox="([^"]+)"/);
  if (vb && vb[1].trim()) return svg;
  const w = svg.match(/\swidth="(\d+(?:\.\d+)?)"/);
  const h = svg.match(/\sheight="(\d+(?:\.\d+)?)"/);
  const width = w ? w[1] : '800';
  const height = h ? h[1] : '600';
  if (/<svg[^>]*>/.test(svg)) {
    return svg.replace(/<svg([^>]*)>/, `<svg$1 viewBox="0 0 ${width} ${height}">`);
  }
  return svg;
}

/**
 * 为 mermaid 产出的 SVG 补 data-ds-node。
 * mermaid 的元素 id 形如 `flowchart-A-0` / `classId-xxx-1`，
 * 取末段去序号后与 IR 节点 id 比对，命中即打标。
 */
export function tagMermaidSvg(svg: string, nodeIds: string[]): string {
  if (!nodeIds.length) return svg;
  const set = new Set(nodeIds);
  return svg.replace(/<(\w+)([^>]*\bid="([^"]+)"[^>]*)>/g, (m, tag, attrs, id) => {
    const parts = id.split('-');
    for (let i = parts.length - 1; i >= 0; i--) {
      const cand = parts[i];
      if (!cand) continue;
      if (set.has(cand)) {
        return `<${tag}${attrs} data-ds-node="${cand}">`;
      }
      if (/^\d+$/.test(cand)) continue;
      break;
    }
    return m;
  });
}
