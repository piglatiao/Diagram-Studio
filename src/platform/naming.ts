/**
 * L5 · 文件名工具（零依赖，便于在 Node 层单测）
 *
 * 「保存到哪里、叫什么名字」全部由这几个纯函数决定。
 */
import type { Lang } from '../render';

export function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i).toLowerCase() : '';
}

export function stripExt(name: string): string {
  const lower = name.toLowerCase();
  for (const e of ['.flow.json', '.dflow']) {
    if (lower.endsWith(e)) return name.slice(0, -e.length);
  }
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

const KNOWN_EXT = ['.mmd', '.puml', '.plantuml', '.mermaid', '.dflow', '.flow.json'];

export function extFor(lang: Lang): string {
  if (lang === 'plantuml') return '.puml';
  if (lang === 'flow') return '.dflow';
  return '.mmd';
}

/** 补上扩展名（缺省按语言补） */
export function withExt(name: string, lang: Lang): string {
  const lower = name.toLowerCase();
  if (KNOWN_EXT.some((e) => lower.endsWith(e))) return name;
  return `${name}${extFor(lang)}`;
}

/** 标题 → 建议文件名（过滤掉 Windows 非法字符） */
export function suggestFileName(title: string, lang: Lang): string {
  const safe = (title || '未命名图表').replace(/[\\/:*?"<>|]/g, '_').trim() || '未命名图表';
  return withExt(safe, lang);
}

/** 目录内重名自动加 -2 / -3 */
export function dedupeName(name: string, used: Set<string>): string {
  if (!used.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let i = 2;
  while (used.has(`${base}-${i}${ext}`)) i++;
  return `${base}-${i}${ext}`;
}
