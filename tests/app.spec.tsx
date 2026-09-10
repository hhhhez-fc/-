// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { createInitialDraft, type DraftState } from '../src/domain/draft';
import { createLabel, defaultSizePresets } from '../src/domain/labels';
import { recordRecentLabels, type RecentLabelInput } from '../src/domain/history';
import { DRAFT_STORAGE_KEY } from '../src/domain/storage';
import LabelPreview from '../src/features/LabelPreview';
import ImageCropSelector from '../src/features/ImageCropSelector';
import PrintReviewDialog, * as printReviewModule from '../src/features/PrintReviewDialog';
import PrintPages from '../src/features/PrintPages';
import SizeStylePanel from '../src/features/SizeStylePanel';
import LabelEditor from '../src/features/LabelEditor';
import SourceHistory from '../src/features/SourceHistory';
import { createPrintPlan } from '../src/domain/printing';
import { buildFontSizePreviewLabel } from '../src/domain/fontSizePreview';
import { PrintHelperError, type PrintJobStatus } from '../src/services/printHelperClient';
import type { PrintHelperCalibrationState, PrintHelperConnectionState } from '../src/features/usePrintHelper';

const directPrintHarness = vi.hoisted(() => ({
  connection: { kind: 'ready', printers: [{
    id: 'xp420b', displayName: 'Xprinter XP-420B', isDefault: true, isCompatible: true,
    queueStatus: 'ready', isAvailable: true,
  }] } as PrintHelperConnectionState,
  calibrationState: {
    kind: 'verified', printerId: 'xp420b', profileRevision: '11111111111111111111111111111111',
  } as PrintHelperCalibrationState,
  selectedPrinterId: 'xp420b' as string | null,
  setSelectedPrinterId: vi.fn(),
  refresh: vi.fn(async () => undefined),
  refreshPairingStatus: vi.fn(async () => undefined),
  submitJob: vi.fn(),
  jobStatus: vi.fn(),
  cancelSubmission: vi.fn(),
  renderAsset: vi.fn(),
}));

vi.mock('../src/features/usePrintHelper', () => ({
  usePrintHelper: () => directPrintHarness,
}));
vi.mock('../src/services/printBitmapRenderer', () => ({
  renderPrintAsset: directPrintHarness.renderAsset,
}));

const DIRECT_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlHSj8AAAAASUVORK5CYII=';
const directPreset = { ...defaultSizePresets[0], id: 'xp420b-100x75', name: 'XP-420B 100 × 75', widthMm: 100, heightMm: 75 };

function directState(content = 'DIRECT', quantity = 1) {
  const label = createLabel({ content, quantity, source: 'manual', needsReview: false, sizePresetId: directPreset.id });
  label.style.fontMode = 'auto';
  return { state: { ...createInitialDraft(), labels: [label], activeLabelId: label.id,
    sizePresets: [...defaultSizePresets, directPreset] }, label };
}

function helperStatus(jobId: string, status: PrintJobStatus['status'], pageStatuses: Array<'submitted' | 'failed' | 'unknown'> = ['submitted']): PrintJobStatus {
  return {
    jobId, manifestFingerprint: 'a'.repeat(64), status,
    createdAtUtc: '2026-09-09T00:00:00.000Z', updatedAtUtc: '2026-09-09T00:00:01.000Z',
    pages: pageStatuses.map((pageStatus, index) => ({ ordinal: index + 1, assetId: 'asset', sha256: 'b'.repeat(64), status: pageStatus })),
  };
}

beforeAll(() => {
  Object.defineProperties(HTMLElement.prototype, {
    hasPointerCapture: { configurable: true, value: () => false },
    setPointerCapture: { configurable: true, value: () => undefined },
    releasePointerCapture: { configurable: true, value: () => undefined },
    scrollIntoView: { configurable: true, value: () => undefined },
  });
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: class { observe() {} unobserve() {} disconnect() {} },
  });
});

beforeEach(() => {
  directPrintHarness.connection = { kind: 'ready', printers: [{
    id: 'xp420b', displayName: 'Xprinter XP-420B', isDefault: true, isCompatible: true,
    queueStatus: 'ready', isAvailable: true,
  }] };
  directPrintHarness.calibrationState = {
    kind: 'verified', printerId: 'xp420b', profileRevision: '11111111111111111111111111111111',
  };
  directPrintHarness.selectedPrinterId = 'xp420b';
  directPrintHarness.setSelectedPrinterId.mockReset();
  directPrintHarness.refresh.mockReset().mockResolvedValue(undefined);
  directPrintHarness.refreshPairingStatus.mockReset().mockResolvedValue(undefined);
  directPrintHarness.submitJob.mockReset().mockImplementation(async (manifest, _assets, onProgress) => {
    onProgress?.({ stage: 'creating', completed: 0, total: 1 });
    onProgress?.({ stage: 'uploading', completed: 1, total: 1, assetId: manifest.assets[0].assetId });
    onProgress?.({ stage: 'committing', completed: 1, total: 1 });
    return helperStatus(manifest.jobId, 'submitted', Array.from({ length: manifest.expectedLabels }, () => 'submitted'));
  });
  directPrintHarness.jobStatus.mockReset();
  directPrintHarness.cancelSubmission.mockReset();
  directPrintHarness.renderAsset.mockReset().mockImplementation(async ({ page, rotation }) => ({
    assetId: `asset-${page.label.id}`, labelId: page.label.id, widthDots: 800, heightDots: 600,
    rotation, pngBase64: DIRECT_PNG, sha256: 'b'.repeat(64),
  }));
});

