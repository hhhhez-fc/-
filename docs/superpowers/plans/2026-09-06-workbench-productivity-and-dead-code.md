# Workbench Productivity and Dead-Code Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add record search, undo/redo, application-local record copy/cut/paste, discoverable keyboard shortcuts, and remove only confirmed runtime-dead compatibility wrappers without regressing the current print workflow.

**Architecture:** Keep the current `codex/print-workflow-improvements` branch and `DraftState` as the source of truth. Add small pure domain modules for search, history, clipboard, and shortcut resolution; `App.tsx` coordinates them through one action submission path while existing printing, recent-history, font-size, quantity, and workspace modules remain authoritative.

**Tech Stack:** React 19, TypeScript 7, Vite 8, Vitest 4, Testing Library, jsdom, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-06-workbench-productivity-and-dead-code-design.md`

## Global Constraints

- Use `D:\Codex\唛头打印\.worktrees\deploy-browser-comments` as the isolated working tree; do not develop from the stale repository root.
- Do not merge `deploy/github-cloudflare`; selectively adapt code and tests to the current branch.
- Preserve print rotation, font-size preview, quantity stepper, recent-label history, local persistence, and workspace behavior.
- Search matches only `LabelRecord.content`, is case-insensitive, and never changes the print plan.
- Copy/cut/paste uses an in-application structured clipboard and never requests system clipboard permission.
- Windows/Linux uses `Ctrl`; macOS uses `Command`; native text-field editing shortcuts must not be intercepted.
- Keep undo history to the latest 100 recorded transitions.
- Do not delete persisted compatibility fields such as `stylePresets`, `recentSizes`, `verticalAlign`, or `paperSize`.
- Do not push or deploy automatically.

---

### Task 1: Add atomic record-list actions to the draft reducer

**Files:**
- Modify: `src/domain/draft.ts` (`DraftAction` and `draftReducer` record-list cases)
- Modify: `tests/draft.spec.ts`

**Interfaces:**
- Consumes: existing `DraftState`, `DraftAction`, and `LabelRecord`.
- Produces: `DraftAction` variants `insert-labels`, `move-labels`, and `delete-labels` for clipboard and one-step bulk history operations.

- [ ] **Step 1: Write failing reducer tests**

Add focused cases to `tests/draft.spec.ts`:

```ts
it('inserts labels after the active record and selects the inserted records', () => {
  const first = createLabel({ content: 'A', quantity: 1, source: 'manual', needsReview: false });
  const second = createLabel({ content: 'B', quantity: 1, source: 'manual', needsReview: false });
  const pasted = createLabel({ content: 'COPY', quantity: 1, source: 'manual', needsReview: false });
  const state = { ...createInitialDraft(), labels: [first, second], activeLabelId: first.id };

  const next = draftReducer(state, { type: 'insert-labels', labels: [pasted], afterId: first.id });

  expect(next.labels.map(({ content }) => content)).toEqual(['A', 'COPY', 'B']);
  expect(next.activeLabelId).toBe(pasted.id);
  expect(next.selectedLabelIds).toEqual([pasted.id]);
});

it('moves several labels as one ordered block and rejects an invalid destination', () => {
  const labels = ['A', 'B', 'C'].map((content) => createLabel({ content, quantity: 1, source: 'manual', needsReview: false }));
  const state = { ...createInitialDraft(), labels, activeLabelId: labels[2].id };

  const moved = draftReducer(state, { type: 'move-labels', ids: [labels[0].id, labels[1].id], afterId: labels[2].id });
  expect(moved.labels.map(({ content }) => content)).toEqual(['C', 'A', 'B']);
  expect(moved.selectedLabelIds).toEqual([labels[0].id, labels[1].id]);
  expect(draftReducer(state, { type: 'move-labels', ids: [labels[0].id], afterId: labels[0].id })).toBe(state);
});

