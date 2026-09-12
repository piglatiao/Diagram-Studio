import { useEffect } from 'react';
import { useStore } from './store';
import { CodeEditor } from './CodeEditor';
import { Preview } from './Preview';
import { Canvas } from './Canvas';
import { FlowCanvas } from './FlowCanvas';
import { SidePanel } from './SidePanel';
import { exportPng, exportSource, exportSvg, printSvg } from '../platform/io';
import type { Lang } from '../render';

const EXT: Record<Lang, string> = { mermaid: 'mmd', plantuml: 'puml', flow: 'dflow' };
const LANG_LABEL: Record<Lang, string> = { mermaid: 'Mermaid', plantuml: 'PlantUML', flow: '流程图' };

export default function App() {
  const init = useStore((s) => s.init);
  const source = useStore((s) => s.source);
  const lang = useStore((s) => s.lang);
  const theme = useStore((s) => s.theme);
  const title = useStore((s) => s.title);
  const dirty = useStore((s) => s.dirty);
  const svg = useStore((s) => s.svg);
  const flow = useStore((s) => s.flow);
  const renderMs = useStore((s) => s.renderMs);
  const fromCache = useStore((s) => s.fromCache);
  const notice = useStore((s) => s.notice);
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const setSource = useStore((s) => s.setSource);
  const setTitle = useStore((s) => s.setTitle);
  const setLang = useStore((s) => s.setLang);
  const setTheme = useStore((s) => s.setTheme);
  const save = useStore((s) => s.save);
  const saveAs = useStore((s) => s.saveAs);
  const persist = useStore((s) => s.persist);
  const diagnostics = useStore((s) => s.diagnostics);

  useEffect(() => {
    void init();
  }, [init]);

  // 自动保存（防抖 1.2s）—— 只静默落库，绝不弹「另存为」对话框
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => void persist(), 1200);
    return () => clearTimeout(t);
  }, [dirty, source, title, lang, persist]);

  // Ctrl/Cmd+S 保存
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  /** 流程图是可视化文档：没有代码区，整屏交给「图例 + 画布」 */
  const isFlow = lang === 'flow';
  const fname = () => `${(title || 'diagram').replace(/[\\/:*?"<>|]/g, '_')}.${EXT[lang]}`;

  return (
    <div className={theme === 'dark' ? 'app dark' : 'app'}>
      <header className="top">
        <div className="brand">
          <span className="logo" />
          <b>Diagram Studio</b>
          <span className="sub">纯本地 · 零外网</span>
        </div>
        <input className="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="图表标题" />
        <div className="tools">
          {isFlow ? (
            <span className="tag">流程图 · 内置节点图例</span>
          ) : (
            <div className="seg">
              <button className={mode === 'preview' ? 'on' : ''} onClick={() => setMode('preview')}>预览</button>
              <button className={mode === 'canvas' ? 'on' : ''} onClick={() => setMode('canvas')}>画布编辑</button>
            </div>
          )}
          <select className="sel" value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
            {(['mermaid', 'plantuml', 'flow'] as Lang[]).map((l) => (
              <option key={l} value={l}>{LANG_LABEL[l]}</option>
            ))}
          </select>
          <button className="btn" onClick={() => void save()} title="未绑定文件时弹出「另存为」选保存位置">保存{dirty ? ' •' : ''}</button>
          <button className="btn ghost" onClick={() => void saveAs()}>另存为</button>
          <div className="menu">
            <button className="btn">导出 ▾</button>
            <div className="dropdown">
              <button onClick={() => svg && exportSvg(svg, fname().replace(/\.\w+$/, '.svg'))}>SVG（矢量）</button>
              <button onClick={() => svg && void exportPng(svg, fname().replace(/\.\w+$/, '.png'), 2, theme === 'dark' ? '#111827' : '#ffffff')}>PNG（2 倍图）</button>
              <button onClick={() => svg && printSvg(svg, title)}>PDF（打印）</button>
              <button onClick={() => exportSource(source, fname())}>{isFlow ? '流程图数据（.dflow）' : `源码（.${EXT[lang]}）`}</button>
            </div>
          </div>
          <button className="btn ghost" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? '浅色' : '深色'}
          </button>
        </div>
      </header>

      <div className={`body${isFlow ? ' flow' : ''}`}>
        <SidePanel />
        {isFlow ? (
          <FlowCanvas />
        ) : (
          <>
            <section className="editor">
              <CodeEditor
                value={source}
                onChange={setSource}
                diagnostics={diagnostics}
                dark={theme === 'dark'}
              />
            </section>
            {mode === 'preview' ? <Preview /> : <Canvas />}
          </>
        )}
      </div>

      <footer className="status">
        <span>
          {isFlow
            ? '流程图（可视化模型 → 自绘 SVG）'
            : lang === 'plantuml'
              ? 'PlantUML 本地引擎（行式解析 → IR → 自绘 SVG）'
              : 'Mermaid.js（本地 bundle）'}
        </span>
        <span className="spacer" />
        {isFlow && flow && <span>{flow.nodes.length} 节点 · {flow.edges.length} 连线 · 方向 {flow.direction}</span>}
        {!isFlow && mode === 'canvas' && <span>画布编辑：改动以最小补丁回写源码</span>}
        {!isFlow && mode === 'preview' && <span>{renderMs} ms{fromCache ? ' · 命中缓存' : ''}</span>}
        <span>·</span>
        <span>{isFlow ? `${source.split('\n').length} 行数据` : `${source.split('\n').length} 行`}</span>
        {notice && <span className="notice">{notice}</span>}
      </footer>
    </div>
  );
}