function storedDraft(): DraftState {
  window.dispatchEvent(new Event('pagehide'));
  return JSON.parse(window.localStorage.getItem(DRAFT_STORAGE_KEY)!);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

async function expectStoredHistory(expectedContents: string[]) {
  await waitFor(() => {
    const saved = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    expect(saved).not.toBeNull();
    expect(JSON.parse(saved!).recentLabels.map((entry: { label: { content: string } }) => entry.label.content))
      .toEqual(expectedContents);
  });
}

const recentInput = (content: string, preset = defaultSizePresets[0]): RecentLabelInput => ({
  label: createLabel({
    content,
    quantity: 2,
    source: 'manual',
    sizePresetId: preset.id,
    needsReview: false,
  }),
  preset: { ...preset },
});

describe('唛头打印工作台', () => {
  it('keeps explicitly activated B active when undo restores deleted A without adding an empty history step', async () => {
    const user = userEvent.setup();
    const labels = ['A', 'B'].map((content) => createLabel({ content, quantity: 1, source: 'manual', needsReview: false }));
    render(<App initialState={{ ...createInitialDraft(), labels, activeLabelId: labels[0].id }} />);
    const records = screen.getByRole('list', { name: '唛头记录' });
    await user.click(within(records).getAllByRole('button', { name: '删除' })[0]);
    expect(storedDraft().labels.map(({ content }) => content)).toEqual(['B']);
    expect(storedDraft().activeLabelId).toBe(labels[1].id);
    await user.click(within(records).getByRole('button', { name: /^01\s+B\s/ }));
    const undo = screen.getByRole('button', { name: '撤销上一步，Ctrl+Z' }) as HTMLButtonElement;
    await user.click(undo);
    expect(storedDraft().labels.map(({ content }) => content)).toEqual(['A', 'B']);
    expect(storedDraft().activeLabelId).toBe(labels[1].id);
    expect(within(records).getByRole('button', { name: /^02\s+B\s/ }).getAttribute('aria-pressed')).toBe('true');
    expect(undo.disabled).toBe(true);
    const redo = screen.getByRole('button', { name: '重做上一步，Ctrl+Y' }) as HTMLButtonElement;
    expect(redo.disabled).toBe(false);
    await user.click(redo);
    expect(storedDraft().labels.map(({ content }) => content)).toEqual(['B']);
    expect(storedDraft().activeLabelId).toBe(labels[1].id);
  });

  it.each([
    { name: '第 1 条唛头的打印数量', before: 1, after: 2, read: (draft: DraftState) => draft.labels[0].quantity },
    { name: '全部字号', before: 26, after: 32, read: (draft: DraftState) => draft.labels[0].style.fontSizePt },
  ])('ignores repeated Enter and blur submissions for $name and preserves redo', async ({ name, before, after, read }) => {
    const user = userEvent.setup();
    render(<App initialState={createInitialDraft()} />);
    const input = screen.getByRole('spinbutton', { name });
    await user.click(input);
    fireEvent.change(input, { target: { value: String(after) } });
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('button', { name: '撤销上一步，Ctrl+Z' }));
    expect(read(storedDraft())).toBe(before);
    await user.click(input);
    await user.tab();
    const redo = screen.getByRole('button', { name: '重做上一步，Ctrl+Y' }) as HTMLButtonElement;
    expect(redo.disabled).toBe(false);
    await user.click(redo);
    expect(read(storedDraft())).toBe(after);
  });

  it('pastes a copied custom preset and record after clear as one undo and redo transition', async () => {
    const user = userEvent.setup();
    const initial = createInitialDraft();
    const preset = { ...initial.sizePresets[0], id: 'custom', widthMm: 88, heightMm: 44 };
    const label = createLabel({ content: 'BOX', quantity: 1, source: 'manual', needsReview: false, sizePresetId: preset.id });
    render(<App initialState={{ ...initial, labels: [label], activeLabelId: label.id, sizePresets: [...initial.sizePresets, preset] }} />);
    await user.click(screen.getByRole('button', { name: '复制所选' }));
    await user.click(screen.getByRole('button', { name: '清空草稿' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '清空草稿' }));
    const cleared = storedDraft();
    expect(cleared.sizePresets.some(({ id }) => id === 'custom')).toBe(false);
    await user.click(screen.getByRole('button', { name: '粘贴' }));
    const pasted = storedDraft();
    const copy = pasted.labels.find(({ content }) => content === 'BOX')!;
    expect(copy.id).not.toBe(label.id);
    expect(pasted.sizePresets.find(({ id }) => id === copy.sizePresetId)).toMatchObject({ widthMm: 88, heightMm: 44 });
    expect(createPrintPlan([copy], pasted.sizePresets)).toMatchObject({ blockers: [], groups: [{ widthMm: 88, heightMm: 44 }] });
    await user.click(screen.getByRole('button', { name: '撤销上一步，Ctrl+Z' }));
    expect(storedDraft().labels).toEqual(cleared.labels);
    expect(storedDraft().sizePresets).toEqual(cleared.sizePresets);
    await user.click(screen.getByRole('button', { name: '重做上一步，Ctrl+Y' }));
    expect(storedDraft().labels).toEqual(pasted.labels);
    expect(storedDraft().sizePresets).toEqual(pasted.sizePresets);
  });

  it.each(['{Control>}f{/Control}', '{Meta>}f{/Meta}'])('expands a collapsed records panel and focuses mounted search with %s', async (keys) => {
    const user = userEvent.setup();
    render(<App initialState={createInitialDraft()} />);
    await user.click(screen.getByRole('button', { name: '收起唛头清单板块' }));
    expect(screen.queryByRole('searchbox', { name: '搜索唛头' })).toBeNull();
    await user.keyboard(keys);
    const search = screen.getByRole('searchbox', { name: '搜索唛头' });
    expect(storedDraft().workspaceLayout.sizes.records.collapsed).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(search));
  });

  it('keeps an enabled paste button after copying and deleting the last record', async () => {
    const user = userEvent.setup();
    const initial = createInitialDraft();
    initial.labels[0].content = 'RESTORE';
    render(<App initialState={initial} />);
    await user.click(screen.getByRole('button', { name: '复制所选' }));
    await user.click(within(screen.getByRole('list', { name: '唛头记录' })).getByRole('button', { name: '删除' }));
    expect(storedDraft().labels).toEqual([]);
    const paste = screen.getByRole('button', { name: '粘贴' }) as HTMLButtonElement;
    expect(paste.disabled).toBe(false);
    await user.click(paste);
    expect(storedDraft().labels.map(({ content }) => content)).toEqual(['RESTORE']);
    expect(storedDraft().labels[0].id).not.toBe(initial.labels[0].id);
  });

  it('keeps F1, Escape and focus owned by the open font-size popup', async () => {
    const user = userEvent.setup();
    const { container } = render(<App initialState={createInitialDraft()} />);
    await user.click(screen.getByRole('button', { name: '剪切所选' }));
    const trigger = screen.getByRole('combobox', { name: '选择常用字号' });
    await user.click(trigger);
    const popup = screen.getByRole('listbox');
    expect(popup.contains(document.activeElement)).toBe(true);
    await user.keyboard('{F1}');
    expect(screen.queryByRole('dialog', { name: '快捷键帮助' })).toBeNull();
    expect(popup.contains(document.activeElement)).toBe(true);
    expect(container.querySelector('[data-cut="true"]')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(container.querySelector('[data-cut="true"]')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(container.querySelector('[data-cut="true"]')).toBeNull();
  });

  it('ignores shortcut events already prevented by another control', () => {
    render(<App initialState={createInitialDraft()} />);
    const event = new KeyboardEvent('keydown', { key: 'F1', bubbles: true, cancelable: true });
    event.preventDefault();
    fireEvent(document, event);
    expect(screen.queryByRole('dialog', { name: '快捷键帮助' })).toBeNull();
  });

  it('首次打开自动创建空白唛头，并可在预览内直接输入', () => {
    const html = renderToStaticMarkup(<App initialState={createInitialDraft()} />);

    expect(html).toContain('唛头打印工作台');
    expect(html).toContain('导入 Excel');
    expect(html).toContain('导入图片');
    expect(html).toContain('手动新增');
    expect(html).toContain('未填写内容');
    expect(html).toContain('aria-label="直接输入唛头内容"');
    expect(html).toContain('placeholder="在此输入唛头内容"');
    expect(html).toContain('唛头清单');
    expect(html).not.toContain('待校对');
    expect(html).not.toContain('<span>基础数量</span>');
    expect(html).toContain('张贴面数');
  });

  it('将三个工作区板块暴露为可拖动、边缘可调整大小的区域，并把历史并入来源', () => {
    const html = renderToStaticMarkup(<App initialState={createInitialDraft()} />);

    expect(html).not.toContain('aria-labelledby="history-title"');
    expect(html).toContain('使用过的唛头');
    expect(html).toContain('进入打印预览后自动保存最近 20 条');
    expect(html.match(/data-testid="panel-drag-handle"/g)).toHaveLength(3);
    expect(html.match(/class="[^"]*panel-drag-handle[^"]*"/g)).toHaveLength(3);
    expect(html.match(/role="separator"[^>]*aria-label="调整[^\"]*宽度"/g)).toHaveLength(3);
    expect(html.match(/aria-valuemin="180"/g)).toHaveLength(3);
    expect(html.match(/role="separator"[^>]*aria-label="调整[^\"]*高度"/g)).toHaveLength(3);
    expect(html).not.toContain('板块缩放比例');
    expect(html).not.toContain('向前移动');
    expect(html).not.toContain('向后移动');
    expect(html.match(/role="group"[^>]*aria-roledescription="可拖动板块"[^>]*tabindex="0"[^>]*data-panel-drag-handle/g)).toHaveLength(3);
    expect(html).not.toContain(' draggable=');
    expect(html.match(/aria-valuenow=/g)).toHaveLength(6);
    expect(html.match(/aria-label="收起[^"]*板块"/g)).toHaveLength(3);
    expect(html).toContain('恢复默认布局');
  });

  it('把全部文字工具栏紧贴尺寸与预览标题并放在预览画布之前', () => {
    const label = createLabel({ content: 'AREEN-21\n56614', quantity: 1, source: 'manual', needsReview: false });
    const state = { ...createInitialDraft(), labels: [label], activeLabelId: label.id };
    const html = renderToStaticMarkup(<App initialState={state} />);

    const previewHeading = html.indexOf('尺寸与预览');
    const textToolbar = html.indexOf('aria-label="全部文字样式"');
    const previewCanvas = html.indexOf('class="preview-stage"');

    expect(previewHeading).toBeGreaterThanOrEqual(0);
    expect(textToolbar).toBeGreaterThan(previewHeading);
    expect(previewCanvas).toBeGreaterThan(textToolbar);
  });

  it('在尺寸与预览标题中提供新增唛头入口', () => {
    const html = renderToStaticMarkup(<App initialState={createInitialDraft()} />);

    expect(html).toContain('aria-label="在尺寸与预览中新增唛头"');
    expect(html).toContain('>新增唛头</button>');
  });

  it('undoes and redoes one manual-label addition from accessible header buttons', async () => {
    const user = userEvent.setup();
    render(<App initialState={createInitialDraft()} />);
    const undo = screen.getByRole('button', { name: '撤销上一步，Ctrl+Z' });
    const redo = screen.getByRole('button', { name: '重做上一步，Ctrl+Y' });
    expect((undo as HTMLButtonElement).disabled).toBe(true);

    await user.click(screen.getByRole('button', { name: '手动新增' }));
    const added = storedDraft().labels;
    expect(added).toHaveLength(2);
    await user.click(undo);
    expect(storedDraft().labels).toEqual([added[0]]);
    expect(screen.getByText('已撤销：新增手动唛头')).toBeTruthy();
    await user.click(redo);
    expect(storedDraft().labels).toEqual(added);
    expect(screen.getByText('已重做：新增手动唛头')).toBeTruthy();
  });

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

  it('search copy paste undo and print keeps the complete printable draft', async () => {
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
    const pasted = storedDraft().labels;
    expect(pasted).toHaveLength(4);
    const copiedId = pasted.find(({ id }) => !labels.some((label) => label.id === id))!.id;
    expect(screen.getByText('已粘贴 1 条唛头')).toBeTruthy();
    await user.keyboard('{Control>}z{/Control}');
    expect(storedDraft().labels.map(({ id }) => id)).toEqual(labels.map(({ id }) => id));
    expect(storedDraft().labels.some(({ id }) => id === copiedId)).toBe(false);
    expect(screen.getByText('已撤销：粘贴 1 条唛头')).toBeTruthy();
    await user.keyboard('{Control>}y{/Control}');
    expect(storedDraft().labels).toEqual(pasted);
    await user.keyboard('{Control>}z{/Control}');

    await user.click(screen.getByRole('button', { name: '检查并打印' }));
    const printDialog = screen.getByRole('dialog');
    expect(printDialog.textContent).toContain('BOX-A');
    expect(printDialog.textContent).toContain('CARTON-B');
    expect(printDialog.textContent).toContain('ENVELOPE-C');
  });

  it('copies and repeatedly pastes an independent selected record', async () => {
    const user = userEvent.setup();
    const label = createLabel({ content: 'COPY-ME', quantity: 1, source: 'manual', needsReview: false });
    const { container } = render(<App initialState={{
      ...createInitialDraft(),
      labels: [label],
      activeLabelId: label.id,
      selectedLabelIds: [label.id],
    }} />);

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
    const labels = ['A', 'B', 'C'].map((content) => createLabel({
      content,
      quantity: 1,
      source: 'manual',
      needsReview: false,
    }));
    const { container } = render(<App initialState={{
      ...createInitialDraft(),
      labels,
      activeLabelId: labels[2].id,
      selectedLabelIds: [labels[0].id],
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
    expect(screen.getByText('Ctrl / ⌘ + C')).toBeTruthy();
    expect(screen.getByText('Ctrl / ⌘ + Shift + Z')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(document.activeElement).toBe(help);
  });

  it('traps shortcut-help focus, makes the workspace inert, and restores the trigger', async () => {
    const user = userEvent.setup();
    const { container } = render(<App initialState={createInitialDraft()} />);
    const trigger = screen.getByRole('button', { name: '快捷键帮助，F1' });

    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: '快捷键帮助' });
    const close = screen.getByRole('button', { name: '关闭快捷键帮助' });
    expect(document.activeElement).toBe(close);
    expect(container.querySelector('.app-shell')?.hasAttribute('inert')).toBe(true);
    expect(dialog.textContent).toContain('Ctrl / ⌘ + C');
    expect(dialog.textContent).not.toContain('删除');

    await user.tab();
    expect(document.activeElement).toBe(close);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(close);
    await user.keyboard('{Escape}');
    expect(document.activeElement).toBe(trigger);
  });

  it('runs undo and redo shortcuts and Escape cancels pending cut', async () => {
    const user = userEvent.setup();
    render(<App initialState={createInitialDraft()} />);

    await user.click(screen.getByRole('button', { name: '手动新增' }));
    const added = storedDraft().labels;
    expect(added).toHaveLength(2);
    await user.keyboard('{Control>}z{/Control}');
    expect(storedDraft().labels).toEqual([added[0]]);
    expect(screen.getByText('已撤销：新增手动唛头')).toBeTruthy();
    await user.keyboard('{Control>}y{/Control}');
    expect(storedDraft().labels).toEqual(added);
    expect(screen.getByText('已重做：新增手动唛头')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '剪切所选' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByText('待剪切')).toBeNull();
    expect(screen.getByText('已取消剪切')).toBeTruthy();
  });

  it('focuses record search with the find shortcut', async () => {
    const user = userEvent.setup();
    render(<App initialState={createInitialDraft()} />);

    await user.keyboard('{Control>}f{/Control}');

    expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: '搜索唛头' }));
  });
});

describe('使用过的唛头', () => {
  it('显示空状态，并通过原生按钮恢复历史条目', async () => {
    const user = userEvent.setup();
    const onRestore = vi.fn();
    const entry = recordRecentLabels([], [recentInput('FY-01\nMADE IN CHINA')], 1000)[0];
    const { rerender } = render(<SourceHistory entries={[]} onRestore={onRestore} />);

    expect(screen.getByText('暂时没有使用记录')).toBeTruthy();
    rerender(<SourceHistory entries={[entry]} onRestore={onRestore} />);
    expect(screen.getByText('FY-01')).toBeTruthy();
    expect(screen.getByText('100 × 60 mm · 2 件 · 手动')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '再次使用' }));
    expect(onRestore).toHaveBeenCalledWith(entry);
  });

  it('恢复时对物理和布局字段相同的同 ID 预设直接复用', async () => {
    const user = userEvent.setup();
    const entry = recordRecentLabels([], [recentInput('REUSE-PRESET')], 1000)[0];
    const state = createInitialDraft(null, [entry]);
    render(<App initialState={state} />);

    await user.click(screen.getByRole('button', { name: '再次使用' }));
    expect(screen.getByText('已从使用记录新增一条唛头')).toBeTruthy();

    await waitFor(() => {
      const saved = JSON.parse(window.localStorage.getItem(DRAFT_STORAGE_KEY) ?? '{}');
      const restored = saved.labels?.find((label: { content: string }) => label.content === 'REUSE-PRESET');
      expect(restored?.id).not.toBe(entry.label.id);
      expect(restored?.textLines.map((line: { id: string }) => line.id)).not.toEqual(entry.label.textLines.map((line) => line.id));
      expect(restored?.sizePresetId).toBe('large');
      expect(saved.sizePresets).toHaveLength(2);
    });
  });

  it('恢复时为字段已变更的同 ID 预设创建新 ID 并同步唛头引用', async () => {
    const user = userEvent.setup();
    const entry = recordRecentLabels([], [recentInput('SNAPSHOT-SIZE')], 1000)[0];
    const initial = createInitialDraft(null, [entry]);
    const state = {
      ...initial,
      sizePresets: initial.sizePresets.map((preset) => preset.id === 'large'
        ? { ...preset, widthMm: 88 }
        : preset),
    };
    render(<App initialState={state} />);

    await user.click(screen.getByRole('button', { name: '再次使用' }));

    await waitFor(() => {
      const saved = JSON.parse(window.localStorage.getItem(DRAFT_STORAGE_KEY) ?? '{}');
      const restored = saved.labels?.find((label: { content: string }) => label.content === 'SNAPSHOT-SIZE');
      expect(restored?.sizePresetId).not.toBe('large');
      expect(saved.sizePresets.find((preset: { id: string }) => preset.id === 'large').widthMm).toBe(88);
      expect(saved.sizePresets.find((preset: { id: string }) => preset.id === restored?.sizePresetId))
        .toMatchObject({ widthMm: 100, heightMm: 60 });
      expect(saved.sizePresets).toHaveLength(3);
    });
  });
});

