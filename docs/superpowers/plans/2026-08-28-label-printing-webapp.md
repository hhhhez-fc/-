# 唛头打印网页 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个完全本地运行的唛头导入、校对、样式设置、预览和分尺寸打印网页。

**Architecture:** React 单页应用负责工作台交互，`src/domain` 保存可独立测试的业务规则，`src/features` 按导入、编辑、预览和打印拆分组件。Excel 由 SheetJS 在浏览器解析，图片由 Tesseract.js 在本机 OCR；草稿和预设通过浏览器 `localStorage` 保存。

**Tech Stack:** React、TypeScript、Vite、Vitest、SheetJS (`xlsx`)、Tesseract.js、CSS print media。

**Spec:** `docs/superpowers/specs/2026-08-28-label-printing-webapp-design.md`

## Global Constraints

- 不添加服务器、登录、云同步或网络上传。
- 所有尺寸使用毫米，固定字号范围为 8–120 pt。
- 默认文字黑色、背景白色；图片保持比例且不裁切。
- 固定字号发生溢出时阻止打印，自动字号必须找到完整容纳内容的最大字号。
- 打印份数等于基础数量乘以张贴面数。
- 所有错误使用中文内联提示，不调用 `alert()`、`confirm()` 或 `prompt()`。
- 当前目录不是 Git 仓库，因此每个任务以测试通过作为检查点，不执行提交命令。

---

### Task 1: 扩展唛头、尺寸和样式领域模型

**Files:**
- Modify: `src/domain/labels.ts`
- Modify: `tests/domain.spec.ts`

**Interfaces:**
- Produces: `LabelStyle`, `SizePreset`, `LabelRecord`, `defaultStyle`, `defaultSizePresets`, `getPrintCopies(label)`。

- [ ] **Step 1: 写失败测试**

```ts
it('打印份数等于基础数量乘以张贴面数', () => {
  const label = createLabel({
    content: 'FY-01', contentType: 'text', purpose: 'carton', source: 'manual',
    quantity: 3, sides: 2, sizePresetId: 'small', style: defaultStyle, needsReview: false,
  });
  expect(getPrintCopies(label)).toBe(6);
});
```

- [ ] **Step 2: 运行领域测试并确认缺少新类型或函数**

Run: `node node_modules/vitest/vitest.mjs run tests/domain.spec.ts`
Expected: FAIL，提示 `defaultStyle` 或 `getPrintCopies` 不存在。

- [ ] **Step 3: 实现模型和默认值**

```ts
export interface LabelStyle {
  fontFamily: string;
  fontMode: 'auto' | 'fixed';
  fontSizePt: number;
  fontWeight: 400 | 700;
  italic: boolean;
  underline: boolean;
  horizontalAlign: 'left' | 'center' | 'right';
  verticalAlign: 'top' | 'middle' | 'bottom';
  lineHeight: 1.05 | 1.2 | 1.4;
  borderWidthMm: number;
}

export const getPrintCopies = (label: LabelRecord) => label.quantity * label.sides;
```

- [ ] **Step 4: 运行测试并确认通过**

Run: `node node_modules/vitest/vitest.mjs run tests/domain.spec.ts`
Expected: PASS。

### Task 2: 完善排版与打印校验规则

**Files:**
- Modify: `src/domain/layout.ts`
- Modify: `tests/domain.spec.ts`

**Interfaces:**
- Consumes: `LabelStyle`, `SizePreset`。
- Produces: `solveTextLayout(input)`, `validateLabelForPrint(label, preset)`。

- [ ] **Step 1: 写固定字号溢出和自动字号测试**

```ts
it('固定字号溢出时返回阻断错误', () => {
  expect(solveTextLayout({
    content: 'VERY LONG SHIPPING MARK', widthMm: 20, heightMm: 10, paddingMm: 2,
    maxFontSize: 80, minFontSize: 8, fixedFontSize: 80, lineHeight: 1.2,
  })).toEqual({ ok: false, error: '固定字号下内容超出唛头范围' });
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node node_modules/vitest/vitest.mjs run tests/domain.spec.ts`
Expected: FAIL，现有排版器不接受固定字号或行距。

