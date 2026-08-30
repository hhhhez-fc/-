# UX Contract

## Product context

- Audience: 中国仓库与发货操作员。
- Primary jobs: 导入、校对、设置样式、预览和打印唛头。
- Target market(s): 中国境内发货操作。
- Active locales: `zh-CN`；用户唛头内容保持原始语言。
- Language/content register and native-review policy: 简体中文操作文案，依据业务流程文档和用户确认。
- Timezone/calendar policy: 不处理日期时间。
- Accessibility target: WCAG 2.2 AA。

## Business-context sources

| Domain / scope | Authoritative source | Source type | Reviewed date |
|---|---|---|---|
| 唛头类型、数量和特殊打印规则 | `唛头打印作业流程(1).docx` | 业务 SOP | 2026-08-28 |
| 尺寸、字体和样式 | `docs/superpowers/specs/2026-08-28-label-printing-webapp-design.md` | 用户确认规格 | 2026-08-28 |
| 隐私和存储 | 同上 | 用户确认规格 | 2026-08-28 |

## Visual contract

- Project `DESIGN.md`: `DESIGN.md`。
- Token ownership model: `DESIGN.md` 规范源，运行时 CSS 手动映射。
- Runtime design-system/token source: `src/styles.css :root`。
- Mapping/export/adapters: CSS 变量与共享组件类。
- Token drift gate: `designmd lint`、`audit_project.py --mode strict` 和真实浏览器计算样式检查。
- Supported themes: 单一浅色工作台；强制颜色模式交给操作系统。
- Design-context owner/review policy: 系统级视觉变化同时修改 `DESIGN.md` 与运行时变量。

## Canonical UI Map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| Table Selection | `ExcelImporter` 语义表格；记录仍使用 `LabelList` | 本合同 | 多个矩形区域、精确地址 | 纯函数 + 浏览器 |
| Select/Listbox | 原生 `select` | `DESIGN.md` | native | 键盘 + 浏览器弹层 |
| Date | 不适用 | 本合同 | 不适用 | 不适用 |
| Form | `LabelEditor` / `SizeStylePanel` 共享字段样式、即时文字样式补丁与自动排列 | 本合同 | edit / current-line / selected-text / all-text / auto-arrange | reducer + 浏览器验证 |
| Scrollbar | `src/styles.css` 全局规则 | `DESIGN.md` | stable-gutter | 计算样式 |
| Toast | `AppStatus` 单一实时状态区 | 本合同 | success / warning / error | live-region 检查 |
| CRUD | `draftReducer` | 设计规格 | stay-inline | reducer + 完整流程 |

## Component behavior

| Component | Default | Hover | Focus | Active | Disabled | Busy | Error |
|---|---|---|---|---|---|---|---|
| Button | 文字+意图样式 | 边线/底色加深 | 蓝色外环 | 轻微下压 | 可读且不可点 | 固定图标槽 | 邻近错误文字 |
| Input | 白纸表面 | 边线加深 | 蓝色外环 | n/a | 灰底 | n/a | 红边+说明 |
| Textarea | `resize: none`，可内部滚动 | 同 Input | 同 Input | n/a | 灰底 | n/a | 红边+说明 |
| List | 复选框+摘要 | 行底色变化 | 行内控件可见焦点 | 红色左边线 | n/a | 保留高度 | 行内原因 |
| Draggable text | 每行细虚线边框 | 抓取光标、边框实线 | 当前行蓝色实线、四角控制点、方向键微调 | 拖动移动；四角拖动按比例改变字号 | n/a | n/a | 溢出或重叠状态 |
| Print area | 内边距范围 | 蓝色实线与控制点 | 蓝色外环、方向键微调 | 整体拖动或八方向缩放 | n/a | n/a | 自动限制在纸张内 |
| Preview inline edit | 双击文字行进入原位编辑 | 文本光标 | 无输入边框，仅显示插入光标 | 输入即时同步正文 | n/a | n/a | 保留原内容并可按 Escape 撤销本次编辑 |
| Text style controls | 全部文字 / 当前行 / 选中文字 / 自动排列方式 | 控件边线加深 | 蓝色外环 | 选择后即时反映到预览 | 不适用项保留说明 | n/a | 无有效行时不提交补丁 |
| Workspace panel | 桌面三板块同一行；历史并入录入来源 | 标题和边缘提示可拖动 | 标题方向键换位；边缘方向键调宽高 | 整块随指针抬起，最近插槽显示红色插入线，松手后吸附 | 窄屏禁用指针换位和横向调宽，保留方向键换位 | n/a | 宽度最小 180px，其他非法尺寸由布局域钳制 |
| Image crop | 整图范围 | 框线加深 | 数字字段蓝色外环 | 蓝色框+深色遮罩 | 忙碌时锁定处理动作 | 识别进度保留高度 | 文件项内联说明 |

## Dataset navigation