it('deletes selected records atomically and chooses the nearest active record', () => {
  const labels = ['A', 'B', 'C'].map((content) => createLabel({ content, quantity: 1, source: 'manual', needsReview: false }));
  const state = { ...createInitialDraft(), labels, activeLabelId: labels[1].id, selectedLabelIds: [labels[0].id, labels[1].id] };

  const next = draftReducer(state, { type: 'delete-labels', ids: [labels[0].id, labels[1].id] });
  expect(next.labels).toEqual([labels[2]]);
  expect(next.activeLabelId).toBe(labels[2].id);
  expect(next.selectedLabelIds).toEqual([]);
});
```

- [ ] **Step 2: Run the reducer tests and confirm the new actions fail to type-check**

Run: `pnpm vitest run tests/draft.spec.ts`

Expected: FAIL because the three `DraftAction` variants do not exist.

- [ ] **Step 3: Implement the three reducer actions**

Extend `DraftAction` and add cases before `delete-label`:

```ts
| { type: 'insert-labels'; labels: LabelRecord[]; afterId: string | null }
| { type: 'move-labels'; ids: string[]; afterId: string | null }
| { type: 'delete-labels'; ids: string[] }
```

```ts
case 'insert-labels': {
  if (action.labels.length === 0) return state;
  const labels = [...state.labels];
  const afterIndex = action.afterId === null
    ? labels.length - 1
    : labels.findIndex(({ id }) => id === action.afterId);
  labels.splice(afterIndex < 0 ? labels.length : afterIndex + 1, 0, ...action.labels);
  const insertedIds = action.labels.map(({ id }) => id);
  return { ...state, labels, activeLabelId: insertedIds[0], selectedLabelIds: insertedIds };
}
case 'move-labels': {
  const movingIds = new Set(action.ids);
  const moving = state.labels.filter(({ id }) => movingIds.has(id));
  if (moving.length === 0 || moving.length !== movingIds.size) return state;
  if (action.afterId && movingIds.has(action.afterId)) return state;
  const remaining = state.labels.filter(({ id }) => !movingIds.has(id));
  const afterIndex = action.afterId === null
    ? remaining.length - 1
    : remaining.findIndex(({ id }) => id === action.afterId);
  remaining.splice(afterIndex < 0 ? remaining.length : afterIndex + 1, 0, ...moving);
  return { ...state, labels: remaining, activeLabelId: moving[0].id, selectedLabelIds: moving.map(({ id }) => id) };
}
case 'delete-labels': {
  const ids = new Set(action.ids);
  const firstRemovedIndex = state.labels.findIndex(({ id }) => ids.has(id));
  if (firstRemovedIndex < 0) return state;
  const labels = state.labels.filter(({ id }) => !ids.has(id));
  return {
    ...state,
    labels,
    activeLabelId: state.activeLabelId && ids.has(state.activeLabelId)
      ? labels[Math.min(firstRemovedIndex, labels.length - 1)]?.id ?? null
      : state.activeLabelId,
    selectedLabelIds: state.selectedLabelIds.filter((id) => !ids.has(id)),
  };
}
case 'delete-label':
  return draftReducer(state, { type: 'delete-labels', ids: [action.id] });
```

- [ ] **Step 4: Run the reducer suite**

Run: `pnpm vitest run tests/draft.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit the atomic actions**

```bash
git add src/domain/draft.ts tests/draft.spec.ts
git commit -m "feat: add atomic record list actions"
```

---

### Task 2: Add pure record search and the search control

**Files:**
- Create: `src/domain/labelSearch.ts`
- Create: `src/features/RecordSearch.tsx`
- Create: `tests/label-search.spec.ts`
- Modify: `src/App.tsx` (records panel search state and filtered list)
- Modify: `src/styles.css` (search and empty-result styles)
- Modify: `tests/app.spec.tsx`

**Interfaces:**
- Consumes: `LabelRecord[]` and a user-entered query.
- Produces: `filterLabelsByQuery(labels: LabelRecord[], query: string): LabelRecord[]` and a controlled `RecordSearch` component with a forwarded input ref.

- [ ] **Step 1: Write the failing search-domain test**

Create `tests/label-search.spec.ts`:

```ts
import { expect, it } from 'vitest';
import { createLabel } from '../src/domain/labels';
import { filterLabelsByQuery } from '../src/domain/labelSearch';

it('matches content without case sensitivity and returns all labels for blank input', () => {
  const labels = [
    createLabel({ content: 'AREEN-21', quantity: 1, source: 'manual', needsReview: false }),
    createLabel({ content: 'BOX-9', quantity: 1, source: 'manual', needsReview: false }),
  ];
  expect(filterLabelsByQuery(labels, ' areen ')).toEqual([labels[0]]);
  expect(filterLabelsByQuery(labels, '  ')).toBe(labels);
  expect(labels.map(({ content }) => content)).toEqual(['AREEN-21', 'BOX-9']);
});
```

- [ ] **Step 2: Run it and confirm the module is missing**

Run: `pnpm vitest run tests/label-search.spec.ts`

Expected: FAIL with module-not-found for `labelSearch`.

- [ ] **Step 3: Implement the pure filter**

Create `src/domain/labelSearch.ts`:

```ts
import type { LabelRecord } from './labels';

export function filterLabelsByQuery(labels: LabelRecord[], query: string): LabelRecord[] {
  const normalized = query.trim().toLocaleLowerCase();
  return normalized
    ? labels.filter(({ content }) => content.toLocaleLowerCase().includes(normalized))
    : labels;
}
```

- [ ] **Step 4: Run the search-domain test**

Run: `pnpm vitest run tests/label-search.spec.ts`

Expected: PASS.

- [ ] **Step 5: Write the failing component/integration test**

Add to `tests/app.spec.tsx`:

```tsx
it('filters the record list, reports the count, and clears the query without changing draft state', async () => {
  const user = userEvent.setup();
  const first = createLabel({ content: 'AREEN-21', quantity: 1, source: 'manual', needsReview: false });
  const second = createLabel({ content: 'BOX-9', quantity: 1, source: 'manual', needsReview: false });
  const { container } = render(<App initialState={{ ...createInitialDraft(), labels: [first, second], activeLabelId: first.id }} />);

  await user.type(screen.getByRole('searchbox', { name: '搜索唛头' }), 'box');
  expect(container.querySelector('.label-list')?.textContent).not.toContain('AREEN-21');
  expect(container.querySelector('.label-list')?.textContent).toContain('BOX-9');
  expect(screen.getByText('1 / 2 条')).toBeTruthy();

  await user.click(screen.getByRole('button', { name: '清空搜索' }));
  expect(container.querySelector('.label-list')?.textContent).toContain('AREEN-21');
  expect(container.querySelector('.label-list')?.textContent).toContain('BOX-9');
  expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: '搜索唛头' }));
});
```

- [ ] **Step 6: Add `RecordSearch` and integrate filtered rendering**