- [ ] **Step 3: 让自动和固定字号共用同一测量路径**

```ts
const candidates = input.fixedFontSize
  ? [input.fixedFontSize]
  : range(input.maxFontSize, input.minFontSize);
```

`validateLabelForPrint` 对空内容、非法数量、未校对状态和溢出分别返回中文原因数组。

- [ ] **Step 4: 运行领域测试**

Run: `node node_modules/vitest/vitest.mjs run tests/domain.spec.ts`
Expected: PASS。

### Task 3: 建立草稿 reducer 和本地持久化边界

**Files:**
- Create: `src/domain/draft.ts`
- Create: `src/domain/storage.ts`
- Create: `tests/draft.spec.ts`

**Interfaces:**
- Produces: `DraftState`, `DraftAction`, `draftReducer`, `loadDraft(storage)`, `saveDraft(storage, state)`。

- [ ] **Step 1: 写 reducer 与损坏存储测试**

```ts
it('损坏的本地草稿不会覆盖初始状态', () => {
  const storage = { getItem: () => '{bad', setItem: vi.fn(), removeItem: vi.fn() };
  expect(loadDraft(storage)).toEqual(null);
});
```

- [ ] **Step 2: 运行新测试并确认模块不存在**

Run: `node node_modules/vitest/vitest.mjs run tests/draft.spec.ts`
Expected: FAIL，提示无法解析 `draft` 或 `storage` 模块。

- [ ] **Step 3: 实现纯 reducer 和防御性 JSON 存储**

```ts
export function loadDraft(storage: Pick<Storage, 'getItem'>): DraftState | null {
  try {
    const value = storage.getItem(STORAGE_KEY);
    return value ? JSON.parse(value) as DraftState : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: 运行新旧测试**

Run: `node node_modules/vitest/vitest.mjs run`
Expected: PASS。

### Task 4: 建立应用工作台、手动录入和实时预览

**Files:**
- Create: `src/App.tsx`
- Create: `src/features/LabelList.tsx`
- Create: `src/features/LabelEditor.tsx`
- Create: `src/features/LabelPreview.tsx`
- Create: `src/features/SizeStylePanel.tsx`
- Modify: `src/main.tsx`
- Create: `src/styles.css`
- Create: `tests/app.spec.tsx`
- Modify: `package.json`

**Interfaces:**
- Consumes: `draftReducer`, `solveTextLayout`, `defaultSizePresets`。
- Produces: 可完成手动新增、选择、编辑、复制、删除、尺寸与样式修改的工作台。

- [ ] **Step 1: 增加 jsdom 与 Testing Library 测试环境并写失败组件测试**

```tsx
it('手动新增后可编辑内容并在预览中显示', async () => {
  render(<App />);
  await user.click(screen.getByRole('button', { name: '手动新增' }));
  await user.type(screen.getByLabelText('唛头内容'), 'MADE IN CHINA');
  expect(screen.getByTestId('label-preview')).toHaveTextContent('MADE IN CHINA');
});
```

- [ ] **Step 2: 运行组件测试并确认 App 不存在**

Run: `node node_modules/vitest/vitest.mjs run tests/app.spec.tsx`
Expected: FAIL。

- [ ] **Step 3: 实现工作台与可访问表单**

`App` 使用 `useReducer`；列表按钮使用 `aria-pressed` 表示当前项；输入有真实 `label`；错误通过 `aria-describedby` 关联；样式控件覆盖规格中的字体、字号模式、字号、粗体、斜体、下划线、水平/垂直对齐、行距和边框。

- [ ] **Step 4: 运行组件与领域测试**

Run: `node node_modules/vitest/vitest.mjs run`
Expected: PASS。

### Task 5: 实现 Excel 导入、工作表选择和手动列映射

**Files:**
- Modify: `src/domain/importing.ts`
- Create: `src/features/ExcelImporter.tsx`
- Create: `tests/excel-import.spec.ts`
- Modify: `tests/app.spec.tsx`

**Interfaces:**
- Produces: `readWorkbook(file)`, `sheetToMatrix(workbook, sheetName)`, `rowsToLabelsWithColumns(...)`。

- [ ] **Step 1: 写手动列映射和工作表选择测试**

```ts
it('允许使用明确列索引转换无法自动识别的表格', () => {
  const labels = rowsToLabelsWithColumns(['A', 'B'], [['FY-01', 4]], 'small', {
    contentColumn: 0, quantityColumn: 1,
  });
  expect(labels[0]).toMatchObject({ content: 'FY-01', quantity: 4 });
});
```

- [ ] **Step 2: 运行测试并确认新 API 不存在**

Run: `node node_modules/vitest/vitest.mjs run tests/excel-import.spec.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 SheetJS 浏览器解析和映射 UI**

