/**
 * L1 · 可视化画布（React Flow）
 *
 * 与文本模式共享同一份 IR；所有编辑最终收敛为「最小化源码补丁」，
 * 纯几何移动则写入 sidecar overlay（不污染源码）。
 *
 * 绘制能力（M3）：
 *   1. 空白文档直接开画 —— 空画布给出「添加第一个节点」入口
 *   2. 双击空白处新建节点
 *   3. 从节点句柄拖到空白处 —— 一行源码同时完成「声明 + 连线」
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Handle, Position, MarkerType,
  applyNodeChanges, applyEdgeChanges, useReactFlow,
  type Node, type Edge, type Connection, type NodeChange, type EdgeChange, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useStore } from './store';
import { editorBridge } from './bridge';
import { layoutDiagram } from '../layout';
import { hashString } from '../ir/types';
import type { DiagramPatch } from '../ir/patch';
import { toSourceEdits } from '../lang/edit';
import { nextMmdId } from '../lang/mmd/edit';
import { nextPumlId } from '../lang/puml/edit';

interface DsNodeData extends Record<string, unknown> {
  label: string;
  kind?: string;
  shape?: string;
  /** 新建的节点自动进入标签编辑 */
  autoEdit?: boolean;
  commit: (id: string, label: string) => void;
  onAutoEditDone: (id: string) => void;
}

function DsNode({ id, data, selected }: NodeProps) {
  const d = data as unknown as DsNodeData;
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(d.label);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setVal(d.label), [d.label]);
  useEffect(() => { if (d.autoEdit) setEditing(true); }, [d.autoEdit, id]);
  /**
   * autoFocus 在 React Flow 的节点容器里不可靠：节点测量完成前祖先还是
   * visibility:hidden，focus() 会静默失效。这里在测量后再补几次，
   * 且只在「用户没在别处输入」时才抢 —— 点按钮/点画布不算输入，
   * 而源码编辑器（contenteditable）或别的输入框正在用的时候绝不打断。
   */
  useEffect(() => {
    if (!editing) return;
    const timers = [0, 60, 200].map((ms) =>
      window.setTimeout(() => {
        const el = inputRef.current;
        if (!el) return;
        const ae = document.activeElement as HTMLElement | null;
        const typing = !!ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable);
        if (!typing) el.focus();
      }, ms)
    );
    return () => timers.forEach(clearTimeout);
  }, [editing]);

  const finish = (cancel = false) => {
    setEditing(false);
    d.onAutoEditDone(id);
    const next = val.trim();
    if (!cancel && next && next !== d.label) d.commit(id, next);
    else setVal(d.label);
  };

  const shape = d.shape ?? 'round';
  return (
    <div
      className={`dsn s-${shape} ${selected ? 'sel' : ''}`}
      onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
      title="双击编辑标签"
    >
      <Handle type="target" position={Position.Left} className="dsn-handle" />
      {editing ? (
        <input
          className="dsn-input"
          ref={inputRef}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onBlur={() => finish()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') finish();
            if (e.key === 'Escape') finish(true);
            e.stopPropagation();
          }}
        />
      ) : (
        <span className="dsn-label">{d.label}</span>
      )}
      <Handle type="source" position={Position.Right} className="dsn-handle" />
    </div>
  );
}

const nodeTypes = { ds: DsNode };

const UNSUPPORTED = new Set(['sequence', 'gantt']);

/** 画布上「不该被当成空白」的元素：节点/连线/把手/控件/小地图 */
const NOT_BLANK =
  '.react-flow__node, .react-flow__edge, .react-flow__handle, .react-flow__controls, .react-flow__minimap, .react-flow__panel, .react-flow__attribution';

