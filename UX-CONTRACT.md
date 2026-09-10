# UX Contract

## Product context

- Audience: 中国仓库与发货操作员。
- Primary jobs: 导入、设置打印数量与样式、预览，并在网站内直接打印唛头。
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
| 打印流程、多行编辑、历史与旋转 | `docs/superpowers/specs/2026-09-04-print-workflow-and-multiline-editing-design.md` | 用户逐节确认规格 | 2026-09-04 |
| 记录搜索、撤销重做、应用内剪贴板与快捷键 | `docs/superpowers/specs/2026-09-06-workbench-productivity-and-dead-code-design.md` | 用户确认规格 | 2026-09-06 |
| XP-420B 网站直打、最终位图、助手安全边界与恢复 | `docs/superpowers/specs/2026-09-08-xprinter-direct-printing-design.md` | 用户确认规格 | 2026-09-08 |

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
| Table Selection | `ExcelImporter` 语义表格；记录仍使用 `LabelList` | 本合同 | 指针拖动 / Enter 或空格设起终点并用方向键扩展；多个矩形区域合并一条 / 按列每行一条 | 组件键盘测试 + 浏览器 |
| Select/Listbox | 常规单选为原生 `select`；全部字号为共享 `FontSizePicker` | `DESIGN.md` | native / authored-live-preview | 键盘 + 浏览器弹层 |
| Date | 不适用 | 本合同 | 不适用 | 不适用 |
| Form | `LabelEditor` / `SizeStylePanel` 共享字段样式、即时文字样式补丁与自动排列 | 本合同 | edit / current-line / selected-lines / selected-text / all-text / auto-arrange | reducer + 浏览器验证 |
| Scrollbar | `src/styles.css` 全局规则 | `DESIGN.md` | stable-gutter | 计算样式 |
| Toast | `AppStatus` 单一实时状态区 | 本合同 | success / warning / error | live-region 检查 |
| CRUD | `draftReducer` | 设计规格 | stay-inline | reducer + 完整流程 |
| Quantity Stepper | `QuantityStepper`，由 `LabelList` 统一消费 | 本合同 | `1..1000` 加减 / 直接输入 / 关联错误与纠正反馈 | 组件可访问性测试 + 完整流程 |
| Multiline Selection | `App` 临时选择状态 + `textLines` 纯函数 + `LabelPreview` | 本合同 | 累加选择 / 空白清除 / 整组移动 | 纯函数 + 组件 + 浏览器 |
| Preview History | `history` 纯函数 + `SourceHistory` + `draftReducer` | 本合同 | 最近 20 条 / 去重 / 再次使用 | 水合 + 完整流程 |
| Print Rotation | `printRotation` 纯函数 + `PrintReviewDialog` / `PrintPages` / `PrintTextLayer` | 本合同 | 整块文字 `0/90/180/270`，换行、相对布局和字号固定 | 纯函数 + 打印 DOM + 浏览器 |
| Record Search | `RecordSearch` + `labelSearch` | 本合同 | 内容本地、大小写不敏感过滤；清空后搜索框仍获得焦点 | `tests/app.spec.tsx` + 浏览器 |
| Draft History | `draftHistory` + `App` | 本合同 | 最近 100 步、撤销 / 重做与含数量的操作反馈 | `tests/draft-history.spec.ts` + `tests/app.spec.tsx` |
| Record Clipboard | `workspaceClipboard` + `LabelList` + `App` | 本合同 | 复制生成独立新 ID；剪切仅在粘贴时移动；粘贴后可撤销 | `tests/workspace-clipboard.spec.ts` + `tests/app.spec.tsx` |
| Shortcut Help | `shortcutKeys` + `ShortcutHelpDialog` | 本合同 | Ctrl 或 ⌘；编辑字段保留原生快捷键；F1 帮助、Escape 关闭或取消剪切 | `tests/shortcut-keys.spec.ts` + `tests/app.spec.tsx` |
| Direct Printer Bridge | `PrintReviewDialog` + `PrintBitmapSurface` / `renderPrintAsset` + `usePrintHelper` / `PrintHelperClient` + `LabelPrintHelper` | 本合同与直打协议 | 网站内直接打印为首选；浏览器打印仅应急；助手连接/配对/版本/打印机/校准/任务恢复均为具名状态 | `tests/direct-print-dialog.spec.tsx` |

