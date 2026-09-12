/**
 * L3/L4 · 流程图模型 → DiagramIR
 *
 * 复用自绘引擎：模型带坐标，直接灌进 NodeIR.geometry，
 * renderGraphSvg 就能按手工位置出图（不跑 ELK）。
 */
import { DiagramIR, EdgeIR, NodeIR, hashString } from '../ir/types';
import { FlowModel, autoPlace, cloneFlow } from './model';

export function flowToIr(model: FlowModel): DiagramIR {
  const m = cloneFlow(model);
  autoPlace(m);

  const ir: DiagramIR = {
    schemaVersion: 1,
    kind: 'flowchart',
    origin: { lang: 'flow', sourceHash: hashString(JSON.stringify(model)) },
    title: m.title,
    direction: m.direction === 'LR' ? 'LR' : 'TB',
    nodes: [],
    edges: [],
    groups: [],
    notes: [],
    unparsed: [],
    fidelity: { complete: true, lossy: [] },
  };

  for (const n of m.nodes) {
    const node: NodeIR = {
      id: n.id,
      label: n.label,
      kind: 'flow',
      shape: n.shape,
      geometry: { x: n.x, y: n.y, w: n.w, h: n.h },
      data: { flow: true },
    };
    ir.nodes.push(node);
  }

  const ids = new Set(m.nodes.map((n) => n.id));
  for (const e of m.edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) continue;
    const edge: EdgeIR = {
      id: e.id,
      from: e.from,
      to: e.to,
      label: e.label,
      head: 'arrow',
      dashed: e.dashed,
    };
    ir.edges.push(edge);
  }

  return ir;
}
