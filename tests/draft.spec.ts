import { describe, expect, it, vi } from 'vitest';
import { createLabel, defaultStyle } from '../src/domain/labels';
import { createInitialDraft, draftReducer } from '../src/domain/draft';
import { loadDraft, saveDraft } from '../src/domain/storage';

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

    expect(next.labels).toEqual([label]);
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

  it('已校对记录修改内容或数量后会重新进入待校对状态', () => {
    const label = createLabel({ content: 'A', quantity: 1, source: 'manual', needsReview: false });
    const state = { ...createInitialDraft(), labels: [label] };

    const next = draftReducer(state, { type: 'update-label', id: label.id, patch: { quantity: 3 } });

    expect(next.labels[0]).toMatchObject({ quantity: 3, needsReview: true, reviewReason: '内容或数量已修改，请重新校对' });
  });

  it('业务与用途选择作为后续新增记录的默认上下文保存', () => {
    const withBusiness = draftReducer(createInitialDraft(), { type: 'set-business', business: '义乌铺' });
    const withPurpose = draftReducer(withBusiness, { type: 'set-purpose', purpose: 'envelope' });

    expect(withPurpose).toMatchObject({ business: '义乌铺', purpose: 'envelope' });
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
    expect(next.labels[1]).toMatchObject({ content: 'A', quantity: 2, needsReview: true });
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

  it('校对确认会清除待校对原因', () => {
    const label = createLabel({ content: 'A', quantity: 1, source: 'manual', needsReview: true, reviewReason: '待确认' });
    const state = { ...createInitialDraft(), labels: [label] };

    const next = draftReducer(state, { type: 'mark-reviewed', id: label.id });

    expect(next.labels[0]).toMatchObject({ needsReview: false });
    expect(next.labels[0].reviewReason).toBeUndefined();
  });

  it('内容或数量无效时不能确认校对完成', () => {
    const label = createLabel({ content: '', quantity: 0, source: 'manual', needsReview: true });
    const state = { ...createInitialDraft(), labels: [label] };

    const next = draftReducer(state, { type: 'mark-reviewed', id: label.id });

    expect(next).toBe(state);
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
    expect(JSON.parse(setItem.mock.calls[0][1])).toMatchObject({ version: 1, labels: [] });
  });

  it('读取旧版同版本草稿时补齐选择状态和业务上下文', () => {
    const oldDraft = createInitialDraft() as unknown as Record<string, unknown>;
    delete oldDraft.selectedLabelIds;
    delete oldDraft.business;
    const storage = { getItem: () => JSON.stringify(oldDraft) };

    expect(loadDraft(storage)).toMatchObject({ selectedLabelIds: [], business: '' });
  });

  it('读取旧草稿时把隐藏的自动字号迁移为可直接编辑的固定字号', () => {
    const label = createLabel({ content: 'FYF-TTT0103', quantity: 1, source: 'manual', needsReview: false });
    label.style.fontMode = 'auto';
    label.style.fontSizePt = 36;
    const oldDraft = { ...createInitialDraft(), labels: [label], activeLabelId: label.id };
    const storage = { getItem: () => JSON.stringify(oldDraft) };

    expect(loadDraft(storage)?.labels[0].style).toMatchObject({ fontMode: 'fixed', fontSizePt: 36 });
  });
});
