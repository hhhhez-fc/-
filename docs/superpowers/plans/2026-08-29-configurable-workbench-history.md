# Configurable Workbench and Used Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a locally persisted, reorderable and boundary-resizable four-panel workbench, remove redundant review/application actions, save printed label snapshots for reuse, and make original-image imports derive their record name from explicit whole-image OCR.

**Architecture:** Add pure domain modules for workspace layout and used-label history, then expose them through `DraftState` migrations and reducer actions. Keep pointer/keyboard interaction inside a reusable `WorkspacePanel`, keep OCR policy inside the image domain/importer, and let `App` only compose panels and connect print actions to history. Preserve the existing offline-only React/Vite architecture and current print rendering path.

**Tech Stack:** React 19, TypeScript 7, Vite 8, Vitest 4, CSS Grid, Pointer Events, browser `localStorage`, Tesseract.js.

**Spec:** `docs/superpowers/specs/2026-08-29-configurable-workbench-history-design.md`

## Global Constraints

- All draft, panel layout, images, OCR output, and history remain local to the current browser; no network data store or account is added.
- The four stable panel IDs are `intake`, `preview`, `records`, and `history`.
- Panel order always contains each stable ID exactly once; invalid stored values are repaired during hydration.
- Desktop panel width is clamped to 220–900 px and height to 320–1200 px; below 720 px panels are full width and only saved height applies.
- Resizing uses invisible panel boundaries rather than visible buttons; keyboard-equivalent separators remain focusable and accessible.
- Used-label history is deduplicated by print-affecting content, limited to the 50 most recent entries, and only recorded from an actual print-group action.
- Image selection never starts OCR. “使用原图” starts explicit whole-image OCR but still prints the original image.
- Objective validation errors continue to block printing; legacy `needsReview` state does not.

---

### Task 1: Workspace layout domain and draft migration

**Files:**
- Create: `src/domain/workspaceLayout.ts`
- Modify: `src/domain/draft.ts`
- Modify: `src/domain/storage.ts`
- Create: `tests/workspace-layout.spec.ts`
- Modify: `tests/draft.spec.ts`

**Interfaces:**
- Produces: `WorkspacePanelId`, `WorkspacePanelSize`, `WorkspaceLayout`, `DEFAULT_WORKSPACE_LAYOUT`, `hydrateWorkspaceLayout(value)`, `reorderWorkspacePanels(layout, sourceId, targetId)`, and `resizeWorkspacePanel(layout, id, patch)`.
- Produces reducer actions: `{ type: 'set-panel-order'; order: WorkspacePanelId[] }` and `{ type: 'resize-panel'; id: WorkspacePanelId; patch: Partial<WorkspacePanelSize> }`.
- Later tasks consume `DraftState.workspaceLayout` and the two reducer actions.

- [ ] **Step 1: Write failing layout-domain tests**

```ts
import {
  DEFAULT_WORKSPACE_LAYOUT,
  hydrateWorkspaceLayout,
  reorderWorkspacePanels,
  resizeWorkspacePanel,
} from '../src/domain/workspaceLayout';

it('repairs duplicate, missing, and unknown panel ids', () => {
  expect(hydrateWorkspaceLayout({ order: ['preview', 'preview', 'unknown'] })).toEqual({
    ...DEFAULT_WORKSPACE_LAYOUT,
    order: ['preview', 'intake', 'records', 'history'],
  });
});

it('reorders by the target position and clamps saved sizes', () => {
  const reordered = reorderWorkspacePanels(DEFAULT_WORKSPACE_LAYOUT, 'history', 'preview');
  expect(reordered.order).toEqual(['intake', 'history', 'preview', 'records']);
  expect(resizeWorkspacePanel(reordered, 'history', { widthPx: 2000, heightPx: 100 }))
    .toMatchObject({ sizes: { history: { widthPx: 900, heightPx: 320 } } });
});
```

- [ ] **Step 2: Run the new domain test and verify RED**

Run: `pnpm test tests/workspace-layout.spec.ts`

Expected: FAIL because `src/domain/workspaceLayout.ts` does not exist.

- [ ] **Step 3: Implement the pure layout domain**

