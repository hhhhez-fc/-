# Print Workflow and Multiline Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make quantities editable from the label list, support additive multiline editing and movement, remove manual review gating, merge Excel selections, persist the last 20 previewed labels, shrink overflowing text, and rotate printed text from the app preview without rotating paper.

**Architecture:** Keep `LabelRecord` backward-compatible while moving new behavior into focused pure domain functions. `App` owns transient line-selection and print-rotation state; persistent preview history lives in `DraftState`. Screen preview, print-preview thumbnails, and print pages consume one layout solver so font sizes and rotations cannot diverge.

**Tech Stack:** React 19, TypeScript 7, Vite 8, Vitest 4, Testing Library, DOM/CSS print rendering.

**Spec:** `docs/superpowers/specs/2026-09-04-print-workflow-and-multiline-editing-design.md`

## Global Constraints

- Keep the existing local-only data flow; do not upload files or history.
- Keep `LabelRecord.needsReview` and `reviewReason` readable for version-1 draft compatibility, but do not use them as print gates or visible workflow state.
- Continue blocking empty content, invalid quantities, invalid sizes, copy-limit violations, and content that cannot fit at the minimum font size.
- Store at most 20 recent preview-history entries; duplicate snapshots move to the front instead of creating another entry.
- Multiline selection and print rotations are transient UI state and must not be serialized.
- Print rotation cycles `0 → 90 → 180 → 270 → 0` and rotates text only; `@page` width, height, margins, print area, and line anchors remain unchanged.
- Excel region selection creates one label; column mapping continues to create one label per data row.
- A user-selected font size is an upper bound: shrink only on overflow and never enlarge short text.
- Preserve the current visual language and responsive behavior documented in `DESIGN.md` and `UX-CONTRACT.md`.

---

### Task 1: Remove Review Gating and Move Quantity to the List

**Files:**
- Create: `src/features/QuantityStepper.tsx`
- Modify: `src/features/LabelList.tsx`
- Modify: `src/features/LabelEditor.tsx`
- Modify: `src/domain/layout.ts`
- Modify: `src/domain/draft.ts`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Test: `tests/quantity-controls.spec.tsx`
- Test: `tests/domain.spec.ts`
- Test: `tests/draft.spec.ts`
- Test: `tests/app.spec.tsx`

**Interfaces:**
- Produces: `QuantityStepper({ value, max, label, onCommit }: QuantityStepperProps)`.
- Produces: `LabelListProps.onQuantityChange(id: string, quantity: number): void`.
- Preserves: `validateLabelForPrint(label, preset): string[]`, without checking `needsReview`.

- [ ] **Step 1: Write failing validation and reducer tests**

Add these assertions to `tests/domain.spec.ts` and `tests/draft.spec.ts`:

```ts
it('人工校对状态不阻止合法唛头打印', () => {
  const label = createLabel({ content: 'FY-01', quantity: 1, source: 'manual', needsReview: true });
  expect(validateLabelForPrint(label, defaultSizePresets[0])).not.toContain('该唛头尚未完成校对');
});

it('修改正文和数量不再写入待校对原因', () => {
  const label = createLabel({ content: 'A', quantity: 1, source: 'manual', needsReview: false });
  const state = { ...createInitialDraft(), labels: [label] };
  const next = draftReducer(state, { type: 'update-label', id: label.id, patch: { quantity: 3 } });
  expect(next.labels[0]).toMatchObject({ quantity: 3, needsReview: false });
  expect(next.labels[0].reviewReason).toBeUndefined();
});
```

- [ ] **Step 2: Run the focused domain tests and confirm red**

Run: `pnpm test -- tests/domain.spec.ts tests/draft.spec.ts`

Expected: both new assertions fail because validation and `update-label` still use review state.

- [ ] **Step 3: Remove review gating and review side effects**

In `validateLabelForPrint`, delete the `needsReview` error. In `draftReducer` remove `requiresReview`, `mark-reviewed`, and every new `reviewReason` assignment from editing/duplicate flows. Keep the legacy fields on stored records.

```ts
case 'update-label':
  return {
    ...state,
    labels: state.labels.map((label) => label.id === action.id
      ? {
          ...label,
          ...action.patch,
          ...(Object.prototype.hasOwnProperty.call(action.patch, 'content')
            && action.patch.content !== label.content
            ? { textStyleRanges: [], textLines: syncTextLines(label.textLines, action.patch.content ?? '') }
            : {}),
          id: label.id,
        }
      : label),
  };
```

- [ ] **Step 4: Write failing quantity component tests**

Create `tests/quantity-controls.spec.tsx` with the jsdom environment and existing pointer-capture polyfills:

```tsx
// @vitest-environment jsdom
it('列表内加减和直接输入打印数量，不触发行切换', async () => {
  const user = userEvent.setup();
  const onCommit = vi.fn();
  const onActivate = vi.fn();
  const label = createLabel({ content: 'FY-01', quantity: 2, source: 'manual', needsReview: false });
  render(<LabelList
    labels={[label]}
    activeLabelId={label.id}
    selectedLabelIds={[]}
    onActivate={onActivate}
    onToggleSelect={() => undefined}
    onQuantityChange={onCommit}
    onDuplicate={() => undefined}
    onDelete={() => undefined}
  />);
  await user.click(screen.getByRole('button', { name: '增加第 1 条唛头的打印数量' }));
  expect(onCommit).toHaveBeenLastCalledWith(label.id, 3);
  expect(onActivate).not.toHaveBeenCalled();
  const input = screen.getByRole('spinbutton', { name: '第 1 条唛头的打印数量' });
  await user.clear(input);
  await user.type(input, '7{Enter}');
  expect(onCommit).toHaveBeenLastCalledWith(label.id, 7);
});
```