Create `src/features/RecordSearch.tsx` with these exact props:

```ts
interface RecordSearchProps {
  query: string;
  resultCount: number;
  totalCount: number;
  inputRef: RefObject<HTMLInputElement | null>;
  onChange: (query: string) => void;
  onClear: () => void;
}
```

Render a `<div role="search">`, a labeled `<input type="search">`, `resultCount / totalCount`, and a `清空` button whose `aria-label` is `清空搜索`. In `App.tsx`, add `searchQuery`, `searchInputRef`, and:

```ts
const visibleLabels = useMemo(
  () => filterLabelsByQuery(state.labels, searchQuery),
  [searchQuery, state.labels],
);
```

Pass `visibleLabels` only to `LabelList`; keep `createPrintPlan(state.labels, ...)` unchanged. When `visibleLabels` is empty and `state.labels` is not, render `没有匹配的唛头` below the search control.

- [ ] **Step 7: Add compact responsive styles and rerun focused tests**

Add `.record-search` styles using existing color, spacing, radius, and typography variables; add a `max-width: 720px` rule that puts the label on its own row.

Run: `pnpm vitest run tests/label-search.spec.ts tests/app.spec.tsx`

Expected: PASS.

- [ ] **Step 8: Commit search**

```bash
git add src/domain/labelSearch.ts src/features/RecordSearch.tsx src/App.tsx src/styles.css tests/label-search.spec.ts tests/app.spec.tsx
git commit -m "feat: add record search"
```

---

### Task 3: Add bounded draft history and route App edits through it

**Files:**
- Create: `src/domain/draftHistory.ts`
- Create: `tests/draft-history.spec.ts`
- Modify: `src/App.tsx` (history reducer, unified apply function, buttons, statuses)
- Modify: `tests/app.spec.tsx`

**Interfaces:**
- Consumes: `DraftState`, one or more `DraftAction`s, a description, and a `record` flag.
- Produces: `createDraftHistory`, `draftHistoryReducer`, `canUndo`, and `canRedo`.

- [ ] **Step 1: Write failing history-domain tests**

Create `tests/draft-history.spec.ts` covering one-step undo/redo, grouped actions, synchronized non-history state, the 100-step bound, and redo invalidation:

```ts
const changed = draftHistoryReducer(createDraftHistory(createInitialDraft()), {
  type: 'apply',
  actions: [{ type: 'set-business', business: '义乌铺' }],
  description: '修改业务类型',
  record: true,
});
expect(draftHistoryReducer(changed, { type: 'undo' }).present.business).toBe('');
expect(draftHistoryReducer(draftHistoryReducer(changed, { type: 'undo' }), { type: 'redo' }).present.business).toBe('义乌铺');
```

For the non-history case, record a quantity change, apply `set-selected` with `record: false`, undo, and assert the selection remains. For the bound, apply 101 unique business values and assert `past` has length 100. After undo, apply a new recorded purpose change and assert `future` is empty.

- [ ] **Step 2: Run it and confirm the module is missing**

Run: `pnpm vitest run tests/draft-history.spec.ts`

Expected: FAIL with module-not-found for `draftHistory`.

- [ ] **Step 3: Implement the history reducer**

Create `src/domain/draftHistory.ts`:

```ts
import { draftReducer, type DraftAction, type DraftState } from './draft';

interface HistorySnapshot { state: DraftState; description: string }
export interface DraftHistoryState {
  past: HistorySnapshot[];
  present: DraftState;
  future: HistorySnapshot[];
  lastTransition: null | { kind: 'apply' | 'undo' | 'redo'; description: string };
}
export type DraftHistoryEvent =
  | { type: 'apply'; actions: DraftAction[]; description: string; record: boolean }
  | { type: 'undo' }
  | { type: 'redo' };

export const createDraftHistory = (present: DraftState): DraftHistoryState => ({
  past: [], present, future: [], lastTransition: null,
});
```

Implement `apply` by reducing all actions through `draftReducer`. If the final state is referentially equal to the current state, return the history unchanged. For `record: false`, apply the same actions to `past[].state` and `future[].state`. For recorded edits, append `{ state: history.present, description }`, slice to `-100`, and clear `future`. Implement undo/redo by moving one snapshot between arrays. Export:

```ts
export const canUndo = (history: DraftHistoryState) => history.past.length > 0;
export const canRedo = (history: DraftHistoryState) => history.future.length > 0;
```

- [ ] **Step 4: Run the history-domain tests**

Run: `pnpm vitest run tests/draft-history.spec.ts`

Expected: PASS.

- [ ] **Step 5: Write a failing App undo/redo test**

Add to `tests/app.spec.tsx`:

```tsx
it('undoes and redoes one manual-label addition from accessible header buttons', async () => {
  const user = userEvent.setup();
  render(<App initialState={createInitialDraft()} />);
  const undo = screen.getByRole('button', { name: '撤销上一步，Ctrl+Z' });
  const redo = screen.getByRole('button', { name: '重做上一步，Ctrl+Y' });
  expect((undo as HTMLButtonElement).disabled).toBe(true);

  await user.click(screen.getByRole('button', { name: '手动新增' }));
  await user.click(undo);
  expect(screen.getByText('已撤销：新增手动唛头')).toBeTruthy();
  await user.click(redo);
  expect(screen.getByText('已重做：新增手动唛头')).toBeTruthy();
});
```