```ts
export const WORKSPACE_PANEL_IDS = ['intake', 'preview', 'records', 'history'] as const;
export type WorkspacePanelId = typeof WORKSPACE_PANEL_IDS[number];
export interface WorkspacePanelSize { widthPx: number; heightPx: number }
export interface WorkspaceLayout {
  order: WorkspacePanelId[];
  sizes: Record<WorkspacePanelId, WorkspacePanelSize>;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function resizeWorkspacePanel(
  layout: WorkspaceLayout,
  id: WorkspacePanelId,
  patch: Partial<WorkspacePanelSize>,
): WorkspaceLayout {
  const current = layout.sizes[id];
  return {
    ...layout,
    sizes: {
      ...layout.sizes,
      [id]: {
        widthPx: clamp(patch.widthPx ?? current.widthPx, 220, 900),
        heightPx: clamp(patch.heightPx ?? current.heightPx, 320, 1200),
      },
    },
  };
}
```

Implement `DEFAULT_WORKSPACE_LAYOUT`, deterministic hydration, and target-index reordering in the same file.

- [ ] **Step 4: Add workspace layout to draft creation, reducer, and hydration**

Add `workspaceLayout: WorkspaceLayout` to `DraftState`. Initialize it with a deep copy of `DEFAULT_WORKSPACE_LAYOUT`; route reducer actions through the pure functions; call `hydrateWorkspaceLayout(parsed.workspaceLayout)` from `hydrateDraft` so version-1 drafts remain readable.

- [ ] **Step 5: Add migration and reducer tests, then run the focused suite**

```ts
it('hydrates an old draft with the default four-panel layout', () => {
  const legacy = createInitialDraft() as Partial<DraftState>;
  delete legacy.workspaceLayout;
  const loaded = loadDraft({ getItem: () => JSON.stringify(legacy) });
  expect(loaded?.workspaceLayout.order).toEqual(['intake', 'preview', 'records', 'history']);
});
```

Run: `pnpm test tests/workspace-layout.spec.ts tests/draft.spec.ts`

Expected: PASS.

- [ ] **Step 6: Commit the layout domain**

```bash
git add src/domain/workspaceLayout.ts src/domain/draft.ts src/domain/storage.ts tests/workspace-layout.spec.ts tests/draft.spec.ts
git commit -m "feat: persist workspace panel layout"
```

---

### Task 2: Draggable and boundary-resizable workspace panels

**Files:**
- Create: `src/features/WorkspacePanel.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Modify: `tests/app.spec.tsx`

**Interfaces:**
- Consumes: `WorkspacePanelId`, `WorkspacePanelSize`, and `DraftState.workspaceLayout` from Task 1.
- Produces: `WorkspacePanel` with props `{ id, titleId, size, onDropBefore, onResize, children, className }`.
- Produces pointer and keyboard events that only emit panel IDs or clamped size patches; it does not write storage directly.

- [ ] **Step 1: Write failing component expectations**

Render `App` with a draft and assert four panel regions, four draggable headers, and separator semantics:

```ts
expect(screen.getByRole('region', { name: '使用过的唛头' })).toBeDefined();
expect(screen.getAllByTestId('panel-drag-handle')).toHaveLength(4);
expect(screen.getAllByRole('separator', { name: /调整.*宽度/ })).toHaveLength(4);
expect(screen.getAllByRole('separator', { name: /调整.*高度/ })).toHaveLength(4);
```

- [ ] **Step 2: Run the component test and verify RED**

Run: `pnpm test tests/app.spec.tsx`

Expected: FAIL because the history panel and workspace panel controls are absent.

- [ ] **Step 3: Implement `WorkspacePanel` pointer and keyboard behavior**

Use a 4px movement threshold for title dragging. Emit `onDropBefore(sourceId, targetId)` when a dragged header crosses a panel body. Render three visually transparent resizers:

```tsx
<span
  role="separator"
  tabIndex={0}
  aria-label={`调整${title}宽度`}
  aria-orientation="vertical"
  className="panel-resizer panel-resizer-x"
  onPointerDown={startHorizontalResize}
  onKeyDown={resizeWidthWithKeyboard}
