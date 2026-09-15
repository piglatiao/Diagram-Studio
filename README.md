# Diagram Studio · 纯本地Web绘图工作台
> 100%本地渲染，运行无外网请求，支持Web版与Electron打包Windows exe桌面端。

## 快速构建
```bash
npm install
npm run dev    # 开发 [http://localhost:5173](http://localhost:5173)
npm run build  # 打包单文件 dist/index.html（约11MB，离线双击可用）
npm run smoke  # 本地链路冒烟测试
# Electron打包
npm run electron:pack   # 免安装目录版
npm run electron:build  # NSIS安装包exe
```
Electron仅做窗口+菜单+受限IPC，页面依旧是单HTML，开启沙箱隔离，无Node能力。

## 核心技术方案
放弃PlantUML在线网关，自研解析器：
`PlantUML源码 → 自研行式解析器 → DiagramIR中间模型 → 本地布局引擎 → SVG自绘`
Mermaid使用本地打包mermaid.js v11，不请求外网。
持久化：IndexedDB（降级localStorage）；导入导出依赖浏览器Blob。

### 支持能力清单
- Mermaid：本地bundle，完整支持流程图、时序、类图、ER、思维导图等
- PlantUML：自研解析+本地布局，支持时序/类/状态/组件/活动/用例/思维导图（部分高级语法不支持）
- **流程图（独立文档类型 .dflow）**：模型即真相，ISO5807规范26种节点；拖拽绘图，可单向导出Mermaid（不可反向）
- 编辑器：CodeMirror6，语法高亮、自动补全、撤销栈；220ms防抖实时预览
- 源码 ↔ SVG双向定位，结构面板查看节点统计
- 画布编辑：修改生成最小源码补丁；纯位置拖拽存入overlay，不污染源码，支持撤销
- 文件夹工作区：Chromium支持File System Access API，可直接读写本地目录文件
- 导出：SVG/PNG/PDF/源码/全量JSON备份；明暗双主题，SVG经DOMPurify安全过滤

## 架构分层
- `ir/`：核心中间模型DiagramIR、编辑事务补丁（底层无外部依赖）
- `flow/`：独立流程图模型、形状库、模型转IR
- `lang/`：Mermaid/PlantUML解析与源码补丁回写
- `layout/`：多种布局算法（ELK分层、时序网格、树布局等）
- `render/`：渲染调度，Mermaid/PlantUML/流程图渲染适配器、SVG自绘
- `platform/`：持久化、文件IO、文件夹工作区
- `app/`：React UI层（编辑器、画布、面板）+ Zustand状态

## 画布编辑源码回写流程
画布操作 → DiagramPatch → 语言适配器生成TextEdit → IR SourceRef定位源码区间 → 事务提交，最小改动；仅几何拖拽存入overlay，源码变更时overlay自动重基。

## 流程图独立文档要点
- Mermaid/PlantUML：**源码为权威**；流程图：**JSON模型为权威**，存储`.dflow`
- 所有视图（面板缩略图、画布、导出）复用同一个`renderNode`渲染函数，视觉一致
- 仅支持单向导出Mermaid；Mermaid无法自动转回流程图，避免布局语义丢失

## 已知限制
1. PlantUML甘特、Salt、WBS、部分高级语法暂不支持；画布编辑不支持时序/甘特图
2. 流程图无子图、分组、泳道，无自动布局；导出Mermaid时部分特殊形状退化为矩形
3. Mermaid单行同时声明节点+边时，删除节点逻辑有限制
4. `@startjson`等块不渲染

## 测试
- smoke：Node层单元测试（85条）
- E2E：调用本机Chrome，内存文件替身，覆盖绘图、撤销、文件夹读写等完整交互

## 构建&许可
- vite单文件打包，默认关闭minify避免OOM；内存充足可开启压缩至约6MB；OOM可增大Node堆内存
- 依赖许可：elkjs为EPL-2.0，对外分发时需满足EPL源码可得要求；其余多为MIT
