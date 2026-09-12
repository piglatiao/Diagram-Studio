/** L2 · 应用状态（Zustand） */
import { create } from 'zustand';
import { Diagnostic, DiagramIR, TextEdit, hashString } from '../ir/types';
import { applyEdits, spanAt, Transaction, TxOrigin } from '../ir/patch';
import { DocRow, newDocId, storage } from '../platform/db';
import { ManualLayoutOverlay, loadOverlay, saveOverlay } from '../platform/overlay';
import {
  FsNode, clearHandle, createFileInDir, ensurePermission, langOfFile, loadHandle, pickDirectory,
  pickSaveFile, readDir, readText, stripExt, suggestFileName, withExt, writeText,
} from '../platform/fs';
import { Lang } from '../render';
import { parseMermaid } from '../lang/mmd/parse';
import { parsePlantUml } from '../lang/puml/parse';
import { FlowModel, emptyFlowModel, flowToMermaid, parseFlow, nextFlowEdgeId, nextFlowId, serializeFlow } from '../flow/model';
import { flowToIr } from '../flow/toIr';
import type { ShapeDef as FlowShapeDef } from '../flow/shapes';

const SAMPLE_MERMAID = `flowchart TD
  A[用户打开应用] --> B{本地渲染?}
  B -- 是 --> C[Mermaid.js 直接出图]
  B -- 否 --> D[PlantUML 本地引擎]
  D --> E[行式解析 → IR]
  E --> F[本地布局 → 自绘 SVG]
  C --> G[渲染完成]
  F --> G
`;

const SAMPLE_PUML = `@startuml
title 下单流程（纯本地渲染）
actor 用户 as U
participant "订单服务" as Order
database "MySQL" as DB
queue "MQ" as MQ

U -> Order: 提交订单
activate Order
Order -> DB: 写入订单
DB --> Order: OK
alt 库存充足
  Order -> MQ: 发送扣减消息
  MQ --> Order: 已受理
else 库存不足
  Order --> U: 下单失败
end
Order --> U: 下单成功
deactivate Order
@enduml
`;

/** 浅拷贝整棵树，保证 React 能感知到目录展开后的变化 */
function cloneTree(n: FsNode): FsNode {
  return { ...n, children: n.children?.map(cloneTree) };
}

const SAMPLE_FLOW = serializeFlow({
  schema: 'diagram-studio/flow@1',
  direction: 'TB',
  nodes: [
    { id: 'N1', label: '开始', shape: 'stadium', x: 135, y: 40, w: 130, h: 52 },
    { id: 'N2', label: '提交申请', shape: 'rect', x: 130, y: 130, w: 140, h: 56 },
    { id: 'N3', label: '是否通过', shape: 'diamond', x: 130, y: 226, w: 140, h: 80 },
    { id: 'N4', label: '归档处理', shape: 'rect', x: 130, y: 348, w: 140, h: 56 },
    { id: 'N5', label: '结束', shape: 'stadium', x: 135, y: 444, w: 130, h: 52 },
  ],
  edges: [
    { id: 'e1', from: 'N1', to: 'N2' },
    { id: 'e2', from: 'N2', to: 'N3' },
    { id: 'e3', from: 'N3', to: 'N4', label: '是' },
    { id: 'e4', from: 'N4', to: 'N5' },
    { id: 'e5', from: 'N3', to: 'N5', label: '否' },
  ],
});

/** 空白骨架：只保留图类型声明，节点全部由画布「画」出来 */
export function blankFor(lang: Lang): string {
  if (lang === 'flow') return serializeFlow(emptyFlowModel());
  return lang === 'plantuml' ? '@startuml\n@enduml\n' : 'flowchart TD\n';
}

export function sampleFor(lang: Lang): string {
  if (lang === 'flow') return SAMPLE_FLOW;
  return lang === 'plantuml' ? SAMPLE_PUML : SAMPLE_MERMAID;
}

