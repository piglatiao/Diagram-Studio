# Diagram Studio · 纯本地 Web 绘图工作台

按 `docs/` 下的技术方案实现的 **Web 绘图工具**，核心约束：**100% 本地渲染，运行时零外网请求**。

## 快速开始

```bash
npm install
npm run dev        # 开发调试 http://localhost:5173
npm run build      # 产出 dist/index.html —— 单个自包含文件（约 11 MB，见「构建说明」）
npm run smoke      # 本地渲染链路冒烟测试（Node 下跑解析→布局→SVG）
```

`npm run build` 用 `vite-plugin-singlefile` 把 JS/CSS 全部内联进 `dist/index.html`，双击即可离线使用，**不需要任何服务器或网络**。

## Windows 桌面版（.exe）

同一个 `dist/index.html` 可以套一层 Electron 外壳打成原生 Windows 安装包：

```bash
npm run electron:pack  # 免安装目录版,产出 release/win-unpacked/(快速验证)
npm run electron:build # NSIS 安装包,产出 release/Diagram-Studio-0.1.0-setup.exe
```

外壳在 `electron/`：`main.ts` 只做「一个窗口 + 中文菜单 + 受限 IPC」，`preload.ts` 用 `contextBridge` 只暴露
`getInfo()` / `onMenu()` 两个方法。渲染层仍是那份自包含的 `dist/index.html`，**不带任何 Node 能力**
（`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`），页面里的外链一律交给系统浏览器打开。

类型检查 `npm run electron:typecheck`；`electron/*.ts` 用 esbuild 编成 CJS（`.cjs` 后缀——项目是 `"type": "module"`，
不加后缀会被 Node 当 ESM 解析而炸掉 `require`），产物在 `dist-electron/`。

## 纯本地是怎么做到的

方案里唯一的外网依赖是 PlantUML 的 HTTP 渲染网关（Kroki / PlantUML Server）。
PlantUML 官方实现依赖 Java，浏览器侧没有成熟稳定的 WASM 构建，所以这里换成：

```
PlantUML 源码
   → 自研行式解析器（src/lang/puml/parse.ts）
   → DiagramIR（统一中间表示）
   → 本地布局（src/layout：时序网格 / 思维树 / ELK 分层 / 用例网格）
   → 自绘 SVG（src/render/svg）
```

Mermaid 仍然用官方 mermaid.js（本地 bundle，不发请求），保证与官方渲染结果一致。

| 能力 | 实现 | 是否联网 |
|---|---|---|
| Mermaid（flowchart / sequence / class / state / ER / mindmap / gantt…） | mermaid.js v11 本地 bundle | 否 |
| **流程图（独立文档类型）** | 可视化模型（JSON）→ 自绘 SVG，内置节点图例库 | 否 |
| PlantUML 时序图 | 自研解析 + 网格布局 + 自绘 | 否 |
| PlantUML 类图 / 状态图 / 组件图 / 活动图 | 自研解析 + ELK 分层布局 + 自绘 | 否 |
| PlantUML 用例图 | 自研解析 + 网格布局 + 自绘 | 否 |
| PlantUML 思维导图 | 自研解析 + 横向树布局 + 自绘 | 否 |
| 数据落盘 | IndexedDB（不可用时降级 localStorage） | 否 |
| 导入导出 | 浏览器本地 Blob / Canvas | 否 |

## 已实现的能力

- **三种并列的文档类型**：`Mermaid` / `PlantUML`（两种 DSL，源码即真相）与 **`流程图`**（可视化，模型即真相）。
  三者互不隶属，语言下拉里的「流程图」是**独立类型**而不是 Mermaid 的一个语法——在两种形态之间切换只给提示，不会把文档悄悄改掉