## Component behavior

| Component | Default | Hover | Focus | Active | Disabled | Busy | Error |
|---|---|---|---|---|---|---|---|
| Button | 文字+意图样式 | 边线/底色加深 | 蓝色外环 | 轻微下压 | 可读且不可点 | 固定图标槽 | 邻近错误文字 |
| Input | 白纸表面 | 边线加深 | 蓝色外环 | n/a | 灰底 | n/a | 红边+说明 |
| Textarea | `resize: none`，可内部滚动 | 同 Input | 同 Input | n/a | 灰底 | n/a | 红边+说明 |
| List | 复选框+摘要+行内打印数量 | 行底色变化 | 行内控件可见焦点 | 红色左边线；数量错误显示文字并通过 `aria-invalid` / `aria-describedby` 关联 | 边界加减按钮禁用 | 保留高度 | 空白、非整数或越界值说明纠正结果并钳制到 `1..1000` |
| Draggable text | 每行细虚线边框 | 抓取光标、边框实线 | 已选行蓝色实线；活动行四角控制点、方向键微调 | 单击累加；整组拖动/方向键移动保持相对间距且不改变固定字号 | n/a | n/a | 固定字号越过内部定位区域仍按原字号打印且不裁剪、不阻断；自动适配才缩小 |
| Print area | 内边距范围 | 蓝色实线与控制点 | 蓝色外环、方向键微调 | 整体拖动或八方向缩放 | n/a | n/a | 自动限制在纸张内 |
| Preview inline edit | 双击文字行进入原位编辑 | 文本光标 | 无输入边框，仅显示插入光标 | 输入即时同步正文 | n/a | n/a | 保留原内容并可按 Escape 撤销本次编辑 |
| Text style controls | 预览标题下方两行工具栏：全部文字 / 当前行 / 选中文字 / 自动排列方式 | 控件边线加深 | 蓝色外环 | 选择后即时反映到下方预览 | 不适用项保留说明 | n/a | 无有效行时不提交补丁 |
| Font size picker | 8–300 pt 无微调按钮的数字输入 + 常用字号菜单，完整显示当前值与单位 | 悬停选项并临时更新文字与边框 | 输入合法值即时生效；方向键移动菜单高亮并临时预览 | 输入失焦/Enter 规范越界值；点击或 Enter 提交菜单项 | n/a | n/a | 菜单 Escape、Tab 或失焦关闭并恢复已提交字号 |
| Workspace panel | 桌面三板块同一行；历史并入录入来源 | 标题和边缘提示可拖动 | 标题方向键换位；边缘方向键调宽高 | 整块随指针抬起，最近插槽显示红色插入线，松手后吸附 | 窄屏禁用指针换位和横向调宽，保留方向键换位 | n/a | 宽度最小 180px，其他非法尺寸由布局域钳制 |
| Workspace collapse | 默认展开并保留原宽高 | 收起/展开按钮强调边线 | 按钮具有明确中文标签与展开状态 | 收起为 52px 边栏，状态随草稿保存 | 窄屏显示水平边栏 | n/a | 恢复默认布局会全部展开 |
| Empty label entry | 首次打开自动创建空白唛头，预览内显示多行输入框 | 输入区保持纸张反馈 | 可见输入焦点 | 输入即时同步正文并生成独立文字行 | n/a | n/a | 空内容在打印前显示阻断原因 |
| Image crop | 整图范围 | 框线加深 | 数字字段蓝色外环 | 蓝色框+深色遮罩 | 忙碌时锁定处理动作 | 识别进度保留高度 | 文件项内联说明 |
| Preview history | 最近进入打印检查的合法唛头，最多 20 条 | 恢复按钮边线加深 | “再次使用”有可见焦点 | 恢复为新 ID 的可编辑副本 | n/a | n/a | 损坏快照在水合时过滤，保存失败不阻止预览 |
| Print rotation | 文字默认 0°、纸张保持预设方向和原始毫米宽高 | 旋转按钮边线加深 | 可见焦点 | 每次顺时针 90°，270° 后回到 0° | 图片不显示旋转按钮；整块文字连同行间关系一起旋转，换行、字号和纸张宽高不变 | n/a | 继续旋转回 0° |
| Direct printer bridge | 网站内对话框显示连接与固定规格；最终预览为 `800 × 600` 位图 | 可用控件按既有边线规则反馈 | 模态焦点约束；关闭后回触发器 | 选择 XP-420B、范围/份数/逐份/方向/偏移/阈值；只有助手返回该打印机已验证校准才可直接打印 | 提交及终态锁定设置；不可用原因可见 | 渲染/上传/提交占固定状态区且按钮尺寸不变 | 未安装时可请求启动助手并重新检测；待配对/版本不兼容/离线/校准读取中/未验证/读取失败/任务失败/部分/未知均保留恢复说明 |