- [ ] **Step 6: Replace the root draft reducer with history state**

In `App.tsx`, initialize history from the same recovered draft and expose `const state = history.present`. Add:

```ts
const applyDraft = useCallback((
  actions: DraftAction | DraftAction[],
  description: string,
  record = true,
) => {
  historyDispatch({
    type: 'apply',
    actions: Array.isArray(actions) ? actions : [actions],
    description,
    record,
  });
}, []);
```

Route every current `dispatch` call through `applyDraft`. Group coupled changes such as “ensure preset, then add/import/restore label” in one `DraftAction[]`. Use `record: false` for `set-active-label`, `toggle-selected`, `set-selected`, `record-recent-labels`, `remember-printed-size`, and any update whose purpose is only auxiliary history/persistence state. Keep actual label, business, purpose, preset, delete, import, and workspace-layout edits recorded.

Add header buttons with the exact accessible names from the test. `undoDraft()` and `redoDraft()` read the transition description before dispatch and set `已撤销：…` / `已重做：…` status. Update destructive dialog copy from “无法撤销” to wording that states it can be undone.

- [ ] **Step 7: Run history and App tests**

Run: `pnpm vitest run tests/draft-history.spec.ts tests/app.spec.tsx`

Expected: PASS.

- [ ] **Step 8: Commit history integration**

```bash
git add src/domain/draftHistory.ts src/App.tsx tests/draft-history.spec.ts tests/app.spec.tsx
git commit -m "feat: add undo and redo history"
```

---

### Task 4: Add the application-local record clipboard

**Files:**
- Create: `src/domain/workspaceClipboard.ts`
- Create: `tests/workspace-clipboard.spec.ts`
- Modify: `src/App.tsx` (clipboard state and commands)
- Modify: `src/features/LabelList.tsx` (pending-cut indicator)
- Modify: `src/styles.css`
- Modify: `tests/app.spec.tsx`

**Interfaces:**
- Consumes: `DraftState`, target IDs, clipboard mode, and an ID factory.
- Produces: `WorkspaceClipboard`, `createWorkspaceClipboard`, and `buildPasteAction` returning one atomic `DraftAction` plus pasted IDs.

- [ ] **Step 1: Write failing clipboard-domain tests**

Create `tests/workspace-clipboard.spec.ts`:

```ts
it('copy-paste creates unique IDs and independent nested records', () => {
  const label = createLabel({ content: 'A', quantity: 1, source: 'manual', needsReview: false });
  const state = { ...createInitialDraft(), labels: [label], activeLabelId: label.id };
  const clipboard = createWorkspaceClipboard(state, [label.id], 'copy');
  const result = buildPasteAction(state, clipboard, () => 'new-id');
  expect(result?.pastedIds).toEqual(['new-id']);
  if (result?.action.type === 'insert-labels') {
    expect(result.action.labels[0].textLines).not.toBe(label.textLines);
    expect(result.action.labels[0].textLines[0].style).not.toBe(label.textLines[0].style);
  }

  let sequence = 0;
  const nextId = () => `new-id-${sequence += 1}`;
  expect(buildPasteAction(state, clipboard, nextId)?.pastedIds).toEqual(['new-id-1']);
  expect(buildPasteAction(state, clipboard, nextId)?.pastedIds).toEqual(['new-id-2']);
});

it('cut creates one move action and rejects missing source records', () => {
  const label = createLabel({ content: 'A', quantity: 1, source: 'manual', needsReview: false });
  const source = { ...createInitialDraft(), labels: [label], activeLabelId: null };
  const clipboard = createWorkspaceClipboard(source, [label.id], 'cut');
  expect(buildPasteAction(source, clipboard, crypto.randomUUID)?.action).toMatchObject({ type: 'move-labels', ids: [label.id] });
  expect(buildPasteAction(createInitialDraft(), clipboard, crypto.randomUUID)).toBeNull();
});
```

- [ ] **Step 2: Run it and confirm the clipboard module is missing**

Run: `pnpm vitest run tests/workspace-clipboard.spec.ts`

Expected: FAIL with module-not-found for `workspaceClipboard`.

- [ ] **Step 3: Implement safe structured cloning and paste action creation**

Create `src/domain/workspaceClipboard.ts` with:

```ts
export type ClipboardMode = 'copy' | 'cut';
export interface WorkspaceClipboard {
  mode: ClipboardMode;
  sourceIds: string[];
  labels: LabelRecord[];
}
```

Implement a private `cloneLabelRecord(label, id = label.id)` that clones `style`, every `textStyleRanges[].style`, `placement`, optional `printArea`, and every `textLines[]` entry with its `placement` and `style`. When a new ID is supplied, set `needsReview: true` and `reviewReason: '复制后请确认内容和数量'`.

`createWorkspaceClipboard` preserves current list order, ignores missing IDs, and returns `null` when no record matches. `buildPasteAction` returns:

```ts
{ action: { type: 'insert-labels', labels, afterId: state.activeLabelId }, pastedIds }
```

for copy mode, and:

```ts
{ action: { type: 'move-labels', ids: clipboard.sourceIds, afterId: state.activeLabelId }, pastedIds: clipboard.sourceIds }
```

for cut mode only when every source still exists and the destination is not one of the cut records.

- [ ] **Step 4: Run clipboard-domain tests**

