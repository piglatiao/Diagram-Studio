/**
 * L1 · 流程图可视化画布（lang = 'flow'）
 *
 * 与 Mermaid 画布的关键差异：
 *   - 节点位置与尺寸是**模型的一部分**，不是 sidecar overlay；
 *   - 编辑是模型级的（不存在源码锚点问题）；
 *   - 左侧内嵌节点图例库，点选/拖放即可添加形状。
 *
 * 节点外观直接调用自绘引擎（shapeSvgFor → renderNode），
 * 于是「图例面板 / 画布 / 导出 SVG」三处永远是同一张脸。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Handle, Position, MarkerType,
  NodeResizer, applyNodeChanges, applyEdgeChanges, useReactFlow,
  type Node, type Edge, type Connection, type NodeChange, type EdgeChange, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useStore } from './store';
import { ShapePanel, SHAPE_DND_TYPE, shapeSvgFor } from './ShapePanel';
import { shapeDef, ALL_SHAPES, type ShapeDef } from '../flow/shapes';
import { emptyFlowModel, nextFlowEdgeId, nextFlowId, type FlowModel, type FlowNode } from '../flow/model';
import type { FlowShape } from '../ir/types';

type Side = 't' | 'r' | 'b' | 'l';

interface FlowData extends Record<string, unknown> {
  label: string;
  shape: FlowShape;
  dark: boolean;
  edit?: boolean;
  commitLabel: (id: string, label: string) => void;
  commitBox: (id: string, box: { x: number; y: number; w: number; h: number }) => void;
  autoEditDone: (id: string) => void;
}

const DEFAULT_DEF = ALL_SHAPES[1]; // 处理

function FlowNodeView({ id, data, selected }: NodeProps) {
  const d = data as unknown as FlowData;
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(d.label);
  const [box, setBox] = useState({ w: 140, h: 56 });
  const inputRef = useRef<HTMLInputElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => setVal(d.label), [d.label]);
  useEffect(() => { if (d.edit) setEditing(true); }, [d.edit, id]);
  // React Flow 测量完成前祖先还是 visibility:hidden，focus 会静默失效，需补几次
  useEffect(() => {
    if (!editing) return;
    const timers = [0, 60, 200].map((ms) =>
      window.setTimeout(() => {
        const el = inputRef.current;
        if (!el) return;
        // 只在「用户没在别处输入」时接管焦点：按钮 / 画布被点中不算输入，
        // 但源码编辑器（contenteditable）或别的输入框正在用，就绝不抢
        const ae = document.activeElement as HTMLElement | null;
        const typing = !!ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable);
        if (!typing) el.focus();
      }, ms)
    );
    return () => timers.forEach(clearTimeout);
  }, [editing]);

  /**
   * 跟随节点实际尺寸重绘背景形状。
   *
   * 必须用 offsetWidth/offsetHeight（**未受祖先 transform 缩放**的布局尺寸），
   * 不能用 getBoundingClientRect —— React Flow 会给节点加 `transform: scale(zoom)`，
   * 用屏幕尺寸喂给 SVG 的 width/height 会让图形被放大 zoom 倍、溢出节点之外，
   * 既画错又抢走节点外空白处的点击。
   */
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const read = () => {
      const w = el.offsetWidth || 140;
      const h = el.offsetHeight || 56;
      setBox((b) => (b.w === w && b.h === h ? b : { w, h }));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const finish = (cancel = false) => {
    setEditing(false);
    d.autoEditDone(id);
    const next = val.trim();
    if (!cancel && next !== d.label) d.commitLabel(id, next);
    else setVal(d.label);
  };

  const art = useMemo(
    () => shapeSvgFor(d.shape, Math.max(2, box.w), Math.max(2, box.h), editing ? '' : d.label, d.dark),
    [d.shape, d.label, d.dark, box.w, box.h, editing],
  );

  return (
    <div className="fln" ref={hostRef}>
      <NodeResizer
        isVisible={!!selected}
        minWidth={48}
        minHeight={30}
        lineClassName="fln-resize-line"
        handleClassName="fln-resize-handle"
        onResizeEnd={(_, p) => d.commitBox(id, { x: p.x, y: p.y, w: p.width, h: p.height })}
      />
      <div
        className="fln-art"
        dangerouslySetInnerHTML={{ __html: art }}
        onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
      />
      {editing && (
        <div className="fln-edit">
          <input
            ref={inputRef}
            className="fln-input"
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onBlur={() => finish()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') finish();
              if (e.key === 'Escape') finish(true);
              e.stopPropagation();
            }}
          />
        </div>
      )}
      {/* 目标句柄先渲染、源句柄后渲染 —— 叠在同一位置时，拖拽拉起的是源句柄 */}
      <Handle type="target" id="tt" position={Position.Top} className="fln-handle fln-h-tt" />
      <Handle type="target" id="tr" position={Position.Right} className="fln-handle fln-h-tr" />
      <Handle type="target" id="tb" position={Position.Bottom} className="fln-handle fln-h-tb" />
      <Handle type="target" id="tl" position={Position.Left} className="fln-handle fln-h-tl" />
      <Handle type="source" id="st" position={Position.Top} className="fln-handle fln-h-st" />
      <Handle type="source" id="sr" position={Position.Right} className="fln-handle fln-h-sr" />
      <Handle type="source" id="sb" position={Position.Bottom} className="fln-handle fln-h-sb" />
      <Handle type="source" id="sl" position={Position.Left} className="fln-handle fln-h-sl" />
    </div>
  );
}

