---
version: alpha
name: "唛头打印工作台"
description: "以包装车间裁切台为视觉原型的本地唛头整理与打印工具"
colors:
  canvas: "#E7EAE8"
  paper: "#FFFDF7"
  ink: "#161916"
  muted: "#626862"
  line: "#A9AFAA"
  signal: "#C63D2F"
  success: "#2F6B52"
  warning: "#9A620D"
  danger: "#A62B24"
  focus: "#0B65C2"
typography:
  display:
    fontFamily: "Bahnschrift SemiCondensed, Arial Narrow, Microsoft YaHei, sans-serif"
    fontSize: "1.75rem"
    lineHeight: "1.05"
  body:
    fontFamily: "Microsoft YaHei, PingFang SC, system-ui, sans-serif"
    fontSize: "0.875rem"
    lineHeight: "1.55"
  utility:
    fontFamily: "Bahnschrift, Consolas, Microsoft YaHei, monospace"
    fontSize: "0.75rem"
    lineHeight: "1.35"
rounded:
  DEFAULT: "0.25rem"
  sm: "0.125rem"
  md: "0.25rem"
  lg: "0.5rem"
spacing:
  xs: "0.375rem"
  sm: "0.625rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "2.25rem"
  page-max: "112rem"
components:
  button:
    height: "2.5rem"
    radius: "0.25rem"
  input:
    height: "2.5rem"
    radius: "0.25rem"
  panel:
    radius: "0.5rem"
    border: "1px solid #A9AFAA"
  dialog:
    width: "28rem"
    radius: "0.5rem"
---

# 唛头打印工作台 Design System

## Overview

### Creative North Star

界面以包装车间里的裁切台、标签纸和质检章为参照：操作面是耐脏的冷灰色，打印预览是真实白纸，关键状态像质检盖章一样使用有限的信号红。视觉表达服务于尺寸、边界和校对，不做装饰性仪表盘。

### Product context and register

- **Audience and primary job:** 中国仓库和发货操作员，需要快速把 Excel、照片或手工信息整理成可打印唛头。
- **Target market(s) and evidence:** 中国境内发货操作；依据《唛头打印作业流程(1).docx》和用户确认的本机工作流。
- **Locale(s) and language policy:** 界面使用简体中文；唛头内容保持原文，允许中英混排。
- **Usage scene:** Windows 桌面浏览器为主，重复高频操作，偶尔在窄窗口查看；需要中高信息密度。
- **Register:** 产品工具，任务清晰与打印准确优先。
- **Memorable signature:** 预览区使用毫米刻度与裁切边界，直接表达物理尺寸。
- **Restraint:** 表单、文件选择、校对和确认交互保持熟悉，动画只用于状态变化。
- **Anti-references:** 不使用渐变 SaaS 仪表盘、玻璃拟态、圆润卡片海洋或营销页式大标题；这些会削弱操作密度和打印可信度。
- **Token ownership/runtime mapping:** 本文件是设计令牌规范源；`src/styles.css` 手动映射同名 CSS 变量，`premium-ui.json` 和严格审计用于漂移检查。

## Colors

`canvas` 是工作台背景，`paper` 只用于打印预览和输入表面，`ink`/`muted` 形成两级文字。`signal` 只标记当前项、需要校对和核心打印动作；`danger` 仅用于清空等不可恢复操作。焦点使用独立蓝色，避免与状态色混淆。强制颜色模式下放弃自定义色，保留系统对比。

## Typography

标题和毫米读数使用紧凑的 Bahnschrift 系列，形成物流标签的工业节奏；中文操作文字使用微软雅黑/PingFang/system-ui。文件大小、数量和尺寸使用等宽回退。界面不加载网络字体，确保离线稳定和避免布局跳动。正文不使用斜体；斜体只属于用户自定义的唛头内容。

## Layout

大于 1120px 时使用“录入 270px 起 / 校对 285px 起 / 预览 480px 起”的三栏工作台，把最终纸张预览作为主操作面；预览画布至少约 32rem 高，宽屏纸张可扩展到 46rem。低频的常用尺寸、精确尺寸与打印区域数值设置收进原生详情折叠区，全部文字样式保持直接可见。页面本身保持自然滚动，列表和预览在足够高度时可拥有内部滚动并启用稳定滚动条槽。窄屏按录入、列表、预览顺序堆叠，打印动作不遮挡字段。