- [ ] **Step 5: Run the quantity test and confirm red**

Run: `pnpm test -- tests/quantity-controls.spec.tsx`

Expected: TypeScript or render failure because `onQuantityChange` and `QuantityStepper` do not exist.

- [ ] **Step 6: Implement `QuantityStepper` and list integration**

Use a local string so the input can temporarily be blank, and normalize on Enter/blur:

```tsx
export interface QuantityStepperProps {
  value: number;
  max: number;
  label: string;
  onCommit: (value: number) => void;
}

const clampQuantity = (raw: string, fallback: number, max: number) => {
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? Math.max(1, Math.min(max, parsed)) : fallback;
};

export default function QuantityStepper({ value, max, label, onCommit }: QuantityStepperProps) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const next = clampQuantity(draft, value, max);
    setDraft(String(next));
    onCommit(next);
  };
  return <div className="quantity-stepper" onClick={(event) => event.stopPropagation()}>
    <button type="button" aria-label={`减少${label}`} disabled={value <= 1} onClick={() => onCommit(value - 1)}>−</button>
    <input aria-label={label} type="number" min="1" max={max} value={draft}
      onChange={(event) => setDraft(event.target.value)} onBlur={commit}
      onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit(); } }} />
    <button type="button" aria-label={`增加${label}`} disabled={value >= max} onClick={() => onCommit(value + 1)}>+</button>
  </div>;
}
```

Render it below each row summary. Remove the review badge. Add `onQuantityChange` to `LabelListProps` and dispatch `update-label` from `App`.

- [ ] **Step 7: Remove quantity and review UI from the editor and headings**

Change the records title and editor copy:

```tsx
<h2 id="records-title">唛头清单</h2>
<p>{state.labels.length} 条记录</p>
```

Delete the review-reason paragraph and the “基础数量” field from `LabelEditor`; leave “张贴面数” and `最终打印 quantity × sides 张`. Do not mark a label reviewed when opening preview.

- [ ] **Step 8: Update SSR expectations and run focused tests**

Add assertions that output contains `唛头清单`, does not contain `待校对` or `<span>基础数量</span>`, and still contains `张贴面数`.

Run: `pnpm test -- tests/quantity-controls.spec.tsx tests/domain.spec.ts tests/draft.spec.ts tests/app.spec.tsx`

Expected: PASS.

- [ ] **Step 9: Commit Task 1**

```bash
git add src/features/QuantityStepper.tsx src/features/LabelList.tsx src/features/LabelEditor.tsx src/domain/layout.ts src/domain/draft.ts src/App.tsx src/styles.css tests/quantity-controls.spec.tsx tests/domain.spec.ts tests/draft.spec.ts tests/app.spec.tsx
git commit -m "feat: edit print quantities from label list"
```

---

### Task 2: Add Pure Multiline Update and Group-Movement Operations

**Files:**
- Modify: `src/domain/textLines.ts`
- Test: `tests/text-lines.spec.ts`

**Interfaces:**
- Produces: `updateSelectedTextLines(lines, selectedIds, patch): LabelTextLine[]`.
- Produces: `moveSelectedTextLines(lines, selectedIds, deltaXPercent, deltaYPercent): LabelTextLine[]`.
- Produces: `cloneTextLinesWithFreshIds(lines): LabelTextLine[]` for history restoration.

- [ ] **Step 1: Write failing pure-function tests**

Append to `tests/text-lines.spec.ts`:

```ts
it('批量样式和方向只更新已选行', () => {
  const lines = createTextLines('A\nB\nC');
  const next = updateSelectedTextLines(lines, [lines[0].id, lines[2].id], {
    style: { fontSizePt: 32, italic: true },
    textOrientation: 'vertical',
  });
  expect(next.map((line) => [line.style.fontSizePt, line.textOrientation])).toEqual([
    [32, 'vertical'], [undefined, 'horizontal'], [32, 'vertical'],
  ]);
});

it('整组移动保持间距并用共同边界限制位移', () => {
  const lines = createTextLines('A\nB');
  lines[0].placement.xPercent = 10;
  lines[1].placement.xPercent = 90;
  const next = moveSelectedTextLines(lines, lines.map((line) => line.id), 20, -5);
  expect(next.map((line) => line.placement.xPercent)).toEqual([20, 100]);
  expect(next[1].placement.xPercent - next[0].placement.xPercent).toBe(80);
});

it('恢复历史时重建每条文字行 ID', () => {
  const lines = createTextLines('A\nB');
  const copy = cloneTextLinesWithFreshIds(lines);
  expect(copy.map((line) => line.id)).not.toEqual(lines.map((line) => line.id));
  expect(copy.map((line) => line.text)).toEqual(['A', 'B']);
});
```

- [ ] **Step 2: Run tests and confirm red**

Run: `pnpm test -- tests/text-lines.spec.ts`

Expected: imports fail because the three functions are absent.