- **流程图（可视化绘制，M5）**：左侧**内置节点图例库**，视觉基线取 **ISO 5807 / draw.io 经典线稿**
  （白底、近黑描边、直角为主，圆角只留给语义上本就该圆的形状；暗色主题镜像反转）：
  - 分 4 组共 26 种形状：基础（开始结束 / 处理 / 判断 / 子流程 / 可选过程 / 步骤 / 包模块）、
    输入输出（数据 / 手动输入 / 显示 / 文档 / 多文档 / 页面）、
    存储（数据库 / 已存数据 / 内部存储 / 队列 / 离页连接符）、
    其他（准备 / 延时 / 手动操作 / 连接点 / 汇总连接 / 注释 / 注释气泡 / 用户角色）
  - **点选**图例即落在画布中心（连点自动错开），**拖拽**则落在鼠标位置，**拖到空白处**还能「落点即建节点 + 连线」一步到位
  - 双击空白建「处理」、双击节点改文字、拖边角改尺寸、拖圆点连线、双击连线改标签、Delete 删除、工具栏切 TB/LR 方向
  - 面板缩略图、画布节点、导出 SVG **三者共用同一个自绘引擎**（`renderNode`），所见即所得，不存在「编辑器一套皮、导出另一套」
  - 保存为 `.dflow`（JSON），和其他文档一样支持撤销栈、自动保存、文件夹写回
  - **一键「转为 Mermaid 文档」**：把画好的图导成 Mermaid 源码，交给代码侧继续改（反向不做自动转换，避免语义丢失）
- **编辑**：CodeMirror 6，DSL 语法高亮、诊断波浪线、自动补全括号、撤销栈、Ctrl/Cmd+S 保存
- **实时预览**：220ms 防抖，渲染结果按 `hash(source + 主题 + lang)` 缓存
- **空源码就是空**：源码为空（或只有注释）时按空渲染，给一句「源码为空」的占位提示，**不报渲染失败**；
  画布此时回到引导卡片，直接开画会自动补上图表头（`flowchart TD` / `@startuml … @enduml`）
- **源码 ↔ 图形双向定位**：点 SVG 节点跳到源码对应区间（靠 IR 携带的 `SourceRef`）；点结构面板同样跳转
- **结构面板**：从 IR 抽取的节点/关系统计，点击定位
- **画布绘制**（M3）：左侧「✎ 空白 Mermaid / ✎ 空白 PUML」建**代码文档的空白图** → 直接进入画布从零开画：
  - 空画布给出「添加第一个节点」引导卡片
  - **双击空白处**新建独立节点
  - **从节点圆点拖到空白处**：一行源码同时完成「声明 + 连线」（`N1 --> N2[新节点]`），新节点自动进入标签编辑
  - 工具栏「+ 节点」建独立节点、「+ 下级」从选中节点拉出下游节点
- **画布编辑**（M2）：React Flow 画布，双击改标签、拖拽连线、Delete 删除、拖拽摆位；
  所有结构改动以**最小补丁回写源码**（不重新生成整份文件，注释与格式全部保留），
  纯几何移动写入 sidecar overlay（不污染源码），事务可一步撤销
- **导入导出**：SVG / PNG（2 倍图，自动把 `foreignObject` 降级为 `<text>` 避免丢标签）/ PDF（打印）/ 源码 / 全量 JSON 备份
- **保存到哪儿，怎么决定**（三级）：
  1. 文档**已经绑定了文件**（从文件夹打开 / 在文件夹下新建 / 之前另存过）→ 直接写回那个位置，不打扰你
  2. 文档**还没绑定文件** → 点「保存」弹**原生「另存为」对话框**，自己挑文件夹和文件名（体验等同下载），
     定下来之后就一直写到那里；标题仍是默认模板时会同步成文件名
  3. 浏览器不支持写盘 → 退化成 `<a download>` 直接下载
  - 自动保存与「另存为」分开：自动保存**只静默落库，永不弹窗**
- **文件夹工作区**：「文件夹」标签可挂载本地目录为文件树，惰性展开（自动跳过 `node_modules` / `.git` 等），
  点击文件即可编辑、**保存直接写回磁盘**；目录行 hover 出「＋」、顶部「＋ 新建文件」可**就在该文件夹下新建图表文件**
  （重名自动加 `-2`），新建出来就落盘，随后编辑保存全部写回同一目录；
  Chromium 系走 File System Access API（可读写，目录句柄持久化到 IndexedDB，下次打开自动恢复），
  其他浏览器降级为 `<input webkitdirectory>` 只读兜底
- **多文档**：本地文档列表、新建、删除、自动保存
- **主题**：浅色 / 深色，自绘引擎与 mermaid 同步切换
- **安全**：所有 SVG（含本地引擎产出）过 DOMPurify；mermaid `securityLevel: 'strict'`

## 目录结构与架构分层

