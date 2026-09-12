/**
 * 冒烟测试：验证 PlantUML 本地渲染链路（解析 → IR → 本地布局 → 自绘 SVG）
 * 在 Node 下运行，不依赖浏览器 DOM。
 */
import { parsePlantUml } from '../src/lang/puml/parse';
import { layoutLayered, layoutMindmap, layoutUsecase } from '../src/layout';
import { renderGraphSvg, fitGroupToChildren } from '../src/render/svg/graph';
import { renderSequenceSvg } from '../src/render/svg/sequence';
import { LIGHT, DARK } from '../src/render/svg/shapes';

const SAMPLES: Array<{ name: string; src: string }> = [
  {
    name: '时序图',
    src: `@startuml
title 下单流程
actor 用户 as U
participant "订单服务" as Order
database "MySQL" as DB
U -> Order: 提交订单
activate Order
Order -> DB: 写入
DB --> Order: OK
alt 库存充足
  Order -> Order: 扣减库存
else 库存不足
  Order --> U: 失败
end
note right of Order: 幂等键校验
Order --> U: 成功
deactivate Order
@enduml`,
  },
  {
    name: '类图',
    src: `@startuml
class Order {
  -id : Long
  +amount : BigDecimal
  +pay() : boolean
}
interface Payable {
  +pay() : boolean
}
class User
Order ..|> Payable
User "1" -- "*" Order : 拥有
User --|> Object
@enduml`,
  },
  {
    name: '用例图',
    src: `@startuml
left to right direction
actor 顾客
actor 管理员
rectangle 商城 {
  usecase "下单" as UC1
  usecase "退款" as UC2
  (查看订单)
}
顾客 --> UC1
顾客 --> (查看订单)
管理员 --> UC2
UC1 ..> UC2 : <<extend>>
@enduml`,
  },
  {
    name: '状态图',
    src: `@startuml
[*] --> 待支付
待支付 --> 已支付 : 支付成功
待支付 --> 已取消 : 超时
state 已支付 {
  [*] --> 备货中
  备货中 --> 已发货 : 出库
}
已支付 --> [*]
@enduml`,
  },
  {
    name: '组件图',
    src: `@startuml
package "接入层" {
  component "API Gateway" as GW
}
cloud "K8s" {
  node "订单服务" as Order
  database "MySQL" as DB
}
GW --> Order : gRPC
Order --> DB
@enduml`,
  },
  {
    name: '活动图',
    src: `@startuml
start
:接收请求;
if (参数合法?) then (是)
  :查询库存;
  fork
    :扣减库存;
  fork again
    :写审计日志;
  end fork
else (否)
  :返回 400;
endif
:返回结果;
stop
@enduml`,
  },
  {
    name: '思维导图',
    src: `@startmindmap
* 纯本地绘图
** 渲染
*** Mermaid.js
*** PlantUML 本地引擎
** 编辑
*** 源码编辑
*** 结构联动
** 导出
*** SVG
*** PNG
@endmindmap`,
  },
];

import { writeFileSync } from 'node:fs';
import { parseMermaid } from '../src/lang/mmd/parse';
import { toSourceEdits } from '../src/lang/edit';
import { applyEdits } from '../src/ir/patch';
import { isBlankSource } from '../src/lang/blank';
import { dedupeName, extOf, stripExt, suggestFileName, withExt, extFor } from '../src/platform/naming';
import {
  emptyFlowModel, serializeFlow, parseFlow, flowToMermaid, autoPlace, flowBounds,
  nextFlowId, nextFlowEdgeId, type FlowModel,
} from '../src/flow/model';
import { flowToIr } from '../src/flow/toIr';
import { SHAPE_GROUPS, ALL_SHAPES, THUMB, shapeDef } from '../src/flow/shapes';

const report: string[] = [];
const say = (s: string) => { report.push(s); };