## Elevation & Depth

主要层级依靠色块和 1px 边线。静态面板不使用阴影；对话框使用单一深阴影与半透明遮罩。预览纸张允许轻微阴影，表达纸张悬浮在裁切台上。

## Shapes

控件采用 4px 小圆角，面板和对话框采用 8px。打印纸、刻度尺和列表分隔保持直角或 2px 圆角。胶囊形仅用于短状态标签，不用于主要按钮。

## Components

### Foundational visual states

默认状态以边线和白纸表面区分；悬停加深边线；键盘焦点使用 2px 蓝色外环；选中项同时使用信号红左边线和文字说明。禁用降低对比但保持可读，忙碌状态预留固定图标槽。错误、警告和成功都包含图标或文字，不单靠颜色。

### Buttons and actions

主要安全动作使用墨黑实底，最终打印使用信号红实底；次要动作使用描边或透明按钮。清空草稿在正常界面使用低强调危险文字，在确认框内才使用高强调危险按钮。按钮保持 40px 高，忙碌时不改变宽度。

### Navigation and data display

该应用没有路由导航；顶部只提供工作状态与全局动作。记录使用有明确复选框的列表，不伪装成表格。选中数量和批量工具条占用固定区域，避免列表跳动。

Excel 的“框选区域”使用紧凑语义表格：冻结行列标尺、不同区域有限色区分，并始终用“区域序号 + 单元格地址”补充颜色信息。框选结果是数据录入工具，不改变记录列表的视觉模型。

图片的“框选区域”使用原图比例预览、深色遮罩和蓝色裁切边界；同时提供百分比数字字段作为非拖动替代。识别结果按原区域中的行拆成独立文字对象，并以框内相对坐标放入打印纸，不额外合并或重排各行。

### Forms and overlays

原生 `select` 是项目的选择器标准，接受 Windows 平台弹层外观。输入、选择器和按钮共享 40px 高度。文件区同时提供可见按钮和拖放区域。确认框为模态 `alertdialog`，支持焦点约束、Escape、取消初始焦点和触发器焦点恢复。

预览纸内的蓝色裁切框表示实际内容打印区域：拖动框内空白处或图片可整体移动区域，八个控制点调整边界，毫米数字字段和方向键提供等价的非拖动操作；区域始终限制在纸张内。每一行文字仍是独立直接操作对象：按下或点击只选中当前行并保持原位，指针移动超过 4px 后才进入拖动；拖动从原位置计算位移，靠近九宫格锚点自动吸附。键盘方向键提供等价微调，Shift 加速；双击某行可在原位置直接编辑，输入态不显示边框或底色，只保留文字和插入光标。每行可单独设置字体、字号、强调和横排/竖排；字符选区仍可覆盖该行的局部样式，控件变化立即生效，不再需要二次“应用”。右侧“全部文字样式”会明确覆盖已有逐行与局部字符的同类属性，切回自动字号会移除残留固定字号。自动字号只由不换行文字、局部样式和内容打印区域的毫米尺寸共同求解，不受锚点或拖动位置影响；移动造成越界或相邻行重叠时保持字号并显示校验错误。预览再把毫米、pt 和边框统一缩放到屏幕纸张，打印消费同一物理字号与区域坐标。当前对齐类型使用可见文字报告，打印页不输出辅助线或控件。

### Iconography

优先使用简洁的内联 SVG 线性图标，16–20px、1.8px 描边；关键动作始终保留文字标签，不使用难以理解的纯图标按钮。

### Motion

状态颜色和边线变化使用 120–180ms；对话框使用 180ms 淡入和轻微缩放。新增记录只淡入当前项，不重放整个列表。`prefers-reduced-motion` 下取消位移和缩放，过渡不超过 80ms。

### Content and data visualization

文案使用操作员能直接执行的动词：“导入 Excel”“标记已校对”“打印此尺寸”。错误说明发生了什么以及下一步，例如“未识别数量，请选择数量列”。数量、毫米和页数使用阿拉伯数字与明确单位。

## Do's and Don'ts

- **Do:** 让尺寸、边界、校对状态和最终页数始终可见。
- **Do:** 所有视觉令牌只从 `:root` CSS 变量映射并由共享类消费。
- **Don't:** 用颜色或图标替代错误文字、字段标签或批量选择范围。
- **Don't:** 在打印页保留网页阴影、刻度尺、按钮、提示或状态徽章。
