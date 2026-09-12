/**
 * L4 · Mermaid 渲染适配器（本地 mermaid.js，无任何网络请求）
 *
 * 渲染用官方引擎保证视觉一致；IR 只用于大纲与定位（见 lang/mmd/parse）。
 */
import mermaid from 'mermaid';
import { parseMermaid } from '../lang/mmd/parse';
import type { Diagnostic } from '../ir/types';
import { RenderRequest, RenderResult } from './types';

let seq = 0;

export const mermaidRenderer = {
  id: 'mermaid',
  supported: ['flowchart', 'sequence', 'class', 'state', 'mindmap', 'gantt'] as const,
  capabilities: { incrementalUpdate: false, supportsBind: true, offline: true, maxNodesHint: 500 },
  canRender: (req: RenderRequest) => req.lang === 'mermaid',

  async render(req: RenderRequest): Promise<RenderResult> {
    const t0 = performance.now();
    const diagnostics: Diagnostic[] = [];

    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: req.config.theme === 'dark' ? 'dark' : 'default',
      fontFamily: req.config.fontFamily,
      flowchart: {
        htmlLabels: !req.config.plainTextLabels,
        curve: 'basis',
        useMaxWidth: true,
      },
      sequence: { useMaxWidth: true, actorFontSize: 13, messageFontSize: 12 },
      class: { useMaxWidth: true },
      state: { useMaxWidth: true },
      gantt: { useMaxWidth: true },
      mindmap: { useMaxWidth: true },
    });

    const id = `dsMmd${(seq++).toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    let svg = '';
    try {
      const out = await mermaid.render(id, req.source);
      svg = out.svg ?? '';
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(msg.replace(/<[^>]*>/g, '').slice(0, 300));
    } finally {
      document.getElementById(id)?.remove();
      document.getElementById(`d${id}`)?.remove();
    }

    return {
      svg,
      diagnostics,
      from: 'engine',
      durationMs: performance.now() - t0,
    };
  },
};

/** 校验（不渲染），用于输入期快速报错 */
export async function validateMermaid(source: string): Promise<{ ok: boolean; message?: string }> {
  try {
    await mermaid.parse(source);
    return { ok: true };
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    return { ok: false, message: raw.replace(/<[^>]*>/g, '').slice(0, 240) };
  }
}

export { parseMermaid };