Run: `pnpm vitest run tests/workspace-clipboard.spec.ts tests/draft.spec.ts`

Expected: PASS.

- [ ] **Step 5: Write failing App clipboard tests**

Add these Testing Library cases to `tests/app.spec.tsx`:

```tsx
it('copies and repeatedly pastes an independent selected record', async () => {
  const user = userEvent.setup();
  const label = createLabel({ content: 'COPY-ME', quantity: 1, source: 'manual', needsReview: false });
  const { container } = render(<App initialState={{ ...createInitialDraft(), labels: [label], activeLabelId: label.id, selectedLabelIds: [label.id] }} />);

  await user.click(screen.getByRole('button', { name: '复制所选' }));
  expect((screen.getByRole('button', { name: '撤销上一步，Ctrl+Z' }) as HTMLButtonElement).disabled).toBe(true);
  await user.click(screen.getByRole('button', { name: '粘贴' }));
  await user.click(screen.getByRole('button', { name: '粘贴' }));

  expect(screen.getByText('已粘贴 1 条唛头')).toBeTruthy();
  expect(Array.from(container.querySelectorAll('.label-row-copy strong'), (node) => node.textContent)).toEqual([
    'COPY-ME', 'COPY-ME', 'COPY-ME',
  ]);
});

it('marks a pending cut, moves it after the active destination, and undoes the move', async () => {
  const user = userEvent.setup();
  const labels = ['A', 'B', 'C'].map((content) => createLabel({ content, quantity: 1, source: 'manual', needsReview: false }));
  const { container } = render(<App initialState={{
    ...createInitialDraft(), labels, activeLabelId: labels[2].id, selectedLabelIds: [labels[0].id],
  }} />);

  await user.click(screen.getByRole('button', { name: '剪切所选' }));
  expect(screen.getByText('待剪切')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: /^03\s+C\s/ }));
  await user.click(screen.getByRole('button', { name: '粘贴' }));
  expect(screen.getByText('已移动 1 条唛头')).toBeTruthy();
  expect(Array.from(container.querySelectorAll('.label-row-copy strong'), (node) => node.textContent)).toEqual(['B', 'C', 'A']);

  await user.click(screen.getByRole('button', { name: '撤销上一步，Ctrl+Z' }));
  expect(Array.from(container.querySelectorAll('.label-row-copy strong'), (node) => node.textContent)).toEqual(['A', 'B', 'C']);
});
```

- [ ] **Step 6: Integrate clipboard state, toolbar commands, and cut feedback**

In `App.tsx` add `clipboard: WorkspaceClipboard | null`. The target resolver is exact:

```ts
const clipboardTargetIds = () => state.selectedLabelIds.length > 0
  ? state.selectedLabelIds
  : state.activeLabelId ? [state.activeLabelId] : [];
```

Add `copyOrCut(mode)` and `paste()` callbacks that use the domain functions, `crypto.randomUUID`, and `applyDraft`. Copy and entering cut mode are not recorded; paste/move is one recorded transition. Clear cut mode after a successful move. Add toolbar buttons `复制所选`, `剪切所选`, and `粘贴`, with disabled states based on targets/clipboard.

Extend `LabelListProps` with `cutLabelIds?: string[]`, add `data-cut="true"` and visible text `待剪切` to matching rows, while preserving `QuantityStepper`. Add `.label-list-item[data-cut="true"]` and `.cut-status` styles using `--color-warning` without lowering text opacity.

- [ ] **Step 7: Run focused clipboard integration tests**

Run: `pnpm vitest run tests/workspace-clipboard.spec.ts tests/app.spec.tsx tests/quantity-controls.spec.tsx`

Expected: PASS, including the existing quantity stepper tests.

- [ ] **Step 8: Commit clipboard support**

```bash
git add src/domain/workspaceClipboard.ts src/features/LabelList.tsx src/App.tsx src/styles.css tests/workspace-clipboard.spec.ts tests/app.spec.tsx
git commit -m "feat: add record clipboard actions"
```

---

### Task 5: Add guarded shortcuts and accessible shortcut help

**Files:**
- Create: `src/domain/shortcutKeys.ts`
- Create: `src/features/ShortcutHelpDialog.tsx`
- Create: `tests/shortcut-keys.spec.ts`
- Modify: `src/App.tsx` (global key handler, help state, search focus)
- Modify: `src/styles.css`
- Modify: `tests/app.spec.tsx`

**Interfaces:**
- Consumes: normalized keyboard event fields and DOM target context.
- Produces: `WorkspaceShortcut = 'copy' | 'cut' | 'paste' | 'undo' | 'redo' | 'find' | 'help' | 'escape'`, `resolveWorkspaceShortcut`, and `isTextEditingTarget`.

- [ ] **Step 1: Write failing shortcut resolver tests**

Create `tests/shortcut-keys.spec.ts` under jsdom. Test `Ctrl/Cmd+C`, `Ctrl/Cmd+X`, `Ctrl/Cmd+V`, `Ctrl/Cmd+Z`, `Ctrl+Y`, `Ctrl/Cmd+Shift+Z`, `Ctrl/Cmd+F`, `F1`, and `Escape`. Also assert `null` when `altKey`, both Ctrl and Meta, an undefined Shift combination, `isComposing`, `modalOpen`, or `textEditing` is true.