- [ ] **Step 3: Implement immutable selected-line updates**

```ts
export type TextLinePatch = Partial<Pick<LabelTextLine, 'textOrientation'>> & { style?: InlineTextStyle };

export function updateSelectedTextLines(lines: LabelTextLine[], selectedIds: string[], patch: TextLinePatch) {
  const selected = new Set(selectedIds);
  return lines.map((line) => selected.has(line.id) ? {
    ...line,
    ...patch,
    style: patch.style ? { ...line.style, ...patch.style } : { ...line.style },
    placement: { ...line.placement },
  } : line);
}
```

- [ ] **Step 4: Implement clamped group movement**

Compute the common allowed delta before applying it:

```ts
export function moveSelectedTextLines(lines: LabelTextLine[], selectedIds: string[], dx: number, dy: number) {
  const selected = new Set(selectedIds);
  const moving = lines.filter((line) => selected.has(line.id));
  if (!moving.length) return lines;
  const clampedX = Math.max(-Math.min(...moving.map((line) => line.placement.xPercent)),
    Math.min(dx, 100 - Math.max(...moving.map((line) => line.placement.xPercent))));
  const clampedY = Math.max(-Math.min(...moving.map((line) => line.placement.yPercent)),
    Math.min(dy, 100 - Math.max(...moving.map((line) => line.placement.yPercent))));
  return lines.map((line) => selected.has(line.id) ? {
    ...line,
    placement: {
      xPercent: line.placement.xPercent + clampedX,
      yPercent: line.placement.yPercent + clampedY,
      horizontalSnap: clampedX ? 'free' : line.placement.horizontalSnap,
      verticalSnap: clampedY ? 'free' : line.placement.verticalSnap,
    },
  } : line);
}
```

Use `crypto.randomUUID()` in `cloneTextLinesWithFreshIds` and deep-clone style/placement.

- [ ] **Step 5: Run focused tests and commit**

Run: `pnpm test -- tests/text-lines.spec.ts`

Expected: PASS.

```bash
git add src/domain/textLines.ts tests/text-lines.spec.ts
git commit -m "feat: add multiline batch editing operations"
```

---

### Task 3: Wire Additive Line Selection into Editor and Preview

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/features/LabelEditor.tsx`
- Modify: `src/features/LabelPreview.tsx`
- Modify: `src/styles.css`
- Test: `tests/multiline-interactions.spec.tsx`
- Test: `tests/app.spec.tsx`

**Interfaces:**
- Consumes: `updateSelectedTextLines` and `moveSelectedTextLines` from Task 2.
- Produces: `LabelEditorProps.selectedLineIds`, `onSelectLine(id)`, and `onClearLineSelection()`.
- Produces: matching selection props on `LabelPreview`.

- [ ] **Step 1: Write failing additive-selection interaction tests**

Create `tests/multiline-interactions.spec.tsx` under jsdom:

```tsx
const stateWithLabel = (content: string) => {
  const label = createLabel({ content, quantity: 1, source: 'manual', needsReview: false });
  return { ...createInitialDraft(), labels: [label], activeLabelId: label.id };
};

it('连续单击累加文字行，单击打印区域空白清空', async () => {
  const user = userEvent.setup();
  render(<App initialState={stateWithLabel('A\nB\nC')} />);
  await user.click(screen.getByRole('button', { name: /拖动第 1 行/ }));
  await user.click(screen.getByRole('button', { name: /拖动第 2 行/ }));
  expect(screen.getByText('已选 2 行')).toBeTruthy();
  await user.click(screen.getByRole('group', { name: /拖动内容打印区域/ }));
  expect(screen.queryByText('已选 2 行')).toBeNull();
});