使用 `XLSX.read(await file.arrayBuffer())`；第一行作为表头；自动识别失败时不丢弃矩阵，而是显示工作表、内容列和数量列选择控件，确认后再分派 `import-labels`。

- [ ] **Step 4: 使用生成的小型工作簿运行自动化测试**

Run: `node node_modules/vitest/vitest.mjs run tests/excel-import.spec.ts tests/app.spec.tsx`
Expected: PASS。

### Task 6: 实现图片导入、OCR 校对和原图模式

**Files:**
- Create: `src/domain/images.ts`
- Create: `src/features/ImageImporter.tsx`
- Create: `tests/images.spec.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Produces: `validateImageFile(file)`, `recognizeImage(file, onProgress)`, 图片型 `LabelRecord`。

- [ ] **Step 1: 写文件类型校验测试**

```ts
it('拒绝不支持的图片类型', () => {
  expect(validateImageFile(new File(['x'], 'mark.gif', { type: 'image/gif' })))
    .toBe('仅支持 PNG、JPEG 和 WebP 图片');
});
```

- [ ] **Step 2: 运行测试并确认模块不存在**

Run: `node node_modules/vitest/vitest.mjs run tests/images.spec.ts`
Expected: FAIL。

- [ ] **Step 3: 实现本地 OCR 与原图保底**

`recognizeImage` 动态调用 Tesseract worker；OCR 结果创建 `needsReview: true` 的文字记录；失败时保留 `URL.createObjectURL(file)` 并允许用户选择“直接打印原图”。组件卸载或删除记录时释放对象 URL。

- [ ] **Step 4: 以 mock worker 验证成功、失败与进度状态**

Run: `node node_modules/vitest/vitest.mjs run tests/images.spec.ts tests/app.spec.tsx`
Expected: PASS。

### Task 7: 实现校对状态、批量样式和尺寸预设管理

**Files:**
- Modify: `src/domain/draft.ts`
- Modify: `src/features/LabelList.tsx`
- Modify: `src/features/SizeStylePanel.tsx`
- Modify: `tests/draft.spec.ts`
- Modify: `tests/app.spec.tsx`

**Interfaces:**
- Produces: `toggle-select`, `apply-style-to-selected`, `add-size-preset`, `update-size-preset`, `remove-size-preset`, `mark-reviewed` actions。

- [ ] **Step 1: 写批量样式不可改动未选记录的测试**

```ts
it('批量样式只更新已选择记录', () => {
  const next = draftReducer(stateWithTwoLabels, {
    type: 'apply-style-to-selected', patch: { fontWeight: 700 },
  });
  expect(next.labels[0].style.fontWeight).toBe(700);
  expect(next.labels[1].style.fontWeight).toBe(400);
});
```

- [ ] **Step 2: 运行测试并确认 action 未实现**

Run: `node node_modules/vitest/vitest.mjs run tests/draft.spec.ts tests/app.spec.tsx`
Expected: FAIL。

- [ ] **Step 3: 实现不可变 reducer 和预设防护**

禁止删除仍被记录引用的尺寸预设；宽高必须为 20–300 mm，内边距必须小于宽高的一半；校对按钮只在内容、数量和尺寸有效时清除 `needsReview`。

- [ ] **Step 4: 运行测试**

Run: `node node_modules/vitest/vitest.mjs run`
Expected: PASS。

### Task 8: 实现打印汇总、分尺寸打印和清空确认框

**Files:**
- Create: `src/domain/printing.ts`
- Create: `src/features/PrintSummary.tsx`
- Create: `src/features/ConfirmDialog.tsx`
- Create: `src/print.css`
- Create: `tests/printing.spec.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Produces: `groupPrintableLabels(labels, presets)`, `buildPrintPages(group)`, `PrintSummary`。