## Dataset navigation

- Label list: 当前草稿为小型有界列表，全部渲染；不分页。
- URL state: 草稿可能包含业务信息，不写入 URL。
- Empty/no-results/error/loading treatment: 稳定空状态；导入错误在导入区；OCR 使用具名阶段和进度。
- Selection scope: 仅当前草稿记录；显示精确选择数量，导入或排序不改变已选 ID，删除后焦点移到下一条或新增按钮。
- Excel range scope: 单个工作表内可连续框选多个矩形区域；反向拖动自动规范化，重复区域去重。键盘用户聚焦单元格后按 Enter/空格设起点，用方向键扩展，再按 Enter/空格完成，Escape 取消当前范围；焦点和正在框选地址均可感知。确认时按区域创建顺序、每个区域内从上到下再从左到右读取非空单元格，以换行合并为一条唛头；全部区域为空则不创建。“按列批量导入”仍保持每行一条。
- Image range scope: 每张图片拥有一个矩形识别区域；反向拖动自动规范化，并提供左、上、宽、高百分比字段作为键盘替代。整图识别优先查找“唛头”（包含紧邻强编号时常见的 `EESL` OCR 误识别前缀）：同行时提取右侧数据，表格中按标题位置提取同列下方数据，并在首个中英文逗号处停止；结构化 OCR 漏标时回退全文，仍未找到则以稀疏文字模式重试，两次均未找到时输出整图全部英数内容。手动框选输出框内英文、数字、空格和连接号，去除其他标点；包含明显唛头编号的行丢弃编号两侧的短 OCR 噪声，并保留识别行位置。
- Text line/range scope: 每个换行是独立文字对象，保留独立位置、方向和整体样式。连续单击文字行累加选择，单击已选行只更换活动行，单击打印区域空白清空；批量样式、方向、拖动和方向键移动作用于全部已选行，整组移动采用共同边界。编辑器字符选区只影响当前唛头的字符范围，正文改变即清除旧范围，避免样式错位。选择状态不写入草稿；切换唛头时清空。旧草稿在读取时按换行迁移为独立行。

## Flow ledger

