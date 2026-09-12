import { useEffect, useRef, useState } from 'react';
import { useStore } from './store';
import { isBlankSource, makeCacheKey, renderDiagram } from '../render';
import { editorBridge } from './bridge';

export function Preview() {
  const source = useStore((s) => s.source);
  const lang = useStore((s) => s.lang);
  const theme = useStore((s) => s.theme);
  const svg = useStore((s) => s.svg);
  const error = useStore((s) => s.error);
  const setRender = useStore((s) => s.setRender);
  const selectNode = useStore((s) => s.selectNode);
  const selectedNode = useStore((s) => s.selectedNode);
  const computeIr = useStore((s) => s.computeIr);

  const hostRef = useRef<HTMLDivElement>(null);
  const lastGood = useRef<string>('');
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      const cfg = {
        theme,
        fontFamily: "system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif",
        scale: 1,
      };
      const key = makeCacheKey(source, lang, cfg);
      try {
        const res = await renderDiagram({ cacheKey: key, lang, source, config: cfg });
        if (cancelled) return;
        lastGood.current = res.svg;
        setRender({
          svg: res.svg,
          diagnostics: res.diagnostics,
          renderMs: Math.round(res.durationMs),
          fromCache: res.from === 'cache',
          error: null,
        });
        computeIr();
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setRender({
          svg: lastGood.current,
          diagnostics: [],
          renderMs: 0,
          fromCache: false,
          error: msg,
        });
      }
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [source, lang, theme, setRender, computeIr]);

  // 选中高亮
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.querySelectorAll('[data-ds-node]').forEach((el) => {
      const on = el.getAttribute('data-ds-node') === selectedNode;
      el.classList.toggle('ds-selected', on);
    });
  }, [selectedNode, svg]);

  const onClick = (e: React.MouseEvent) => {
    const el = (e.target as Element).closest('[data-ds-node]');
    const id = el?.getAttribute('data-ds-node');
    if (!id) return;
    selectNode(id);
    const ir = useStore.getState().ir;
    const node = ir?.nodes.find((n) => n.id === id);
    if (node?.ref) editorBridge.selectRange?.(node.ref.span.start, node.ref.span.end);
  };

  return (
    <div className="preview">
      <div className="preview-bar">
        <span className="tag">{lang === 'plantuml' ? 'PlantUML · 本地引擎' : 'Mermaid.js · 本地引擎'}</span>
        <div className="spacer" />
        <button className="mini" onClick={() => setZoom((z) => Math.max(0.3, +(z - 0.1).toFixed(2)))}>−</button>
        <span className="zoom">{Math.round(zoom * 100)}%</span>
        <button className="mini" onClick={() => setZoom((z) => Math.min(3, +(z + 0.1).toFixed(2)))}>＋</button>
        <button className="mini" onClick={() => setZoom(1)}>重置</button>
      </div>
      <div className="preview-body">
        {error && <div className="err">渲染失败：{error}</div>}
        {!error && isBlankSource(source) && (
          <div className="blank">
            源码为空 —— 在左侧写代码，或切到「画布编辑」从零绘制
          </div>
        )}
        <div
          className="svg-host"
          ref={hostRef}
          onClick={onClick}
          style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    </div>
  );
}