- Label list: 当前草稿为小型有界列表，全部渲染；不分页。
- URL state: 草稿可能包含业务信息，不写入 URL。
- Empty/no-results/error/loading treatment: 稳定空状态；导入错误在导入区；OCR 使用具名阶段和进度。
- Selection scope: 仅当前草稿记录；显示精确选择数量，导入或排序不改变已选 ID，删除后焦点移到下一条或新增按钮。
- Excel range scope: 单个工作表内可连续框选多个矩形区域；反向拖动自动规范化，重复区域去重，每个非空区域按行优先合成为一条待校对唛头。
- Image range scope: 每张图片拥有一个矩形识别区域；反向拖动自动规范化，并提供左、上、宽、高百分比字段作为键盘替代。整图识别优先查找“唛头”（包含紧邻强编号时常见的 `EESL` OCR 误识别前缀）：同行时提取右侧数据，表格中按标题位置提取同列下方数据，并在首个中英文逗号处停止；结构化 OCR 漏标时回退全文，仍未找到则以稀疏文字模式重试，两次均未找到时输出整图全部英数内容。手动框选输出框内英文、数字、空格和连接号，去除其他标点；包含明显唛头编号的行丢弃编号两侧的短 OCR 噪声，并保留识别行位置。
- Text line/range scope: 每个换行是独立文字对象，保留独立位置、方向和整体样式；编辑器字符选区只影响当前唛头的字符范围，正文改变即清除旧范围，避免样式错位。旧草稿在读取时按换行迁移为独立行。

## Flow ledger

| Operation | Trigger | Pending | Success destination | Success feedback | Failure recovery | Focus outcome | Source ref |
|---|---|---|---|---|---|---|---|
| Create | 手动新增/导入 | 文件区稳定进度 | 当前列表 | 状态区报告新增数量 | 保留成功项，失败项内联 | 新记录编辑器 | 设计规格 |
| Edit | 字段与文字样式即时编辑 | 本地操作无需加载；无需二次“应用” | 原位置 | 预览即时更新，草稿状态显示“已保存在本机” | 存储失败显示持久提示 | 保持字段焦点 | 用户浏览器批注确认 |
| Position text | 按下只选中；移动超过 4px 后拖动，或使用方向键 | 即时预览 | 原位置 | 显示吸附类型 | 恢复正中 | 保持文字对象焦点 | 用户确认需求 |
| Resize text | 拖动当前行四角控制点，或在控制点使用方向键 | 即时预览 | 原位置 | 边框与文字按比例同步缩放 | 中栏字号数字输入 | 保持控制点或文字行焦点 | 用户浏览器批注确认 |
| Auto arrange text | 在下拉列表选择排列方式 | 即时预览 | 原位置 | 非空行上下均匀分布并立即应用左/中/右/保持位置 | 可继续拖动单行或重复选择 | 保持选择器焦点 | 用户浏览器批注确认 |
| Position print area | 拖动区域/控制点，或输入毫米数值 | 即时预览 | 原位置 | 状态区保存草稿 | 恢复默认区域 | 保持区域或字段焦点 | 用户确认需求 |
| Arrange workspace panels | 拖动板块标题，或聚焦标题后按左右方向键 | 拖动超过 4px 后整块跟随指针并预览最近水平插槽；靠近溢出工作区左右边缘时持续滚动 | 松手后吸附到插槽前/后位置 | 布局随草稿保存在本机 | 恢复默认布局 | 保持标题焦点 | 用户浏览器批注确认 |
| Resize workspace panel | 拖动右/下/右下边缘，或聚焦边缘后按方向键 | 即时本地更新 | 原位置 | 宽高随草稿保存在本机 | 恢复默认布局 | 保持边缘焦点 | 用户浏览器批注确认 |
| Edit preview text | 双击某一文字行 | 即时预览 | 原位置 | 输入即时同步校对正文；Enter 或失焦完成 | Escape 恢复进入编辑前内容 | 保持原位或返回文字对象 | 用户确认需求 |
| Crop and recognize image | 图片上框选或填写百分比后识别 | 可取消的具名 OCR 进度 | 新增待校对记录 | 报告文件名并选中新记录 | 保留图片、可重选区域或改用原图 | 文件项或新记录 | 用户确认需求 |
| Print | 当前唛头“打印预览” / 顶部检查并打印 / 打印这一组 | 显示程序生成张数，并提示系统打印份数保持 1 | 系统打印窗口 | 显示 `1 × 程序生成张数 = 实际打印张数` | 取消系统打印后保留当前草稿 | 返回打印检查触发按钮 | 用户确认需求 |
| Delete | 删除此项 | 即时本地更新 | 列表 | 状态区确认 | 不适用 | 下一条或新增按钮 | 设计规格 |
| Bulk action | 批量应用样式 | 即时本地更新 | 原列表 | 报告更新数量 | 无选择时禁用并解释 | 批量工具条 | 设计规格 |
| Upload/background job | 导入 Excel/识别图片 | 具名阶段/可见进度 | 列表 | 成功与失败数量 | 重试或切换原图模式 | 文件项或新记录 | 设计规格 |
| Cancel/back | 取消确认框 | 无 | 原位置 | 无 | 无 | 返回触发按钮 | 本合同 |
| Hard-delete | 清空草稿 | 确认框内固定忙碌槽 | 空状态 | 状态区“草稿已清空” | 取消保留全部数据 | 手动新增按钮 | 设计规格 |

