/**
 * L4 · PlantUML 本地渲染适配器
 *
 * 链路：源码 → 行式解析 → DiagramIR → 本地布局 → 自绘 SVG
 * 全程无网络、无 Java、无 WASM 外部依赖。
 */
import { DiagramIR, Diagnostic } from '../ir/types';
import { parsePlantUml } from '../lang/puml/parse';
import { layoutLayered, layoutMindmap, layoutUsecase } from '../layout';
import { renderGraphSvg, fitGroupToChildren } from './svg/graph';
import { renderSequenceSvg } from './svg/sequence';
import { DARK, LIGHT, Theme, esc } from './svg/shapes';
import { RenderRequest, RenderResult } from './types';

export const plantumlRenderer = {
  id: 'plantuml',
  supported: ['sequence', 'class', 'usecase', 'state', 'component', 'activity', 'mindmap', 'flowchart'] as const,
  capabilities: { incrementalUpdate: false, supportsBind: false, offline: true, maxNodesHint: 600 },
  canRender: (req: RenderRequest) => req.lang === 'plantuml',
  async render(req: RenderRequest): Promise<RenderResult> {
    const t0 = performance.now();
    const th: Theme = req.config.theme === 'dark' ? DARK : LIGHT;
    const { ir, diagnostics } = parsePlantUml(req.source);

    // 空图（如只有 @startuml/@enduml）：按空渲染，不算失败
    if (!ir.nodes.length && !ir.groups.length && !ir.notes.length) {
      return { svg: '', diagnostics: [], from: 'engine', durationMs: performance.now() - t0 };
    }

    let svg: string;
    let width = 800;
    let height = 400;

    if (ir.kind === 'gantt') {
      svg = messageSvg('本地渲染器暂不支持甘特图（gantt）', th);
      width = 560;
      height = 160;
    } else if (ir.kind === 'sequence') {
      svg = renderSequenceSvg(ir, th);
      const m = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
      if (m) { width = +m[1]; height = +m[2]; }
    } else {
      let bounds: { width: number; height: number };
      if (ir.kind === 'mindmap') bounds = layoutMindmap(ir);
      else if (ir.kind === 'usecase') bounds = layoutUsecase(ir);
      else bounds = await layoutLayered(ir, ir.direction === 'LR' ? 'RIGHT' : 'DOWN');
      fitGroupToChildren(ir);
      width = Math.max(320, bounds.width);
      height = Math.max(220, bounds.height);
      svg = renderGraphSvg(ir, width, height, th);
    }

    return {
      svg,
      width,
      height,
      diagnostics,
      from: 'engine',
      durationMs: performance.now() - t0,
    };
  },
};

export function messageSvg(text: string, th: Theme): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 160" width="100%">
  <rect width="560" height="160" fill="${th.bg}"/>
  <rect x="20" y="40" width="520" height="80" rx="10" fill="${th.group}" stroke="${th.groupStroke}" stroke-dasharray="6 4"/>
  <text x="280" y="80" text-anchor="middle" font-size="14" fill="${th.text}" font-family="system-ui, 'PingFang SC', sans-serif">${esc(text)}</text>
</svg>`;
}

/** 供大纲/定位使用的 IR 解析入口 */
export function parseForOutline(source: string): { ir: DiagramIR; diagnostics: Diagnostic[] } {
  const { ir, diagnostics } = parsePlantUml(source);
  return { ir, diagnostics };
}