it('修改方向和方向键移动会作用到全部已选行', async () => {
  const user = userEvent.setup();
  render(<App initialState={stateWithLabel('A\nB')} />);
  await user.click(screen.getByRole('button', { name: /拖动第 1 行/ }));
  await user.click(screen.getByRole('button', { name: /拖动第 2 行/ }));
  await user.selectOptions(screen.getByRole('combobox', { name: '所选行方向' }), 'vertical');
  await user.keyboard('{ArrowRight}');
  expect(screen.getAllByText(/竖排/).length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run the new test and confirm red**

Run: `pnpm test -- tests/multiline-interactions.spec.tsx`

Expected: selection status and props are absent.

- [ ] **Step 3: Add transient selection state in `App`**

```ts
const [selectedLineIds, setSelectedLineIds] = useState<string[]>([]);
const selectLine = (id: string) => {
  setActiveLineId(id);
  setSelectedLineIds((current) => current.includes(id) ? current : [...current, id]);
};
const clearLineSelection = () => setSelectedLineIds([]);

useEffect(() => {
  setSelectedLineIds((current) => current.filter((id) => activeLabel?.textLines.some((line) => line.id === id)));
}, [activeLabel?.id, activeLabel?.textLines]);
```

When `activeLabelId` changes, explicitly clear the old selection before activating the new label.

- [ ] **Step 4: Apply selected-line style and direction changes in `LabelEditor`**

When `selectedLineIds.length > 0`, skip character-range editing and use the Task 2 function:

```ts
const targetIds = selectedLineIds.length ? selectedLineIds : activeLine ? [activeLine.id] : [];
const updateTargetLines = (patch: TextLinePatch) => {
  onChange({ textLines: updateSelectedTextLines(label.textLines, targetIds, patch) });
};
```

Set the legend/status to `已选 ${selectedLineIds.length} 行`; use `aria-label="所选行方向"` for the orientation select. Line selector buttons call `onSelectLine` and expose `aria-pressed={selectedLineIds.includes(line.id)}`.

- [ ] **Step 5: Apply group selection and movement in `LabelPreview`**

Use `.is-selected-line` for every selected frame and `.is-active-line` only for the active frame. On pointer start, snapshot the dragged line's placement. On pointer move, convert its proposed placement into a delta and call:

```ts
const ids = selectedLineIds.includes(line.id) ? selectedLineIds : [line.id];
onChange({ textLines: moveSelectedTextLines(label.textLines, ids, deltaXPercent, deltaYPercent) });
```

For keyboard movement use the same function. On the content-layer background only, call `onClearLineSelection`; every line, handle, input, and print-area control continues to stop propagation.

- [ ] **Step 6: Add selected-line styling**

```css
.text-line-frame.is-selected-line { z-index: 2; outline: 2px solid var(--color-focus); outline-offset: .24rem; }
.text-line-frame.is-active-line { box-shadow: 0 0 0 3px rgba(11,101,194,.18); }
```

- [ ] **Step 7: Run interaction and SSR tests**

Run: `pnpm test -- tests/multiline-interactions.spec.tsx tests/app.spec.tsx tests/text-lines.spec.ts`

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

```bash
git add src/App.tsx src/features/LabelEditor.tsx src/features/LabelPreview.tsx src/styles.css tests/multiline-interactions.spec.tsx tests/app.spec.tsx
git commit -m "feat: select and move multiple text lines"
```

---

### Task 4: Merge Excel Selection Regions into One Label

**Files:**
- Modify: `src/domain/importing.ts`
- Modify: `src/features/ExcelImporter.tsx`
- Modify: `tests/enhancements.spec.ts`
- Test: `tests/excel-import.spec.ts`

**Interfaces:**
- Replaces: `regionsToLabels(...) => LabelRecord[]`.
- Produces: `regionsToLabel(sheet, ranges, sizePresetId, purpose): LabelRecord | null`.
- Preserves: `rowsToLabelsWithColumns(...) => LabelRecord[]`.

- [ ] **Step 1: Replace the old multi-label expectation with a failing merged-label test**

```ts
it('多个框选区域按创建顺序合并成一条唛头', () => {
  const label = regionsToLabel(sheet, [
    { startRow: 1, startCol: 0, endRow: 2, endCol: 1 },
    { startRow: 3, startCol: 0, endRow: 3, endCol: 1 },
  ], 'small');
  expect(label).toMatchObject({
    content: 'FY-01\nBLUE\nMADE IN CHINA\nFY-02\nRED',
    quantity: 1,
    sides: 1,
    source: 'excel',
  });
});

it('全部框选区域为空时不创建唛头', () => {
  expect(regionsToLabel(sheet, [{ startRow: 99, startCol: 9, endRow: 100, endCol: 10 }], 'small')).toBeNull();
});
```

- [ ] **Step 2: Run and confirm red**

Run: `pnpm test -- tests/enhancements.spec.ts tests/excel-import.spec.ts`

Expected: missing `regionsToLabel` export.

- [ ] **Step 3: Implement the merged region function**

```ts
export function regionsToLabel(sheet: ParsedSheet, ranges: CellRange[], sizePresetId: string, purpose: LabelPurpose = 'carton') {
  const content = ranges.map((range) => extractRegionText(sheet, range)).filter(Boolean).join('\n');
  if (!content) return null;
  return createLabel({
    content,
    contentType: 'text',
    purpose,
    sizePresetId,
    quantity: 1,
    sides: 1,
    source: 'excel',
    needsReview: false,
  });
}
```

- [ ] **Step 4: Update `ExcelImporter` confirmation**

In region mode, call `regionsToLabel`; pass `[label]` to `onImport` only when non-null. Preserve column mode exactly.

```ts
const label = regionsToLabel(activeSheet, regions, sizePresetId, purpose);
if (!label) { setError('框选区域没有可导入内容'); return; }
onImport([label]);
```

- [ ] **Step 5: Run tests and commit**

Run: `pnpm test -- tests/enhancements.spec.ts tests/excel-import.spec.ts`

Expected: PASS.

```bash
git add src/domain/importing.ts src/features/ExcelImporter.tsx tests/enhancements.spec.ts tests/excel-import.spec.ts
git commit -m "feat: merge Excel selections into one label"
```

---

### Task 5: Persist and Restore the Last 20 Previewed Labels

**Files:**
- Create: `src/domain/history.ts`
- Create: `src/features/SourceHistory.tsx`
- Create: `tests/history.spec.ts`
- Modify: `src/domain/draft.ts`
- Modify: `src/domain/storage.ts`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Modify: `tests/draft.spec.ts`
- Modify: `tests/app.spec.tsx`

**Interfaces:**
- Produces: `RecentLabelEntry` and `RecentLabelInput`.
- Produces: `recordRecentLabels(current, inputs, now?): RecentLabelEntry[]`.
- Produces: `restoreRecentLabel(entry): { label: LabelRecord; preset: SizePreset }`.
- Produces: `hydrateRecentLabels(value): RecentLabelEntry[]`.
- Produces: `DraftAction { type: 'record-recent-labels'; entries: RecentLabelInput[]; previewedAt: number }`.

- [ ] **Step 1: Write failing history-domain tests**

Create `tests/history.spec.ts`:

```ts
const historyInput = (content: string): RecentLabelInput => ({
  label: createLabel({ content, quantity: 1, source: 'manual', needsReview: false }),
  preset: { ...defaultSizePresets[0] },
});

it('相同快照去重移到最前，并最多保留 20 条', () => {
  const inputs = Array.from({ length: 21 }, (_, index) => historyInput(`LABEL-${index}`));
  const first = recordRecentLabels([], inputs, 1000);
  expect(first).toHaveLength(20);
  const repeated = recordRecentLabels(first, [historyInput('LABEL-5')], 2000);
  expect(repeated).toHaveLength(20);
  expect(repeated[0].label.content).toBe('LABEL-5');
  expect(repeated.filter((entry) => entry.label.content === 'LABEL-5')).toHaveLength(1);
});

it('再次使用会重建唛头和文字行 ID', () => {
  const entry = recordRecentLabels([], [historyInput('A\nB')], 1000)[0];
  const restored = restoreRecentLabel(entry);
  expect(restored.label.id).not.toBe(entry.label.id);
  expect(restored.label.textLines.map((line) => line.id)).not.toEqual(entry.label.textLines.map((line) => line.id));
  expect(restored.preset).toEqual(entry.preset);
});
```

- [ ] **Step 2: Run and confirm red**

Run: `pnpm test -- tests/history.spec.ts`

Expected: module `src/domain/history.ts` is missing.

- [ ] **Step 3: Implement stable snapshots and hydration**

```ts
export interface RecentLabelInput { label: LabelRecord; preset: SizePreset }
export interface RecentLabelEntry extends RecentLabelInput {
  id: string;
  signature: string;
  previewedAt: number;
}
export const MAX_RECENT_LABELS = 20;

const signatureFor = ({ label, preset }: RecentLabelInput) => JSON.stringify({
  content: label.content, quantity: label.quantity, sides: label.sides,
  purpose: label.purpose, contentType: label.contentType, style: label.style,
  textStyleRanges: label.textStyleRanges, placement: label.placement,
  printArea: label.printArea, textLines: label.textLines.map(({ id: _id, ...line }) => line),
  imageFallback: label.imageFallback,
  size: {
    widthMm: preset.widthMm, heightMm: preset.heightMm, paddingMm: preset.paddingMm,
    maxFontSize: preset.maxFontSize, minFontSize: preset.minFontSize, paperSize: preset.paperSize,
  },
});
```

Deep-clone every nested object. `recordRecentLabels` prepends each new snapshot, filters matching signatures, and slices to 20. `hydrateRecentLabels` accepts only array entries whose label has content/image, whose preset passes `validateSizePreset`, and whose timestamp/signature are valid.

- [ ] **Step 4: Add draft actions and storage hydration**

Add `recentLabels` to `DraftState` and `createInitialDraft`. Add reducer action:

```ts
case 'record-recent-labels':
  return { ...state, recentLabels: recordRecentLabels(state.recentLabels, action.entries, action.previewedAt) };
```

In `hydrateDraft`, set `recentLabels: hydrateRecentLabels((parsed as Partial<DraftState>).recentLabels)` after the `...parsed` spread. Preserve recent labels through `clear-draft` by extending `createInitialDraft(lastPrintedSize, recentLabels)` or copying them after initialization.

- [ ] **Step 5: Add reducer/storage regression tests**

```ts
it('清空草稿保留最近预览历史', () => {
  const state = draftReducer(createInitialDraft(), {
    type: 'record-recent-labels', entries: [historyInput('FY-01')], previewedAt: 1000,
  });
  expect(draftReducer(state, { type: 'clear-draft' }).recentLabels).toHaveLength(1);
});

it('损坏历史条目在读取草稿时被过滤', () => {
  const stored = { ...createInitialDraft(), recentLabels: [{ bad: true }] };
  expect(loadDraft({ getItem: () => JSON.stringify(stored) })?.recentLabels).toEqual([]);
});
```

- [ ] **Step 6: Build `SourceHistory`**

```tsx
interface SourceHistoryProps {
  entries: RecentLabelEntry[];
  onRestore: (entry: RecentLabelEntry) => void;
}

export default function SourceHistory({ entries, onRestore }: SourceHistoryProps) {
  return <section className="source-history" aria-labelledby="source-history-title">
    <div><h3 id="source-history-title">使用过的唛头</h3><p>进入打印预览后自动保存最近 20 条。</p></div>
    {entries.length ? <ol>{entries.map((entry) => <li key={entry.id}>
      <div><strong>{entry.label.content.trim().split(/\r?\n/)[0]}</strong>
        <span>{entry.preset.widthMm} × {entry.preset.heightMm} mm · {entry.label.quantity} 件</span></div>
      <button type="button" onClick={() => onRestore(entry)}>再次使用</button>
    </li>)}</ol> : <div className="source-history-empty"><strong>暂时没有使用记录</strong><span>进入打印预览后会显示在这里。</span></div>}
  </section>;
}
```

- [ ] **Step 7: Record history on preview entry and restore safely**

In `App`, create `recordPrintableLabels(ids?)` from `printPlan.groups.flatMap(group.pages)` and deduplicate label IDs. Dispatch `{ type: 'record-recent-labels', entries, previewedAt: Date.now() }` immediately before setting the print dialog open for both active and global entry points.

For restore:

```ts
const restoreHistoryEntry = (entry: RecentLabelEntry) => {
  const { label, preset } = restoreRecentLabel(entry);
  if (!state.sizePresets.some((candidate) => candidate.id === preset.id)) {
    dispatch({ type: 'add-size-preset', preset });
  }
  dispatch({ type: 'add-label', label });
  setStatus('已从使用记录新增一条唛头');
};
```

- [ ] **Step 8: Run focused tests and commit**

Run: `pnpm test -- tests/history.spec.ts tests/draft.spec.ts tests/app.spec.tsx`

Expected: PASS.

```bash
git add src/domain/history.ts src/features/SourceHistory.tsx src/domain/draft.ts src/domain/storage.ts src/App.tsx src/styles.css tests/history.spec.ts tests/draft.spec.ts tests/app.spec.tsx
git commit -m "feat: remember labels when opening print preview"
```

---

### Task 6: Shrink Only Overflowing Text with a Shared Per-Line Layout

**Files:**
- Create: `src/domain/printRotation.ts`
- Modify: `src/domain/layout.ts`
- Modify: `src/features/StyledText.tsx`
- Modify: `src/features/LabelPreview.tsx`
- Modify: `src/features/PrintPages.tsx`
- Modify: `tests/domain.spec.ts`
- Modify: `tests/app.spec.tsx`

**Interfaces:**
- Produces: `PrintRotation = 0 | 90 | 180 | 270` and `rotationSwapsAxes(rotation): boolean`.
- Extends: `solveLabelTextLayout(label, preset, rotation = 0): LabelLayoutResult`.
- Produces: `ResolvedLineLayout { fontSizePt: number; fontScale: number }` keyed by line ID.
- Extends: `StyledTextLine` with `fontScale?: number`.

- [ ] **Step 1: Write failing layout tests for upper-bound behavior**

```ts
it('短内容保留用户字号，长内容只缩小到最大可用字号', () => {
  const short = createLabel({ content: 'FY', quantity: 1, source: 'manual', needsReview: false });
  short.style.fontSizePt = 48;
  const shortLayout = solveLabelTextLayout(short, defaultSizePresets[0]);
  expect(shortLayout.ok && shortLayout.lineLayouts[short.textLines[0].id].fontSizePt).toBe(48);

  const long = createLabel({ content: 'VERY-LONG-SHIPPING-MARK-1234567890', quantity: 1, source: 'manual', needsReview: false });
  long.style.fontSizePt = 48;
  const longLayout = solveLabelTextLayout(long, defaultSizePresets[1]);
  expect(longLayout.ok).toBe(true);
  expect(longLayout.ok && longLayout.lineLayouts[long.textLines[0].id].fontSizePt).toBeLessThan(48);
});

it('局部字符字号按同一比例缩小', () => {
  const label = createLabel({ content: 'LONG-LONG-LONG', quantity: 1, source: 'manual', needsReview: false });
  label.style.fontSizePt = 40;
  label.textStyleRanges = [{ start: 0, end: 4, style: { fontSizePt: 60 } }];
  const result = solveLabelTextLayout(label, defaultSizePresets[1]);
  expect(result.ok && result.lineLayouts[label.textLines[0].id].fontScale).toBeLessThanOrEqual(1);
});
```

- [ ] **Step 2: Run and confirm red**

Run: `pnpm test -- tests/domain.spec.ts`

Expected: `lineLayouts` is absent and fixed long content still fails.

- [ ] **Step 3: Refactor line measurement to use a scale**

Create the rotation type before changing the solver:

```ts
export type PrintRotation = 0 | 90 | 180 | 270;
export const rotationSwapsAxes = (rotation: PrintRotation) => rotation === 90 || rotation === 270;
```

```ts
export interface ResolvedLineLayout { fontSizePt: number; fontScale: number }
export type LabelLayoutResult =
  | { ok: true; fontSize: number; lineLayouts: Record<string, ResolvedLineLayout>; lines: string[] }
  | { ok: false; error: string; fontSize?: number; lineLayouts?: Record<string, ResolvedLineLayout> };

const requestedLineSize = (label: LabelRecord, line: LabelTextLine) => line.style.fontSizePt ?? label.style.fontSizePt;
```

Change segment measurement to multiply both line-level and character-range sizes by `fontScale`. For each non-empty line, search from its requested size down to `preset.minFontSize`; choose the first candidate whose rotated rectangle fits the available bounds. Use the resulting per-line rectangles for overlap validation.

- [ ] **Step 4: Make renderers consume `fontScale`**

Extend `StyledTextLine`:

```tsx
export function StyledTextLine({ label, line, lineIndex, previewScale, fontScale = 1 }: Props) {
  // ...
  const explicitSize = segment.style.fontSizePt;
  const fontSize = explicitSize ? explicitSize * fontScale : undefined;
  // render pt for print or px for screen exactly as today
}
```

For the line wrapper, set its base size to `lineLayout.fontSizePt`. Pass `fontScale` to every `StyledTextLine` in both preview and print.

- [ ] **Step 5: Add shared-rendering SSR assertions**

Create a long label and assert both `LabelPreview` and `PrintPages` contain the same resolved numeric font size rather than the original upper bound.

- [ ] **Step 6: Run focused tests and commit**

Run: `pnpm test -- tests/domain.spec.ts tests/app.spec.tsx tests/printing.spec.ts`

Expected: PASS.

```bash
git add src/domain/printRotation.ts src/domain/layout.ts src/features/StyledText.tsx src/features/LabelPreview.tsx src/features/PrintPages.tsx tests/domain.spec.ts tests/app.spec.tsx tests/printing.spec.ts
git commit -m "feat: shrink only overflowing label text"
```

---

### Task 7: Add Cyclic Text Rotation to Print Preview and Output

**Files:**
- Modify: `src/domain/printRotation.ts`
- Create: `src/features/PrintLabelThumbnail.tsx`
- Create: `tests/print-rotation.spec.tsx`
- Modify: `src/features/PrintReviewDialog.tsx`
- Modify: `src/features/PrintPages.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Modify: `tests/app.spec.tsx`

**Interfaces:**
- Consumes: `PrintRotation` and `rotationSwapsAxes` from Task 6.
- Produces: `nextPrintRotation(rotation): PrintRotation`.
- Produces: `rotationTransform(placement, rotation): string`.
- Extends: `PrintReviewDialogProps.rotations` and `onRotateLabel(id)`.
- Extends: `PrintPagesProps.rotations`.

- [ ] **Step 1: Write failing pure and component tests**

Create `tests/print-rotation.spec.tsx`:

```tsx
const centerPlacement: TextPlacement = {
  xPercent: 50, yPercent: 50, horizontalSnap: 'center', verticalSnap: 'middle',
};
const textLabel = (content: string) => createLabel({
  content, quantity: 1, source: 'manual', needsReview: false,
});

it('按 90 度循环并保持纸张尺寸不变', () => {
  expect([0, 90, 180, 270, 0].slice(1)).toEqual([
    nextPrintRotation(0), nextPrintRotation(90), nextPrintRotation(180), nextPrintRotation(270),
  ]);
  expect(rotationTransform(centerPlacement, 90)).toBe('translate(-50%, -50%) rotate(90deg)');
});

it('打印预览为每个文字唛头显示旋转按钮和角度', () => {
  const plan = createPrintPlan([textLabel('A')], defaultSizePresets);
  const html = renderToStaticMarkup(<PrintReviewDialog open plan={plan} rotations={{ [plan.groups[0].pages[0].label.id]: 90 }}
    onRotateLabel={() => undefined} onClose={() => undefined} onEditLabel={() => undefined} onPrintGroup={() => undefined} />);
  expect(html).toContain('旋转 90°');
  expect(html).toContain('当前 90°');
});

it('实际打印旋转文字但不交换纸张宽高', () => {
  const group = createPrintPlan([textLabel('A')], defaultSizePresets).groups[0];
  const id = group.pages[0].label.id;
  const html = renderToStaticMarkup(<PrintPages group={group} rotations={{ [id]: 90 }} />);
  expect(html).toContain(`@page { size: ${group.widthMm}mm ${group.heightMm}mm; margin: 0; }`);
  expect(html).toContain('rotate(90deg)');
});
```

- [ ] **Step 2: Run and confirm red**

Run: `pnpm test -- tests/print-rotation.spec.tsx`

Expected: missing module, props, and button.

- [ ] **Step 3: Implement rotation primitives**

```ts
export const nextPrintRotation = (value: PrintRotation): PrintRotation => ((value + 90) % 360) as PrintRotation;
const placementTranslate = (placement: TextPlacement): string =>
  `translate(${placement.xPercent}%, ${placement.yPercent}%) translate(-50%, -50%)`;
export function rotationTransform(placement: TextPlacement, rotation: PrintRotation) {
  return `${placementTranslate(placement)} rotate(${rotation}deg)`;
}
```

Move the duplicate placement-transform logic from `LabelPreview`/`PrintPages` into this focused domain file and have both consumers call the same exported transform helper.

- [ ] **Step 4: Add transient rotations in `App`**

```ts
const [printRotations, setPrintRotations] = useState<Record<string, PrintRotation>>({});
const rotatePrintedLabel = (id: string) => setPrintRotations((current) => ({
  ...current,
  [id]: nextPrintRotation(current[id] ?? 0),
}));
const closePrintDialog = useCallback(() => {
  setPrintDialogOpen(false);
  setPrintRotations({});
}, []);
```

Pass rotations to `PrintReviewDialog` and `PrintPages`. Keep history snapshots independent of these values.

- [ ] **Step 5: Build thumbnails and rotation controls**

`PrintLabelThumbnail` consumes `{ label, preset, rotation }`, calls `solveLabelTextLayout(label, preset, rotation)`, and renders the same line transforms and scales as `PrintPages` inside a scaled fixed-aspect preview.

In each print group, deduplicate pages by label ID and render one thumbnail/control row per label:

```tsx
<button type="button" onClick={() => onRotateLabel(label.id)}>
  旋转 90°
</button>
<span>当前 {rotation}°</span>
```

Do not show the button for `contentType === 'image'`.

- [ ] **Step 6: Apply rotation to print lines and block rotated overflow**

Pass the rotation into `solveLabelTextLayout`. Append `rotate(Ndeg)` after the existing translate for each text line. If a rotated label layout is invalid, show its error beside the thumbnail and disable that group's print button until all unique labels in the group are valid.

Keep the dynamic paper rule unchanged:

```tsx
<style media="print">{`
  @page { size: ${group.widthMm}mm ${group.heightMm}mm; margin: 0; }
  .app-shell, .dialog-backdrop { display: none !important; }
  .print-root { position: static !important; }
`}</style>
```

- [ ] **Step 7: Update print guidance and responsive styles**

Add: “在这里旋转文字；系统打印窗口保持所示自定义纸张方向，不要交换宽高。” Ensure thumbnail rows stack below 720px.

- [ ] **Step 8: Run focused tests and commit**

Run: `pnpm test -- tests/print-rotation.spec.tsx tests/app.spec.tsx tests/printing.spec.ts`

Expected: PASS.

```bash
git add src/domain/printRotation.ts src/features/PrintLabelThumbnail.tsx src/features/PrintReviewDialog.tsx src/features/PrintPages.tsx src/App.tsx src/styles.css tests/print-rotation.spec.tsx tests/app.spec.tsx tests/printing.spec.ts
git commit -m "feat: rotate printed text from preview"
```

---

### Task 8: Full Integration, Accessibility, and Browser Verification

**Files:**
- Modify: `DESIGN.md`
- Modify: `UX-CONTRACT.md`
- Modify: `premium-ui.json`
- Modify: `tests/app.spec.tsx`

**Interfaces:**
- Consumes every completed task.
- Produces no new runtime API; produces release evidence and synchronized design documentation.

- [ ] **Step 1: Add end-to-end component assertions for the complete workflow**

Cover the integrated state boundaries:

```tsx
it('合法的旧待校对唛头可进入预览并写入历史', async () => {
  const user = userEvent.setup();
  render(<App initialState={stateWithLegacyReviewLabel()} />);
  await user.click(screen.getByRole('button', { name: '打印预览' }));
  expect(screen.getByRole('dialog', { name: /可以打印/ })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: '关闭' }));
  expect(screen.getByText('使用过的唛头')).toBeTruthy();
  expect(screen.getByRole('button', { name: '再次使用' })).toBeTruthy();
});
```

Also assert that changing list quantity updates total copies in the next preview, and that rotation clears after closing/reopening.

- [ ] **Step 2: Run the complete automated suite**

Run: `pnpm test`

Expected: all test files and all tests pass with zero failures.

- [ ] **Step 3: Run typecheck and production build**

Run: `pnpm run build`

Expected: TypeScript exits 0 and Vite emits `dist/`. The existing bundle-size warning may remain informational; no new build errors are allowed.

- [ ] **Step 4: Update durable design documentation**

Document these exact contracts in `DESIGN.md` and `UX-CONTRACT.md`:

- inline quantity stepper location and boundaries;
- additive line selection and blank-area clearing;
- recent-20 preview history and restore behavior;
- fixed paper direction plus transient `0/90/180/270` text rotation;
- fixed font sizes as upper bounds with shrink-only overflow handling.

Update `premium-ui.json` ownership/evidence paths for the new application-owned stepper, multiline controls, history list, and print rotation controls.

- [ ] **Step 5: Run static UI and design-context audits**

Run:

```powershell
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' 'C:\Users\Administrator\.codex\plugins\cache\openai-curated-remote\frontend-design-premium\1.4.0\skills\frontend-design-premium\scripts\audit_project.py' . --mode strict --no-write
pnpm dlx @google/design.md designmd lint DESIGN.md
```

Expected: strict audit reports zero findings; DESIGN.md lint exits 0.

- [ ] **Step 6: Start the local production-equivalent app and perform browser QA**

Run: `pnpm run dev -- --host 127.0.0.1`

In the in-app browser, verify at desktop size:

1. quantity +/− and direct entry update the list and print total;
2. clicking lines 1 and 2 selects both, dragging keeps their gap, clicking blank clears selection;
3. an old `needsReview: true` label opens print preview if otherwise valid;
4. two Excel regions import as one label with ordered newline content;
5. opening preview records history immediately and “再次使用” creates a new editable copy;
6. 21 distinct previews retain only the newest 20;
7. long content shrinks while short content keeps the selected font size;
8. print rotation cycles through all four angles, thumbnail and print DOM match, and paper dimensions do not change.

Repeat layout checks at a 390 × 844 viewport. Inspect console errors after interactions and reload once to verify quantity/history persistence.

- [ ] **Step 7: Run final repository checks**

Run:

```bash
git diff --check
git status --short
```

Expected: `git diff --check` has no errors; only intentional documentation/test/source changes are present before the final commit.

- [ ] **Step 8: Commit Task 8**

```bash
git add DESIGN.md UX-CONTRACT.md premium-ui.json tests/app.spec.tsx
git commit -m "docs: record print workflow interaction contracts"
```

- [ ] **Step 9: Request independent code review before integration**

Review the full range from `a94acb7` through `HEAD`. The reviewer must check every requirement in the spec, inspect storage migration and print-CSS risk, and report Critical/Important/Minor findings with file and line references. Resolve findings with focused regression tests before claiming completion.