```
src/
├─ ir/
│  ├─ types.ts            L3 图模型（DiagramIR / SourceRef / TextEdit），零外部依赖
│  └─ patch.ts            L3 补丁与事务：applyEdits / 反向编辑 / 词边界替换
├─ flow/                  L3 流程图文档（第三种文档类型，与两种 DSL 并列）
│  ├─ model.ts            FlowModel / 序列化 / 容错解析 / 自动排版 / 导出 Mermaid
│  ├─ shapes.ts           节点图例库（分组 / 默认尺寸 / 用途说明）
│  └─ toIr.ts             FlowModel → DiagramIR（带手工坐标，不跑自动布局）
├─ lang/
│  ├─ blank.ts            L3 「源码实质为空」判定（零依赖，渲染层与 UI 共用）
│  ├─ edit.ts             补丁 → 源码编辑的统一入口
│  ├─ puml/parse.ts       L3 PlantUML 行式解析器（时序/类/用例/状态/组件/活动/思维导图）
│  ├─ puml/edit.ts        PlantUML 补丁回写
│  ├─ mmd/parse.ts        L3 Mermaid 轻量解析器（供大纲与定位，不参与渲染）
│  └─ mmd/edit.ts         Mermaid 补丁回写
├─ layout/index.ts        L3/L4 布局：sequence / mindmap / layered(ELK) / usecase grid
├─ render/
│  ├─ types.ts            L4 渲染 Port
│  ├─ index.ts            渲染调度 + 缓存 + 语言识别
│  ├─ mermaid.ts          Adapter：mermaid.js
│  ├─ plantuml.ts         Adapter：本地引擎
│  ├─ flow.ts             Adapter：流程图（模型 → 自绘 SVG）
│  ├─ postprocess.ts      消毒 / viewBox 归一化 / 节点打标
│  └─ svg/                自绘图元：shapes / graph / sequence
├─ platform/              L5 持久化（db.ts）、导入导出（io.ts）、布局 overlay（overlay.ts）、
│                            文件夹工作区（fs.ts）、文件名推导（naming.ts）
└─ app/                   L1/L2 React 界面（CodeEditor / Preview / Canvas / FlowCanvas /
                                 ShapePanel / SidePanel）+ Zustand
```

## 画布编辑是怎么回写源码的

```
画布操作（改标签 / 连线 / 删除）
   → DiagramPatch（与语言无关的语义操作）
   → lang.toSourceEdits(ir, source, patch)
   → 用 IR 元素上的 SourceRef 定位到源码字符区间，产出最小 TextEdit[]
   → applyEdits() 一次性提交（含反向编辑）→ 重解析 → 重渲染
```

三条铁律：**最小改动**（改一个标签只动那几个字符）、**锚点校验**（找不到位置就跳过并提示，绝不瞎改）、**单事务撤销**。

「画」流程图的关键在 `add-node` 补丁的 `connectFrom` 字段：拖出来的新节点不是先建空节点再连线，而是一次事务写入
`N1 --> N2[新节点]` 这样**一行**，Mermaid 与 PlantUML 各自的 `edit.ts` 负责生成符合文法的那一行。

拖拽位置属于纯几何变更，走 `ManualLayoutOverlay`（localStorage sidecar，绑定 sourceHash）。
overlay 在源码变更后会做 **rebase**（仍存在的节点保留手工位置，已删除的节点丢弃），
所以「拖好位置 → 改标签 / 加连线」不会让整张图弹回自动布局。

依赖规则：`app → render/index → lang/layout → ir`，`ir` 不反向依赖任何东西；适配器之间零横向依赖。

## 流程图为什么是「独立文档类型」

Mermaid / PlantUML 是**源码即真相**：源码是唯一权威，画布只是源码的另一个视图，任何编辑都要还原成最小字符补丁。

流程图走的是另一条路——**模型即真相**：

```
FlowModel（JSON：节点带 shape/x/y/w/h，连线带 from/to/label）
   ├─ 存盘：整份 JSON 序列化进 DocRow.source（.dflow）
   ├─ 绘制：FlowModel → DiagramIR（灌入 geometry）→ 自绘 SVG，不跑自动布局
   └─ 编辑：commitFlow(label, mutate) —— 改模型 → 整份序列化 → 一条「整档替换」的文本编辑
```

这样做的收益：

- **不存在源码锚点问题**。「往左挪 8px」在 DSL 里是几何变更（只能塞 sidecar overlay），在流程图里就是改模型的一个数字，天然可撤销、可持久化、可 diff
- 复用既有机制：撤销栈、`dirty`、自动保存、文件夹写回、导出全部走的还是那套 `TextEdit` + `Transaction`，没有为流程图单开一套状态
- 与 Mermaid 彻底解耦：内置图例库、把手连线、尺寸调整这些交互不需要迁就任何 DSL 文法