| Operation | Trigger | Pending | Success destination | Success feedback | Failure recovery | Focus outcome | Source ref |
|---|---|---|---|---|---|---|---|
| Create | 手动新增/导入 | 文件区稳定进度 | 当前列表 | 状态区报告新增数量 | 保留成功项，失败项内联 | 新记录编辑器 | 设计规格 |
| Edit | 字段与文字样式即时编辑 | 本地操作无需加载；无需二次“应用” | 原位置 | 预览即时更新，草稿状态显示“已保存在本机” | 存储失败显示持久提示 | 保持字段焦点 | 用户浏览器批注确认 |
| Position text | 按下只选中；移动超过 4px 后拖动，或使用方向键 | 即时预览 | 原位置 | 显示吸附类型 | 恢复正中 | 保持文字对象焦点 | 用户确认需求 |
| Resize text | 拖动当前行四角控制点，或在控制点使用方向键 | 即时预览 | 原位置 | 边框与文字按比例同步缩放 | 中栏字号数字输入 | 保持控制点或文字行焦点 | 用户浏览器批注确认 |
| Preview font size | 悬停字号选项或用方向键移动 | 只生成非持久预览副本 | 原位置 | 文字和选中边框同步改变 | Escape、Tab 或失焦恢复；点击/Enter 提交 | 返回字号触发器 | 用户浏览器批注确认 |
| Auto arrange text | 在下拉列表选择排列方式 | 即时预览 | 原位置 | 非空行上下均匀分布并立即应用左/中/右/保持位置 | 可继续拖动单行或重复选择 | 保持选择器焦点 | 用户浏览器批注确认 |
| Position print area | 拖动区域/控制点，或使用方向键 | 即时预览 | 原位置 | 状态区保存草稿 | 继续拖动或调整控制点 | 保持区域焦点 | 用户确认需求 |
| Arrange workspace panels | 拖动板块标题，或聚焦标题后按左右方向键 | 拖动超过 4px 后整块跟随指针并预览最近水平插槽；靠近溢出工作区左右边缘时持续滚动 | 松手后吸附到插槽前/后位置 | 布局随草稿保存在本机 | 恢复默认布局 | 保持标题焦点 | 用户浏览器批注确认 |
| Resize workspace panel | 拖动右/下/右下边缘，或聚焦边缘后按方向键 | 即时本地更新 | 原位置 | 宽高随草稿保存在本机 | 恢复默认布局 | 保持边缘焦点 | 用户浏览器批注确认 |
| Edit preview text | 双击某一文字行 | 即时预览 | 原位置 | 输入即时同步唛头正文；Enter 或失焦完成 | Escape 恢复进入编辑前内容 | 保持原位或返回文字对象 | 用户确认需求 |
| Enter blank label | 在空白预览的裁切框内输入 | 即时预览 | 原位置 | 多行内容自动生成可独立操作的文字行 | 保留输入内容继续修改 | 保持输入框焦点 | 用户浏览器批注确认 |
| Change print quantity | 唛头清单内减号、数字输入或加号 | 输入中保留草稿值并立即显示关联错误 | 原列表 | 失焦或 Enter 钳制到 `1..1000`，说明纠正后的值，下一次预览张数即时采用新值 | 空白归一为 1、越界钳制、非整数恢复当前值；边界按钮禁用 | 保持数量控件焦点 | 用户浏览器批注确认 |
| Select/move text lines | 连续单击文字行后拖动或按方向键 | 即时预览 | 原位置 | 已选行保持相对间距共同移动 | 单击打印区域空白清除选择 | 保持活动文字行焦点 | 用户浏览器批注确认 |
| Collapse workspace panel | 点击任一板块“收起” | 即时本地更新 | 同一工作区边缘栏 | 收起状态随草稿保存在本机 | 点击“展开”恢复原宽高 | 移到展开按钮 | 用户浏览器批注确认 |
| Crop and recognize image | 图片上框选或填写百分比后识别 | 可取消的具名 OCR 进度 | 新增记录 | 报告文件名并选中新记录 | 保留图片、可重选区域或改用原图 | 文件项或新记录 | 用户确认需求 |
| Preview / remember | 当前唛头“打印预览”或顶部“检查并打印” | 同步筛选合法唛头 | 打印检查对话框 | 合法快照立即写入最近历史、去重并限制 20 条 | 阻塞项不写历史；存储失败不阻止对话框 | 对话框关闭后回触发按钮 | 用户浏览器批注确认 |
| Restore history | “再次使用” | 同步深拷贝 | 当前列表与编辑器 | 新建唛头/文字行 ID，并恢复历史尺寸快照 | 同 ID 尺寸冲突时新建预设 ID | 新副本编辑器 | 用户浏览器批注确认 |
| Rotate print text | 打印检查中“旋转 90°” | 整块唛头文字围绕内容中心旋转，纸张和打印区域不旋转 | 同一对话框 | 缩略图与打印 DOM 同步按 `0/90/180/270` 循环；每行仍为完整字符串，换行、相对队形、字号和纸张宽高不变 | 图片不旋转；关闭对话框清零 | 保持旋转按钮焦点 | 用户确认（2026-09-06） |
| Search | 输入“搜索唛头”或 Ctrl / ⌘ + F | 本地同步过滤内容，不修改草稿或打印范围 | 当前列表 | `已显示 / 总数` live region；无结果显示稳定说明 | 清空搜索恢复完整列表 | 清空后回到搜索框；Ctrl / ⌘ + F 聚焦搜索框 | 2026-09-06 设计规格 |
| Undo / Redo | 顶部按钮、Ctrl / ⌘ + Z、Ctrl + Y 或 Ctrl / ⌘ + Shift + Z | 本地快照切换，不触发存储读取 | 当前草稿 | 状态区报告“已撤销 / 已重做：操作名”；无可用步骤时按钮原生禁用 | 输入字段保留浏览器原生快捷键 | 保持当前焦点；按钮具有可访问名称 | 2026-09-06 设计规格 |
| Copy / Cut / Paste | 记录操作栏或 Ctrl / ⌘ + C/X/V | 复制或剪切暂存在应用内；剪切显示“待剪切” | 当前列表、活动记录之后 | 复制、粘贴或移动的精确条数；粘贴/移动作为单个可撤销步骤 | Escape 取消待剪切；目标消失时不执行移动 | 保持操作触发器；剪贴板暂存不写入历史 | 2026-09-06 设计规格 |
| Shortcut Help | 顶部“快捷键”或 F1 | 对话框打开，背景 inert 且页面滚动锁定 | 快捷键帮助对话框 | 展示跨平台 Ctrl / ⌘ 组合键 | Escape 或关闭按钮关闭 | 对话框聚焦关闭按钮，关闭后回到触发器 | 2026-09-06 设计规格 |
| Direct print | 单一精确 `100 × 75 mm` 计划直接进入；混合计划从该组按“直接打印标签”进入，再按“直接打印” | 依次显示生成、上传、提交且阻止重复操作 | 同一网站对话框 | “已向打印队列提交 N 张”；不宣称实体标签已输出 | 未提交可修正后重试；部分/未知先核对实体输出与队列，再从下一未确认张创建新任务 | 终态留在对话框；关闭后回打印检查触发按钮 | `docs/superpowers/specs/2026-09-08-xprinter-direct-printing-design.md` |
| Pair print helper | 网站检测到无有效配对后创建请求；用户在助手原生确认窗批准，再按“检查配对状态” | 保持待配对说明，不暴露凭据 | 同一网站对话框 | 助手已连接并显示兼容打印机 | 拒绝、过期、已领取或授权失效时重新建立配对；不降低到浏览器打印 | 保持对话框内可操作焦点 | 直打设计规格与协议测试 |
| Calibrate printer | “校准打印机”只触发固定无载荷 `labelprint://calibrate`，助手新实例或既有实例均聚焦校准控件 | 浏览器只能请求外部协议，不能确认助手已打开或校准已完成；校准命令、边框测试和人工确认分离 | 助手诊断窗；完成后回网站“刷新连接”，网站重新读取 `GET /v1/calibration?printerId=…` | 只有助手返回已验证，且完整边框恰好占一张 `100 × 75 mm` 实体标签时主动作可用 | 任一失败、取消、否认或状态读取失败都保持主动作禁用；重新校准、测试、确认后刷新 | 助手校准控件；网站保留可见未验证说明 | 直打设计规格、`tests/print-helper-client.spec.ts` 与 `CalibrationServiceTests` |
| Emergency browser print | 直打为“更多操作”→“浏览器打印（应急）”→“仍然打开浏览器打印”；任一非 `100 × 75 mm` legacy 分组也先显示同名应急动作和相同二次确认 | 明示纸张设置不一致可能再次跨标签 | 浏览器系统打印界面；直打确认时先关闭网站对话框 | 仅声明已打开浏览器打印，不作为直打成功证据 | 取消保留草稿；不得自动进入或静默回退 | 关闭系统界面后回网站主页面；再次检查不会保留动作锁 | 直打设计规格 |
| Remember print size | 点击“打印这一组” | 同步记录该组宽高 | 原位置 | 之后从手动、Excel 或图片新增时采用该宽高 | 仅编辑宽高不更新默认值 | 保持打印动作焦点 | 用户浏览器批注确认 |
| Delete | 删除此项 | 即时本地更新 | 列表 | 状态区确认 | 不适用 | 下一条或新增按钮 | 设计规格 |
| Bulk action | 批量应用样式 | 即时本地更新 | 原列表 | 报告更新数量 | 无选择时禁用并解释 | 批量工具条 | 设计规格 |
| Upload/background job | 导入 Excel/识别图片 | 具名阶段/可见进度 | 列表 | 成功与失败数量 | 重试或切换原图模式 | 文件项或新记录 | 设计规格 |
| Cancel/back | 取消确认框 | 无 | 原位置 | 无 | 无 | 返回触发按钮 | 本合同 |
| Hard-delete | 清空草稿 | 确认框内固定忙碌槽 | 空状态 | 状态区“草稿已清空” | 取消保留全部数据 | 手动新增按钮 | 设计规格 |