/**
 * 源码变更后 overlay 重定位：仍存在的节点保留手工位置，已删除的节点丢弃。
 * 这样「拖好位置 → 改标签/加连线」不会让整张图弹回自动布局。
 */
function rebaseOverlay(
  ov: ManualLayoutOverlay | null,
  ir: DiagramIR | null,
  hash: string,
): ManualLayoutOverlay | null {
  if (!ov || !ir) return null;
  const ids = new Set(ir.nodes.map((n) => n.id));
  const nodes: ManualLayoutOverlay['nodes'] = {};
  let changed = ov.sourceHash !== hash;
  for (const [k, v] of Object.entries(ov.nodes)) {
    if (ids.has(k)) nodes[k] = v;
    else changed = true;
  }
  if (!Object.keys(nodes).length) return null;
  if (!changed) return ov; // 完全一致时保持引用，避免无谓重渲染
  return { sourceHash: hash, nodes, updatedAt: ov.updatedAt };
}

/** 提示 2.6s 后自动消失 */
function noticeOf(set: (p: Partial<State>) => void, msg: string) {
  set({ notice: msg });
  setTimeout(() => set({ notice: null }), 2600);
}

interface State {
  docs: DocRow[];
  activeId: string;
  title: string;
  source: string;
  lang: Lang;
  theme: 'light' | 'dark';
  svg: string;
  error: string | null;
  diagnostics: Diagnostic[];
  ir: DiagramIR | null;
  /** 流程图文档（lang='flow'）的模型视图，其它类型为 null */
  flow: FlowModel | null;
  renderMs: number;
  fromCache: boolean;
  dirty: boolean;
  selectedNode: string | null;
  notice: string | null;
  mode: 'preview' | 'canvas';
  overlay: ManualLayoutOverlay | null;
  undoStack: Transaction[];
  folder: FsNode | null;
  expanded: Record<string, boolean>;
  /** docId → 来源文件节点（用于保存时写回磁盘） */
  fileNodes: Record<string, FsNode>;

  init: () => Promise<void>;
  setMode: (m: 'preview' | 'canvas') => void;
  openFolder: () => Promise<void>;
  toggleDir: (node: FsNode) => Promise<void>;
  openFile: (node: FsNode) => Promise<void>;
  closeFolder: () => Promise<void>;
  setSource: (s: string) => void;
  setTitle: (t: string) => void;
  setLang: (l: Lang) => void;
  setTheme: (t: 'light' | 'dark') => void;
  setRender: (p: { svg: string; diagnostics: Diagnostic[]; renderMs: number; fromCache: boolean; error?: string | null }) => void;
  computeIr: () => void;
  selectNode: (id: string | null) => void;
  newDoc: (lang: Lang) => Promise<void>;
  /** 新建空白图（直接进入画布模式，从零绘制） */
  newBlankDoc: (lang: Lang) => Promise<void>;
  /** 新建流程图文档（可视化绘制，带节点图例库） */
  newFlowDoc: (withSample?: boolean) => Promise<void>;
  /** 流程图模型级事务：一次改动 = 一次撤销步 */
  commitFlow: (label: string, mutate: (m: FlowModel) => void) => void;
  /** 新增流程图形状节点；at 为空时按方向顺势排版 */
  flowAddNode: (def: FlowShapeDef, at?: { x: number; y: number }, connectFrom?: string) => string;
  /** 把当前流程图转成一份 Mermaid 文档 */
  flowExportMermaid: () => Promise<void>;
  /** 在已挂载文件夹的某个目录下新建文件（保存时直接写回该文件夹） */
  newFileInFolder: (dir: FsNode, name?: string) => Promise<void>;
  openDoc: (id: string) => Promise<void>;
  save: () => Promise<void>;
  /** 另存为：一定弹窗重新挑位置 */
  saveAs: () => Promise<void>;
  removeDoc: (id: string) => Promise<void>;
  importDocs: (rows: DocRow[]) => Promise<void>;
  setNotice: (n: string | null) => void;
  /** 静默写本地库（自动保存用，永不弹窗） */
  persist: () => Promise<void>;
  moveNode: (id: string, x: number, y: number) => void;
  commitEdits: (edits: TextEdit[], label: string, origin: TxOrigin) => void;
  undo: () => void;
}