## Navigation and responsive behavior

- Route document title policy: `唛头打印工作台`。
- Breadcrumb/tab/route-state policy: 单页无路由；不使用标签页伪装步骤。
- Responsive transformation: 桌面工作区的三个板块以 300 / 540 / 340px 默认宽度保持同一行，顺序和宽高保存在本机；放大后的总宽度超过视口时横向滚动而不换行。拖动标题时整块随指针移动，按最近水平插槽预览，松手后吸附换位；边缘只负责调宽高，最小宽度 180px。720px 以下按逻辑顺序单栏堆叠并取消横向溢出，标题恢复纵向触摸滚动，禁用指针换位与横向调宽，但保留标题左右方向键换位和纵向调高。“使用过的唛头”始终位于录入来源内部，不参与独立排序。
- Physical preview contract: 纸张宽高与内容打印区域都使用毫米；内容区域移动/缩放后始终限制在纸张内，并由屏幕预览和打印页共同消费。全部字号可选择自动适配或固定物理字号；当前行文字边框缩放会写入该行字号。拖动和自动排列只改变位置。越界或文字行重叠时保持字号并显示校验错误；屏幕预览按纸张渲染宽度同步缩放 pt、毫米坐标和纸张边框，打印页使用相同物理字号，但排除编辑边框与控制点。
- Truncation/full-value access: 唛头内容在列表最多两行，编辑器和预览始终提供完整值。
- Focus restoration and sticky-obstruction policy: 对话框关闭回触发器；焦点使用 `scroll-margin`，无固定遮挡栏。

## Overlays and feedback

- Dialog primitive: 项目共享 `ConfirmDialog`，模态、焦点约束、Escape、背景 inert 和焦点恢复。
- Destructive confirmation levels: “清空整个草稿”和“批量删除”需要不可恢复确认；删除单条记录可立即执行。
- Toast placement/duration/deduplication: 不使用浮动 toast；顶部 `AppStatus` 持久展示最近一次状态，重复覆盖。
- Alert/banner scope and persistence: 文件、校对和存储问题在对应区域持续到修复。
- Tooltip delay/dismissal: 必要说明使用可见帮助文字，不依赖 tooltip。
- Unsaved-changes behavior: 每次变更立即保存到本机；保存失败时启用窄范围 `beforeunload` 警告。
- Layer/z-index contract: sticky 100、backdrop 500、dialog 600、status 900。

## Async and resilience

- Mutation default: 本地 reducer 即时提交；OCR 属于可取消的后台读取。
- Idempotency and duplicate-submit policy: 忙碌期间禁用同一文件重复处理。
- Auto-save/draft recovery: 每次 reducer 状态变化后防抖写入 localStorage，启动时恢复；不自动覆盖版本不兼容草稿。
- Offline/read-stale/write behavior: 全部核心功能离线运行；OCR 语言资源不可用时保留原图并说明。
- Retry/backoff/timeout behavior: 不自动无限重试；文件项提供显式重试。
- Version conflict and multi-tab behavior: 不承诺多标签页合并；后打开的标签页读取启动时快照。
- Stale-request cancellation/invalidation: 图片项提供“取消识别”，离开组件时终止旧 worker，旧结果不得写回新记录。
- Dialog/form preservation and retry after mutation failure: 本地存储失败不清空内存草稿。

## Validation

- Schema/validation layer: `src/domain` 纯函数与 reducer。
- Trigger timing: 导入时验证；编辑字段在离开错误状态或打印前验证。
- Error summary/inline policy: 打印前汇总，字段和记录同时显示内联原因。
- Sensitive-value handling: 不展示文件路径，不写 URL，不发送网络。
- `noValidate`, first-invalid focus, duplicate-submit prevention, unsaved changes, and submit recovery: 表单使用 `noValidate`；打印阻断后聚焦第一条问题记录。

## Verification

- Required static commands: TypeScript、Vitest、Vite build、premium strict audit、DESIGN lint。
- Browser/device/locale/theme matrix: Windows Chromium 桌面、390px 窄屏、`zh-CN`、强制颜色与 reduced motion。
- Accessibility checks: 键盘、焦点、标签、live region、对话框焦点约束和 200% 缩放抽查。
- Component-state/visual regression coverage: 空、选择、待校对、错误、OCR 进度、溢出、打印、确认框。
- Canonical sibling flow used for comparison: 新项目无兄弟页面；手动新增、Excel 导入和图片导入互为创建流程对照。
- CRUD full-flow evidence: `tests/draft.spec.ts` 与真实浏览器工作流。
- Failure-path evidence: 文件、存储、排版与打印阻断测试。