function CanvasInner() {
  const ir = useStore((s) => s.ir);
  const source = useStore((s) => s.source);
  const lang = useStore((s) => s.lang);
  const overlay = useStore((s) => s.overlay);
  const selectedNode = useStore((s) => s.selectedNode);
  const moveNode = useStore((s) => s.moveNode);
  const selectNode = useStore((s) => s.selectNode);
  const undo = useStore((s) => s.undo);
  const canUndo = useStore((s) => s.undoStack.length > 0);
  const { screenToFlowPosition, fitView } = useReactFlow();

  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [ready, setReady] = useState(false);
  const [autoEditId, setAutoEditId] = useState<string | null>(null);
  const dragFrom = useRef<string | null>(null);

  const commit = useCallback((patch: DiagramPatch, label: string) => {
    const st = useStore.getState();
    if (!st.ir) return;
    const edits = toSourceEdits(st.ir, st.source, patch, st.lang);
    if (!edits.length) {
      st.setNotice('该元素没有可定位的源码位置，回写已跳过');
      return;
    }
    st.commitEdits(edits, label, 'canvas');
  }, []);

  const commitLabel = useCallback((id: string, label: string) => {
    commit({ op: 'update-node', id, label }, '修改节点标签');
  }, [commit]);

  const clearAutoEdit = useCallback((id: string) => {
    setAutoEditId((cur) => (cur === id ? null : cur));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!ir || UNSUPPORTED.has(ir.kind)) {
        setNodes([]);
        setEdges([]);
        setReady(true);
        return;
      }
      await layoutDiagram(ir);
      if (cancelled) return;
      const ov = overlay && overlay.sourceHash === hashString(source) ? overlay : null;
      const ns: Node[] = ir.nodes.map((n) => {
        const g = n.geometry ?? { x: 0, y: 0, w: 140, h: 50 };
        const p = ov?.nodes?.[n.id];
        return {
          id: n.id,
          type: 'ds',
          position: p ? { x: p.x, y: p.y } : { x: g.x, y: g.y },
          data: {
            label: n.label || n.id,
            kind: n.kind,
            shape: n.shape,
            autoEdit: autoEditId === n.id,
            commit: commitLabel,
            onAutoEditDone: clearAutoEdit,
          } as unknown as Record<string, unknown>,
          style: { width: Math.max(130, Math.min(320, g.w)) },
        };
      });
      const es: Edge[] = ir.edges
        .filter((e) => !e.data?.activation)
        .map((e) => ({
          id: e.id,
          source: e.from,
          target: e.to,
          label: e.label,
          type: 'smoothstep',
          animated: !!e.dashed,
          style: { stroke: 'var(--rf-line, #64748b)' },
          markerEnd: (e.head ?? 'arrow') === 'none' ? undefined : { type: MarkerType.ArrowClosed },
        }));
      setNodes(ns);
      setEdges(es);
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, [ir, source, overlay, commitLabel, clearAutoEdit, autoEditId]);

  const onNodesChange = useCallback((c: NodeChange[]) => setNodes((ns) => applyNodeChanges(c, ns)), []);
  const onEdgesChange = useCallback((c: EdgeChange[]) => setEdges((es) => applyEdgeChanges(c, es)), []);

  /** 新建节点：from 非空时，一行源码同时完成「声明 + 连线」 */
  const createNode = useCallback((from: string | null, pos?: { x: number; y: number }) => {
    const st = useStore.getState();
    if (!st.ir) {
      st.setNotice('当前源码解析不出可编辑结构，请先在左侧修正');
      return;
    }
    const before = st.ir.nodes.length;
    const id = st.lang === 'plantuml' ? nextPumlId(st.ir) : nextMmdId(st.ir);
    commit(
      { op: 'add-node', id, label: '新节点', ...(from ? { connectFrom: from } : {}) },
      from ? '新增下级节点' : '新增节点',
    );
    const after = useStore.getState();
    if (!after.ir?.nodes.some((n) => n.id === id)) return;
    if (pos) after.moveNode(id, Math.round(pos.x), Math.round(pos.y));
    setAutoEditId(id);
    after.selectNode(id);
    // 前两个节点时自动归位，避免新节点落在视野之外
    if (before <= 1) setTimeout(() => void fitView({ padding: 0.3, duration: 250, maxZoom: 1.2 }), 80);
    // 源码面板同步高亮到新节点（延后一拍等编辑器吃到新 source；不抢焦点，标签输入框要继续保持焦点）
    const node = after.ir.nodes.find((n) => n.id === id);
    if (node?.ref) {
      const { start, end } = node.ref.span;
      setTimeout(() => editorBridge.selectRange?.(start, end, { focus: false }), 0);
    }
  }, [commit]);

  const onConnect = useCallback((c: Connection) => {
    if (c.source && c.target) commit({ op: 'add-edge', from: c.source, to: c.target }, '新增连线');
  }, [commit]);

  const onNodeClick = useCallback((_: unknown, n: Node) => {
    selectNode(n.id);
    const node = useStore.getState().ir?.nodes.find((x) => x.id === n.id);
    // 只高亮源码位置，不把焦点抢进编辑器：否则紧接着按 Delete 删的是源码而不是节点
    if (node?.ref) editorBridge.selectRange?.(node.ref.span.start, node.ref.span.end, { focus: false });
  }, [selectNode]);

  /**
   * 双击空白 → 新建独立节点。
   * 判据是「没点在节点/连线/控件上」，而不是「点中的元素恰好是 pane」：
   * 空白处的实际命中元素常是背景 svg / pattern rect（没有 class），按 className 精确匹配会时灵时不灵。
   */
  const onDoubleClick = (e: React.MouseEvent) => {
    const t = e.target as Element | null;
    if (!t || t.closest(NOT_BLANK)) return;
    const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    createNode(null, { x: pos.x - 65, y: pos.y - 20 });
  };

  const unsupported = !!ir && UNSUPPORTED.has(ir.kind);
  const empty = ready && !nodes.length && !unsupported;

  return (
    <div className="canvas">
      <div className="canvas-bar">
        <span className="tag">画布绘制 · 编辑即回写源码</span>
        <span className="hint">双击空白建节点 · 拖右侧圆点到空白建连线 · 双击节点改标签 · Delete 删除</span>
        <div className="spacer" />
        <button className="mini" onClick={() => createNode(null)}>+ 节点</button>
        <button
          className="mini"
          onClick={() => selectedNode && createNode(selectedNode)}
          disabled={!selectedNode}
          title={selectedNode ? `从 ${selectedNode} 拉出一个新节点` : '先选中一个节点'}
        >
          + 下级
        </button>
        <button className="mini" onClick={() => undo()} disabled={!canUndo}>撤销</button>
      </div>
      <div className="canvas-wrap" onDoubleClick={onDoubleClick}>
        {unsupported && (
          <div className="canvas-note">
            时序图 / 甘特图的排版由消息顺序决定，不提供自由画布编辑。<br />
            请切换到「预览」标签查看，或在源码中调整。
          </div>
        )}
        {!unsupported && (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onConnectStart={(_, p) => { dragFrom.current = p.nodeId ?? null; }}
            onConnectEnd={(event, state) => {
              if (state.toNode) return; // 落在已有节点上：交给 onConnect
              const from = state.fromNode?.id ?? dragFrom.current;
              dragFrom.current = null;
              if (!from) return;
              const pt = 'changedTouches' in event ? event.changedTouches?.[0] : event;
              if (!pt) return;
              const pos = screenToFlowPosition({ x: pt.clientX, y: pt.clientY });
              createNode(from, { x: pos.x - 65, y: pos.y - 20 });
            }}
            onNodeClick={onNodeClick}
            onNodeDragStop={(_, n) => moveNode(n.id, n.position.x, n.position.y)}
            onNodesDelete={(del) => del.forEach((n) => commit({ op: 'remove-node', id: n.id }, '删除节点'))}
            onEdgesDelete={(del) => del.forEach((e) => commit({ op: 'remove-edge', id: e.id }, '删除连线'))}
            deleteKeyCode={['Backspace', 'Delete']}
            zoomOnDoubleClick={false}
            fitView
            /* 初次适配不要把内容放大过 100%：节点很少时 fitView 会一路顶到 maxZoom */
            fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
            minZoom={0.2}
            maxZoom={2.5}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={16} size={1} />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        )}
        {empty && (
          <div className="canvas-empty">
            <div className="ce-card">
              <b>空白画布 · 开始绘制</b>
              <p>
                双击空白处新建节点，或点下面的按钮创建第一个节点。<br />
                从节点右侧圆点拖到空白处，会直接生成<b>「已有节点 --&gt; 新节点」</b>的一行源码。
              </p>
              <button className="btn sm" onClick={() => createNode(null)}>＋ 添加第一个节点</button>
              <span className="ce-lang">{lang === 'plantuml' ? 'PlantUML' : 'Mermaid'}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