## Navigation and responsive behavior

- Route document title policy: `唛头打印工作台`。
- Breadcrumb/tab/route-state policy: 单页无路由；不使用标签页伪装步骤。
- Responsive transformation: 桌面工作区的三个板块以 300 / 540 / 340px 默认宽度保持同一行，顺序、宽高和收起状态保存在本机；每块可收成 52px 边栏并恢复原尺寸。放大后的总宽度超过视口时横向滚动而不换行。预览板块内的全部文字工具栏和宽高输入固定在标题与画布之间；板块窄于 500px 时控件折为两列。720px 以下工作区按逻辑顺序单栏堆叠，收起板块显示为水平边栏。“使用过的唛头”始终位于录入来源内部，不参与独立排序。
- Physical preview contract: 纸张宽高使用毫米，尺寸工具只保留可编辑的宽度与高度；内容区域移动/缩放后始终限制在纸张内，并由屏幕预览和打印布局共同消费。首次打开自动创建空白唛头，空白预览可直接输入多行文字。点击“打印这一组”后记住该组宽高，之后从任一入口新增唛头均默认使用该宽高；只编辑宽高不更新这项默认值，清空草稿也保留最近打印宽高。全部字号可选择自动适配或输入 8–300 pt 固定物理字号；合法输入即时生效，越界输入在失焦或 Enter 时规范到边界。常用字号菜单悬停或方向键高亮只临时预览字号并同步改变文字边框，点击或 Enter 才提交。固定字号和逐行/局部字号覆盖按原值渲染，拖动或方向键移动只改变位置；文字越过内部定位区域时不警告、不阻断、不缩小且不在该区域裁剪，继续按原字号和坐标进入打印检查。只有自动适配模式会向下缩小到可完整显示的最大字号；最小字号仍越界或文字行重叠时阻止打印。直接打印的单一最终输出几何为 `100 × 75 mm @ 203 DPI = 800 × 600` 点；`PrintBitmapSurface` / `renderPrintAsset` 生成同一位图供预览与助手提交，CSS 像素、设备像素比、浏览器缩放和浏览器分页不得成为第二个几何源。旋转、偏移和阈值在同一位图链路中解析；辅助线、编辑边框、控制点和临时字号预览不进入位图。
- Truncation/full-value access: 唛头内容在列表最多两行，编辑器和预览始终提供完整值。
- Focus restoration and sticky-obstruction policy: 对话框关闭回触发器；焦点使用 `scroll-margin`，无固定遮挡栏。

