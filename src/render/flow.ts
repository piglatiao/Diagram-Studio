/**
 * L4 · 流程图渲染适配器（自绘引擎）
 *
 * 链路：flow JSON → FlowModel → DiagramIR（带手工坐标）→ 自绘 SVG
 * 与 Mermaid / PlantUML 适配器并列，彼此零依赖。
 */
import { flowBounds, parseFlow } from '../flow/model';
import { flowToIr } from '../flow/toIr';
import { renderGraphSvg } from './svg/graph';
import { DARK, LIGHT, Theme, esc } from './svg/shapes';
import { RenderRequest, RenderResult } from './types';

export const flowRenderer = {
  id: 'flow',
  supported: ['flowchart'] as const,
  capabilities: { incrementalUpdate: true, supportsBind: false, offline: true, maxNodesHint: 800 },
  canRender: (req: RenderRequest) => req.lang === 'flow',

  async render(req: RenderRequest): Promise<RenderResult> {
    const t0 = performance.now();
    const th: Theme = req.config.theme === 'dark' ? DARK : LIGHT;
    const { model, error } = parseFlow(req.source);

    if (error) {
      return { svg: messageSvg(error, th), diagnostics: [{ severity: 'error', message: error }], from: 'engine', durationMs: performance.now() - t0 };
    }
    if (!model.nodes.length) {
      return { svg: '', diagnostics: [], from: 'engine', durationMs: performance.now() - t0 };
    }

    const b = flowBounds(model);
    const ir = flowToIr(model);
    const svg = renderGraphSvg(ir, Math.max(240, b.width), Math.max(180, b.height), th);
    return { svg, width: b.width, height: b.height, diagnostics: [], from: 'engine', durationMs: performance.now() - t0 };
  },
};

function messageSvg(text: string, th: Theme): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 140" width="100%">
  <rect width="520" height="140" fill="${th.bg}"/>
  <rect x="18" y="36" width="484" height="68" rx="10" fill="${th.group}" stroke="${th.groupStroke}" stroke-dasharray="6 4"/>
  <text x="260" y="70" text-anchor="middle" font-size="13.5" fill="${th.text}" font-family="system-ui, 'PingFang SC', sans-serif">${esc(text)}</text>
</svg>`;
}
