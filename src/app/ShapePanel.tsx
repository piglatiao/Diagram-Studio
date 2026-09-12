/**
 * L1 · 流程图节点图例库面板
 *
 * 缩略图直接用自绘引擎（renderNode）渲染，保证「面板里长什么样，画出来就是什么样」。
 * 支持点选（落在视口中心）与拖拽（落在鼠标位置）。
 */
import { useState } from 'react';
import type { NodeIR } from '../ir/types';
import { renderNode, LIGHT, DARK } from '../render/svg/shapes';
import { SHAPE_GROUPS, THUMB, shapeDef, type ShapeDef } from '../flow/shapes';
import { useStore } from './store';

export const SHAPE_DND_TYPE = 'application/ds-flow-shape';

/** 用真实渲染器画缩略图 */
export function shapeThumb(shape: string, dark: boolean): string {
  const pad = 3;
  const node = {
    id: 'thumb',
    label: '',
    shape,
    geometry: { x: pad, y: pad, w: THUMB.w - pad * 2, h: THUMB.h - pad * 2 },
  } as unknown as NodeIR;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${THUMB.w} ${THUMB.h}" width="${THUMB.w}" height="${THUMB.h}">${renderNode(node, dark ? DARK : LIGHT)}</svg>`;
}

/**
 * 画布节点所用的同尺寸 SVG。
 *
 * 与缩略图、导出图走同一个 renderNode —— 面板里长什么样、画布里就长什么样、
 * 导出到 PNG/SVG 还是同一个形状，避免「编辑器用 CSS 近似、导出用真渲染」两套皮。
 */
export function shapeSvgFor(shape: string, w: number, h: number, label: string, dark: boolean): string {
  const node = {
    id: 'live',
    label,
    shape,
    geometry: { x: 1, y: 1, w: Math.max(2, w - 2), h: Math.max(2, h - 2) },
  } as unknown as NodeIR;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${renderNode(node, dark ? DARK : LIGHT)}</svg>`;
}

export function ShapePanel({ onPick }: { onPick?: (def: ShapeDef) => void }) {
  const theme = useStore((s) => s.theme);
  const [filter, setFilter] = useState('');
  const dark = theme === 'dark';

  const groups = SHAPE_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((it) => !filter || it.name.includes(filter) || it.shape.includes(filter.toLowerCase())),
  })).filter((g) => g.items.length);

  return (
    <aside className="shapes">
      <div className="shapes-head">
        <b>节点图例</b>
        <input
          className="shapes-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="筛选形状"
        />
      </div>
      <div className="shapes-body">
        {groups.map((g) => (
          <div key={g.name} className="shape-group">
            <div className="shape-group-title">
              {g.name}
              <span className="n">{g.items.length}</span>
            </div>
            <div className="shape-grid">
              {g.items.map((it) => (
                <button
                  key={it.shape + it.name}
                  className="shape-item"
                  title={`${it.name} · ${it.hint}\n点击添加到画布中心，或直接拖到画布上`}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(SHAPE_DND_TYPE, JSON.stringify({ shape: it.shape, label: it.label }));
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => onPick?.(it)}
                >
                  <span className="shape-thumb" dangerouslySetInnerHTML={{ __html: shapeThumb(it.shape, dark) }} />
                  <span className="shape-name">{it.name}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
        {!groups.length && <p className="empty">没有匹配的形状。</p>}
      </div>
      <div className="shapes-foot">双击画布新建「处理」· 拖圆点连线 · Delete 删除 · 双击节点改文字</div>
    </aside>
  );
}

export { shapeDef };