/** 补丁 → 源码编辑 → 应用 → 撤销 的往返验证 */
function patchTests(): number {
  let fail = 0;
  const check = (name: string, cond: boolean, detail = '') => {
    if (!cond) fail++;
    say(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);
  };

  const puml = [
    '@startuml',
    'participant "订单服务" as Order',
    'database "MySQL" as DB',
    'Order -> DB: 查询',
    '@enduml',
  ].join('\n');

  // 1. 改标签（引号形式）
  {
    const { ir } = parsePlantUml(puml);
    const edits = toSourceEdits(ir, puml, { op: 'update-node', id: 'Order', label: '订单中心' }, 'plantuml');
    const out = applyEdits(puml, edits);
    check('puml · 改节点标签', out.text.includes('"订单中心" as Order') && !out.text.includes('订单服务'), JSON.stringify(out.text));
    // 撤销还原
    const back = applyEdits(out.text, out.inverse).text;
    check('puml · 撤销还原', back === puml);
  }

  // 2. 新增连线
  {
    const { ir } = parsePlantUml(puml);
    const edits = toSourceEdits(ir, puml, { op: 'add-edge', from: 'Order', to: 'DB', label: '写库' }, 'plantuml');
    const out = applyEdits(puml, edits);
    check('puml · 新增连线', out.text.includes('Order --> DB : 写库') && out.text.includes('@enduml'));
  }

  // 3. 删除节点（连带删除引用它的关系）
  {
    const { ir } = parsePlantUml(puml);
    const edits = toSourceEdits(ir, puml, { op: 'remove-node', id: 'DB' }, 'plantuml');
    const out = applyEdits(puml, edits);
    check(
      'puml · 删除节点连带删边',
      !out.text.includes('database') && !out.text.includes('查询') && out.text.includes('订单服务'),
      JSON.stringify(out.text)
    );
  }

  // 4. 类图重命名（标识符，需同步更新关系）
  {
    const src = ['@startuml', 'class Order', 'class User', 'User --> Order', '@enduml'].join('\n');
    const { ir } = parsePlantUml(src);
    const edits = toSourceEdits(ir, src, { op: 'update-node', id: 'Order', label: 'TradeOrder' }, 'plantuml');
    const out = applyEdits(src, edits);
    check(
      'puml · 重命名同步关系',
      out.text.includes('class TradeOrder') &&
        out.text.includes('User --> TradeOrder') &&
        !out.text.replace(/TradeOrder/g, '').includes('Order'),
      JSON.stringify(out.text)
    );
  }

  // 5. Mermaid 改标签
  {
    const src = ['flowchart TD', 'A[开始] --> B{判断}', 'B --> C[结束]'].join('\n');
    const { ir } = parseMermaid(src);
    const edits = toSourceEdits(ir, src, { op: 'update-node', id: 'A', label: '起点' }, 'mermaid');
    const out = applyEdits(src, edits);
    check('mermaid · 改节点标签', out.text.includes('A[起点]') && !out.text.includes('开始'), JSON.stringify(out.text));
    const back = applyEdits(out.text, out.inverse).text;
    check('mermaid · 撤销还原', back === src);
  }

  // 6. Mermaid 新增节点
  {
    const src = ['flowchart TD', 'A[开始] --> B[结束]'].join('\n');
    const { ir } = parseMermaid(src);
    const edits = toSourceEdits(ir, src, { op: 'add-node', id: 'N1', label: '新节点' }, 'mermaid');
    const out = applyEdits(src, edits);
    check('mermaid · 新增节点', out.text.includes('N1[新节点]'), JSON.stringify(out.text));
  }

  // 7. 纯几何移动不产生源码改动
  {
    const { ir } = parsePlantUml(puml);
    const edits = toSourceEdits(ir, puml, { op: 'move-node', id: 'Order', x: 10, y: 20 }, 'plantuml');
    check('puml · 移动不污染源码', edits.length === 0);
  }

  // 8. 空白 Mermaid：创建第一个节点
  {
    const src = 'flowchart TD\n';
    const { ir } = parseMermaid(src);
    const edits = toSourceEdits(ir, src, { op: 'add-node', id: 'N1', label: '新节点' }, 'mermaid');
    const out = applyEdits(src, edits);
    check('mermaid · 空白图建首个节点', out.text === 'flowchart TD\nN1[新节点]\n', JSON.stringify(out.text));
  }

  // 9. Mermaid：从已有节点拖出 → 一行同时完成「声明 + 连线」
  {
    const src = 'flowchart TD\nN1[新节点]\n';
    const { ir } = parseMermaid(src);
    const edits = toSourceEdits(ir, src, { op: 'add-node', id: 'N2', label: '第二步', connectFrom: 'N1' }, 'mermaid');
    const out = applyEdits(src, edits);
    check(
      'mermaid · 拖拽生成「声明 + 连线」',
      out.text.includes('N1 --> N2[第二步]') && !out.text.includes('N1[新节点]N1'),
      JSON.stringify(out.text)
    );
  }

  // 10. 连续绘制：空白 → 4 节点 3 边的链式流程图
  {
    let src = 'flowchart TD\n';
    let prev = '';
    const labels = ['开始', '处理', '校验', '结束'];
    for (let i = 0; i < labels.length; i++) {
      const id = `N${i + 1}`;
      const label = labels[i] ?? '节点';
      const { ir: cur } = parseMermaid(src);
      const patch = prev
        ? ({ op: 'add-node', id, label, connectFrom: prev } as const)
        : ({ op: 'add-node', id, label } as const);
      src = applyEdits(src, toSourceEdits(cur, src, patch, 'mermaid')).text;
      prev = id;
    }
    const { ir } = parseMermaid(src);
    check('mermaid · 连续绘制成链', ir.nodes.length === 4 && ir.edges.length === 3, JSON.stringify(src));
  }

  // 11. 空白 PlantUML：从零绘制
  {
    const blank = '@startuml\n@enduml\n';
    const { ir: ir0 } = parsePlantUml(blank);
    const e1 = toSourceEdits(ir0, blank, { op: 'add-node', id: 'N1', label: '第一步' }, 'plantuml');
    const out1 = applyEdits(blank, e1).text;
    check('puml · 空白图建首个节点', out1.includes('"第一步"') && out1.indexOf('@enduml') > out1.indexOf('第一步'), JSON.stringify(out1));

    const { ir: ir1 } = parsePlantUml(out1);
    const e2 = toSourceEdits(ir1, out1, { op: 'add-node', id: 'N2', label: '第二步', connectFrom: 'N1' }, 'plantuml');
    const out2 = applyEdits(out1, e2).text;
    check(
      'puml · 拖拽生成「声明 + 连线」',
      out2.includes('"第二步"') && out2.includes('N1 --> N2') && out2.indexOf('@enduml') > out2.indexOf('N1 --> N2'),
      JSON.stringify(out2)
    );
  }

  // 12. 空源码：判定为「空」而不是错误
  {
    check('blank · 空串', isBlankSource(''));
    check('blank · 只有空白', isBlankSource('  \n\n \t '));
    check('blank · 只有注释', isBlankSource('%% 说明\n// 另一行\n'));
    check('blank · 骨架不算空', !isBlankSource('flowchart TD\n'));
    check('blank · 有内容不算空', !isBlankSource('@startuml\nA -> B\n@enduml'));
  }

  // 13. 源码被清空后仍能从画布继续画（自动补图表头）
  {
    const { ir } = parseMermaid('');
    const e1 = toSourceEdits(ir, '', { op: 'add-node', id: 'N1', label: '开始' }, 'mermaid');
    const out1 = applyEdits('', e1).text;
    check('mermaid · 空源码补表头', out1.startsWith('flowchart TD') && out1.includes('N1[开始]'), JSON.stringify(out1));

    const { ir: ir2 } = parseMermaid(out1);
    const out2 = applyEdits(out1, toSourceEdits(ir2, out1, { op: 'add-node', id: 'N2', label: '下一步', connectFrom: 'N1' }, 'mermaid')).text;
    check('mermaid · 补完表头后不再重复补', (out2.match(/flowchart TD/g) ?? []).length === 1 && out2.includes('N1 --> N2[下一步]'), JSON.stringify(out2));

    const { ir: irp } = parsePlantUml('');
    const outp = applyEdits('', toSourceEdits(irp, '', { op: 'add-node', id: 'N1', label: '第一步' }, 'plantuml')).text;
    check('puml · 空源码补外壳', outp.startsWith('@startuml') && outp.trimEnd().endsWith('@enduml') && outp.includes('"第一步"'), JSON.stringify(outp));

    const { ir: irp2 } = parsePlantUml(outp);
    const outp2 = applyEdits(outp, toSourceEdits(irp2, outp, { op: 'add-node', id: 'N2', label: '第二步', connectFrom: 'N1' }, 'plantuml')).text;
    check('puml · 补完外壳后不再重复补', (outp2.match(/@startuml/g) ?? []).length === 1 && outp2.includes('N1 --> N2'), JSON.stringify(outp2));
  }

  // 14. 保存文件名推导
  {
    check('naming · 按语言补扩展名', suggestFileName('我的流程', 'mermaid') === '我的流程.mmd'
      && suggestFileName('我的流程', 'plantuml') === '我的流程.puml');
    check('naming · 已有扩展名不重复补', withExt('a.puml', 'mermaid') === 'a.puml' && withExt('a.mmd', 'plantuml') === 'a.mmd');
    check('naming · 过滤非法字符', suggestFileName('a/b:c*d?e"f<g>h|i', 'mermaid') === 'a_b_c_d_e_f_g_h_i.mmd');
    check('naming · 空标题兜底', suggestFileName('   ', 'mermaid') === '未命名图表.mmd');
    check('naming · 去扩展名', stripExt('订单流程.mmd') === '订单流程' && extOf('订单流程.mmd') === '.mmd');
    check('naming · 目录内重名加序号', dedupeName('a.mmd', new Set(['a.mmd', 'a-2.mmd'])) === 'a-3.mmd'
      && dedupeName('b.mmd', new Set(['a.mmd'])) === 'b.mmd');
  }

  // 15. 复合形状语法（([开始]) / [(DB)] / [[子流程]] …）不能被截断
  {
    const cases: Array<[string, string, string, string]> = [
      ['A1([开始])', 'A1', 'stadium', '开始'],
      ['A2((起点))', 'A2', 'circle', '起点'],
      ['A3[处理]', 'A3', 'rect', '处理'],
      ['A4(可选)', 'A4', 'round', '可选'],
      ['A5{判断}', 'A5', 'diamond', '判断'],
      ['A6{{准备}}', 'A6', 'hexagon', '准备'],
      ['A7[(数据库)]', 'A7', 'cylinder', '数据库'],
      ['A8[[子流程]]', 'A8', 'subprocess', '子流程'],
      ['A9[/数据/]', 'A9', 'parallelogram', '数据'],
      ['A10[/手动\\]', 'A10', 'trapezoid', '手动'],
      ['A11>注释]', 'A11', 'note', '注释'],
    ];
    const src = 'flowchart TD\n' + cases.map(([t]) => `X --> ${t}`).join('\n');
    const { ir } = parseMermaid(src);
    const byId = new Map(ir.nodes.map((n) => [n.id, n]));
    const wrong = cases.filter(([, id, shape, label]) => {
      const n = byId.get(id);
      return !n || n.shape !== shape || n.label !== label;
    });
    check(
      'mermaid · 复合形状全部识别',
      wrong.length === 0,
      wrong.length
        ? `失败：${wrong.map(([, id]) => `${id}=${byId.get(id)?.shape}/${byId.get(id)?.label}`).join(' ')}`
        : `${cases.length} 种`,
    );
    check('mermaid · 复合形状不吃连线', ir.edges.length === cases.length, `edges=${ir.edges.length}/${cases.length}`);
    check('mermaid · 复合形状无幽灵节点', ir.nodes.length === cases.length + 1, `nodes=${ir.nodes.length}/${cases.length + 1}`);
    check(
      'mermaid · 复合形状标签干净（无残留括号）',
      [...byId.values()].every((n) => !/[\[\](){}]/.test(n.label)),
      [...byId.values()].map((n) => `${n.id}=${n.label}`).join(','),
    );
  }

  return fail;
}

