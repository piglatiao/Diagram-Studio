/** L4 · 渲染 Port —— 所有渲染适配器统一实现此接口 */
import { DiagramKind, Diagnostic } from '../ir/types';

export interface RenderConfig {
  theme: 'light' | 'dark';
  fontFamily: string;
  scale: number;
  /** 关闭 foreignObject，导出 PNG 时更稳 */
  plainTextLabels?: boolean;
}

export interface RenderRequest {
  cacheKey: string;
  lang: 'mermaid' | 'plantuml' | 'flow';
  source: string;
  config: RenderConfig;
  signal?: AbortSignal;
}

export interface RenderResult {
  svg: string;
  width?: number;
  height?: number;
  diagnostics: Diagnostic[];
  from: 'engine' | 'cache' | 'fallback';
  durationMs: number;
}

export interface DiagramRenderer {
  readonly id: string;
  readonly supported: DiagramKind[];
  canRender(req: RenderRequest): boolean;
  render(req: RenderRequest): Promise<RenderResult>;
  readonly capabilities: {
    incrementalUpdate: boolean;
    supportsBind: boolean;
    offline: boolean;
    maxNodesHint?: number;
  };
}

export class RenderError extends Error {
  constructor(message: string, readonly code: string, readonly detail?: string) {
    super(message);
    this.name = 'RenderError';
  }
}