```ts
expect(resolveWorkspaceShortcut({ ...base, key: 'z', ctrlKey: true })).toBe('undo');
expect(resolveWorkspaceShortcut({ ...base, key: 'z', metaKey: true, shiftKey: true })).toBe('redo');
expect(resolveWorkspaceShortcut({ ...base, key: 'c', ctrlKey: true, textEditing: true })).toBeNull();
expect(resolveWorkspaceShortcut({ ...base, key: 'v', ctrlKey: true, isComposing: true })).toBeNull();
```

Create real nested DOM elements to assert that `isTextEditingTarget` recognizes `input`, `textarea`, `select`, and both empty-string and `plaintext-only` `contenteditable` ancestors.

- [ ] **Step 2: Run it and confirm the shortcut module is missing**

Run: `pnpm vitest run tests/shortcut-keys.spec.ts`

Expected: FAIL with module-not-found for `shortcutKeys`.

- [ ] **Step 3: Implement the minimal shortcut resolver**

Use this input contract:

```ts
export interface ShortcutInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  textEditing: boolean;
  isComposing: boolean;
  modalOpen: boolean;
}
```

Return `null` for blocked contexts first. Accept exactly one of Ctrl/Meta for command shortcuts. Only `Z` accepts Shift, mapping it to redo. With no modifiers, map `F1` to help and `Escape` to escape. Export:

```ts
export function isTextEditingTarget(element: Element | null): boolean {
  return Boolean(element?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]'));
}
```

- [ ] **Step 4: Run shortcut-domain tests**

Run: `pnpm vitest run tests/shortcut-keys.spec.ts`

Expected: PASS.

- [ ] **Step 5: Write failing help and keyboard integration tests**

Add to `tests/app.spec.tsx`:

```tsx
it('opens keyboard help with F1 and preserves native shortcuts in search input', async () => {
  const user = userEvent.setup();
  render(<App initialState={createInitialDraft()} />);

  await user.keyboard('{F1}');
  expect(screen.getByRole('dialog', { name: '快捷键帮助' })).toBeTruthy();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog', { name: '快捷键帮助' })).toBeNull();

  const search = screen.getByRole('searchbox', { name: '搜索唛头' });
  await user.click(search);
  await user.keyboard('{Control>}z{/Control}');
  expect((screen.getByRole('button', { name: '撤销上一步，Ctrl+Z' }) as HTMLButtonElement).disabled).toBe(true);
});
```

Add a test that adds a label, sends `Ctrl+Z`, then `Ctrl+Y`, and checks the same statuses as the header buttons. Add a cut-mode test where `Escape` clears the `待剪切` indicator.

```tsx
it('runs undo and redo shortcuts and Escape cancels pending cut', async () => {
  const user = userEvent.setup();
  render(<App initialState={createInitialDraft()} />);

  await user.click(screen.getByRole('button', { name: '手动新增' }));
  await user.keyboard('{Control>}z{/Control}');
  expect(screen.getByText('已撤销：新增手动唛头')).toBeTruthy();
  await user.keyboard('{Control>}y{/Control}');
  expect(screen.getByText('已重做：新增手动唛头')).toBeTruthy();

  await user.click(screen.getByRole('button', { name: '剪切所选' }));
  await user.keyboard('{Escape}');
  expect(screen.queryByText('待剪切')).toBeNull();
  expect(screen.getByText('已取消剪切')).toBeTruthy();
});
```

- [ ] **Step 6: Implement the help dialog and App key handler**

Create `ShortcutHelpDialog.tsx` with an `open`/`onClose` API. Use `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, initial focus on Close, Escape close, a one-button focus trap, body scroll lock, backdrop close, and focus restoration. List only the shortcuts actually implemented in this task.

In `App.tsx`, add a single document `keydown` effect. Normalize the event through `resolveWorkspaceShortcut`; call `preventDefault()` only after a shortcut resolves. Dispatch to existing `undoDraft`, `redoDraft`, `copyOrCut`, and `paste` commands; `find` focuses `searchInputRef`; `help` opens the dialog; `escape` cancels pending cut state. Treat `confirmation`, print dialog, or shortcut dialog as modal state. Add a header button with `aria-label="快捷键帮助，F1"`.

Render `ShortcutHelpDialog` outside `.app-shell`, and include `shortcutHelpOpen` in the shell `inert` expression.

- [ ] **Step 7: Style and run focused accessibility/integration tests**

Reuse `.dialog-backdrop` and current design tokens. Add `.shortcut-dialog`, grouped definition-list, `kbd`, sticky header/footer, and single-column mobile styles.

Run: `pnpm vitest run tests/shortcut-keys.spec.ts tests/app.spec.tsx tests/accessibility.spec.tsx`

Expected: PASS.

- [ ] **Step 8: Commit shortcut support**

```bash
git add src/domain/shortcutKeys.ts src/features/ShortcutHelpDialog.tsx src/App.tsx src/styles.css tests/shortcut-keys.spec.ts tests/app.spec.tsx
git commit -m "feat: add guarded keyboard shortcuts"
```

---

### Task 6: Verify the productivity UI as one coherent workflow

**Files:**
- Modify: `tests/app.spec.tsx`
- Modify: `src/App.tsx` only if the workflow test reveals integration defects
- Modify: `src/styles.css` only if focus, responsive layout, or disabled-state defects are found

**Interfaces:**
- Consumes: the search, history, clipboard, and shortcut APIs from Tasks 2–5.
- Produces: one end-to-end component test that locks the approved interaction contract.

- [ ] **Step 1: Add a complete workflow test**

Add one test that:

```tsx
const user = userEvent.setup();
const labels = ['BOX-A', 'CARTON-B', 'ENVELOPE-C'].map((content) => createLabel({
  content,
  quantity: 1,
  source: 'manual',
  needsReview: false,
}));
render(<App initialState={{
  ...createInitialDraft(),
  labels,
  activeLabelId: labels[0].id,
  selectedLabelIds: [],
}} />);
await user.type(screen.getByRole('searchbox', { name: '搜索唛头' }), 'BOX');
await user.click(screen.getByRole('checkbox', { name: '选择第 1 条唛头' }));
await user.click(screen.getByRole('button', { name: '复制所选' }));
await user.click(screen.getByRole('button', { name: '清空搜索' }));
await user.click(screen.getByRole('button', { name: '粘贴' }));
expect(screen.getByText('已粘贴 1 条唛头')).toBeTruthy();
await user.keyboard('{Control>}z{/Control}');
expect(screen.getByText('已撤销：粘贴 1 条唛头')).toBeTruthy();