/** 流程图文档（lang = 'flow'）模型层验证 */
function flowTests(): number {
  let fail = 0;
  const check = (name: string, cond: boolean, detail = '') => {
    if (!cond) fail++;
    say(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);
  };

  const model: FlowModel = {
    schema: 'diagram-studio/flow@1',
    direction: 'TB',
    nodes: [
      { id: 'N1', label: '开始', shape: 'stadium', x: 135, y: 40, w: 130, h: 52 },
      { id: 'N2', label: '提交申请', shape: 'rect', x: 130, y: 130, w: 140, h: 56 },
      { id: 'N3', label: '是否通过', shape: 'diamond', x: 130, y: 226, w: 140, h: 80 },
      { id: 'N4', label: '入库', shape: 'cylinder', x: 120, y: 340, w: 130, h: 66 },
    ],
    edges: [
      { id: 'e1', from: 'N1', to: 'N2' },
      { id: 'e2', from: 'N2', to: 'N3' },
      { id: 'e3', from: 'N3', to: 'N4', label: '是' },
      { id: 'e4', from: 'N3', to: 'N1', label: '否', dashed: true },
    ],
  };

  // 1. 序列化 → 解析 往返无损
  {
    const text = serializeFlow(model);
    const { model: back, error } = parseFlow(text);
    check('flow · JSON 往返无错', !error);
    check(
      'flow · 往返节点/连线数一致',
      back.nodes.length === 4 && back.edges.length === 4,
      `nodes=${back.nodes.length} edges=${back.edges.length}`,
    );
    check(
      'flow · 往返保留坐标与形状',
      back.nodes[2].x === 130 && back.nodes[2].y === 226 && back.nodes[2].shape === 'diamond' && back.nodes[3].shape === 'cylinder',
      JSON.stringify(back.nodes[2]),
    );
    check('flow · 往返保留虚线标记', back.edges[3].dashed === true && back.edges[3].label === '否');
  }

  // 2. 空 / 非法输入 → 不抛异常
  {
    const a = parseFlow('');
    check('flow · 空数据 = 空模型（不是错误）', !a.error && a.model.nodes.length === 0);
    const b = parseFlow('   \n ');
    check('flow · 纯空白 = 空模型', !b.error && b.model.nodes.length === 0);
    const c = parseFlow('flowchart TD\nA-->B');
    check('flow · 非 JSON 报结构化错误', !!c.error && c.model.nodes.length === 0);
    const d = parseFlow('{"schema":"diagram-studio/flow@1"}');
    check('flow · 缺 nodes 视为空模型', !d.error && d.model.nodes.length === 0);
    const e = parseFlow('{"schema":"diagram-studio/flow@1","nodes":[{"id":"X","label":"框"}]}');
    check('flow · 字段缺失走默认值', !e.error && e.model.nodes[0].shape === 'rect' && e.model.nodes[0].w === 140);
  }

  // 3. 无坐标自动排版
  {
    const m = emptyFlowModel();
    m.nodes = [
      { id: 'A', label: 'a', shape: 'rect', x: NaN, y: NaN, w: 140, h: 56 },
      { id: 'B', label: 'b', shape: 'rect', x: NaN, y: NaN, w: 140, h: 56 },
    ];
    autoPlace(m);
    check('flow · 无坐标自动排版', m.nodes.every((n) => isFinite(n.x) && isFinite(n.y)) && m.nodes[1].y > m.nodes[0].y);
    const b = flowBounds(m);
    check('flow · 外接尺寸含留白', b.width >= 220 && b.height >= 136, JSON.stringify(b));
  }

  // 4. id 分配不撞号
  {
    const m = { ...emptyFlowModel(), nodes: [{ id: 'N1', label: '', shape: 'rect' as const, x: 0, y: 0, w: 1, h: 1 }] };
    check('flow · 新节点 id 不撞号', nextFlowId(m) !== 'N1', nextFlowId(m));
    const id = nextFlowEdgeId({ ...emptyFlowModel(), edges: [{ id: 'e1', from: 'a', to: 'b' }] });
    check('flow · 新连线 id 不撞号', id !== 'e1', id);
  }

  // 5. 一键转 Mermaid 源码
  {
    const mmd = flowToMermaid(model);
    check('flow · 转 Mermaid 有表头', mmd.startsWith('flowchart TD'));
    check('flow · 转 Mermaid 带形状语法', mmd.includes('([开始])') && mmd.includes('{是否通过}') && mmd.includes('[(入库)]'), mmd.split('\n').slice(0, 4).join(' | '));
    check('flow · 转 Mermaid 带标签与虚线', mmd.includes('|是|') && mmd.includes('-.->|否|'));
    const parsed = parseMermaid(mmd);
    check('flow · 转出的 Mermaid 能被解析回来', parsed.ir.nodes.length === 4 && parsed.ir.edges.length === 4, JSON.stringify({ n: parsed.ir.nodes.length, e: parsed.ir.edges.length }));
  }

  // 6. 模型 → IR → 自绘 SVG（不跑 ELK，直接用模型坐标）
  {
    const ir = flowToIr(model);
    const n3 = ir.nodes.find((n) => n.id === 'N3');
    check('flow · IR 带几何且图形类型正确', ir.kind === 'flowchart' && ir.nodes.length === 4 && !!n3?.geometry, JSON.stringify(n3?.geometry));
    check('flow · IR 用模型坐标不做自动布局', n3?.geometry?.x === 130 && n3?.geometry?.y === 226);
    check('flow · IR 连线带箭头', ir.edges.every((e) => e.head === 'arrow'));
    const svg = renderGraphSvg(ir, 400, 460, LIGHT);
    check('flow · 自绘 SVG 成功', svg.startsWith('<svg') && svg.length > 600, `${svg.length}B`);
    const dark = renderGraphSvg(ir, 400, 460, DARK);
    check('flow · 暗色主题可渲染', dark.startsWith('<svg') && dark.length > 600);
  }

  // 7. 图例库：每个形状都能被自绘引擎画出来
  {
    const shapeNames = SHAPE_GROUPS.flatMap((g) => g.items.map((i) => i.shape));
    const bad: string[] = [];
    for (const it of ALL_SHAPES) {
      const svg = renderGraphSvg(
        flowToIr({
          ...emptyFlowModel(),
          nodes: [{ id: 'N1', label: it.name, shape: it.shape, x: 20, y: 20, w: it.w, h: it.h }],
        }),
        it.w + 60,
        it.h + 60,
        LIGHT,
      );
      if (!svg.startsWith('<svg') || svg.length < 300) bad.push(it.shape);
    }
    check('flow · 图例库形状全部可渲染', bad.length === 0, bad.length ? `失败：${bad.join(',')}` : `共 ${ALL_SHAPES.length} 种`);
    check('flow · 图例库分组非空', SHAPE_GROUPS.length >= 4 && SHAPE_GROUPS.every((g) => g.items.length > 0));
    check('flow · 形状去重（无遗漏无重复）', new Set(shapeNames).size === shapeNames.length, `unique=${new Set(shapeNames).size} total=${shapeNames.length}`);
    check('flow · 形状可反查定义', shapeDef('diamond')?.name === '判断' && shapeDef('offPage')?.name === '离页连接符');

    // 补充形状（对齐 D2 shape catalog）必须已入图例库、可反查、可渲染
    const ADDED: string[] = ['queue', 'package', 'person', 'page', 'step', 'callout', 'storedData'];
    const missing = ADDED.filter((s) => !shapeNames.includes(s));
    check(
      'flow · 补充形状已入图例库',
      missing.length === 0,
      missing.length ? `缺失：${missing.join(',')}` : `新增 ${ADDED.length} 种，共 ${ALL_SHAPES.length} 种`,
    );
    check('flow · 补充形状可反查定义', ADDED.every((s) => !!shapeDef(s)), ADDED.map((s) => shapeDef(s)?.name).join('/'));
    check('flow · 缩略图 viewBox 放大到 56×36', THUMB.w === 56 && THUMB.h === 36, `${THUMB.w}×${THUMB.h}`);

    // 新形状转 Mermaid：有对应符号的保留，没有的退化成矩形（不能凭空多出节点）
    const mmdNew = flowToMermaid({
      ...emptyFlowModel(),
      nodes: [
        { id: 'N1', label: '日志', shape: 'storedData', x: 0, y: 0, w: 150, h: 60 },
        { id: 'N2', label: '消息队列', shape: 'queue', x: 0, y: 100, w: 150, h: 58 },
      ],
      edges: [{ id: 'E1', from: 'N1', to: 'N2' }],
    });
    check(
      'flow · 新形状转 Mermaid（有符号的保留，无符号的退化矩形）',
      mmdNew.includes('[(日志)]') && mmdNew.includes('[消息队列]'),
      mmdNew.split('\n').slice(0, 4).join(' | '),
    );
    const backNew = parseMermaid(mmdNew);
    check(
      'flow · 新形状转出的 Mermaid 可被解析回来',
      backNew.ir.nodes.length === 2 && backNew.ir.edges.length === 1,
      `nodes=${backNew.ir.nodes.length} edges=${backNew.ir.edges.length}`,
    );
  }

  // 8. 扩展名与语言归属
  {
    check('flow · 扩展名为 .dflow', extFor('flow') === '.dflow' && suggestFileName('审批流程', 'flow') === '审批流程.dflow');
    check('flow · 已有 .dflow 不重复补', withExt('a.dflow', 'flow') === 'a.dflow');
    check('flow · 去扩展名识别 .flow.json', stripExt('a.flow.json') === 'a' && stripExt('a.dflow') === 'a');
  }

  return fail;
}

