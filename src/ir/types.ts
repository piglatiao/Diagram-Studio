/**
 * L3 领域层 · Diagram IR
 *
 * 设计要点：
 * 1. 纯数据 + 纯函数，零外部依赖，可在 Worker / Node / 测试中直接运行。
 * 2. 每个元素携带 SourceRef —— 这是「可视化编辑回写源码」的锚点。
 * 3. IR 是「尽力而为」的派生视图：解析失败不阻断渲染，只降级结构化能力。
 */

export type DiagramKind =
  | 'sequence'
  | 'class'
  | 'usecase'
  | 'state'
  | 'activity'
  | 'component'
  | 'mindmap'
  | 'flowchart'
  | 'gantt'
  | 'unknown';

export type ShapeKind =
  | 'rect'
  | 'round'
  | 'stadium'
  | 'circle'
  | 'diamond'
  | 'hexagon'
  | 'cylinder'
  | 'note'
  | 'actor'
  | 'cloud'
  | 'frame'
  | 'text'
  | 'dot'        // 状态图起始/终止
  | 'bullseye'   // 活动图终止 / 流程图「页内连接符」
  | 'bar'        // fork / join 粗横条
  // ↓ 流程图图例库（WPS / 亿图风格）
  | 'parallelogram'   // 数据（输入输出）
  | 'trapezoid'       // 手动操作
  | 'manualInput'     // 手动输入
  | 'display'         // 显示
  | 'delay'           // 延时
  | 'document'        // 文档
  | 'multiDocument'   // 多文档
  | 'internalStorage' // 内部存储
  | 'subprocess'      // 子流程（预定义流程）
  | 'offPage'         // 离页连接符
  // ↓ 补充形状（对齐 D2 shape catalog：queue / package / person / page / step / callout / stored_data）
  | 'queue'           // 队列
  | 'package'         // 包 / 模块
  | 'person'          // 用户 / 角色
  | 'page'            // 页面
  | 'step'            // 步骤（切角卡片）
  | 'callout'         // 注释气泡
  | 'storedData';     // 已存数据（ISO 5807）

/** 流程图文档（lang='flow'）的扩展形状名，与 ShapeKind 同名以便直接复用自绘引擎 */
export type FlowShape = ShapeKind;

export type Severity = 'error' | 'warning' | 'info';

export interface SourceSpan {
  start: number;
  end: number;
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

/** 指向源码的引用；text 保存命中原文，用于补丁应用前的锚点校验 */
export interface SourceRef {
  span: SourceSpan;
  text: string;
  /** 元素所在的整条语句，删除元素时按整句删除 */
  statement?: SourceSpan;
}

/** 源码级文本编辑 */
export interface TextEdit {
  span: SourceSpan;
  newText: string;
  expected?: string;
}

export interface Geometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 类图成员 */
export interface MemberIR {
  text: string;
  visibility?: '+' | '-' | '#' | '~';
  isMethod?: boolean;
  static?: boolean;
  abstract?: boolean;
}

export interface NodeIR {
  id: string;
  label: string;
  /** 语义子类型：participant | class | usecase | state | activity | component … */
  kind?: string;
  shape?: ShapeKind;
  groupId?: string;
  order?: number;
  /** 类图成员 */
  members?: MemberIR[];
  stereotype?: string;
  style?: {
    className?: string;
    fill?: string;
    stroke?: string;
    color?: string;
  };
  /** 布局产出，非源码属性 */
  geometry?: Geometry;
  ref?: SourceRef;
  data?: Record<string, unknown>;
}

/** 关系/边的端点样式（UML 箭头语义） */
export type ArrowHead =
  | 'none'
  | 'arrow'      // 实心/开放箭头 →
  | 'triangle'   // 空心三角（继承）
  | 'diamond'    // 实心菱形（组合）
  | 'diamondOpen'// 空心菱形（聚合）
  | 'cross'      // x
  | 'halfArrow'; // 半箭头（异步消息）

export interface EdgeIR {
  id: string;
  from: string;
  to: string;
  label?: string;
  kind?: 'link' | 'dashed' | 'thick' | 'self';
  head?: ArrowHead;
  tail?: ArrowHead;
  dashed?: boolean;
  direction?: 'forward' | 'backward' | 'both';
  /** 顺序信息：时序图消息序号、活动图分支序号 */
  order?: number;
  /** 时序图：激活开始(++)/结束(--) */
  activate?: 'start' | 'end';
  waypoints?: Array<{ x: number; y: number }>;
  ref?: SourceRef;
  data?: Record<string, unknown>;
}

export interface GroupIR {
  id: string;
  label?: string;
  kind: 'package' | 'fragment' | 'stateGroup' | 'partition' | 'boundary' | 'cluster';
  parentId?: string;
  children: string[];
  /** 时序图片段类型：alt | opt | loop | par | critical | group | break | ref */
  fragmentType?: string;
  condition?: string;
  /** 时序图：覆盖的消息序号区间 */
  orderRange?: [number, number];
  geometry?: Geometry;
  ref?: SourceRef;
}

export interface NoteIR {
  id: string;
  text: string;
  attachTo?: { type: 'node' | 'edge' | 'span'; id: string };
  position?: 'left' | 'right' | 'top' | 'bottom' | 'over';
  /** 时序图：note over A,B 的两个端点 */
  over?: string[];
  order?: number;
  ref?: SourceRef;
}

export interface DiagramIR {
  schemaVersion: number;
  kind: DiagramKind;
  origin: {
    lang: 'mermaid' | 'plantuml' | 'flow';
    sourceHash: string;
    /** PlantUML 的 @startXXX 类型，便于提示支持度 */
    dialect?: string;
  };
  title?: string;
  header?: string;
  footer?: string;
  direction?: 'TB' | 'LR';
  nodes: NodeIR[];
  edges: EdgeIR[];
  groups: GroupIR[];
  notes: NoteIR[];
  /** 无法映射的语句，原样保留，保证往返不丢信息 */
  unparsed: Array<{ text: string; line: number }>;
  /** 解析质量报告 */
  fidelity: { complete: boolean; lossy: string[] };
  meta?: Record<string, unknown>;
}

export interface Diagnostic {
  severity: Severity;
  message: string;
  code?: string;
  span?: SourceSpan;
  hint?: string;
}

export interface ParseResult {
  ir: DiagramIR;
  diagnostics: Diagnostic[];
  durationMs: number;
}

export function emptyIR(lang: 'mermaid' | 'plantuml' | 'flow', hash: string): DiagramIR {
  return {
    schemaVersion: 1,
    kind: 'unknown',
    origin: { lang, sourceHash: hash },
    nodes: [],
    edges: [],
    groups: [],
    notes: [],
    unparsed: [],
    fidelity: { complete: false, lossy: [] },
  };
}

/** 简易字符串哈希，用于缓存键与 overlay 失效判定 */
export function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