代价是**不做自动反向转换**（Mermaid → 流程图），只提供单向的「转为 Mermaid 文档」，避免把布局意图猜错。

节点外观只有一个来源：`render/svg/shapes.ts` 的 `renderNode`。
图例面板缩略图、画布上的节点、导出的 PNG/SVG 全都调它，所以「面板里长什么样，画出来就是什么样，导出去还是什么样」。

## 已知边界

- PlantUML 本地引擎覆盖**常用子集**：甘特图（gantt）、Salt、WBS、时序图的部分高级语法尚未支持，会给出明确提示而不是静默出错
- 画布编辑**不支持时序图 / 甘特图**（排版由消息顺序决定），会自动提示并引导回预览模式
- Mermaid 中「节点的声明和边写在同一行」时，删除节点会被跳过（避免误删边），请直接改源码
- 空白 PlantUML 图默认按**组件图**语义生成节点（`component "X" as N1`）；思维导图 / 活动图无关系语法，拖拽只建节点不连线
- **流程图不与 Mermaid 自动互转**：只提供单向「转为 Mermaid 文档」。反向（读懂一份 Mermaid 后还原成可视化模型）不做，
  因为布局意图无法可靠推断；要画流程图请从「▦ 新建流程图」开始
- 流程图**暂不支持子图 / 分组容器与泳道**，也不做自动布局（位置就是你摆的样子）；这类结构请用 Mermaid 的 `subgraph` 或 PlantUML
- 流程图导出 SVG / PNG 与画布同源；但**导出 Mermaid 时形状会退化**——文档、多文档、离页连接符、延时、手动输入、
  队列、包模块、用户角色、页面、步骤、注释气泡等 Mermaid 没有对应原生语法的，会统一变成矩形（`[文字]`）；
  「已存数据」退化成最接近的圆柱 `[(文字)]`
- 「另存为」用的是浏览器原生对话框，**文件名即文件身份**：另存出的文件与本地文档库里那条记录是同一个文档，
  再次「另存为」会换绑定位置，旧文件留在原地不会被删
- `@startjson` / `@startyaml` / `@startsalt` 不做渲染

## 测试

```bash
npm run smoke                  # Node 层：解析 → 布局 → 自绘 SVG + 补丁回写 / 空源码 / 文件名推导 / 流程图模型（85 条）
npm i --no-save playwright     # E2E 依赖按需装，不进 package.json
npm run build
node tools/_e2e.mjs            # 真浏览器跑完整交互链路，报告在 tools/_e2e_report.txt
```

E2E 用本机 Chrome（`executablePath`），避开 Playwright 自带 Chromium 版本号与本机镜像不匹配的问题；
文件系统用内存替身顶掉（无头环境弹不出真实对话框），验证的是「对话框返回之后我们做了什么」。
覆盖：空白图从零绘制 / 拖句柄生成「声明+连线」/ 撤销 / 空源码按空渲染 / 保存弹位置并在记住后不再弹 /
文件夹下新建文件并写回该目录 / 画布模式改源码画布同步 / 焦点不被画布抢走 /
**流程图独立文档（图例库 → 落节点 → 拖圆点连线 → 改文字 → 切方向 → 存 .dflow → 转 Mermaid）** / 0 控制台错误。

## 构建说明

`vite.config.ts` 里 `build.minify` 设为 `false`：单文件产物体积大，esbuild 压缩阶段的内存峰值在小内存机器上会直接崩。
如果你的机器内存充足，可以打开压缩把产物从 ~11 MB 降到 ~6 MB：

```ts
build: { minify: true }
```

类型检查和构建如遇 OOM，加堆：`NODE_OPTIONS=--max-old-space-size=6144 npm run build`

## 许可证注意

mermaid.js（MIT）、elkjs（EPL-2.0）、CodeMirror（MIT）、React（MIT）、Electron（MIT）、electron-builder（Apache-2.0）。
**elkjs 是 EPL-2.0**：分发光产物（NSIS 安装包 / 免安装目录 / 离线 HTML）时需要保留 elkjs 源码可得性 —— 公开分发场景请重新打包一份包含 `node_modules/elkjs/` 的归档，或在 README / 项目站点明确标注 elkjs 来源与 EPL 链接（`https://www.eclipse.org/legal/epl-2.0/`）。
#   D i a g r a m - S t u d i o  
 