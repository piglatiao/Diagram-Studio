/** 渲染调度：语言识别 → 适配器分发 → 后处理 → 缓存 */
import { hashString } from '../ir/types';
import { isBlankSource } from '../lang/blank';
import { mermaidRenderer } from './mermaid';
import { plantumlRenderer } from './plantuml';
import { flowRenderer } from './flow';
import { postProcessSvg, tagMermaidSvg } from './postprocess';
import { RenderConfig, RenderRequest, RenderResult } from './types';

/** 三种并列的文档类型：两种 DSL（代码）+ 一种流程图（可视化） */
export type Lang = 'mermaid' | 'plantuml' | 'flow';

const MMD_HEAD = /^\s*(sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|flowchart|graph|flowchart-v2|quadrantChart|requirementDiagram|sankey-beta|architecture-beta|C4Context)\b/m;

export function detectLanguage(source: string): Lang {
  const s = source.trim();
  if (!s) return 'mermaid';
  // 流程图文档是自带 schema 的 JSON
  if (s.startsWith('{')) {
    try {
      const o = JSON.parse(s) as { schema?: string; nodes?: unknown };
      if (typeof o?.schema === 'string' && o.schema.startsWith('diagram-studio/flow')) return 'flow';
      if (Array.isArray(o?.nodes)) return 'flow';
    } catch {
      /* 不是 JSON，继续按 DSL 判断 */
    }
  }
  if (/@start/i.test(s)) return 'plantuml';
  if (MMD_HEAD.test(s)) return 'mermaid';
  if (/\bparticipant\b|\bactor\b|->>|-->/m.test(s) && /@startuml/i.test(s)) return 'plantuml';
  return 'mermaid';
}

const cache = new Map<string, RenderResult>();
const MAX_CACHE = 40;

export function clearRenderCache() {
  cache.clear();
}

export function makeCacheKey(source: string, lang: Lang, cfg: RenderConfig): string {
  return `${lang}:${cfg.theme}:${cfg.plainTextLabels ? 1 : 0}:${hashString(source)}`;
}

/** 空源码按空渲染（判定逻辑见 lang/blank，零依赖纯函数） */
const EMPTY: RenderResult = { svg: '', diagnostics: [], from: 'engine', durationMs: 0 };

export async function renderDiagram(req: RenderRequest): Promise<RenderResult> {
  if (isBlankSource(req.source)) return { ...EMPTY };

  const hit = cache.get(req.cacheKey);
  if (hit) return { ...hit, from: 'cache', durationMs: 0 };

  const result = req.lang === 'plantuml'
    ? await plantumlRenderer.render(req)
    : req.lang === 'flow'
      ? await flowRenderer.render(req)
      : await mermaidRenderer.render(req);

  let svg = postProcessSvg(result.svg);
  if (req.lang === 'mermaid') {
    // 用 IR 提取到的节点 id 给 mermaid SVG 打标（尽力而为）
    try {
      const { parseMermaid } = await import('../lang/mmd/parse');
      const { ir } = parseMermaid(req.source);
      svg = tagMermaidSvg(svg, ir.nodes.map((n) => n.id));
    } catch {
      /* 打标失败不影响渲染 */
    }
  }

  const out: RenderResult = { ...result, svg };
  cache.set(req.cacheKey, out);
  if (cache.size > MAX_CACHE) {
    const first = cache.keys().next();
    if (!first.done) cache.delete(first.value);
  }
  return out;
}

export { isBlankSource };
export { mermaidRenderer, plantumlRenderer, flowRenderer };
export type { RenderRequest, RenderResult, RenderConfig };