describe('打印检查', () => {
  it('助手未安装且没有未决任务时刷新连接仍调用一次助手探测', async () => {
    const user = userEvent.setup();
    const { state } = directState('REFRESH-NOT-INSTALLED');
    directPrintHarness.connection = { kind: 'not-installed' };
    directPrintHarness.selectedPrinterId = null;
    render(<App initialState={state} />);

    await user.click(screen.getByRole('button', { name: '检查并打印' }));
    await user.click(screen.getByRole('button', { name: '刷新连接' }));

    expect(directPrintHarness.refresh).toHaveBeenCalledOnce();
    expect(directPrintHarness.jobStatus).not.toHaveBeenCalled();
  });

  it('助手缺失与校准动作只唤起固定的无载荷本机协议', async () => {
    const user = userEvent.setup();
    const launchedUrls: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function captureProtocol(this: HTMLAnchorElement) {
      launchedUrls.push(this.getAttribute('href') ?? '');
    });
    const { state } = directState('HELPER-PROTOCOL');
    directPrintHarness.connection = { kind: 'not-installed' };
    directPrintHarness.calibrationState = { kind: 'not-selected' };
    directPrintHarness.selectedPrinterId = null;
    const view = render(<App initialState={state} />);

    await user.click(screen.getByRole('button', { name: '检查并打印' }));
    await user.click(screen.getByRole('button', { name: '启动/打开打印助手' }));
    expect(launchedUrls).toEqual(['labelprint://start']);

    view.unmount();
    directPrintHarness.connection = { kind: 'ready', printers: [{
      id: 'xp420b', displayName: 'Xprinter XP-420B', isDefault: true, isCompatible: true,
      queueStatus: 'ready', isAvailable: true,
    }] };
    directPrintHarness.calibrationState = { kind: 'unverified', printerId: 'xp420b' };
    directPrintHarness.selectedPrinterId = 'xp420b';
    render(<App initialState={state} />);
    await user.click(screen.getByRole('button', { name: '检查并打印' }));
    await user.click(screen.getByRole('button', { name: '校准打印机' }));

    expect(launchedUrls).toEqual(['labelprint://start', 'labelprint://calibrate']);
    expect(screen.getByText(/浏览器无法确认助手是否已完成校准/)).toBeTruthy();
  });

  it('单一默认大唛头改为 100 × 75 后在助手未安装时仍进入网站直打', async () => {
    const user = userEvent.setup();
    const label = createLabel({
      content: 'SINGLE-DEFAULT-PRESET-100X75',
      quantity: 2,
      source: 'manual',
      needsReview: false,
      sizePresetId: 'large',
    });
    label.style.fontMode = 'auto';
    const initial = createInitialDraft();
    const { unmount } = render(<App initialState={{
      ...initial,
      labels: [label],
      activeLabelId: label.id,
    }} />);

    const width = screen.getByRole('spinbutton', { name: '宽度（mm）' });
    const height = screen.getByRole('spinbutton', { name: '高度（mm）' });
    await user.clear(width);
    await user.type(width, '100');
    await user.clear(height);
    await user.type(height, '75');

    const saved = storedDraft();
    await waitFor(() => expect(saved.sizePresets.find(({ id }) => id === 'large'))
      .toMatchObject({ widthMm: 100, heightMm: 75 }));
    expect(typeof saved.sizePresets.find(({ id }) => id === 'large')!.widthMm).toBe('number');
    expect(typeof saved.sizePresets.find(({ id }) => id === 'large')!.heightMm).toBe('number');
    unmount();
    directPrintHarness.connection = { kind: 'not-installed' };
    directPrintHarness.selectedPrinterId = null;
    render(<App />);

    await user.click(screen.getByRole('button', { name: '检查并打印' }));

    expect(screen.getByRole('dialog', { name: '直接打印标签' })).toBeTruthy();
    expect(screen.getByText(/未检测到打印助手/)).toBeTruthy();
    expect(screen.getByText('所选 2 张 × 1 份 = 将发送 2 张实体标签')).toBeTruthy();
  });

  it('混合计划中的默认大唛头经界面改为 100 × 75 后按组进入网站直打对话框', async () => {
    const user = userEvent.setup();
    const directLabel = createLabel({
      content: 'DEFAULT-PRESET-100X75',
      quantity: 1,
      source: 'manual',
      needsReview: false,
      sizePresetId: 'large',
    });
    const otherLabel = createLabel({
      content: 'OTHER-DEFAULT-PRESET',
      quantity: 1,
      source: 'manual',
      needsReview: false,
      sizePresetId: 'small',
    });
    directLabel.style.fontMode = 'auto';
    otherLabel.style.fontMode = 'auto';
    const initial = createInitialDraft();
    const { unmount } = render(<App initialState={{
      ...initial,
      labels: [directLabel, otherLabel],
      activeLabelId: directLabel.id,
    }} />);

    const width = screen.getByRole('spinbutton', { name: '宽度（mm）' });
    const height = screen.getByRole('spinbutton', { name: '高度（mm）' });
    await user.clear(width);
    await user.type(width, '100');
    await user.clear(height);
    await user.type(height, '75');

    await waitFor(() => expect(storedDraft().sizePresets.find(({ id }) => id === 'large'))
      .toMatchObject({ widthMm: 100, heightMm: 75 }));
    unmount();
    directPrintHarness.connection = { kind: 'not-installed' };
    directPrintHarness.selectedPrinterId = null;
    render(<App />);

    expect((screen.getByRole('spinbutton', { name: '宽度（mm）' }) as HTMLInputElement).value).toBe('100');
    expect((screen.getByRole('spinbutton', { name: '高度（mm）' }) as HTMLInputElement).value).toBe('75');
    await user.click(screen.getByRole('button', { name: '检查并打印' }));

    expect(screen.getByText('PRINT CHECK · 打印检查')).toBeTruthy();
    const directGroup = screen.getByText('100 × 75 mm').closest('article');
    expect(directGroup).not.toBeNull();
    await user.click(within(directGroup!).getByRole('button', { name: '直接打印标签' }));

    expect(screen.getByRole('dialog', { name: '直接打印标签' })).toBeTruthy();
    expect(screen.queryByText('PRINT CHECK · 打印检查')).toBeNull();
    expect(screen.getByText(/未检测到打印助手/)).toBeTruthy();
  });

  it('正常直接打印只提交一个助手任务且绝不调用浏览器打印', async () => {
    const user = userEvent.setup();
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { state } = directState();
    render(<App initialState={state} />);

    await user.click(screen.getByRole('button', { name: '检查并打印' }));
    await user.click(screen.getByRole('button', { name: '直接打印' }));

    await waitFor(() => expect(screen.getByText('已向打印队列提交 1 张')).toBeTruthy());
    expect(print).not.toHaveBeenCalled();
    expect(directPrintHarness.submitJob).toHaveBeenCalledOnce();
    expect(directPrintHarness.submitJob.mock.calls[0][0]).toMatchObject({ expectedLabels: 1, printerId: 'xp420b' });
  });

  it('一次点击只创建一个任务，连续点击不会重复渲染或提交', async () => {
    let finishRender!: () => void;
    const { state, label } = directState();
    directPrintHarness.renderAsset.mockImplementationOnce(() => new Promise((resolve) => {
      finishRender = () => resolve({ assetId: 'asset-one', labelId: label.id, widthDots: 800, heightDots: 600,
        rotation: 0, pngBase64: DIRECT_PNG, sha256: 'b'.repeat(64) });
    }));
    render(<App initialState={state} />);
    fireEvent.click(screen.getByRole('button', { name: '检查并打印' }));
    const direct = screen.getByRole('button', { name: '直接打印' });
    fireEvent.click(direct);
    fireEvent.click(direct);

    expect(screen.getByText('正在生成 1 / 1')).toBeTruthy();
    expect(directPrintHarness.renderAsset).toHaveBeenCalledOnce();
    await act(async () => finishRender());
    await waitFor(() => expect(directPrintHarness.submitJob).toHaveBeenCalledOnce());
  });

  it('重复物理页只上传一个位图资产，但保留逐份顺序和四个实体序列项', async () => {
    const user = userEvent.setup();
    const { state } = directState('TWO-PAGES', 2);
    render(<App initialState={state} />);
    await user.click(screen.getByRole('button', { name: '检查并打印' }));
    await user.clear(screen.getByRole('spinbutton', { name: '打印份数' }));
    await user.type(screen.getByRole('spinbutton', { name: '打印份数' }), '2');
    await user.click(screen.getByRole('checkbox', { name: '逐份打印' }));
    await user.click(screen.getByRole('button', { name: '直接打印' }));

    await waitFor(() => expect(directPrintHarness.submitJob).toHaveBeenCalledOnce());
    const [manifest, assets] = directPrintHarness.submitJob.mock.calls[0];
    expect(assets).toHaveLength(1);
    expect(manifest.assets).toHaveLength(1);
    expect(manifest.sequence.map(({ sourcePageNumber, copyNumber }: { sourcePageNumber: number; copyNumber: number }) =>
      [sourcePageNumber, copyNumber])).toEqual([[1, 1], [2, 1], [1, 2], [2, 2]]);
    expect(manifest.expectedLabels).toBe(4);
  });

  it('依次显示生成、上传和提交进度且提交期间锁定设置', async () => {
    const user = userEvent.setup();
    let progress!: (value: unknown) => void;
    let finish!: (value: PrintJobStatus) => void;
    directPrintHarness.submitJob.mockImplementationOnce((manifest, _assets, onProgress) => {
      progress = onProgress;
      onProgress({ stage: 'creating', completed: 0, total: 1 });
      return new Promise((resolve) => { finish = resolve; });
    });
    const { state } = directState('PROGRESS');
    render(<App initialState={state} />);
    await user.click(screen.getByRole('button', { name: '检查并打印' }));
    await user.click(screen.getByRole('button', { name: '直接打印' }));
    expect(await screen.findByText('正在上传 0 / 1')).toBeTruthy();
    expect((screen.getByRole('spinbutton', { name: '打印份数' }) as HTMLInputElement).disabled).toBe(true);

    act(() => progress({ stage: 'uploading', completed: 1, total: 1, assetId: 'asset' }));
    expect(screen.getByText('正在上传 1 / 1')).toBeTruthy();
    act(() => progress({ stage: 'committing', completed: 1, total: 1 }));
    expect(screen.getByText('正在提交 1 张')).toBeTruthy();
    await act(async () => finish(helperStatus(directPrintHarness.submitJob.mock.calls[0][0].jobId, 'submitted')));
  });

  it('助手明确拒绝时保留设置并允许用户安全发起一个新任务', async () => {
    const user = userEvent.setup();
    directPrintHarness.submitJob
      .mockImplementationOnce(async (_manifest, _assets, onProgress) => {
        onProgress({ stage: 'creating', completed: 0, total: 1 });
        throw new PrintHelperError('http', '助手明确拒绝任务', 409);
      })
      .mockImplementationOnce(async (manifest) => helperStatus(manifest.jobId, 'submitted'));
    const { state } = directState('KNOWN-FAILURE');
    render(<App initialState={state} />);
    await user.click(screen.getByRole('button', { name: '检查并打印' }));
    await user.clear(screen.getByRole('spinbutton', { name: '水平偏移' }));
    await user.type(screen.getByRole('spinbutton', { name: '水平偏移' }), '1.5');
    await user.click(screen.getByRole('button', { name: '直接打印' }));
    expect(await screen.findByText('助手明确拒绝任务')).toBeTruthy();
    expect((screen.getByRole('spinbutton', { name: '水平偏移' }) as HTMLInputElement).value).toBe('1.5');
    const firstJobId = directPrintHarness.submitJob.mock.calls[0][0].jobId;

    await user.click(screen.getByRole('button', { name: '直接打印' }));
    await waitFor(() => expect(directPrintHarness.submitJob).toHaveBeenCalledTimes(2));
    expect(directPrintHarness.submitJob.mock.calls[1][0].jobId).not.toBe(firstJobId);
  });

  it('将不确定提交锁定到原任务，并在刷新后只查询该任务状态', async () => {
    const user = userEvent.setup();
    let originalJobId = '';
    directPrintHarness.submitJob.mockImplementationOnce(async (manifest) => {
      originalJobId = manifest.jobId;
      throw new PrintHelperError('uncertain', '提交结果未知', undefined, manifest.jobId);
    });
    directPrintHarness.jobStatus.mockImplementationOnce(async (jobId) => helperStatus(jobId, 'submitted'));
    const { state } = directState('UNKNOWN');
    render(<App initialState={state} />);
    await user.click(screen.getByRole('button', { name: '检查并打印' }));
    await user.click(screen.getByRole('button', { name: '直接打印' }));
    await waitFor(() => expect(screen.getAllByText(/提交结果未知/).length).toBeGreaterThan(0));

    await user.click(screen.getByRole('button', { name: '刷新连接' }));
    await waitFor(() => expect(directPrintHarness.jobStatus).toHaveBeenCalledWith(originalJobId));
    expect(screen.getByText('已向打印队列提交 1 张')).toBeTruthy();
  });

  it('部分提交后只从第一张未确认标签创建新的剩余任务', async () => {
    const user = userEvent.setup();
    directPrintHarness.submitJob
      .mockImplementationOnce(async (manifest) => helperStatus(manifest.jobId, 'partial', ['submitted', 'submitted', 'failed', 'unknown']))
      .mockImplementationOnce(async (manifest) => helperStatus(manifest.jobId, 'submitted', ['submitted', 'submitted']));
    const { state } = directState('TWO-BY-TWO', 2);
    render(<App initialState={state} />);
    await user.click(screen.getByRole('button', { name: '检查并打印' }));
    await user.clear(screen.getByRole('spinbutton', { name: '打印份数' }));
    await user.type(screen.getByRole('spinbutton', { name: '打印份数' }), '2');
    await user.click(screen.getByRole('button', { name: '直接打印' }));
    const remaining = await screen.findByRole('button', { name: '从第 3 张创建新任务' });
    await user.click(remaining);

    await waitFor(() => expect(directPrintHarness.submitJob).toHaveBeenCalledTimes(2));
    const firstManifest = directPrintHarness.submitJob.mock.calls[0][0];
    const remainingManifest = directPrintHarness.submitJob.mock.calls[1][0];
    expect(remainingManifest.jobId).not.toBe(firstManifest.jobId);
    expect(remainingManifest.expectedLabels).toBe(2);
    expect(remainingManifest.sequence).toHaveLength(2);
  });

  it('部分提交页不连续时，剩余任务精确排除所有已确认实体页', async () => {
    const user = userEvent.setup();
    const first = createLabel({ content: 'NONCONTIGUOUS-A', quantity: 1, source: 'manual', needsReview: false, sizePresetId: directPreset.id });
    const second = createLabel({ content: 'NONCONTIGUOUS-B', quantity: 1, source: 'manual', needsReview: false, sizePresetId: directPreset.id });
    first.style.fontMode = 'auto';
    second.style.fontMode = 'auto';
    const state = { ...createInitialDraft(), labels: [first, second], activeLabelId: first.id,
      sizePresets: [...defaultSizePresets, directPreset] };
    directPrintHarness.submitJob.mockImplementationOnce(async (manifest) =>
      helperStatus(manifest.jobId, 'partial', ['submitted', 'failed', 'submitted', 'unknown']));
    render(<App initialState={state} />);
    await user.click(screen.getByRole('button', { name: '检查并打印' }));
    await user.clear(screen.getByRole('spinbutton', { name: '打印份数' }));
    await user.type(screen.getByRole('spinbutton', { name: '打印份数' }), '2');
    await user.click(screen.getByRole('checkbox', { name: '逐份打印' }));
    await user.click(screen.getByRole('button', { name: '直接打印' }));

    await user.click(await screen.findByRole('button', { name: '从第 2 张创建新任务' }));
    await waitFor(() => expect(directPrintHarness.submitJob).toHaveBeenCalledTimes(2));

    const remainingManifest = directPrintHarness.submitJob.mock.calls[1][0];
    expect(remainingManifest.expectedLabels).toBe(2);
    expect(remainingManifest.sequence.map((entry: { labelId: string }) => entry.labelId))
      .toEqual([second.id, second.id]);
  });

  it('未知任务刷新出非连续已提交页后，剩余任务只包含未确认实体页', async () => {
    const user = userEvent.setup();
    const first = createLabel({ content: 'RECOVERED-A', quantity: 1, source: 'manual', needsReview: false, sizePresetId: directPreset.id });
    const second = createLabel({ content: 'RECOVERED-B', quantity: 1, source: 'manual', needsReview: false, sizePresetId: directPreset.id });
    first.style.fontMode = 'auto';
    second.style.fontMode = 'auto';
    const state = { ...createInitialDraft(), labels: [first, second], activeLabelId: first.id,
      sizePresets: [...defaultSizePresets, directPreset] };
    let originalJobId = '';
    directPrintHarness.submitJob.mockImplementationOnce(async (manifest) => {
      originalJobId = manifest.jobId;
      throw new PrintHelperError('uncertain', '提交结果未知', undefined, manifest.jobId);
    });
    directPrintHarness.jobStatus.mockImplementationOnce(async (jobId) =>
      helperStatus(jobId, 'unknown', ['submitted', 'failed', 'submitted', 'unknown']));
    render(<App initialState={state} />);
    await user.click(screen.getByRole('button', { name: '检查并打印' }));
    await user.clear(screen.getByRole('spinbutton', { name: '打印份数' }));
    await user.type(screen.getByRole('spinbutton', { name: '打印份数' }), '2');
    await user.click(screen.getByRole('checkbox', { name: '逐份打印' }));
    await user.click(screen.getByRole('button', { name: '直接打印' }));
    await waitFor(() => expect(screen.getAllByText(/提交结果未知/).length).toBeGreaterThan(0));

    await user.click(screen.getByRole('button', { name: '刷新连接' }));
    await waitFor(() => expect(directPrintHarness.jobStatus).toHaveBeenCalledWith(originalJobId));
    await user.click(await screen.findByRole('button', { name: '从第 2 张创建新任务' }));
    await waitFor(() => expect(directPrintHarness.submitJob).toHaveBeenCalledTimes(2));

    const remainingManifest = directPrintHarness.submitJob.mock.calls[1][0];
    expect(remainingManifest.expectedLabels).toBe(2);
    expect(remainingManifest.sequence.map((entry: { labelId: string }) => entry.labelId))
      .toEqual([second.id, second.id]);
  });

  it('关闭并重开未决任务时恢复原任务、打印计划、旋转和设置', async () => {
    const user = userEvent.setup();
    directPrintHarness.submitJob.mockImplementationOnce(async (manifest) =>
      helperStatus(manifest.jobId, 'partial', ['submitted', 'unknown']));
    directPrintHarness.jobStatus.mockImplementationOnce(async (jobId) =>
      helperStatus(jobId, 'submitted', ['submitted', 'submitted']));
    const { state } = directState('RESUME-PARTIAL');
    render(<App initialState={state} />);
    await user.click(screen.getByRole('button', { name: '检查并打印' }));
    await user.clear(screen.getByRole('spinbutton', { name: '打印份数' }));
    await user.type(screen.getByRole('spinbutton', { name: '打印份数' }), '2');
    await user.clear(screen.getByRole('spinbutton', { name: '水平偏移' }));
    await user.type(screen.getByRole('spinbutton', { name: '水平偏移' }), '1.5');
    await user.click(screen.getByRole('radio', { name: '纵向' }));
    await user.click(screen.getByRole('button', { name: '旋转当前文字标签 90°' }));
    await user.click(screen.getByRole('button', { name: '直接打印' }));
    await screen.findByRole('button', { name: '从第 2 张创建新任务' });
    const originalJobId = directPrintHarness.submitJob.mock.calls[0][0].jobId;

    await user.click(screen.getByRole('button', { name: '关闭' }));
    await user.click(screen.getByRole('button', { name: '增加第 1 条唛头的打印数量' }));
    await user.click(screen.getByRole('button', { name: '检查并打印' }));

    expect(screen.getByRole('button', { name: '从第 2 张创建新任务' })).toBeTruthy();
    expect((screen.getByRole('spinbutton', { name: '打印份数' }) as HTMLInputElement).value).toBe('2');
    expect((screen.getByRole('spinbutton', { name: '水平偏移' }) as HTMLInputElement).value).toBe('1.5');
    expect((screen.getByRole('radio', { name: '纵向' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText('当前 90°')).toBeTruthy();
    expect(screen.getByText('第 1 / 共 1 张')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '刷新连接' }));
    await waitFor(() => expect(directPrintHarness.jobStatus).toHaveBeenCalledWith(originalJobId));
  });

  it('刷新连接尚未完成时创建剩余任务，不查询替换后的新任务', async () => {
    const user = userEvent.setup();
    let finishRefresh!: () => void;
    let finishRemaining!: (status: PrintJobStatus) => void;
    directPrintHarness.refresh.mockImplementationOnce(() => new Promise<undefined>((resolve) => {
      finishRefresh = () => resolve(undefined);
    }));
    directPrintHarness.submitJob
      .mockImplementationOnce(async (manifest) => helperStatus(manifest.jobId, 'partial', ['submitted', 'unknown']))
      .mockImplementationOnce(() => new Promise((resolve) => { finishRemaining = resolve; }));
    directPrintHarness.jobStatus.mockImplementation(async (jobId) => helperStatus(jobId, 'submitted'));
    const { state } = directState('REFRESH-RACE');
    render(<App initialState={state} />);
    await user.click(screen.getByRole('button', { name: '检查并打印' }));
    await user.clear(screen.getByRole('spinbutton', { name: '打印份数' }));
    await user.type(screen.getByRole('spinbutton', { name: '打印份数' }), '2');
    await user.click(screen.getByRole('button', { name: '直接打印' }));
    const remaining = await screen.findByRole('button', { name: '从第 2 张创建新任务' });

    await user.click(screen.getByRole('button', { name: '刷新连接' }));
    await waitFor(() => expect(directPrintHarness.refresh).toHaveBeenCalledOnce());
    await user.click(remaining);
    await waitFor(() => expect(directPrintHarness.submitJob).toHaveBeenCalledTimes(2));
    await act(async () => finishRefresh());

    expect(directPrintHarness.jobStatus).not.toHaveBeenCalled();
    const remainingJobId = directPrintHarness.submitJob.mock.calls[1][0].jobId;
    await act(async () => finishRemaining(helperStatus(remainingJobId, 'submitted')));
  });

  it('原任务状态查询返回前创建剩余任务时丢弃旧查询结果', async () => {
    const user = userEvent.setup();
    let finishOriginalStatus!: (status: PrintJobStatus) => void;
    let finishRemaining!: (status: PrintJobStatus) => void;
    directPrintHarness.submitJob
      .mockImplementationOnce(async (manifest) => helperStatus(manifest.jobId, 'partial', ['submitted', 'unknown']))
      .mockImplementationOnce(() => new Promise((resolve) => { finishRemaining = resolve; }));
    directPrintHarness.jobStatus.mockImplementationOnce(() =>
      new Promise((resolve) => { finishOriginalStatus = resolve; }));
    const { state } = directState('STATUS-RACE');
    render(<App initialState={state} />);
    await user.click(screen.getByRole('button', { name: '检查并打印' }));
    await user.clear(screen.getByRole('spinbutton', { name: '打印份数' }));
    await user.type(screen.getByRole('spinbutton', { name: '打印份数' }), '2');
    await user.click(screen.getByRole('button', { name: '直接打印' }));
    const remaining = await screen.findByRole('button', { name: '从第 2 张创建新任务' });
    const originalJobId = directPrintHarness.submitJob.mock.calls[0][0].jobId;

    await user.click(screen.getByRole('button', { name: '刷新连接' }));
    await waitFor(() => expect(directPrintHarness.jobStatus).toHaveBeenCalledWith(originalJobId));
    await user.click(remaining);
    await waitFor(() => expect(directPrintHarness.submitJob).toHaveBeenCalledTimes(2));
    await act(async () => finishOriginalStatus(helperStatus(originalJobId, 'submitted', ['submitted', 'submitted'])));

    expect(screen.queryByText('已向打印队列提交 2 张')).toBeNull();
    const remainingJobId = directPrintHarness.submitJob.mock.calls[1][0].jobId;
    await act(async () => finishRemaining(helperStatus(remainingJobId, 'submitted')));
  });

  it('渲染期间卸载会取消任务，且渲染完成后不会提交', async () => {
    let finishRender!: (asset: Awaited<ReturnType<typeof directPrintHarness.renderAsset>>) => void;
    const { state, label } = directState('UNMOUNT-RENDER');
    directPrintHarness.renderAsset.mockImplementationOnce(() =>
      new Promise((resolve) => { finishRender = resolve; }));
    const { unmount } = render(<App initialState={state} />);
    fireEvent.click(screen.getByRole('button', { name: '检查并打印' }));
    fireEvent.click(screen.getByRole('button', { name: '直接打印' }));
    await waitFor(() => expect(directPrintHarness.renderAsset).toHaveBeenCalledOnce());

    unmount();
    await act(async () => finishRender({
      assetId: 'asset-unmounted', labelId: label.id, widthDots: 800, heightDots: 600,
      rotation: 0, pngBase64: DIRECT_PNG, sha256: 'b'.repeat(64),
    }));

    expect(directPrintHarness.cancelSubmission).toHaveBeenCalledOnce();
    expect(directPrintHarness.submitJob).not.toHaveBeenCalled();
  });

  it('混合尺寸计划回退到旧打印检查并保留每个分组入口', async () => {
    const user = userEvent.setup();
    const direct = createLabel({ content: 'DIRECT-GROUP', quantity: 1, source: 'manual', needsReview: false, sizePresetId: directPreset.id });
    const legacy = createLabel({ content: 'LEGACY-GROUP', quantity: 1, source: 'manual', needsReview: false, sizePresetId: defaultSizePresets[0].id });
    direct.style.fontMode = 'auto';
    legacy.style.fontMode = 'auto';
    const state = { ...createInitialDraft(), labels: [direct, legacy], activeLabelId: direct.id,
      sizePresets: [...defaultSizePresets, directPreset] };
    render(<App initialState={state} />);

    await user.click(screen.getByRole('button', { name: '检查并打印' }));

    expect(screen.queryByRole('dialog', { name: '直接打印标签' })).toBeNull();
    expect(screen.getByRole('button', { name: '直接打印标签' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '浏览器打印（应急）' })).toBeTruthy();
    expect(screen.getByText('100 × 75 mm')).toBeTruthy();
    expect(screen.getByText(`${defaultSizePresets[0].widthMm} × ${defaultSizePresets[0].heightMm} mm`)).toBeTruthy();
  });

  it('只有用户确认的浏览器应急入口会调用 window.print', async () => {
    const user = userEvent.setup();
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => (callbacks.push(callback), callbacks.length));
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { state } = directState('EMERGENCY');
    render(<App initialState={state} />);
    await user.click(screen.getByRole('button', { name: '检查并打印' }));
    await user.click(screen.getByRole('button', { name: '更多操作' }));
    await user.click(screen.getByRole('button', { name: '浏览器打印（应急）' }));
    expect(print).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '仍然打开浏览器打印' }));
    await act(async () => { callbacks.shift()?.(0); callbacks.shift()?.(16); });
    expect(print).toHaveBeenCalledOnce();
  });

  it('非 100 × 75 分组明确标为浏览器应急且二次确认后才打印', async () => {
    const user = userEvent.setup();
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => (callbacks.push(callback), callbacks.length));
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const label = createLabel({
      content: 'LEGACY-EMERGENCY', quantity: 1, source: 'manual', needsReview: false,
      sizePresetId: defaultSizePresets[0].id,
    });
    label.style.fontMode = 'auto';
    render(<App initialState={{ ...createInitialDraft(), labels: [label], activeLabelId: label.id }} />);

    await user.click(screen.getByRole('button', { name: '检查并打印' }));
    await user.click(screen.getByRole('button', { name: '浏览器打印（应急）' }));

    expect(screen.getByText(/纸张设置不一致，内容可能再次被拆分到两张纸/)).toBeTruthy();
    expect(print).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '仍然打开浏览器打印' }));
    await act(async () => { callbacks.shift()?.(0); callbacks.shift()?.(16); });
    expect(print).toHaveBeenCalledOnce();
  });

  it('直打应急确认关闭对话框且 afterprint 后重开不会保留动作锁', async () => {
    const user = userEvent.setup();
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => (callbacks.push(callback), callbacks.length));
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { state } = directState('EMERGENCY-UNLOCK');
    render(<App initialState={state} />);

    await user.click(screen.getByRole('button', { name: '检查并打印' }));
    await user.click(screen.getByRole('button', { name: '更多操作' }));
    await user.click(screen.getByRole('button', { name: '浏览器打印（应急）' }));
    await user.click(screen.getByRole('button', { name: '仍然打开浏览器打印' }));

    expect(screen.queryByRole('dialog', { name: '直接打印标签' })).toBeNull();
    await act(async () => { callbacks.shift()?.(0); callbacks.shift()?.(16); });
    expect(print).toHaveBeenCalledOnce();
    await act(async () => window.dispatchEvent(new Event('afterprint')));

    await user.click(screen.getByRole('button', { name: '检查并打印' }));
    expect(screen.getByRole('dialog', { name: '直接打印标签' })).toBeTruthy();
    expect((screen.getByRole('button', { name: '直接打印' }) as HTMLButtonElement).disabled).toBe(false);
    expect(print).toHaveBeenCalledOnce();
  });

  it('合法的旧待校对唛头可进入预览并立即写入历史', async () => {
    const user = userEvent.setup();
    const legacy = createLabel({ content: 'LEGACY-READY', quantity: 1, source: 'manual', needsReview: true });
    legacy.style.fontMode = 'auto';
    const state = { ...createInitialDraft(), labels: [legacy], activeLabelId: legacy.id };
    render(<App initialState={state} />);

    await user.click(screen.getByRole('button', { name: '打印预览' }));

    expect(screen.getByRole('dialog', { name: /可以打印/ })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '关闭' }));
    expect(screen.getByText('使用过的唛头')).toBeTruthy();
    expect(screen.getByRole('button', { name: '再次使用' })).toBeTruthy();
    await expectStoredHistory(['LEGACY-READY']);
  });

  it('列表内修改打印数量会更新下一次预览的总张数', async () => {
    const user = userEvent.setup();
    const label = createLabel({ content: 'QUANTITY-PREVIEW', quantity: 1, sides: 2, source: 'manual', needsReview: false });
    label.style.fontMode = 'auto';
    const state = { ...createInitialDraft(), labels: [label], activeLabelId: label.id };
    render(<App initialState={state} />);

    await user.click(screen.getByRole('button', { name: '增加第 1 条唛头的打印数量' }));
    await user.click(screen.getByRole('button', { name: '打印预览' }));

    expect(screen.getByRole('dialog', { name: '共 4 张，可以打印' })).toBeTruthy();
    expect(screen.getByText('1 × 程序生成 4 张 = 实际打印 4 张')).toBeTruthy();
  });

  it('单条打印预览只记录当前合法唛头', async () => {
    const user = userEvent.setup();
    const active = createLabel({ content: 'ACTIVE', quantity: 1, source: 'manual', needsReview: false });
    const other = createLabel({ content: 'OTHER', quantity: 1, source: 'manual', needsReview: false });
    const state = { ...createInitialDraft(), labels: [active, other], activeLabelId: active.id };
    render(<App initialState={state} />);

    await user.click(screen.getByRole('button', { name: '打印预览' }));

    const dialog = screen.getByRole('dialog', { name: '共 1 张，可以打印' });
    expect(dialog.textContent).toContain('ACTIVE');
    expect(dialog.textContent).not.toContain('OTHER');
    await expectStoredHistory(['ACTIVE']);
  });

  it('顶部打印检查记录所有合法唛头，并忽略阻塞项和重复打印页', async () => {
    const user = userEvent.setup();
    const first = createLabel({ content: 'FIRST', quantity: 1, source: 'manual', needsReview: false });
    const blocked = createLabel({ content: '', quantity: 1, source: 'manual', needsReview: false });
    const second = createLabel({ content: 'SECOND', quantity: 2, source: 'manual', needsReview: false });
    const state = { ...createInitialDraft(), labels: [first, blocked, second], activeLabelId: first.id };
    render(<App initialState={state} />);

    await user.click(screen.getByRole('button', { name: '检查并打印' }));

    expect(screen.getByRole('dialog')).toBeTruthy();
    await expectStoredHistory(['SECOND', 'FIRST']);
  });

  it('本机存储写入失败不阻止打开预览', async () => {
    const user = userEvent.setup();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    const label = createLabel({ content: 'PRINTABLE', quantity: 1, source: 'manual', needsReview: false });
    const state = { ...createInitialDraft(), labels: [label], activeLabelId: label.id };
    render(<App initialState={state} />);

    await user.click(screen.getByRole('button', { name: '打印预览' }));

    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('把精确毫米尺寸写入剪贴板，并报告浏览器拒绝写入', async () => {
    const clipboard = printReviewModule as unknown as {
      copyPaperSizeToClipboard: (
        sizeLabel: string,
        writer?: { writeText: (text: string) => Promise<void> },
      ) => Promise<boolean>;
    };
    const copiedText: string[] = [];

    await expect(clipboard.copyPaperSizeToClipboard('86 × 45 mm', {
      writeText: async (text) => { copiedText.push(text); },
    })).resolves.toBe(true);
    expect(copiedText).toEqual(['86 × 45 mm']);
    await expect(clipboard.copyPaperSizeToClipboard('86 × 45 mm', {
      writeText: async () => { throw new Error('denied'); },
    })).resolves.toBe(false);
  });

  it('明确要求系统打印份数保持 1，并按列表打印数量乘张贴面数生成打印张数', () => {
    const label = createLabel({
      content: 'FYF-TTT0103',
      quantity: 3,
      sides: 2,
      source: 'manual',
      needsReview: false,
    });
    label.style.fontMode = 'auto';
    const plan = createPrintPlan([label], defaultSizePresets);
    const html = renderToStaticMarkup(<PrintReviewDialog
      mode="legacy"
      open
      plan={plan}
      rotations={{}}
      layouts={{}}
      onRotateLabel={() => undefined}
      onLayoutChange={() => undefined}
      onClose={() => undefined}
      onEditLabel={() => undefined}
      onPrintGroup={() => undefined}
    />);

    expect(html).toContain('系统打印份数保持 1');
    expect(html).toContain('1 × 程序生成 6 张 = 实际打印 6 张');
  });

  it('为浏览器系统打印窗口提供精确纸张尺寸和驱动设置说明', () => {
    const label = createLabel({
      content: 'FYF-TTT0103',
      quantity: 1,
      source: 'manual',
      needsReview: false,
    });
    label.style.fontMode = 'auto';
    const plan = createPrintPlan([label], defaultSizePresets);
    const html = renderToStaticMarkup(<PrintReviewDialog
      mode="legacy"
      open
      plan={plan}
      rotations={{}}
      layouts={{}}
      onRotateLabel={() => undefined}
      onLayoutChange={() => undefined}
      onClose={() => undefined}
      onEditLabel={() => undefined}
      onPrintGroup={() => undefined}
    />);

    expect(html).toContain('自定义纸张');
    expect(html).toContain('复制 70 × 45 mm');
    expect(html).toContain('打印机首选项');
    expect(html).toContain('缩放保持 100%');
    expect(html).toContain('不要选择 A4 或信纸代替');
  });

  it('打印输出仅保留实际纸张，非打印界面不参与浏览器分页', () => {
    const label = createLabel({
      content: 'FYF-TTT0103',
      quantity: 2,
      sides: 2,
      source: 'manual',
      needsReview: false,
    });
    label.style.fontMode = 'auto';
    const group = createPrintPlan([label], defaultSizePresets).groups[0];
    const html = renderToStaticMarkup(<PrintPages group={group} />);

    expect(html.match(/<section class="print-page[^"]*"/g)).toHaveLength(4);
    expect(html).toMatch(/\.app-shell[^}]*display:\s*none\s*!important/);
    expect(html).toMatch(/\.dialog-backdrop[^}]*display:\s*none\s*!important/);
    expect(html).toMatch(/\.print-root[^}]*position:\s*static\s*!important/);
  });

  it('实际打印使用预览中设置的毫米打印区域', () => {
    const label = {
      ...createLabel({ content: 'FY', quantity: 1, source: 'manual', needsReview: false }),
      printArea: { leftMm: 10, topMm: 5, widthMm: 40, heightMm: 20 },
    };
    const group = createPrintPlan([label,], defaultSizePresets).groups[0];
    const html = renderToStaticMarkup(<PrintPages group={group} />);

    expect(html).toContain('left:10mm');
    expect(html).toContain('top:5mm');
    expect(html).toContain('width:40mm');
    expect(html).toContain('height:20mm');
  });

  it('打印检查可循环旋转文字，并在关闭后清除临时角度', async () => {
    const user = userEvent.setup();
    const label = createLabel({ content: 'ROTATE-ME', quantity: 1, source: 'manual', needsReview: false });
    const state = { ...createInitialDraft(), labels: [label], activeLabelId: label.id };
    render(<App initialState={state} />);

    await user.click(screen.getByRole('button', { name: '打印预览' }));
    const rotate = screen.getByRole('button', { name: '旋转 70 × 45 mm 第 1 个文字唛头 ROTATE-ME 90°' });
    expect(screen.getByText('当前 0°')).toBeTruthy();
    await user.click(rotate);
    expect(screen.getByText('当前 90°')).toBeTruthy();
    await user.click(rotate);
    expect(screen.getByText('当前 180°')).toBeTruthy();
    await user.click(rotate);
    expect(screen.getByText('当前 270°')).toBeTruthy();
    await user.click(rotate);
    expect(screen.getByText('当前 0°')).toBeTruthy();
    await user.click(rotate);
    expect(screen.getByText('当前 90°')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '关闭' }));

    await user.click(screen.getByRole('button', { name: '打印预览' }));
    expect(screen.getByText('当前 0°')).toBeTruthy();
  });
});