/>
```

Repeat for height and the corner. Use pointer capture, cancel cleanup, `Shift` as a 20px keyboard step, and 4px otherwise.

- [ ] **Step 4: Compose all four panels from layout order in `App`**

Create a `Record<WorkspacePanelId, ReactNode>` and map `state.workspaceLayout.order` to `WorkspacePanel`. Dispatch `set-panel-order` and `resize-panel` from callbacks. Do not duplicate panel contents; move the existing intake, preview, and record bodies into their wrappers.

- [ ] **Step 5: Add grid and resize CSS**

Use an auto-flow grid whose panel inline sizes come from CSS custom properties set by `WorkspacePanel`. Add `overflow: auto` inside the panel body, `cursor: ew-resize/ns-resize/nwse-resize` only over the boundary hit zones, and a focus/drag border state. At `max-width: 720px`, set every panel to `width: 100%` and disable the horizontal/corner width effect while retaining the height separator.

- [ ] **Step 6: Run component tests and build**

Run: `pnpm test tests/app.spec.tsx tests/workspace-layout.spec.ts && pnpm build`

Expected: PASS and a successful Vite production build.

- [ ] **Step 7: Commit panel interaction**

```bash
git add src/features/WorkspacePanel.tsx src/App.tsx src/styles.css tests/app.spec.tsx
git commit -m "feat: reorder and resize workbench panels"
```

---

### Task 3: Immediate text arrangement and automatic validation

**Files:**
- Modify: `src/features/SizeStylePanel.tsx`
- Modify: `src/features/LabelEditor.tsx`
- Modify: `src/features/LabelList.tsx`
- Modify: `src/domain/layout.ts`
- Modify: `src/domain/draft.ts`
- Modify: `src/App.tsx`
- Modify: `tests/app.spec.tsx`
- Modify: `tests/domain.spec.ts`
- Modify: `tests/draft.spec.ts`
- Modify: `DESIGN.md`
- Modify: `UX-CONTRACT.md`

**Interfaces:**
- Consumes: existing `alignTextLines(lines, alignment)`.
- Produces: direct select-to-layout behavior and objective-only `validateLabelForPrint`.
- Removes user-facing `onReview`, `mark-reviewed`, “全部自动排列”, “确认校对完成”, review counts, and review badges.

- [ ] **Step 1: Write failing behavior tests**

```ts
expect(screen.queryByRole('button', { name: '全部自动排列' })).toBeNull();
expect(screen.queryByRole('button', { name: '确认校对完成' })).toBeNull();
expect(screen.queryByText(/条待校对/)).toBeNull();
expect(validateLabelForPrint({ ...label, needsReview: true }, preset)).not.toContain('该唛头尚未完成校对');
```

Add a component interaction test that selects `right` and asserts both non-empty line placements become `xPercent: 100` and `horizontalSnap: 'right'` without clicking another control.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm test tests/app.spec.tsx tests/domain.spec.ts tests/draft.spec.ts`

Expected: FAIL on the old buttons, review blocker, and delayed arrangement.

- [ ] **Step 3: Make the arrangement selector commit immediately**

Replace the separate button with one `select` handler:

```tsx
onChange={(event) => {
  const alignment = event.target.value as TextLineAlignment;
  setAutoAlignment(alignment);
  onChange({ textLines: alignTextLines(label.textLines, alignment) });
}}
```

- [ ] **Step 4: Remove the manual review gate**

Remove `onReview` from `LabelEditorProps` and its action button. Remove `needsReview` from `validateLabelForPrint`, stop setting review state in `update-label`, remove `mark-reviewed` from `DraftAction`, and replace list/header review wording with neutral record counts. Keep hydration tolerant of old fields so existing local data loads.

- [ ] **Step 5: Update product contracts**

Document immediate arrangement and objective-only validation in `DESIGN.md` and `UX-CONTRACT.md`. Remove statements that require a manual review confirmation before printing.

- [ ] **Step 6: Run focused and full tests**

Run: `pnpm test tests/app.spec.tsx tests/domain.spec.ts tests/draft.spec.ts && pnpm test`

Expected: all focused tests and the full suite PASS.

- [ ] **Step 7: Commit simplified editing**

```bash
git add src/features/SizeStylePanel.tsx src/features/LabelEditor.tsx src/features/LabelList.tsx src/domain/layout.ts src/domain/draft.ts src/App.tsx tests/app.spec.tsx tests/domain.spec.ts tests/draft.spec.ts DESIGN.md UX-CONTRACT.md
git commit -m "feat: apply layout and validation immediately"
```

---

### Task 4: Used-label history and reuse

**Files:**
- Create: `src/domain/usedLabels.ts`
- Create: `src/features/UsedLabelsPanel.tsx`
- Modify: `src/domain/draft.ts`
- Modify: `src/domain/storage.ts`
- Modify: `src/App.tsx`
- Create: `tests/used-labels.spec.ts`
- Modify: `tests/draft.spec.ts`
- Modify: `tests/app.spec.tsx`

**Interfaces:**
- Produces: `UsedLabelRecord`, `rememberUsedLabels(history, labels, usedAt)`, and `reuseUsedLabel(entry)`.
- Produces reducer actions `{ type: 'remember-used-labels'; labels: LabelRecord[]; usedAt: string }` and `{ type: 'reuse-used-label'; historyId: string }`.
- `App.onPrintGroup` consumes unique labels from `PrintGroup.pages` and dispatches `remember-used-labels` before opening the browser print dialog.