- [ ] **Step 1: 写分组、页数和阻断测试**

```ts
it('按物理尺寸分组并展开打印份数', () => {
  const groups = groupPrintableLabels(labels, presets);
  expect(groups.map((g) => [g.sizeKey, g.pages.length])).toEqual([
    ['70x45', 6], ['100x60', 2],
  ]);
});
```

- [ ] **Step 2: 运行测试并确认打印模块不存在**

Run: `node node_modules/vitest/vitest.mjs run tests/printing.spec.ts`
Expected: FAIL。

- [ ] **Step 3: 实现打印状态和 CSS**

打印前显示记录数、总页数、尺寸分组和阻断原因；每次只激活一个尺寸分组，动态注入对应 `@page { size: Wmm Hmm; margin: 0; }`；确认框使用 `role="alertdialog"`、Escape、焦点恢复和“取消/清空草稿”明确按钮。

- [ ] **Step 4: 运行全部测试**

Run: `node node_modules/vitest/vitest.mjs run`
Expected: PASS。

### Task 9: 完成视觉系统、响应式布局与浏览器验收

**Files:**
- Create: `DESIGN.md`
- Create: `premium-ui.json`
- Modify: `src/styles.css`
- Modify: `src/print.css`
- Modify: `index.html`

**Interfaces:**
- Produces: 桌面三栏工作台、窄屏分段布局、统一滚动条/焦点/按钮/表单/状态视觉和准确打印样式。

- [ ] **Step 1: 定义设计令牌和组件状态**

在 `DESIGN.md` 固化暖白纸张背景、墨黑文字、朱红强调色、中文无衬线操作字体与等宽数字；在 `:root` 映射颜色、间距、圆角、阴影和字体令牌。

- [ ] **Step 2: 实现桌面与窄屏布局**

桌面宽度大于 1100 px 时使用录入、校对、预览三栏；窄屏按文档流堆叠，列表和预览保持独立可滚动区域，不隐藏页面滚动条。

- [ ] **Step 3: 运行静态 UI 审计与项目检查**

Run: `C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe C:/Users/Administrator/.codex/plugins/cache/openai-curated-remote/frontend-design-premium/1.4.0/skills/frontend-design-premium/scripts/audit_project.py D:/Codex/唛头打印 --mode strict`
Expected: 无 blocking findings。

- [ ] **Step 4: 运行类型检查、测试和构建**

Run: `node node_modules/typescript/bin/tsc -b`
Expected: exit 0。

Run: `node node_modules/vitest/vitest.mjs run`
Expected: 全部通过。

Run: `node node_modules/vite/bin/vite.js build`
Expected: exit 0 且生成 `dist`。

- [ ] **Step 5: 在真实浏览器验收完整工作流**

启动 Vite，依次验证空状态、手动新增、示例 Excel、错误文件、样式修改、固定字号溢出、图片原图模式、批量样式、清空确认、打印分组、键盘焦点和 390 px 窄屏布局；截图检查唛头边界与打印预览。