describe('图片识别区域', () => {
  it('提供可视框选和精确数值输入作为非拖动操作', () => {
    const html = renderToStaticMarkup(<ImageCropSelector
      previewUrl="data:image/png;base64,AA=="
      fileName="mark.png"
      selection={{ xPercent: 10, yPercent: 20, widthPercent: 60, heightPercent: 40 }}
      onChange={() => undefined}
      onImageSize={() => undefined}
    />);

    expect(html).toContain('选择识别区域');
    expect(html).toContain('框选宽度（%）');
    expect(html).toContain('重新选择整张图片');
    expect(html).toContain('“唛头”同列下方或同行右侧');
    expect(html).toContain('去除其他标点与短噪声');
  });
});

describe('逐行预览', () => {
  it('从空白框输入单行唛头后使用自动放大的渲染字号', () => {
    render(<App initialState={createInitialDraft()} />);

    const input = screen.getByRole('textbox', { name: '直接输入唛头内容' });
    fireEvent.change(input, { target: { value: '1548' } });
    fireEvent.blur(input);

    const line = screen.getByRole('button', { name: /拖动第 1 行：1548/ });
    expect(line.style.fontSize).toBe('108px');
    expect(screen.getByRole('group', { name: /拖动内容打印区域/ }).getAttribute('style')).toContain('left: 0px');
    expect(screen.getByText(/第 1 行 · 81 pt · 正中/)).toBeTruthy();
  });

  it('屏幕预览和打印页使用同一个缩小后字号', () => {
    const label = createLabel({
      content: 'MMMM',
      quantity: 1,
      source: 'manual',
      sizePresetId: 'large',
      needsReview: false,
      printArea: { leftMm: 25, topMm: 15, widthMm: 50, heightMm: 30 },
    });
    label.style.fontMode = 'auto';
    label.style.fontSizePt = 48;
    const previewHtml = renderToStaticMarkup(<LabelPreview
      label={label}
      preset={defaultSizePresets[0]}
      activeLineId={label.textLines[0].id}
      selectedLineIds={[label.textLines[0].id]}
      onActiveLineChange={() => undefined}
      onSelectLine={() => undefined}
      onClearLineSelection={() => undefined}
      onChange={() => undefined}
    />);
    const group = createPrintPlan([label], defaultSizePresets).groups[0];
    const printHtml = renderToStaticMarkup(<PrintPages group={group} />);

    expect(previewHtml).toContain('font-size:49.33333333333333px');
    expect(previewHtml).not.toContain('font-size:64px');
    expect(printHtml).toContain('font-size:37pt');
    expect(printHtml).not.toContain('font-size:48pt');
  });

  it('屏幕预览和打印页分别渲染每行解析后的字号', () => {
    const label = createLabel({
      content: 'MMMM\nI',
      quantity: 1,
      source: 'manual',
      sizePresetId: 'large',
      needsReview: false,
      printArea: { leftMm: 25, topMm: 10, widthMm: 50, heightMm: 40 },
    });
    label.style.fontMode = 'auto';
    label.style.fontSizePt = 48;
    label.textLines[0].placement.yPercent = 22;
    label.textLines[1].placement.yPercent = 72;
    const previewHtml = renderToStaticMarkup(<LabelPreview
      label={label}
      preset={defaultSizePresets[0]}
      activeLineId={label.textLines[0].id}
      selectedLineIds={[label.textLines[0].id]}
      onActiveLineChange={() => undefined}
      onSelectLine={() => undefined}
      onClearLineSelection={() => undefined}
      onChange={() => undefined}
    />);
    const printHtml = renderToStaticMarkup(<PrintPages group={createPrintPlan([label], defaultSizePresets).groups[0]} />);

    expect(previewHtml).toContain('font-size:49.33333333333333px');
    expect(previewHtml).toContain('font-size:64px');
    expect(printHtml).toContain('font-size:37pt');
    expect(printHtml).toContain('font-size:48pt');
  });

  it('屏幕预览和打印页以相同比例缩小局部字符字号', () => {
    const label = createLabel({
      content: 'MMMM',
      quantity: 1,
      source: 'manual',
      sizePresetId: 'large',
      needsReview: false,
      printArea: { leftMm: 25, topMm: 15, widthMm: 50, heightMm: 30 },
    });
    label.style.fontMode = 'auto';
    label.style.fontSizePt = 48;
    label.textStyleRanges = [{ start: 0, end: 1, style: { fontSizePt: 60 } }];
    const previewHtml = renderToStaticMarkup(<LabelPreview
      label={label}
      preset={defaultSizePresets[0]}
      activeLineId={label.textLines[0].id}
      selectedLineIds={[label.textLines[0].id]}
      onActiveLineChange={() => undefined}
      onSelectLine={() => undefined}
      onClearLineSelection={() => undefined}
      onChange={() => undefined}
    />);
    const printHtml = renderToStaticMarkup(<PrintPages group={createPrintPlan([label], defaultSizePresets).groups[0]} />);

    expect(previewHtml).toContain('font-size:56.666666666666664px');
    expect(previewHtml).not.toContain('font-size:80px');
    expect(printHtml).toContain('font-size:42.5pt');
    expect(printHtml).not.toContain('font-size:60pt');
  });

  it('每一行都渲染成独立可拖动对象', () => {
    const label = createLabel({ content: 'FY-01\nMADE IN CHINA', quantity: 1, source: 'manual', needsReview: false });
    const html = renderToStaticMarkup(<LabelPreview
      label={label}
      preset={defaultSizePresets[0]}
      activeLineId={label.textLines[0].id}
      selectedLineIds={[label.textLines[0].id]}
      onActiveLineChange={() => undefined}
      onSelectLine={() => undefined}
      onClearLineSelection={() => undefined}
      onChange={() => undefined}
    />);

    expect(html.match(/拖动第 \d 行/g)).toHaveLength(2);
    expect(html).toContain('aria-pressed="true"');
    expect(html.match(/white-space:nowrap/g)).toHaveLength(2);
    expect(html.match(/调整第 1 行文字大小/g)).toHaveLength(4);
    expect(html).toContain('text-line-frame is-active-line');
  });

  it('文字行重叠时保持内容适配字号且不显示警告', () => {
    const label = createLabel({
      content: Array.from({ length: 9 }, (_, index) => `LONG SHIPPING MARK LINE ${index + 1}`).join('\n'),
      quantity: 1,
      source: 'image',
      needsReview: true,
    });
    label.style.fontMode = 'auto';
    label.style.fontSizePt = 12;
    const preset = defaultSizePresets.find((item) => item.id === 'small')!;
    const html = renderToStaticMarkup(<LabelPreview
      label={label}
      preset={preset}
      activeLineId={label.textLines[0].id}
      selectedLineIds={[label.textLines[0].id]}
      onActiveLineChange={() => undefined}
      onSelectLine={() => undefined}
      onClearLineSelection={() => undefined}
      onChange={() => undefined}
    />);

    expect(html).toContain('font-size:16px');
    expect(html).not.toContain('文字行发生重叠');
  });

  it('提供整体拖动和八方向缩放打印区域的语义控件', () => {
    const label = createLabel({ content: 'FY-01', quantity: 1, source: 'manual', needsReview: false });
    const html = renderToStaticMarkup(<LabelPreview
      label={label}
      preset={defaultSizePresets[0]}
      activeLineId={label.textLines[0].id}
      selectedLineIds={[label.textLines[0].id]}
      onActiveLineChange={() => undefined}
      onSelectLine={() => undefined}
      onClearLineSelection={() => undefined}
      onChange={() => undefined}
    />);

    expect(html).toContain('拖动内容打印区域');
    expect(html.match(/调整打印区域/g)).toHaveLength(8);
    expect(html).toContain('本行恢复正中');
    expect(html).toContain('layout-status-action');
  });
});