export const useStore = create<State>()((set, get) => ({
  docs: [],
  activeId: '',
  title: '未命名图表',
  source: SAMPLE_MERMAID,
  lang: 'mermaid',
  theme: 'light',
  svg: '',
  error: null,
  diagnostics: [],
  ir: null,
  flow: null,
  renderMs: 0,
  fromCache: false,
  dirty: false,
  selectedNode: null,
  notice: null,
  mode: 'preview',
  overlay: null,
  undoStack: [],
  folder: null,
  expanded: {},
  fileNodes: {},

  setNotice: (n) => set({ notice: n }),
  setMode: (m) => set({ mode: m }),

  async openFolder() {
    const root = await pickDirectory();
    if (!root) return;
    set({ folder: root, expanded: { '': true } });
    await get().toggleDir(root);
  },

  async toggleDir(node) {
    if (!node.loaded) await readDir(node);
    const open = !get().expanded[node.path];
    // 读完后重建 folder 引用，触发 React 重渲染
    set((s) => ({
      expanded: { ...s.expanded, [node.path]: open },
      folder: s.folder ? cloneTree(s.folder) : s.folder,
    }));
  },

  async openFile(node) {
    const text = await readText(node);
    const id = `f:${node.path}`;
    const lang = langOfFile(node.name, text);
    const doc: DocRow = {
      id,
      title: node.name,
      lang,
      source: text,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await storage.put(doc);
    set((s) => ({
      docs: [doc, ...s.docs.filter((d) => d.id !== id)],
      activeId: id,
      source: text,
      lang,
      title: node.name,
      dirty: false,
      selectedNode: null,
      overlay: loadOverlay(id, text),
      undoStack: [],
      fileNodes: { ...s.fileNodes, [id]: node },
    }));
    get().computeIr();
  },

  async closeFolder() {
    await clearHandle();
    set({ folder: null, expanded: {}, fileNodes: {} });
  },

  async init() {
    const docs = await storage.list();
    if (docs.length) {
      set({
        docs,
        activeId: docs[0].id,
        source: docs[0].source,
        lang: docs[0].lang,
        title: docs[0].title,
        dirty: false,
        overlay: loadOverlay(docs[0].id, docs[0].source),
        undoStack: [],
      });
    } else {
      const id = newDocId();
      const doc: DocRow = {
        id,
        title: '示例 · 本地渲染链路',
        lang: 'mermaid',
        source: SAMPLE_MERMAID,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await storage.put(doc);
      set({ docs: [doc], activeId: id, source: doc.source, lang: doc.lang, title: doc.title, overlay: null, undoStack: [] });
    }
    get().computeIr();

    // 恢复上次打开的文件夹（浏览器会要求重新授权一次）
    try {
      const h = await loadHandle();
      if (h && (await ensurePermission(h, 'read'))) {
        const root: FsNode = { kind: 'dir', name: h.name, path: '', loaded: false, h };
        await readDir(root);
        set({ folder: root, expanded: { '': true } });
      }
    } catch {
      /* 恢复失败不影响主流程 */
    }
  },

  setSource(s) {
    set({ source: s, dirty: true });
    // 源码一变就重算 IR —— 否则「画布编辑」模式下改源码，画布不会跟着更新
    get().computeIr();
  },
  setTitle(t) {
    set({ title: t, dirty: true });
  },
  setLang(l) {
    const cur = get().lang;
    if (l === cur) return;
    // 流程图是独立文档类型（JSON 模型），与代码文档不能直接互转
    if (l === 'flow' || cur === 'flow') {
      noticeOf(set, '流程图与代码文档是两种独立类型；流程图可用「导出 Mermaid」把内容带过去');
      return;
    }
    set({ lang: l, dirty: true });
    get().computeIr();
  },
  setTheme(t) {
    set({ theme: t });
  },
  setRender({ svg, diagnostics, renderMs, fromCache, error }) {
    set({ svg, diagnostics, renderMs, fromCache, error: error ?? null });
  },
  computeIr() {
    const { source, lang, overlay } = get();
    if (lang === 'flow') {
      const { model } = parseFlow(source);
      set({ ir: flowToIr(model), flow: model });
      return;
    }
    try {
      const res = lang === 'plantuml' ? parsePlantUml(source) : parseMermaid(source);
      set({ ir: res.ir, flow: null });
      const next = rebaseOverlay(overlay, res.ir, hashString(source));
      if (next !== overlay) set({ overlay: next });
    } catch {
      set({ ir: null, flow: null });
    }
  },
  selectNode(id) {
    set({ selectedNode: id });
  },

  /** 纯几何移动：写 sidecar overlay，不碰源码 */
  moveNode(id, x, y) {
    const { activeId, source, overlay, ir } = get();
    const h = hashString(source);
    const base: ManualLayoutOverlay =
      rebaseOverlay(overlay, ir, h) ?? { sourceHash: h, nodes: {}, updatedAt: 0 };
    const next: ManualLayoutOverlay = {
      sourceHash: h,
      nodes: { ...base.nodes, [id]: { x, y, pinned: true } },
      updatedAt: Date.now(),
    };
    set({ overlay: next });
    if (activeId) saveOverlay(activeId, next);
  },

  /** 把一组文本编辑作为单个事务提交（可一步撤销） */
  commitEdits(edits, label, origin) {
    if (!edits.length) return;
    const { source, undoStack } = get();
    const { text, inverse } = applyEdits(source, edits);
    if (text === source) return;
    const tx: Transaction = {
      id: `tx${Date.now().toString(36)}`,
      label,
      origin,
      edits,
      inverse,
      timestamp: Date.now(),
    };
    set({ source: text, dirty: true, undoStack: [...undoStack, tx] });
    get().computeIr();
  },

  undo() {
    const { source, undoStack } = get();
    const tx = undoStack[undoStack.length - 1];
    if (!tx) return;
    const { text } = applyEdits(source, tx.inverse);
    set({ source: text, dirty: true, undoStack: undoStack.slice(0, -1) });
    get().computeIr();
  },

  async newDoc(lang) {
    const doc: DocRow = {
      id: newDocId(),
      title: lang === 'plantuml' ? '未命名 · PlantUML' : '未命名 · Mermaid',
      lang,
      source: sampleFor(lang),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await storage.put(doc);
    set((s) => ({
      docs: [doc, ...s.docs],
      activeId: doc.id,
      source: doc.source,
      lang: doc.lang,
      title: doc.title,
      dirty: false,
      overlay: null,
      undoStack: [],
    }));
    get().computeIr();
  },

  async newBlankDoc(lang) {
    const doc: DocRow = {
      id: newDocId(),
      title: lang === 'plantuml' ? '空白图 · PlantUML' : '空白图 · Mermaid',
      lang,
      source: blankFor(lang),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await storage.put(doc);
    set((s) => ({
      docs: [doc, ...s.docs],
      activeId: doc.id,
      source: doc.source,
      lang: doc.lang,
      title: doc.title,
      dirty: false,
      selectedNode: null,
      overlay: null,
      undoStack: [],
      mode: 'canvas', // 直接进画布，从零开始画
    }));
    get().computeIr();
  },

  /** 在已挂载文件夹的目录下新建文件：立刻在磁盘上建出来，之后保存直接写回该文件夹 */
  async newFileInFolder(dir, name) {
    await get().persist();
    const lang = name ? langOfFile(name, '') : get().lang;
    const fileName = withExt((name ?? '').trim() || '未命名图表', lang);
    const node = await createFileInDir(dir, fileName, blankFor(lang));
    if (!node) {
      noticeOf(set, '该文件夹不可写，请用 Chromium 系浏览器打开文件夹');
      return;
    }
    const id = `f:${node.path}`;
    const doc: DocRow = {
      id,
      title: stripExt(node.name),
      lang,
      source: blankFor(lang),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await storage.put(doc);
    set((s) => ({
      docs: [doc, ...s.docs.filter((d) => d.id !== id)],
      activeId: id,
      source: doc.source,
      lang,
      title: doc.title,
      dirty: false,
      selectedNode: null,
      overlay: null,
      undoStack: [],
      mode: 'canvas',
      fileNodes: { ...s.fileNodes, [id]: node },
      expanded: { ...s.expanded, [dir.path]: true },
      folder: s.folder ? cloneTree(s.folder) : s.folder,
    }));
    get().computeIr();
    noticeOf(set, `已在 ${dir.name || '根目录'} 新建 ${node.name}`);
  },

  /** 新建流程图文档（可视化绘制，带节点图例库） */
  async newFlowDoc(withSample = false) {
    const source = withSample ? SAMPLE_FLOW : serializeFlow(emptyFlowModel());
    const doc: DocRow = {
      id: newDocId(),
      title: withSample ? '示例流程图' : '未命名流程图',
      lang: 'flow',
      source,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await storage.put(doc);
    set((s) => ({
      docs: [doc, ...s.docs],
      activeId: doc.id,
      source: doc.source,
      lang: 'flow',
      title: doc.title,
      dirty: false,
      selectedNode: null,
      overlay: null,
      undoStack: [],
      mode: 'canvas',
      fileNodes: s.fileNodes,
    }));
    get().computeIr();
  },

  /**
   * 流程图模型级事务：改的是模型，落盘的是整份 JSON。
   * 生成一条「整档替换」的文本编辑，于是撤销栈与 dirty 逻辑完全复用。
   */
  commitFlow(label, mutate) {
    const { source, lang } = get();
    if (lang !== 'flow') return;
    const { model } = parseFlow(source);
    const next: FlowModel = {
      ...model,
      nodes: model.nodes.map((n) => ({ ...n })),
      edges: model.edges.map((e) => ({ ...e })),
    };
    mutate(next);
    const text = serializeFlow(next);
    if (text === source) return;
    get().commitEdits([{ span: spanAt(source, 0, source.length), newText: text }], label, 'canvas');
  },

  /** 新增流程图形状节点；at 为空时按方向顺势排版 */
  flowAddNode(def, at, connectFrom) {
    const cur = get().flow ?? emptyFlowModel();
    const id = nextFlowId(cur);
    let pos = at;
    if (!pos) {
      const maxX = cur.nodes.length ? Math.max(...cur.nodes.map((n) => n.x + n.w)) : 0;
      const maxY = cur.nodes.length ? Math.max(...cur.nodes.map((n) => n.y + n.h)) : 0;
      pos = cur.direction === 'LR'
        ? { x: cur.nodes.length ? maxX + 60 + def.w / 2 : 160, y: 110 }
        : { x: 200, y: cur.nodes.length ? maxY + 44 + def.h / 2 : 110 };
    }
    get().commitFlow(`新增${def.name}`, (m) => {
      m.nodes.push({
        id,
        label: def.label,
        shape: def.shape,
        x: Math.round(pos.x - def.w / 2),
        y: Math.round(pos.y - def.h / 2),
        w: def.w,
        h: def.h,
      });
      if (connectFrom) m.edges.push({ id: nextFlowEdgeId(m), from: connectFrom, to: id });
    });
    return id;
  },

  async flowExportMermaid() {
    const m = get().flow;
    if (!m || !m.nodes.length) {
      noticeOf(set, '流程图还是空的，没有可导出的内容');
      return;
    }
    const source = flowToMermaid(m);
    const doc: DocRow = {
      id: newDocId(),
      title: `${get().title || '流程图'}(Mermaid)`,
      lang: 'mermaid',
      source,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await storage.put(doc);
    set((s) => ({
      docs: [doc, ...s.docs],
      activeId: doc.id,
      source,
      lang: 'mermaid',
      title: doc.title,
      dirty: false,
      selectedNode: null,
      overlay: null,
      undoStack: [],
      mode: 'preview',
      fileNodes: s.fileNodes,
    }));
    get().computeIr();
    noticeOf(set, '已生成一份 Mermaid 文档，可在代码里继续改');
  },

  async openDoc(id) {
    const doc = get().docs.find((d) => d.id === id);
    if (!doc) return;
    set({
      activeId: id,
      source: doc.source,
      lang: doc.lang,
      title: doc.title,
      dirty: false,
      selectedNode: null,
      overlay: loadOverlay(id, doc.source),
      undoStack: [],
    });
    get().computeIr();
  },

  /** 静默落库：自动保存走这里，绝不弹窗 */
  async persist() {
    const { activeId, title, source, lang, docs } = get();
    if (!activeId) return;
    const prev = docs.find((d) => d.id === activeId);
    const doc: DocRow = {
      id: activeId,
      title,
      lang,
      source,
      createdAt: prev?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    };
    await storage.put(doc);
    set({ docs: docs.map((d) => (d.id === activeId ? doc : d)), dirty: false });
  },

  /**
   * 手动保存：
   * - 文档绑定了文件（从文件夹打开 / 在文件夹下新建 / 之前另存过）→ 直接写回那个位置
   * - 没有绑定文件 → 弹「另存为」让用户挑位置（等同下载），定下来之后就一直写到那里
   */
  async save() {
    const { activeId, title, source, lang } = get();
    if (!activeId) return;
    await get().persist();

    let node = get().fileNodes[activeId];
    if (!node) {
      const name = suggestFileName(title, lang);
      const { outcome, node: picked } = await pickSaveFile(name, source);
      if (outcome === 'cancel') {
        noticeOf(set, '已保存到本地库（未选择保存位置）');
        return;
      }
      if (outcome === 'download') {
        noticeOf(set, `已下载 ${name}（该浏览器不支持直接写盘）`);
        return;
      }
      if (!picked) {
        noticeOf(set, '保存失败：无法写入所选位置');
        return;
      }
      node = picked;
      set((s) => ({ fileNodes: { ...s.fileNodes, [activeId]: picked as FsNode } }));
      // 标题仍是默认模板时才同步成文件名，避免覆盖用户手改的标题
      if (!title || /^(未命名|空白图|示例)/.test(title)) {
        set({ title: stripExt(picked.name) });
      }
      await get().persist();
      noticeOf(set, `已保存到 ${picked.name}`);
      return;
    }

    const ok = await writeText(node, source);
    noticeOf(
      set,
      ok ? `已写入 ${node.name}` : `已保存到本地库（${node.name} 无法写回，请用 Chromium 系浏览器打开文件夹）`
    );
  },

  async saveAs() {
    const { activeId } = get();
    if (!activeId) return;
    set((s) => {
      const f = { ...s.fileNodes };
      delete f[activeId];
      return { fileNodes: f };
    });
    await get().save();
  },

  async removeDoc(id) {
    await storage.remove(id);
    const docs = get().docs.filter((d) => d.id !== id);
    set({ docs });
    if (get().activeId === id && docs.length) await get().openDoc(docs[0].id);
    if (!docs.length) await get().newDoc('mermaid');
  },

  async importDocs(rows) {
    for (const r of rows) await storage.put({ ...r, id: newDocId(), updatedAt: Date.now() });
    set({ docs: await storage.list(), notice: `已导入 ${rows.length} 个文档` });
    setTimeout(() => set({ notice: null }), 2200);
  },
}));