await user.click(screen.getByRole('button', { name: '检查并打印' }));
const printDialog = screen.getByRole('dialog');
expect(printDialog.textContent).toContain('BOX-A');
expect(printDialog.textContent).toContain('CARTON-B');
expect(printDialog.textContent).toContain('ENVELOPE-C');
```

Then open the top print dialog and assert it still includes all original printable records despite the earlier search.

- [ ] **Step 2: Run the workflow test and inspect any failure before changing code**

Run: `pnpm vitest run tests/app.spec.tsx -t "search copy paste undo and print"`

Expected: PASS. If it fails, diagnose the exact state transition; do not broaden the shortcut set or change print scope.

- [ ] **Step 3: Check static accessibility and responsive contracts**

Add the following focused accessibility case:

```tsx
it('exposes native disabled states, live search count, and restores help focus', async () => {
  const user = userEvent.setup();
  const { container } = render(<App initialState={createInitialDraft()} />);
  const undo = screen.getByRole('button', { name: '撤销上一步，Ctrl+Z' }) as HTMLButtonElement;
  const redo = screen.getByRole('button', { name: '重做上一步，Ctrl+Y' }) as HTMLButtonElement;
  const help = screen.getByRole('button', { name: '快捷键帮助，F1' });

  expect(undo.disabled).toBe(true);
  expect(redo.disabled).toBe(true);
  expect(container.querySelector('.record-search [aria-live="polite"]')).toBeTruthy();
  await user.click(help);
  expect(screen.getByText('Ctrl+C')).toBeTruthy();
  expect(screen.getByText('Ctrl+Shift+Z')).toBeTruthy();
  await user.keyboard('{Escape}');
  expect(document.activeElement).toBe(help);
});
```

Run: `pnpm vitest run tests/app.spec.tsx tests/accessibility.spec.tsx`

Expected: PASS.

- [ ] **Step 4: Commit workflow coverage and any focused integration correction**

```bash
git add tests/app.spec.tsx src/App.tsx src/styles.css
git commit -m "test: cover productivity workflow"
```

---

### Task 7: Remove confirmed runtime-dead wrappers and migrate tests to public replacements

**Files:**
- Modify: `src/domain/draft.ts` (remove unused `validateSizePreset` import only)
- Modify: `src/domain/images.ts` (remove `recognizeImage`)
- Modify: `src/domain/importing.ts` (remove `rowsToLabels`)
- Modify: `src/domain/layout.ts` (remove `LayoutInput`, `LayoutResult`, `wrapText`, and `solveTextLayout` if no remaining production reference)
- Modify: `src/domain/workspaceLayout.ts` (remove `reorderWorkspacePanels`)
- Modify: `tests/images.spec.ts`
- Modify: `tests/domain.spec.ts`
- Modify: `tests/final-findings.spec.tsx`
- Modify: `tests/workspace-layout.spec.ts`

**Interfaces:**
- Consumes: current public replacements `recognizeImageLayout`, `identifyExcelColumns`, `rowsToLabelsWithColumns`, `solveLabelTextLayout`, `placeWorkspacePanel`, and `moveWorkspacePanel`.
- Produces: no new production API; removes obsolete exported wrappers while retaining equivalent behavioral coverage.

- [ ] **Step 1: Capture the current reference inventory**

Run:

```bash
rg -n "recognizeImage\(|rowsToLabels\(|solveTextLayout\(|reorderWorkspacePanels\(|validateSizePreset" src tests
```

Expected: each of the first four APIs appears only in its defining production file and tests; `validateSizePreset` has valid callers elsewhere but is unused specifically in `src/domain/draft.ts`.

- [ ] **Step 2: Migrate tests to replacement APIs before deleting production code**

- In `tests/images.spec.ts`, change the abort-before-start test to call `recognizeImageLayout(file, { left: 0, top: 0, width: 1, height: 1 }, undefined, controller.signal)`.
- In `tests/domain.spec.ts` and `tests/final-findings.spec.tsx`, resolve columns with `identifyExcelColumns(headers)` and pass them to `rowsToLabelsWithColumns(headers, rows, 'small', columns)`.
- Replace `solveTextLayout` tests with `solveLabelTextLayout(createLabel(...), preset)` assertions covering fit, overflow, fixed size, and line preservation.
- Replace `reorderWorkspacePanels` tests with exact `placeWorkspacePanel` or `moveWorkspacePanel` expectations for before/after and keyboard movement.

Use these concrete call shapes while retaining the existing input values and expected business assertions:

```ts
const columns = identifyExcelColumns(headers);
const labels = rowsToLabelsWithColumns(headers, rows, 'small', columns);

