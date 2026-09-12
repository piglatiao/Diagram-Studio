/**
 * L3 · 流程图节点图例库
 *
 * 对齐 WPS 流程图 / 亿图图示的常用形状集，按用途分组；
 * 每个形状给出默认尺寸、默认文字与一句用途说明（面板里做 tooltip）。
 */
import type { FlowShape } from '../ir/types';

export interface ShapeDef {
  shape: FlowShape;
  /** 面板里显示的名字 */
  name: string;
  /** 新建时的默认文字 */
  label: string;
  w: number;
  h: number;
  hint: string;
}

export interface ShapeGroup {
  name: string;
  items: ShapeDef[];
}

export const SHAPE_GROUPS: ShapeGroup[] = [
  {
    name: '基础',
    items: [
      { shape: 'stadium', name: '开始/结束', label: '开始', w: 130, h: 52, hint: '流程的起点或终点（终止符）' },
      { shape: 'rect', name: '处理', label: '处理', w: 140, h: 56, hint: '一个处理步骤（过程）' },
      { shape: 'diamond', name: '判断', label: '判断', w: 140, h: 80, hint: '分支条件，需要标注 是/否' },
      { shape: 'subprocess', name: '子流程', label: '子流程', w: 150, h: 58, hint: '预定义流程 / 调用另一个流程' },
      { shape: 'round', name: '可选过程', label: '步骤', w: 140, h: 56, hint: '圆角矩形，同级步骤的备选画法' },
      { shape: 'step', name: '步骤', label: '步骤', w: 140, h: 56, hint: '切角卡片，强调单步操作' },
      { shape: 'package', name: '包/模块', label: '模块', w: 140, h: 72, hint: '模块 / 分包（UML package）' },
    ],
  },
  {
    name: '输入输出',
    items: [
      { shape: 'parallelogram', name: '数据', label: '输入数据', w: 150, h: 60, hint: '输入 / 输出数据' },
      { shape: 'manualInput', name: '手动输入', label: '手动输入', w: 150, h: 66, hint: '人工录入的数据' },
      { shape: 'display', name: '显示', label: '显示', w: 150, h: 60, hint: '显示信息给用户' },
      { shape: 'document', name: '文档', label: '文档', w: 140, h: 74, hint: '文档输出（底边波浪）' },
      { shape: 'multiDocument', name: '多文档', label: '多份文档', w: 150, h: 84, hint: '多份文档输出' },
      { shape: 'page', name: '页面', label: '页面', w: 134, h: 80, hint: '页面 / 报表（右下折角）' },
    ],
  },
  {
    name: '存储',
    items: [
      { shape: 'cylinder', name: '数据库', label: '数据库', w: 130, h: 66, hint: '数据库 / 持久化存储' },
      { shape: 'storedData', name: '已存数据', label: '已存数据', w: 150, h: 60, hint: '文件 / 日志等非数据库存储（ISO 5807）' },
      { shape: 'internalStorage', name: '内部存储', label: '内部存储', w: 140, h: 68, hint: '内存 / 内部存储' },
      { shape: 'queue', name: '队列', label: '队列', w: 150, h: 58, hint: '消息队列 / 缓冲区' },
      { shape: 'offPage', name: '离页连接符', label: '见下页', w: 130, h: 58, hint: '流程接到另一页继续' },
    ],
  },
  {
    name: '其他',
    items: [
      { shape: 'hexagon', name: '准备', label: '准备', w: 150, h: 68, hint: '准备 / 初始化条件' },
      { shape: 'delay', name: '延时', label: '等待', w: 140, h: 58, hint: '等待一段时间' },
      { shape: 'trapezoid', name: '手动操作', label: '手动操作', w: 150, h: 60, hint: '需要人工介入的操作' },
      { shape: 'circle', name: '连接点', label: 'A', w: 64, h: 64, hint: '页内跳转的连接点' },
      { shape: 'bullseye', name: '汇总连接', label: '', w: 40, h: 40, hint: '多路汇合的连接符' },
      { shape: 'note', name: '注释', label: '说明', w: 140, h: 64, hint: '补充说明（折角便签）' },
      { shape: 'callout', name: '注释气泡', label: '说明', w: 150, h: 70, hint: '带指向尾巴的说明气泡' },
      { shape: 'person', name: '用户/角色', label: '用户', w: 120, h: 94, hint: '参与流程的人或角色' },
    ],
  },
];

export const ALL_SHAPES: ShapeDef[] = SHAPE_GROUPS.flatMap((g) => g.items);

export function shapeDef(shape: FlowShape): ShapeDef | undefined {
  return ALL_SHAPES.find((s) => s.shape === shape);
}

/** 面板里给形状缩略图用的 viewBox 尺寸 */
export const THUMB = { w: 56, h: 36 };
