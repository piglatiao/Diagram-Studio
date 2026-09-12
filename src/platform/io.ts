/** L4 · 导入导出（全部浏览器本地完成，无服务端） */
import type { DocRow } from './db';

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 把 foreignObject 降级为 <text>，解决 canvas 光栅化丢标签的老问题 */
function deForeignObject(svg: SVGSVGElement) {
  svg.querySelectorAll('foreignObject').forEach((fo) => {
    const text = (fo.textContent ?? '').trim();
    const x = parseFloat(fo.getAttribute('x') ?? '0');
    const y = parseFloat(fo.getAttribute('y') ?? '0');
    const w = parseFloat(fo.getAttribute('width') ?? '100');
    const h = parseFloat(fo.getAttribute('height') ?? '20');
    const t = document.createElementNS(SVG_NS, 'text');
    t.setAttribute('x', String(x + w / 2));
    t.setAttribute('y', String(y + h / 2));
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('dominant-baseline', 'central');
    t.setAttribute('font-size', '13');
    t.setAttribute('font-family', "system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif");
    const inner = fo.querySelector('[style*="color"]') as HTMLElement | null;
    if (inner?.style?.color) t.setAttribute('fill', inner.style.color);
    t.textContent = text;
    fo.replaceWith(t);
  });
}

export function exportSvg(svgText: string, filename: string) {
  download(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }), filename);
}

export async function exportPng(svgText: string, filename: string, scale = 2, bg = '#ffffff') {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const svg = doc.documentElement as unknown as SVGSVGElement;
  if (!svg.getAttribute('xmlns')) svg.setAttribute('xmlns', SVG_NS);
  const vb = (svg.getAttribute('viewBox') ?? '').split(/\s+/).map(Number);
  let w = parseFloat(svg.getAttribute('width') ?? '') || (vb[2] ?? 800);
  let h = parseFloat(svg.getAttribute('height') ?? '') || (vb[3] ?? 600);
  if (!isFinite(w) || w <= 0) w = 800;
  if (!isFinite(h) || h <= 0) h = 600;
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));
  deForeignObject(svg);

  const serialized = new XMLSerializer().serializeToString(svg);
  const blob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('SVG 转位图失败'));
      im.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(w * scale);
    canvas.height = Math.ceil(h * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    if (out) download(out, filename);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function exportSource(source: string, filename: string) {
  downloadText(source, filename);
}

/** 直接把文本交给浏览器下载（文件系统不可写时的最终兜底） */
export function downloadText(text: string, filename: string) {
  download(new Blob([text], { type: 'text/plain;charset=utf-8' }), filename);
}

export function exportBundle(docs: DocRow[], filename: string) {
  const bundle = {
    format: 'diagram-studio/bundle',
    version: 1,
    exportedAt: new Date().toISOString(),
    documents: docs,
  };
  download(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }), filename);
}

export async function importBundle(file: File): Promise<DocRow[]> {
  const text = await file.text();
  const data = JSON.parse(text);
  if (data?.format === 'diagram-studio/bundle' && Array.isArray(data.documents)) {
    return data.documents as DocRow[];
  }
  if (Array.isArray(data)) return data as DocRow[];
  throw new Error('不是有效的 Diagram Studio 备份文件');
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

/** 通过浏览器打印管线导出 PDF（调用方负责打开一个只含该 SVG 的打印窗口） */
export function printSvg(svgText: string, title: string) {
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) return;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
  <style>@page{size:auto;margin:12mm}body{margin:0;display:flex;justify-content:center}svg{max-width:100%;height:auto}</style>
  </head><body>${svgText}<script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script></body></html>`);
  w.document.close();
}