const layout = solveLabelTextLayout(createLabel({
  content: 'A', quantity: 1, source: 'manual', needsReview: false,
}), defaultSizePresets[1]);
expect(layout.ok).toBe(true);

expect(placeWorkspacePanel(DEFAULT_WORKSPACE_LAYOUT, 'records', 'preview', 'after').order)
  .toEqual(['intake', 'preview', 'records']);
expect(moveWorkspacePanel(DEFAULT_WORKSPACE_LAYOUT, 'records', 1).order)
  .toEqual(['intake', 'preview', 'records']);
```

Run: `pnpm vitest run tests/images.spec.ts tests/domain.spec.ts tests/final-findings.spec.tsx tests/workspace-layout.spec.ts`

Expected: PASS while the wrappers still exist.

- [ ] **Step 3: Delete only the now-unreferenced wrappers and related private legacy helpers/types**

Remove the four exported functions. In `layout.ts`, also remove `LayoutInput`, `LayoutResult`, and `wrapText` only after `rg` confirms they have no other references. Remove only the `validateSizePreset` import from `draft.ts`; keep the validator and its real callers in `labels.ts`, `App.tsx`, `history.ts`, `printing.ts`, and `SizeStylePanel.tsx`.

- [ ] **Step 4: Verify no forbidden production or test references remain**

Run:

```bash
rg -n "recognizeImage\(|rowsToLabels\(|solveTextLayout\(|reorderWorkspacePanels\(" src tests
```

Expected: no matches.

Run: `pnpm exec tsc -p tsconfig.app.json --noEmit --noUnusedLocals --noUnusedParameters`

Expected: PASS with no unused-symbol diagnostics.

- [ ] **Step 5: Run all affected domain suites**

Run: `pnpm vitest run tests/images.spec.ts tests/domain.spec.ts tests/final-findings.spec.tsx tests/workspace-layout.spec.ts tests/draft.spec.ts`

Expected: PASS.

- [ ] **Step 6: Commit dead-code cleanup**

```bash
git add src/domain/draft.ts src/domain/images.ts src/domain/importing.ts src/domain/layout.ts src/domain/workspaceLayout.ts tests/images.spec.ts tests/domain.spec.ts tests/final-findings.spec.tsx tests/workspace-layout.spec.ts
git commit -m "refactor: remove superseded domain wrappers"
```

---

### Task 8: Run full verification and browser QA

**Files:**
- Modify: only files required by defects reproduced during verification
- Test: all files under `tests/`

**Interfaces:**
- Consumes: the complete implementation from Tasks 1–7.
- Produces: verified production build and a clean working tree; no deployment.

- [ ] **Step 1: Run formatting and type safety checks**

Run: `git diff --check`

Expected: no output.

Run: `pnpm typecheck`

Expected: PASS.

Run: `pnpm exec tsc -p tsconfig.app.json --noEmit --noUnusedLocals --noUnusedParameters`

Expected: PASS.

- [ ] **Step 2: Run the complete automated test suite**

Run: `pnpm test`

Expected: every test file and test passes; no existing print, quantity, font-size, recent-history, image, Excel, workspace, or accessibility regression.

- [ ] **Step 3: Build production assets**

Run: `pnpm build`

Expected: TypeScript and Vite complete successfully and create `dist/`.

- [ ] **Step 4: Perform browser interaction QA against the local production build**

Start the preview server with `pnpm exec vite preview --host 127.0.0.1`. In the available browser surface, verify:

1. Searching filters only the list, displays the count, and Clear restores focus and all rows.
2. Adding/editing a label enables Undo; Undo and Redo restore content and status.
3. Copy then Paste creates an independent record; repeated Paste creates distinct records.
4. Cut marks a row without dimming it; activating another row and Paste moves it; Escape cancels pending cut.
5. `Ctrl/Cmd+Z`, `Ctrl+Y` / `Ctrl/Cmd+Shift+Z`, `Ctrl/Cmd+C/X/V/F`, F1, and Escape work outside editors.
6. The same shortcuts do not override native behavior inside inputs or contenteditable areas.
7. Shortcut help opens, traps/restores focus, closes with Escape, and lists only supported shortcuts.
8. Top print review still contains all labels while single-record preview still targets only the active label; rotation and quantity controls remain functional.
9. At narrow viewport width, search, header actions, toolbar, and help dialog remain usable without horizontal page overflow.

- [ ] **Step 5: Fix only reproduced defects, rerun the narrowest failing test, then repeat all verification**

For every defect, first add or tighten the smallest failing test, implement the minimal correction, and rerun Steps 1–4. Do not add unrelated features or deploy.

- [ ] **Step 6: Commit any verification-only corrections**

If files changed during QA:

```bash
git add --patch
git commit -m "fix: address productivity workflow regression"
```

If no files changed, do not create an empty commit.

- [ ] **Step 7: Confirm final repository state**

Run: `git status --short`

Expected: no output. Report test counts, build result, browser scenarios checked, commits created, and explicitly state that nothing was pushed or deployed.
