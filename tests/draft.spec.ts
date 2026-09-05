import { describe, expect, it, vi } from 'vitest';
import { createLabel, defaultStyle } from '../src/domain/labels';
import { createInitialDraft, draftReducer, type DraftState } from '../src/domain/draft';
import type { RecentLabelInput } from '../src/domain/history';
import { loadDraft, recoverDraft, saveDraft, saveDraftSafely } from '../src/domain/storage';

const historyInput = (content: string): RecentLabelInput => ({
  label: createLabel({
    content,
    quantity: 1,
    source: 'manual',
    sizePresetId: createInitialDraft().sizePresets[0].id,
    needsReview: false,
  }),
  preset: { ...createInitialDraft().sizePresets[0] },
});

describe('草稿状态', () => {
  it('新增记录后将其设为当前记录并保留在列表中', () => {
    const label = createLabel({
      content: 'FY-01',
      quantity: 1,
      source: 'manual',
      needsReview: false,
      style: defaultStyle,
    });

    const next = draftReducer(createInitialDraft(), { type: 'add-label', label });

    expect(next.labels.at(-1)).toEqual(label);
    expect(next.labels).toHaveLength(2);
    expect(next.activeLabelId).toBe(label.id);
  });

  it('编辑记录时只更新目标记录并保留其他记录', () => {
    const first = createLabel({ content: 'A', quantity: 1, source: 'manual', needsReview: false });
    const second = createLabel({ content: 'B', quantity: 1, source: 'manual', needsReview: false });
    const state = {
      ...createInitialDraft(),
      labels: [first, second],
      activeLabelId: first.id,
    };

    const next = draftReducer(state, {
      type: 'update-label',
      id: first.id,
      patch: { content: 'A-UPDATED' },
    });

    expect(next.labels.map((label) => label.content)).toEqual(['A-UPDATED', 'B']);
  });

  it('修改正文和数量不再新增旧草稿校对原因', () => {
    const label = createLabel({ content: 'A', quantity: 1, source: 'manual', needsReview: false });
    const state = { ...createInitialDraft(), labels: [label] };

    const next = draftReducer(state, { type: 'update-label', id: label.id, patch: { quantity: 3 } });

    expect(next.labels[0]).toMatchObject({ quantity: 3, needsReview: false });
    expect(next.labels[0].reviewReason).toBeUndefined();
  });

  it('业务与用途选择作为后续新增记录的默认上下文保存', () => {
    const withBusiness = draftReducer(createInitialDraft(), { type: 'set-business', business: '义乌铺' });
    const withPurpose = draftReducer(withBusiness, { type: 'set-purpose', purpose: 'envelope' });

    expect(withPurpose).toMatchObject({ business: '义乌铺', purpose: 'envelope' });
  });

  it('默认草稿包含一条当前空白唛头', () => {
    const state = createInitialDraft();

    expect(state.labels).toHaveLength(1);
    expect(state.labels[0]).toMatchObject({ content: '', source: 'manual', quantity: 1 });
    expect(state.activeLabelId).toBe(state.labels[0].id);
    expect(state.lastPrintedSize).toBeNull();
  });

  it('只在发起实际打印后记住宽高，并供后续新增唛头使用', () => {
    const remembered = draftReducer(createInitialDraft(), {
      type: 'remember-printed-size',
      widthMm: 86,
      heightMm: 45,
    });

    expect(remembered.lastPrintedSize).toEqual({ widthMm: 86, heightMm: 45 });

    const nextDraft = createInitialDraft(remembered.lastPrintedSize);
    const activeLabel = nextDraft.labels.find((label) => label.id === nextDraft.activeLabelId)!;
    const activePreset = nextDraft.sizePresets.find((preset) => preset.id === activeLabel.sizePresetId)!;
    expect(activePreset).toMatchObject({ widthMm: 86, heightMm: 45 });
  });

  it('清空草稿时保留上次实际打印的宽高并用于新的空白唛头', () => {
    const remembered = draftReducer(createInitialDraft(), {
      type: 'remember-printed-size',
      widthMm: 92,
      heightMm: 58,
    });
    const cleared = draftReducer(remembered, { type: 'clear-draft' });
    const activeLabel = cleared.labels.find((label) => label.id === cleared.activeLabelId)!;
    const activePreset = cleared.sizePresets.find((preset) => preset.id === activeLabel.sizePresetId)!;

    expect(cleared.lastPrintedSize).toEqual({ widthMm: 92, heightMm: 58 });
    expect(activePreset).toMatchObject({ widthMm: 92, heightMm: 58 });
  });

  it('清空草稿保留最近预览历史', () => {
    const state = draftReducer(createInitialDraft(), {
      type: 'record-recent-labels',
      entries: [historyInput('FY-01')],
      previewedAt: 1000,
    });

    expect(state.recentLabels).toHaveLength(1);
    expect(draftReducer(state, { type: 'clear-draft' }).recentLabels).toEqual(state.recentLabels);
    expect(draftReducer(state, { type: 'clear-draft' }).recentLabels).not.toBe(state.recentLabels);
  });

  it('可收起板块并保留原有尺寸', () => {
    const state = createInitialDraft();
    const next = draftReducer(state, { type: 'toggle-panel-collapsed', id: 'preview' });

    expect(next.workspaceLayout.sizes.preview).toMatchObject({
      widthPx: state.workspaceLayout.sizes.preview.widthPx,
      heightPx: state.workspaceLayout.sizes.preview.heightPx,
      collapsed: true,
    });
  });

  it('保存面板顺序并限制面板尺寸', () => {
    const reordered = draftReducer(createInitialDraft(), {
      type: 'set-panel-order',
      order: ['records', 'preview', 'intake'],
    });
    const resized = draftReducer(reordered, {
      type: 'resize-panel',
      id: 'records',
      patch: { widthPx: 1000, heightPx: 100 },
    });

    expect(resized.workspaceLayout).toMatchObject({
      order: ['records', 'preview', 'intake'],
      sizes: { records: { widthPx: 900, heightPx: 320 } },
    });
  });

  it('用户主动设置为旧默认数值的宽度在换位和重新加载后仍保留', () => {
    const resized = draftReducer(createInitialDraft(), {
      type: 'resize-panel',
      id: 'intake',
      patch: { widthPx: 360 },
    });
    const reordered = draftReducer(resized, {
      type: 'set-panel-order',
      order: ['preview', 'intake', 'records'],
    });
    const storage = new Map<string, string>();

    saveDraft({ setItem: (key, value) => storage.set(key, value) }, reordered);
    const reloaded = loadDraft({ getItem: (key) => storage.get(key) ?? null });

    expect(reordered.workspaceLayout.sizes.intake.widthPx).toBe(360);
    expect(reloaded?.workspaceLayout.sizes.intake.widthPx).toBe(360);
  });

  it('只恢复默认工作区布局而保留当前唛头', () => {
    const label = createLabel({ content: 'A', quantity: 1, source: 'manual', needsReview: false });
    const state = {
      ...createInitialDraft(),
      labels: [label],
      workspaceLayout: {
        version: 2 as const,
        order: ['records', 'preview', 'intake'] as DraftState['workspaceLayout']['order'],
        sizes: {
          ...createInitialDraft().workspaceLayout.sizes,
          preview: { widthPx: 800, heightPx: 900, collapsed: false },
        },
      },
    };

    const next = draftReducer(state, { type: 'reset-workspace-layout' });

    expect(next.labels).toEqual([label]);
    expect(next.workspaceLayout).toEqual(createInitialDraft().workspaceLayout);
  });

  it('从列表选择记录时更新当前编辑目标', () => {
    const first = createLabel({ content: 'A', quantity: 1, source: 'manual', needsReview: false });
    const second = createLabel({ content: 'B', quantity: 1, source: 'manual', needsReview: false });
    const state = { ...createInitialDraft(), labels: [first, second], activeLabelId: first.id };

    const next = draftReducer(state, { type: 'set-active-label', id: second.id });

    expect(next.activeLabelId).toBe(second.id);
  });

  it('批量导入保留已有记录并将第一条新记录设为当前记录', () => {
    const existing = createLabel({ content: 'OLD', quantity: 1, source: 'manual', needsReview: false });
    const imported = [
      createLabel({ content: 'NEW-1', quantity: 2, source: 'excel', needsReview: false }),
      createLabel({ content: 'NEW-2', quantity: 1, source: 'excel', needsReview: false }),
    ];
    const state = { ...createInitialDraft(), labels: [existing], activeLabelId: existing.id };

    const next = draftReducer(state, { type: 'import-labels', labels: imported });

    expect(next.labels.map((label) => label.content)).toEqual(['OLD', 'NEW-1', 'NEW-2']);
    expect(next.activeLabelId).toBe(imported[0].id);
  });

  it('只把样式批量应用到勾选的记录', () => {
    const first = createLabel({ content: 'A', quantity: 1, source: 'manual', needsReview: false });
    const second = createLabel({ content: 'B', quantity: 1, source: 'manual', needsReview: false });
    const state = { ...createInitialDraft(), labels: [first, second], selectedLabelIds: [second.id] };
    const style = { ...defaultStyle, fontSizePt: 48, italic: true };

    const next = draftReducer(state, { type: 'apply-style-to-selected', style });

    expect(next.labels[0].style).toEqual(first.style);
    expect(next.labels[1].style).toEqual(style);
  });

  it('删除当前记录后选择相邻记录并清理勾选状态', () => {
    const first = createLabel({ content: 'A', quantity: 1, source: 'manual', needsReview: false });
    const second = createLabel({ content: 'B', quantity: 1, source: 'manual', needsReview: false });
    const state = {
      ...createInitialDraft(),
      labels: [first, second],
      activeLabelId: first.id,
      selectedLabelIds: [first.id],
    };

    const next = draftReducer(state, { type: 'delete-label', id: first.id });

    expect(next.labels).toEqual([second]);
    expect(next.activeLabelId).toBe(second.id);
    expect(next.selectedLabelIds).toEqual([]);
  });

  it('复制记录时生成新标识并把副本设为当前记录', () => {
    const label = createLabel({ content: 'A', quantity: 2, source: 'manual', needsReview: false });
    const state = { ...createInitialDraft(), labels: [label], activeLabelId: label.id };

    const next = draftReducer(state, { type: 'duplicate-label', id: label.id });

    expect(next.labels).toHaveLength(2);
    expect(next.labels[1]).toMatchObject({ content: 'A', quantity: 2, needsReview: false });
    expect(next.labels[1].id).not.toBe(label.id);
    expect(next.activeLabelId).toBe(next.labels[1].id);
  });

  it('可以新增修改未使用的尺寸预设，但不能删除正在使用的预设', () => {
    const custom = { ...createInitialDraft().sizePresets[0], id: 'custom', name: '客户尺寸', widthMm: 88 };
    const withPreset = draftReducer(createInitialDraft(), { type: 'add-size-preset', preset: custom });
    const updated = draftReducer(withPreset, {
      type: 'update-size-preset',
      id: custom.id,
      patch: { widthMm: 90, heightMm: 50 },
    });
    expect(updated.sizePresets.find((preset) => preset.id === custom.id)).toMatchObject({ widthMm: 90, heightMm: 50 });

    const removed = draftReducer(updated, { type: 'remove-size-preset', id: custom.id });
    expect(removed.sizePresets.some((preset) => preset.id === custom.id)).toBe(false);

    const label = createLabel({ content: 'A', quantity: 1, source: 'manual', needsReview: false, sizePresetId: 'large' });
    const inUse = { ...createInitialDraft(), labels: [label] };
    expect(draftReducer(inUse, { type: 'remove-size-preset', id: 'large' })).toBe(inUse);
  });

});