- [ ] **Step 1: Write failing history-domain tests**

```ts
it('deduplicates print-equivalent snapshots and updates usage', () => {
  const first = rememberUsedLabels([], [label], '2026-08-29T10:00:00.000Z');
  const second = rememberUsedLabels(first, [{ ...label, id: 'another-id' }], '2026-08-29T11:00:00.000Z');
  expect(second).toHaveLength(1);
  expect(second[0]).toMatchObject({ useCount: 2, lastUsedAt: '2026-08-29T11:00:00.000Z' });
});

it('keeps 50 newest snapshots and deep-clones a reused label', () => {
  let history: UsedLabelRecord[] = [];
  for (let index = 0; index < 51; index += 1) {
    const distinct = {
      ...label,
      id: `label-${index}`,
      content: `LABEL-${index}`,
      textLines: createTextLines(`LABEL-${index}`),
    };
    history = rememberUsedLabels(history, [distinct], new Date(index * 1000).toISOString());
  }
  expect(history).toHaveLength(50);
  const reused = reuseUsedLabel(history[0]);
  expect(reused.id).not.toBe(history[0].label.id);
  expect(reused.textLines).not.toBe(history[0].label.textLines);
});
```

- [ ] **Step 2: Run history tests and verify RED**

Run: `pnpm test tests/used-labels.spec.ts`

Expected: FAIL because the history domain does not exist.

- [ ] **Step 3: Implement deterministic history fingerprinting and cloning**

Define:

```ts
export interface UsedLabelRecord {
  id: string;
  label: LabelRecord;
  lastUsedAt: string;
  useCount: number;
}
```

Build the fingerprint from stable JSON of print-affecting label fields while excluding label IDs and line IDs. Deep-copy style ranges, lines, placements, print area, and image data string. Deduplicate within the incoming print group and against stored history; sort descending by `lastUsedAt`; slice to 50.

- [ ] **Step 4: Add reducer, hydration, and reuse actions**

Add `usedLabels: UsedLabelRecord[]` to `DraftState`, default it to `[]`, validate/hydrate stored entries, and implement both actions. Reuse inserts a new label through the same semantics as `add-label` and selects it.

- [ ] **Step 5: Build the history panel and connect printing**

Render a `UsedLabelsPanel` with the title “使用过的唛头”, newest-first summaries, dimensions, localized last-used time, use count, and a “再次使用” button. In `onPrintGroup`, derive unique records from `group.pages`, dispatch history recording with `new Date().toISOString()`, then preserve the existing print flow.

- [ ] **Step 6: Run history, reducer, and component tests**

Run: `pnpm test tests/used-labels.spec.ts tests/draft.spec.ts tests/app.spec.tsx`

Expected: PASS, including one history entry for multiple copies of the same label and a newly selected record after reuse.

- [ ] **Step 7: Commit used-label history**

```bash
git add src/domain/usedLabels.ts src/features/UsedLabelsPanel.tsx src/domain/draft.ts src/domain/storage.ts src/App.tsx tests/used-labels.spec.ts tests/draft.spec.ts tests/app.spec.tsx
git commit -m "feat: save and reuse printed labels"
```

---

### Task 5: Whole-image OCR metadata for original-image imports

**Files:**
- Modify: `src/domain/images.ts`
- Modify: `src/features/ImageImporter.tsx`
- Modify: `tests/images.spec.ts`
- Modify: `tests/app.spec.tsx`
- Modify: `UX-CONTRACT.md`

**Interfaces:**
- Extends `OcrRecognitionOptions` with `preserveAllText?: boolean`.
- `recognizeImageLayout(file, crop, progress, signal, { requireMarker: false, preserveAllText: true })` returns normalized bilingual full-image text and lines.
- `ImageImporter.importOriginal` becomes asynchronous and creates `contentType: 'image'` with `content: result.text || '原图唛头'` and the unchanged original `imageFallback`.

- [ ] **Step 1: Write failing OCR policy tests**

```ts
it('preserves all bilingual whole-image content without requiring a marker', async () => {
  tesseract.recognize.mockResolvedValueOnce({
    data: { text: '箱号 A-21\n数量 56\nMADE IN CHINA', blocks: [] },
  });
  const result = await recognizeImageLayout(file, fullCrop, undefined, undefined, {
    requireMarker: false,
    preserveAllText: true,
  });
  expect(result.text).toBe('箱号 A-21\n数量 56\nMADE IN CHINA');
});
```