async function run() {
  let fail = 0;
  for (const s of SAMPLES) {
    let svg = '';
    let info = '';
    let ok = false;
    try {
      const t0 = performance.now();
      const { ir, diagnostics } = parsePlantUml(s.src);
      const th = LIGHT;
      if (ir.kind === 'sequence') {
        svg = renderSequenceSvg(ir, th);
      } else {
        const b = ir.kind === 'mindmap'
          ? layoutMindmap(ir)
          : ir.kind === 'usecase'
            ? layoutUsecase(ir)
            : await layoutLayered(ir, ir.direction === 'LR' ? 'RIGHT' : 'DOWN');
        fitGroupToChildren(ir);
        svg = renderGraphSvg(ir, Math.max(320, b.width), Math.max(220, b.height), th);
      }
      const ms = (performance.now() - t0).toFixed(1);
      ok = svg.startsWith('<svg') && svg.length > 400;
      info = `kind=${ir.kind} nodes=${ir.nodes.length} edges=${ir.edges.length} groups=${ir.groups.length} `
        + `svg=${svg.length}B warn=${diagnostics.length} ${ms}ms`;
      if (!ok) { fail++; info = 'FAIL ' + info; }
      // 暗色主题也过一遍，确保不抛异常
      if (ir.kind === 'sequence') renderSequenceSvg(ir, DARK);
      else renderGraphSvg(ir, 800, 500, DARK);
    } catch (e) {
      fail++;
      info = `FAIL ${e instanceof Error ? e.message : String(e)}`;
    }
    say(`${ok ? 'PASS' : 'FAIL'} ${s.name.padEnd(6)} ${info}`);
  }
  say('--- 补丁回写 ---');
  fail += patchTests();
  say('--- 流程图文档（lang = flow） ---');
  fail += flowTests();
  say(fail === 0 ? 'ALL PASS' : `${fail} FAILED`);
  writeFileSync(new URL('./_smoke_report.txt', import.meta.url), report.join('\n'), 'utf-8');
  if (fail) process.exit(1);
}

run();
