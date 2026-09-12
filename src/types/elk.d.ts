declare module 'elkjs/lib/elk.bundled.js' {
  interface ElkNode {
    id: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    children?: ElkNode[];
    edges?: Array<{ id: string; sources: string[]; targets: string[]; sections?: Array<{ startPoint: { x: number; y: number }; endPoint: { x: number; y: number }; bendPoints?: Array<{ x: number; y: number }> }> }>;
    layoutOptions?: Record<string, string>;
  }
  export default class ELK {
    constructor(opts?: Record<string, unknown>);
    layout(graph: ElkNode, opts?: { layoutOptions?: Record<string, string> }): Promise<ElkNode>;
  }
}