Add a component assertion that choosing a file does not call OCR, then clicking “使用原图” calls OCR and imports an image label whose `content` is recognized text rather than `file.name`.

- [ ] **Step 2: Run image tests and verify RED**

Run: `pnpm test tests/images.spec.ts tests/app.spec.tsx`

Expected: FAIL because `preserveAllText` and asynchronous original import are absent.

- [ ] **Step 3: Implement the preserve-all OCR branch**

When `preserveAllText` is true, bypass marker extraction and ASCII-only crop sanitization. Normalize whitespace with `normalizeOcrText`, retain bilingual characters and line positions, and return all non-empty recognized lines in reading order.

- [ ] **Step 4: Make “使用原图” run explicit whole-image OCR**

Reuse the existing busy/progress/cancel controller. OCR the full pixel rectangle regardless of the visible crop selection, then import the original image. If OCR yields no text or throws a non-cancellation error, import with `content: '原图唛头'`, keep the image, and send a non-blocking status message. Do not use `file.name.replace(...)` anywhere in label creation.

- [ ] **Step 5: Update the image contract and run tests**

Document that file selection is idle, cropped OCR is explicit, and original-image use performs full OCR metadata extraction. Run: `pnpm test tests/images.spec.ts tests/app.spec.tsx && pnpm test`

Expected: all tests PASS.

- [ ] **Step 6: Commit image import behavior**

```bash
git add src/domain/images.ts src/features/ImageImporter.tsx tests/images.spec.ts tests/app.spec.tsx UX-CONTRACT.md
git commit -m "feat: name original images from full OCR"
```

---

### Task 6: Integrated browser verification, audit, and deployment

**Files:**
- Modify if verification reveals a defect: only the owning files and their focused tests from Tasks 1–5.
- Verify: `DESIGN.md`, `UX-CONTRACT.md`, and `docs/superpowers/specs/2026-08-29-configurable-workbench-history-design.md`

**Interfaces:**
- Consumes the complete four-panel workbench, immediate arrangement, history, and image-import flows.
- Produces final GitHub `main` commit and Cloudflare Pages deployment evidence.

- [ ] **Step 1: Run fresh automated verification**

Run:

```bash
pnpm test
pnpm build
"C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe" "C:/Users/Administrator/.codex/plugins/cache/openai-curated-remote/frontend-design-premium/1.4.0/skills/frontend-design-premium/scripts/audit_project.py" . --mode strict --no-write
pnpm dlx @google/design.md designmd lint DESIGN.md
git diff --check
```

Expected: all tests PASS, Vite build exits 0, strict audit reports zero findings, DESIGN lint exits 0, and diff check is empty.

- [ ] **Step 2: Verify desktop behavior in a real browser**

At 1136 × 920 on an isolated local origin:

- confirm four panels and default preview prominence;
- drag a title across another panel and verify persisted order after reload;
- hover and drag right, bottom, and corner boundaries with no visible resize button;
- verify width/height clamps and internal scrolling;
- select right alignment and verify immediate line movement without an apply button;
- verify no confirmation-review button or pending-review wording;
- trigger a print group and verify one used-label entry, updated count on repeat, and “再次使用” deep copy;
- select an image and verify OCR remains idle until an explicit action.

- [ ] **Step 3: Verify narrow behavior**

At 390 × 844 confirm four full-width panels in saved order, no horizontal overflow, height resizing remains available, and saved desktop widths do not affect the narrow layout.

- [ ] **Step 4: Verify original-image import with a fixture**

Use a local fixture containing Chinese, English, and numbers. Click “使用原图”, verify the list/history name comes from all recognized contents rather than the file name, and verify preview/print still renders the original image.

- [ ] **Step 5: Re-run affected tests after any browser-found fix**

For each defect, first add or adjust the focused regression test, confirm it fails, implement the smallest owner-level fix, rerun the focused test, then repeat Step 1 in full.

- [ ] **Step 6: Commit final integration if browser verification required fixes**

```bash
git add src tests DESIGN.md UX-CONTRACT.md
git commit -m "fix: harden configurable workbench flows"
```

Skip this commit when the worktree is already clean.

- [ ] **Step 7: Push and verify deployment**

```bash
git push origin HEAD:main
git ls-remote origin refs/heads/main
```

Fetch `https://label-printing-workbench.pages.dev/`, confirm its JS asset fingerprint matches the local final build, and confirm the deployed asset contains “使用过的唛头” and “调整…宽度” while excluding “全部自动排列” and “确认校对完成”.