const nodeTypes = { fln: FlowNodeView };

/** 连线两端落在哪条边上：按两节点中心连线的走向择优 */
function pickSides(a: FlowNode, b: FlowNode): [Side, Side] {
  const dx = b.x + b.w / 2 - (a.x + a.w / 2);
  const dy = b.y + b.h / 2 - (a.y + a.h / 2);
  if (Math.abs(dy) >= Math.abs(dx)) return dy >= 0 ? ['b', 't'] : ['t', 'b'];
  return dx >= 0 ? ['r', 'l'] : ['l', 'r'];
}

/** 画布上「不该被当成空白」的元素：节点/连线/把手/控件/小地图 */
const NOT_BLANK =
  '.react-flow__node, .react-flow__edge, .react-flow__handle, .react-flow__controls, .react-flow__minimap, .react-flow__panel, .react-flow__attribution';

function FlowCanvasInner() {
  const flow = useStore((s) => s.flow);
  const theme = useStore((s) => s.theme);
  const selectedNode = useStore((s) => s.selectedNode);
  const selectNode = useStore((s) => s.selectNode);
  const commitFlow = useStore((s) => s.commitFlow);
  const undo = useStore((s) => s.undo);
  const canUndo = useStore((s) => s.undoStack.length > 0);
  const { screenToFlowPosition, fitView } = useReactFlow();

  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [autoEditId, setAutoEditId] = useState<string | null>(null);
  const dragFrom = useRef<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  /** 连点图例时逐级错开，避免新节点精确叠在一起 */
  const cascade = useRef(0);
  const dark = theme === 'dark';

  const commitLabel = useCallback((id: string, label: string) => {
    commitFlow('修改节点文字', (m) => {
      const n = m.nodes.find((x) => x.id === id);
      if (n) n.label = label;
    });
  }, [commitFlow]);

  const commitBox = useCallback((id: string, box: { x: number; y: number; w: number; h: number }) => {
    commitFlow('调整节点尺寸', (m) => {
      const n = m.nodes.find((x) => x.id === id);
      if (!n) return;
      n.x = box.x; n.y = box.y; n.w = box.w; n.h = box.h;
    });
  }, [commitFlow]);

  const clearAutoEdit = useCallback((id: string) => {
    setAutoEditId((cur) => (cur === id ? null : cur));
  }, []);

  useEffect(() => {
    if (!flow) {
      setNodes([]);
      setEdges([]);
      return;
    }
    const byId = new Map(flow.nodes.map((n) => [n.id, n]));
    setNodes(
      flow.nodes.map((n) => ({
        id: n.id,
        type: 'fln',
        position: { x: n.x, y: n.y },
        data: {
          label: n.label,
          shape: n.shape,
          dark,
          edit: autoEditId === n.id,
          commitLabel,
          commitBox,
          autoEditDone: clearAutoEdit,
        } as unknown as Record<string, unknown>,
        style: { width: n.w, height: n.h },
        selected: selectedNode === n.id,
      }))
    );
    setEdges(
      flow.edges.map((e) => {
        const a = byId.get(e.from);
        const b = byId.get(e.to);
        const sides = a && b ? pickSides(a, b) : (['b', 't'] as [Side, Side]);
        return {
          id: e.id,
          source: e.from,
          target: e.to,
          sourceHandle: `s${sides[0]}`,
          targetHandle: `t${sides[1]}`,
          label: e.label,
          type: 'smoothstep',
          style: { stroke: 'var(--rf-line, #64748b)', ...(e.dashed ? { strokeDasharray: '6 4' } : {}) },
          labelBgPadding: [4, 2] as [number, number],
          labelBgStyle: { fill: 'var(--panel)' },
          markerEnd: { type: MarkerType.ArrowClosed },
        } as Edge;
      })
    );
  }, [flow, selectedNode, autoEditId, commitLabel, commitBox, clearAutoEdit, dark]);

  const onNodesChange = useCallback((c: NodeChange[]) => setNodes((ns) => applyNodeChanges(c, ns)), []);
  const onEdgesChange = useCallback((c: EdgeChange[]) => setEdges((es) => applyEdgeChanges(c, es)), []);

  /** 新增节点：at 为空则落在视口中心；connectFrom 非空时同事务补一条连线 */
  const addNode = useCallback((def: ShapeDef, at?: { x: number; y: number }, connectFrom?: string | null) => {
    const cur: FlowModel = useStore.getState().flow ?? emptyFlowModel();
    const id = nextFlowId(cur);
    let pos = at;
    if (!pos) {
      const el = wrapRef.current;
      const base = el
        ? screenToFlowPosition({
            x: el.getBoundingClientRect().left + el.clientWidth / 2,
            y: el.getBoundingClientRect().top + el.clientHeight / 2,
          })
        : { x: 200, y: 160 };
      const k = cascade.current++ % 8;
      pos = { x: base.x + k * 30, y: base.y + k * 30 };
    }
    commitFlow(`新增${def.name}`, (m) => {
      m.nodes.push({
        id,
        label: def.label,
        shape: def.shape,
        x: Math.round(pos!.x - def.w / 2),
        y: Math.round(pos!.y - def.h / 2),
        w: def.w,
        h: def.h,
      });
      if (connectFrom) m.edges.push({ id: nextFlowEdgeId(m), from: connectFrom, to: id });
    });
    setAutoEditId(id);
    selectNode(id);
    return id;
  }, [commitFlow, screenToFlowPosition, selectNode]);

  const onDrop = (e: React.DragEvent) => {
    const raw = e.dataTransfer.getData(SHAPE_DND_TYPE);
    if (!raw) return;
    e.preventDefault();
    let def: ShapeDef | undefined;
    try {
      const parsed = JSON.parse(raw) as { shape: FlowShape; label: string };
      def = shapeDef(parsed.shape) ?? { ...DEFAULT_DEF, shape: parsed.shape, label: parsed.label };
    } catch {
      return;
    }
    if (def) addNode(def, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
  };

  /**
   * 双击空白 → 落一个「处理」。
   *
   * 判据是「没点在节点/连线/控件上」，而不是「点中的元素恰好是 pane」：
   * 画布空白处的实际命中元素往往是 pane 内部的背景 svg / pattern rect（没有 class），
   * 按 className 精确匹配会时灵时不灵。
   */
  const onDoubleClick = (e: React.MouseEvent) => {
    const t = e.target as Element | null;
    if (!t || t.closest(NOT_BLANK)) return;
    addNode(DEFAULT_DEF, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
  };

  const empty = !!flow && !flow.nodes.length;

  return (
    <div className="flow-wrap">
      <ShapePanel onPick={(def) => addNode(def)} />
      <div className="canvas">
        <div className="canvas-bar">
          <span className="tag">流程图 · 可视化绘制</span>
          <span className="hint">
            左侧图例点选/拖入 · 双击空白建「处理」· 拖圆点连线 · 双击节点改文字 · Delete 删除
          </span>
          <div className="spacer" />
          <button
            className="mini"
            onClick={() => commitFlow('切换方向', (m) => { m.direction = m.direction === 'TB' ? 'LR' : 'TB'; })}
          >
            方向 {flow?.direction ?? 'TB'}
          </button>
          <button className="mini" onClick={() => void fitView({ padding: 0.25, duration: 250 })}>适应</button>
          <button className="mini" onClick={() => undo()} disabled={!canUndo}>撤销</button>
        </div>
        <div
          className="canvas-wrap"
          ref={wrapRef}
          onDoubleClick={onDoubleClick}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
          onDrop={onDrop}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={(c: Connection) => {
              if (!c.source || !c.target || c.source === c.target) return;
              commitFlow('新增连线', (m) => {
                m.edges.push({ id: nextFlowEdgeId(m), from: c.source as string, to: c.target as string });
              });
            }}
            onConnectStart={(_, p) => { dragFrom.current = p.nodeId ?? null; }}
            onConnectEnd={(event, state) => {
              if (state.toNode) return; // 落在已有节点上：交给 onConnect
              const from = state.fromNode?.id ?? dragFrom.current;
              dragFrom.current = null;
              if (!from) return;
              const pt = 'changedTouches' in event ? event.changedTouches?.[0] : event;
              if (!pt) return;
              // 拖到空白处：一次事务同时建节点 + 连线
              addNode(DEFAULT_DEF, screenToFlowPosition({ x: pt.clientX, y: pt.clientY }), from);
            }}
            onNodeClick={(_, n) => selectNode(n.id)}
            onPaneClick={() => selectNode(null)}
            onNodeDragStop={(_, n) => {
              commitFlow('移动节点', (m) => {
                const t = m.nodes.find((x) => x.id === n.id);
                if (t) { t.x = Math.round(n.position.x); t.y = Math.round(n.position.y); }
              });
            }}
            onNodesDelete={(del) => {
              const ids = new Set(del.map((d) => d.id));
              commitFlow('删除节点', (m) => {
                m.nodes = m.nodes.filter((n) => !ids.has(n.id));
                m.edges = m.edges.filter((e) => !ids.has(e.from) && !ids.has(e.to));
              });
            }}
            onEdgesDelete={(del) => {
              const ids = new Set(del.map((d) => d.id));
              commitFlow('删除连线', (m) => { m.edges = m.edges.filter((e) => !ids.has(e.id)); });
            }}
            onEdgeDoubleClick={(e, edge) => {
              e.stopPropagation();
              const cur = useStore.getState().flow?.edges.find((x) => x.id === edge.id)?.label ?? '';
              const next = window.prompt('连线标签（留空则清除）', cur);
              if (next === null) return;
              commitFlow('修改连线标签', (m) => {
                const t = m.edges.find((x) => x.id === edge.id);
                if (t) t.label = next.trim() || undefined;
              });
            }}
            deleteKeyCode={['Backspace', 'Delete']}
            zoomOnDoubleClick={false}
            snapToGrid
            snapGrid={[8, 8]}
            fitView
            /* 初次适配不要把内容放大过 100%：单个节点时 fitView 会一路顶到 maxZoom，很突兀 */
            fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
            minZoom={0.2}
            maxZoom={2.5}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={16} size={1} />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
          {empty && (
            <div className="canvas-empty">
              <div className="ce-card">
                <b>空白流程图 · 开始绘制</b>
                <p>
                  从左侧<b>节点图例</b>里点选或拖一个形状进来，<br />
                  双击空白处可以直接放一个「处理」框。
                </p>
                <button className="btn sm" onClick={() => addNode(DEFAULT_DEF)}>＋ 添加第一个节点</button>
                <span className="ce-lang">流程图（可一键导出 Mermaid）</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function FlowCanvas() {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner />
    </ReactFlowProvider>
  );
}
