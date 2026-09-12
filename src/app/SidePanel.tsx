import { useState } from 'react';
import { useStore } from './store';
import { editorBridge } from './bridge';
import { exportBundle, importBundle, pickFile, exportSource } from '../platform/io';
import { suggestFileName, type FsNode } from '../platform/fs';

type Tab = 'docs' | 'folder' | 'struct' | 'problems';

function FileTree({
  node, depth = 0, onCreate,
}: {
  node: FsNode;
  depth?: number;
  onCreate: (dir: FsNode) => void;
}) {
  const expanded = useStore((s) => s.expanded);
  const toggleDir = useStore((s) => s.toggleDir);
  const openFile = useStore((s) => s.openFile);
  const activeId = useStore((s) => s.activeId);
  const on = !!expanded[node.path];

  if (node.kind === 'file') {
    const id = `f:${node.path}`;
    return (
      <button
        className={`fitem${activeId === id ? ' on' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => openFile(node)}
        title={node.path}
      >
        {node.name}
      </button>
    );
  }
  return (
    <div>
      <div className="frow">
        <button className="fitem dir" style={{ paddingLeft: 4 + depth * 14 }} onClick={() => toggleDir(node)}>
          <span className={on ? 'caret open' : 'caret'}>▸</span>
          {node.name}
        </button>
        <button
          className="fnew"
          title={`在 ${node.name} 下新建图表文件`}
          onClick={(e) => { e.stopPropagation(); onCreate(node); }}
        >
          ＋
        </button>
      </div>
      {on && (node.children ?? []).map((c) => (
        <FileTree key={c.path} node={c} depth={depth + 1} onCreate={onCreate} />
      ))}
    </div>
  );
}

export function SidePanel() {
  const [tab, setTab] = useState<Tab>('docs');
  const docs = useStore((s) => s.docs);
  const activeId = useStore((s) => s.activeId);
  const openDoc = useStore((s) => s.openDoc);
  const removeDoc = useStore((s) => s.removeDoc);
  const newDoc = useStore((s) => s.newDoc);
  const newBlankDoc = useStore((s) => s.newBlankDoc);
  const newFlowDoc = useStore((s) => s.newFlowDoc);
  const flowExportMermaid = useStore((s) => s.flowExportMermaid);
  const lang = useStore((s) => s.lang);
  const newFileInFolder = useStore((s) => s.newFileInFolder);
  const ir = useStore((s) => s.ir);
  const diagnostics = useStore((s) => s.diagnostics);
  const error = useStore((s) => s.error);
  const selectNode = useStore((s) => s.selectNode);
  const selectedNode = useStore((s) => s.selectedNode);
  const importDocs = useStore((s) => s.importDocs);
  const setNotice = useStore((s) => s.setNotice);
  const folder = useStore((s) => s.folder);
  const openFolder = useStore((s) => s.openFolder);
  const closeFolder = useStore((s) => s.closeFolder);

  const jump = (id: string) => {
    selectNode(id);
    const node = ir?.nodes.find((n) => n.id === id);
    if (node?.ref) editorBridge.selectRange?.(node.ref.span.start, node.ref.span.end);
  };

  const onImport = async () => {
    const file = await pickFile('.json,.mmd,.puml,.plantuml,.txt,.md');
    if (!file) return;
    try {
      if (file.name.endsWith('.json')) {
        await importDocs(await importBundle(file));
      } else {
        const text = await file.text();
        const lang = /@start/i.test(text) ? ('plantuml' as const) : ('mermaid' as const);
        await newDoc(lang);
        useStore.setState({ source: text, dirty: true, title: file.name });
        setNotice(`已导入 ${file.name}`);
      }
    } catch (e) {
      setNotice(`导入失败：${e instanceof Error ? e.message : e}`);
    }
  };

  const onExportBundle = () => {
    exportBundle(docs, `diagram-studio-${new Date().toISOString().slice(0, 10)}.json`);
  };

  /** 语言标签：流程图是独立类型，与两种 DSL 并列 */
  const langLabel = (l: string) => (l === 'plantuml' ? 'PlantUML' : l === 'flow' ? '流程图' : 'Mermaid');

  /** 在指定目录下新建图表文件（写完直接落到那个文件夹，之后保存即写回） */
  const onCreateFile = async (dir: FsNode) => {
    const cur = useStore.getState().lang;
    const name = window.prompt('新建图表文件（.mmd / .puml / .dflow）', suggestFileName('未命名图表', cur));
    if (!name || !name.trim()) return;
    await newFileInFolder(dir, name.trim());
  };

  return (
    <aside className="side">
      <div className="tabs">
        {([['docs', '文档'], ['folder', '文件夹'], ['struct', '结构'], ['problems', '问题']] as Array<[Tab, string]>).map(([k, label]) => (
          <button key={k} className={tab === k ? 'tab on' : 'tab'} onClick={() => setTab(k)}>
            {label}
            {k === 'problems' && (diagnostics.length || (error ? 1 : 0)) ? <i className="dot" /> : null}
          </button>
        ))}
      </div>

      {tab === 'docs' && (
        <div className="pane">
          <div className="row">
            <button className="btn sm" onClick={() => void newFlowDoc(false)} title="可视化流程图：内置节点图例，拖拽即画">
              ▦ 新建流程图
            </button>
            <button className="btn sm ghost" onClick={() => void newFlowDoc(true)} title="带一份审批流程示例">+ 示例流程图</button>
          </div>
          <div className="row">
            <button className="btn sm" onClick={() => void newBlankDoc('mermaid')} title="Mermaid 源码，空画布从零画">✎ 空白 Mermaid</button>
            <button className="btn sm" onClick={() => void newBlankDoc('plantuml')} title="PlantUML 源码，空画布从零画">✎ 空白 PUML</button>
          </div>
          <div className="row">
            <button className="btn sm ghost" onClick={() => newDoc('mermaid')}>+ 示例 Mermaid</button>
            <button className="btn sm ghost" onClick={() => newDoc('plantuml')}>+ 示例 PlantUML</button>
          </div>
          <div className="row">
            <button className="btn sm ghost" onClick={onImport}>导入</button>
            <button className="btn sm ghost" onClick={onExportBundle}>导出全部</button>
          </div>
          {lang === 'flow' && (
            <div className="row">
              <button
                className="btn sm ghost"
                onClick={() => void flowExportMermaid()}
                title="把当前流程图转成一份 Mermaid 文档，方便在源码里继续改"
              >
                ⇄ 转为 Mermaid 文档
              </button>
            </div>
          )}
          <ul className="doclist">
            {docs.map((d) => (
              <li key={d.id} className={d.id === activeId ? 'on' : ''}>
                <button className="doc" onClick={() => openDoc(d.id)}>
                  <span className="dt">{d.title}</span>
                  <span className="dm">{langLabel(d.lang)} · {new Date(d.updatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                </button>
                <button className="del" title="删除" onClick={() => removeDoc(d.id)}>×</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === 'folder' && (
        <div className="pane">
          <div className="row">
            <button
              className="btn sm"
              onClick={async () => {
                await openFolder();
                if (!useStore.getState().folder) setNotice('未选择文件夹，或该浏览器不支持目录选择');
              }}
            >
              打开文件夹
            </button>
            {folder && <button className="btn sm ghost" onClick={() => void closeFolder()}>关闭</button>}
          </div>
          {!folder ? (
            <p className="empty">
              把本地的图表目录挂进来，双击文件即可编辑，保存会写回磁盘。<br />
              支持 .mmd / .puml / .plantuml / .dflow / .dot / .txt / .md。<br />
              Chromium 系浏览器可读写；其他浏览器为只读兜底。
            </p>
          ) : (
            <>
              <div className="meta-line">
                <span className="folder-name">{folder.name}</span>
                <button className="btn sm" onClick={() => void onCreateFile(folder)} title="在根目录新建图表文件">
                  ＋ 新建文件
                </button>
              </div>
              <FileTree node={folder} onCreate={onCreateFile} />
            </>
          )}
        </div>
      )}

      {tab === 'struct' && (
        <div className="pane">
          {!ir || !ir.nodes.length ? (
            <p className="empty">暂无结构化信息。当前图类型未提取到 IR 时，渲染仍可正常使用。</p>
          ) : (
            <>
              <div className="meta-line">
                <span>类型 <b>{ir.kind}</b></span>
                <span>节点 <b>{ir.nodes.length}</b></span>
                <span>关系 <b>{ir.edges.length}</b></span>
              </div>
              {!ir.fidelity.complete && <p className="warn">IR 解析为「尽力而为」模式，部分语句未映射（{ir.unparsed.length} 条）。</p>}
              <ul className="nodelist">
                {ir.nodes.map((n) => (
                  <li key={n.id}>
                    <button className={selectedNode === n.id ? 'on' : ''} onClick={() => jump(n.id)}>
                      <span className="chip">{n.kind === 'flow' ? n.shape ?? 'node' : n.kind ?? n.shape ?? 'node'}</span>
                      <span className="nl">{n.label || n.id}</span>
                      {n.ref && <span className="ln">L{n.ref.span.startLine + 1}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {tab === 'problems' && (
        <div className="pane">
          {error && <div className="prob err">渲染错误：{error}</div>}
          {!error && diagnostics.length === 0 && <p className="empty">没有问题。</p>}
          {diagnostics.map((d, i) => (
            <div key={i} className={`prob ${d.severity}`}>
              {d.span ? <span className="ln">L{d.span.startLine + 1}</span> : null}
              {d.message}
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}

export { exportSource };