## Overlays and feedback

- Dialog primitive: 项目共享 `ConfirmDialog`，模态、焦点约束、Escape、背景 inert 和焦点恢复。
- Destructive confirmation levels: “清空整个草稿”和“批量删除”需要不可恢复确认；删除单条记录可立即执行。
- Toast placement/duration/deduplication: 不使用浮动 toast；顶部 `AppStatus` 持久展示最近一次状态，重复覆盖。
- Alert/banner scope and persistence: 文件、排版、打印阻断和存储问题在对应区域持续到修复；旧 `needsReview` 字段只为草稿兼容保留，不产生人工校对门槛或状态徽标。
- Tooltip delay/dismissal: 必要说明使用可见帮助文字，不依赖 tooltip。
- Unsaved-changes behavior: 每次变更立即保存到本机；保存失败时启用窄范围 `beforeunload` 警告。
- Layer/z-index contract: sticky 100、backdrop 500、dialog 600、status 900。

## Async and resilience

- Mutation default: 本地 reducer 即时提交；OCR 属于可取消的后台读取。
- Idempotency and duplicate-submit policy: 文件处理忙碌期间禁用重复操作；直打任务使用唯一任务 ID，网站同步锁定重复提交，助手对同一任务幂等返回已有状态。提交请求不自动重试。
- Auto-save/draft recovery: 每次 reducer 状态变化后防抖写入 localStorage，启动时恢复；不自动覆盖版本不兼容草稿。
- Offline/read-stale/write behavior: 编辑与草稿核心功能离线运行；OCR 语言资源不可用时保留原图并说明。直打依赖本机助手与 Windows 打印队列，连接失败时保留对话框设置并提供刷新，不静默回退到浏览器打印。
- Retry/backoff/timeout behavior: 不自动无限重试；文件项提供显式重试。直打的健康检查和状态查询可由用户刷新；非幂等提交遇到超时、网络中断或结果不明时禁止自动重试，先按任务 ID 查询并核对队列/实体输出。
- Version conflict and multi-tab behavior: 不承诺多标签页合并；后打开的标签页读取启动时快照。
- Stale-request cancellation/invalidation: 图片项提供“取消识别”，离开组件时终止旧 worker，旧结果不得写回新记录。
- Dialog/form preservation and retry after mutation failure: 本地存储失败不清空内存草稿。直打失败、部分提交或状态不明保留范围、份数、逐份、方向、偏移、阈值、任务 ID 与已确认页码；只有明确未提交才允许原任务重试，其余恢复生成新任务。