describe('右侧样式设置', () => {
  it('字号使用应用自有选择器，并把临时字号只应用到预览副本', () => {
    const label = createLabel({ content: 'FY-01\nMADE IN CHINA', quantity: 1, source: 'manual', needsReview: false });
    const html = renderToStaticMarkup(<SizeStylePanel
      label={label}
      presets={defaultSizePresets}
      onChange={() => undefined}
      onPresetChange={() => undefined}
      onFontSizePreview={() => undefined}
    />);

    const preview = buildFontSizePreviewLabel(label, { fontMode: 'fixed', fontSizePt: 64 });

    expect(html).toContain('aria-label="全部字号"');
    expect(html).toContain('role="combobox"');
    expect(preview).not.toBe(label);
    expect(preview.style).toMatchObject({ fontMode: 'fixed', fontSizePt: 64 });
    expect(preview.textLines.every((line) => line.style.fontSizePt === 64)).toBe(true);
    expect(label.style.fontSizePt).not.toBe(64);
  });

  it('省去重复区域标题和说明，只保留直接操作控件', () => {
    const label = createLabel({ content: 'FYF-TTT0103\n4576', quantity: 1, source: 'manual', needsReview: false });
    const html = renderToStaticMarkup(<SizeStylePanel
      label={label}
      presets={defaultSizePresets}
      onChange={() => undefined}
      onPresetChange={() => undefined}
    />);

    expect(html).toContain('aria-label="全部文字样式"');
    expect(html).not.toContain('>文字与尺寸<');
    expect(html).not.toContain('修改后覆盖预览中的全部文字');
    expect(html).toContain('全部文字强调');
  });

  it('提供直接的全部文字设置和始终可见的宽高输入', () => {
    const label = createLabel({ content: 'FYF-TTT0103\n4576', quantity: 1, source: 'manual', needsReview: false });
    const html = renderToStaticMarkup(<SizeStylePanel
      label={label}
      presets={defaultSizePresets}
      onChange={() => undefined}
      onPresetChange={() => undefined}
    />);

    expect(html).toContain('全部文字样式');
    expect(html).toContain('<span>全部字体</span>');
    expect(html).toContain('<span>全部字号</span>');
    expect(html).not.toContain('字号模式');
    expect(html).toContain('<span>自动排列方式</span>');
    expect(html).toContain('选择即应用');
    expect(html).toContain('保持当前左右位置');
    expect(html).not.toContain('全部自动排列');
    expect(html).not.toContain('<summary>');
    expect(html).toContain('宽度（mm）');
    expect(html).toContain('高度（mm）');
    expect(html).not.toContain('尺寸预设');
    expect(html).not.toContain('内边距（mm）');
    expect(html).not.toContain('内容打印区域（mm）');
    expect(html).toContain('<span>行距</span>');
    expect(html).not.toContain('<span>文字方向</span>');
    expect(html).not.toContain('<span>水平对齐</span>');
    expect(html).not.toContain('<span>垂直对齐</span>');
    expect(html).not.toContain('<span>边框粗细（mm）</span>');
    expect(html).not.toContain('placement-control');
  });

  it('当前行和选中文字样式说明修改后立即生效，不再需要应用按钮', () => {
    const label = createLabel({ content: 'FYF-TTT0103\n4576', quantity: 1, source: 'manual', needsReview: false });
    const html = renderToStaticMarkup(<LabelEditor
      label={label}
      activeLineId={label.textLines[0].id}
      selectedLineIds={[label.textLines[0].id]}
      onActiveLineChange={() => undefined}
      onSelectLine={() => undefined}
      onChange={() => undefined}
      onPrintPreview={() => undefined}
      reviewErrors={[]}
      onDuplicate={() => undefined}
      onDelete={() => undefined}
    />);

    expect(html).toContain('修改后立即生效');
    expect(html).not.toContain('应用到第');
    expect(html).not.toContain('应用到选中文字');
    expect(html).toContain('打印预览');
    expect(html).not.toContain('确认校对完成');
  });

  it('尺寸区只保留可修改的宽度和高度', () => {
    const label = createLabel({ content: 'FYF-TTT0103', quantity: 1, source: 'manual', needsReview: false });
    const html = renderToStaticMarkup(<SizeStylePanel
      label={label}
      presets={defaultSizePresets}
      onChange={() => undefined}
      onPresetChange={() => undefined}
    />);

    expect(html).toContain('宽度（mm）');
    expect(html).toContain('高度（mm）');
    expect(html).not.toContain('区域左边距');
    expect(html).not.toContain('恢复默认区域');
  });
});