describe('本地草稿存储', () => {
  it('损坏的本地草稿不会覆盖初始状态', () => {
    const storage = { getItem: () => '{bad json' };
    expect(loadDraft(storage)).toBeNull();
  });

  it('保存时写入带版本号的完整草稿', () => {
    const setItem = vi.fn();
    const draft = createInitialDraft();

    expect(saveDraft({ setItem }, draft)).toBe(true);
    expect(setItem).toHaveBeenCalledOnce();
    expect(JSON.parse(setItem.mock.calls[0][1])).toMatchObject({ version: 1, labels: [{ content: '' }] });
  });

  it('读取旧版同版本草稿时补齐选择状态和业务上下文', () => {
    const oldDraft = createInitialDraft() as unknown as Record<string, unknown>;
    delete oldDraft.selectedLabelIds;
    delete oldDraft.business;
    const storage = { getItem: () => JSON.stringify(oldDraft) };

    expect(loadDraft(storage)).toMatchObject({ selectedLabelIds: [], business: '' });
  });

  it('读取旧草稿时缺失的最近预览历史补为空列表', () => {
    const oldDraft = createInitialDraft() as unknown as Record<string, unknown>;
    delete oldDraft.recentLabels;

    expect(loadDraft({ getItem: () => JSON.stringify(oldDraft) })?.recentLabels).toEqual([]);
  });

  it('损坏历史条目在读取草稿时被过滤', () => {
    const stored = { ...createInitialDraft(), recentLabels: [{ bad: true }] };

    expect(loadDraft({ getItem: () => JSON.stringify(stored) })?.recentLabels).toEqual([]);
  });

  it('读取草稿时丢弃超出可打印范围的上次打印尺寸', () => {
    const invalidDraft = { ...createInitialDraft(), lastPrintedSize: { widthMm: 999, heightMm: 10 } };
    const storage = { getItem: () => JSON.stringify(invalidDraft) };

    expect(loadDraft(storage)?.lastPrintedSize).toBeNull();
  });

  it('读取没有记录的草稿时补建上次打印尺寸，并让空白唛头引用该尺寸', () => {
    const emptyDraft = {
      ...createInitialDraft(),
      labels: [],
      activeLabelId: null,
      lastPrintedSize: { widthMm: 86, heightMm: 52 },
    };
    const loaded = loadDraft({ getItem: () => JSON.stringify(emptyDraft) })!;
    const activeLabel = loaded.labels.find((label) => label.id === loaded.activeLabelId)!;
    const activePreset = loaded.sizePresets.find((preset) => preset.id === activeLabel.sizePresetId);

    expect(activePreset).toMatchObject({ widthMm: 86, heightMm: 52 });
  });

  it('hydrates an old draft with the default three-panel layout', () => {
    const legacy = createInitialDraft() as Partial<DraftState>;
    delete legacy.workspaceLayout;
    const loaded = loadDraft({ getItem: () => JSON.stringify(legacy) });
    expect(loaded?.workspaceLayout.order).toEqual(['intake', 'preview', 'records']);
  });

  it('读取旧四板块草稿时移除历史板块并保留其余顺序与尺寸', () => {
    const legacy = {
      ...createInitialDraft(),
      workspaceLayout: {
        order: ['history', 'records', 'intake', 'preview'],
        sizes: {
          ...createInitialDraft().workspaceLayout.sizes,
          history: { widthPx: 540, heightPx: 500, zoom: 1.1 },
          records: { widthPx: 520, heightPx: 700, zoom: .9 },
        },
      },
    };

    const loaded = loadDraft({ getItem: () => JSON.stringify(legacy) });

    expect(loaded?.workspaceLayout.order).toEqual(['records', 'intake', 'preview']);
    expect(loaded?.workspaceLayout.sizes.records).toEqual({ widthPx: 520, heightPx: 700, collapsed: false });
    expect(loaded?.workspaceLayout.sizes).not.toHaveProperty('history');
  });

  it('读取旧草稿时把隐藏的自动字号迁移为可直接编辑的固定字号', () => {
    const label = createLabel({ content: 'FYF-TTT0103', quantity: 1, source: 'manual', needsReview: false });
    label.style.fontMode = 'auto';
    label.style.fontSizePt = 36;
    const oldDraft = { ...createInitialDraft(), labels: [label], activeLabelId: label.id };
    const storage = { getItem: () => JSON.stringify(oldDraft) };

    expect(loadDraft(storage)?.labels[0].style).toMatchObject({ fontMode: 'fixed', fontSizePt: 36 });
  });

  it('浏览器拒绝取得本机存储时仍可恢复和继续编辑', () => {
    const getBlockedStorage = () => { throw new Error('blocked'); };

    expect(recoverDraft(getBlockedStorage)).toMatchObject({
      business: '',
      labels: [{ content: '', source: 'manual' }],
      workspaceLayout: createInitialDraft().workspaceLayout,
    });
    expect(saveDraftSafely(getBlockedStorage, createInitialDraft())).toBe(false);
  });
});