## Direct-print release gate

- Intended workflow: 网站内直接打印是产品首选；浏览器打印只能通过明确应急入口和二次确认打开。
- Canonical helper states: 连接为 `checking`、`not-installed`、`pairing-required`、`version-mismatch`、`ready`、`error`；所选打印机校准另为 `not-selected`、`checking`、`verified`、`unverified`、`error`。打印机必须兼容且可用，且助手持久化配置明确为 `verified`，生产配置才允许提交；校准、独立边框测试与人工确认缺一不可。
- Canonical job states: `received`、`validating`、`submitting`、`submitted`、`partial`、`failed`、`unknown`。`submitted` 仅表示进入 Windows 打印队列。
- Release evidence: 自动化、安装器、真实浏览器和 XP-420B 实体测试分开记录。实体 XP-420B 上的边框、1→1、10→10、内容/旋转/图片/偏移、逐份顺序、离线/缺纸/断开/部分/未知恢复以及 Windows 重启尚未全部通过时，不得称为生产硬件已批准。
- Split-label investigation: 若单条内容仍跨两张实体标签，依次核对 `800 × 600 PNG`、1-bit packed bitmap、TSPL `SIZE`、传感器配置、spool bytes 与实体校准中的首个差异，不能用缩小字体或浏览器设置掩盖。

## Validation

- Schema/validation layer: `src/domain` 纯函数与 reducer；`print-protocol` JSON Schema、网站严格解析与助手 `ProtocolValidator` 共同约束直打协议。
- Trigger timing: 导入时验证；编辑字段在离开错误状态或打印前验证。
- Error summary/inline policy: 打印前汇总，字段和记录同时显示内联原因。
- Sensitive-value handling: 不展示业务文件路径，不把业务内容写入 URL 或公网服务。配对凭据不进入文案、日志、URL 或报告；助手只接受精确 Origin、loopback TLS 与允许的协议字段。
- `noValidate`, first-invalid focus, duplicate-submit prevention, unsaved changes, and submit recovery: 表单使用 `noValidate`；打印阻断后聚焦第一条问题记录。

## Verification

- Required static commands: `pnpm test`、`pnpm run test:a11y`、`pnpm run typecheck`、`pnpm run build`、Release helper tests、win-x64 自包含单文件发布、premium strict audit、DESIGN lint 与直打反模式扫描。
- Browser/device/locale/theme matrix: Windows Edge/Chrome 桌面与 390px 窄屏、`zh-CN`、强制颜色与 reduced motion；直打另验安装检测、唤起/配对、打印机列表、固定规格、全部设置、焦点、重连与刷新恢复，正常“直接打印”不得打开浏览器打印界面。
- Accessibility checks: 键盘、焦点、标签、live region、对话框焦点约束和 200% 缩放抽查。
- Component-state/visual regression coverage: 空、单行/多行选择、错误、OCR 进度、自动缩小、整体旋转、历史、直打连接/配对/版本/打印机/校准/任务状态、应急确认框。
- Canonical sibling flow used for comparison: 新项目无兄弟页面；手动新增、Excel 导入和图片导入互为创建流程对照。
- CRUD full-flow evidence: `tests/draft.spec.ts` 与真实浏览器工作流。
- Failure-path evidence: 文件、存储、排版阻断、`tests/direct-print-dialog.spec.tsx`、`tests/print-helper-client.spec.ts`、`tests/app.spec.tsx` 与 helper job/security/calibration tests。
