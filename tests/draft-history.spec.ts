import { describe, expect, it } from 'vitest';
import { createInitialDraft } from '../src/domain/draft';
import { createLabel } from '../src/domain/labels';
import {
  canRedo,
  canUndo,
  createDraftHistory,
  draftHistoryReducer,
} from '../src/domain/draftHistory';

describe('draft history', () => {
  it('synchronizes an unchanged explicit activation into past snapshots before undo', () => {
    const labels = ['A', 'B'].map((content) => createLabel({ content, quantity: 1, source: 'manual', needsReview: false }));
    const initial = { ...createInitialDraft(), labels, activeLabelId: labels[0].id };
    const deleted = draftHistoryReducer(createDraftHistory(initial), {
      type: 'apply', actions: [{ type: 'delete-label', id: labels[0].id }], description: '删除 A', record: true,
    });
    expect(deleted.present.activeLabelId).toBe(labels[1].id);
    const activated = draftHistoryReducer(deleted, {
      type: 'apply', actions: [{ type: 'set-active-label', id: labels[1].id }], description: '激活 B', record: false,
    });
    expect(activated.present).toEqual(deleted.present);
    expect(activated.past).toHaveLength(1);
    const undone = draftHistoryReducer(activated, { type: 'undo' });
    expect(undone.present.labels).toEqual(labels);
    expect(undone.present.activeLabelId).toBe(labels[1].id);
    expect(canUndo(undone)).toBe(false);
    expect(canRedo(undone)).toBe(true);
    expect(draftHistoryReducer(undone, { type: 'redo' }).present).toEqual(deleted.present);
  });

  it('synchronizes an unchanged explicit activation into future snapshots without clearing redo', () => {
    const initial = createInitialDraft();
    const added = createLabel({ content: 'B', quantity: 1, source: 'manual', needsReview: false });
    const changed = draftHistoryReducer(createDraftHistory(initial), {
      type: 'apply', actions: [{ type: 'add-label', label: added }], description: '新增 B', record: true,
    });
    const undone = draftHistoryReducer(changed, { type: 'undo' });
    const activated = draftHistoryReducer(undone, {
      type: 'apply', actions: [{ type: 'set-active-label', id: initial.labels[0].id }], description: '激活 A', record: false,
    });
    expect(activated.present).toEqual(undone.present);
    expect(activated.past).toHaveLength(0);
    expect(activated.future).toHaveLength(1);
    const redone = draftHistoryReducer(activated, { type: 'redo' });
    expect(redone.present.labels).toEqual([...initial.labels, added]);
    expect(redone.present.activeLabelId).toBe(initial.labels[0].id);
    expect(canRedo(redone)).toBe(false);
    expect(redone.past).toHaveLength(1);
  });

  it('rejects same-value quantity and nested font submissions without losing redo', () => {
    const initial = createInitialDraft();
    const label = initial.labels[0];
    for (const patch of [{ quantity: 2 }, { style: { ...label.style, fontSizePt: 32 } }]) {
      const event = {
        type: 'apply' as const,
        actions: [{ type: 'update-label' as const, id: label.id, patch }],
        description: '修改字段', record: true,
      };
      const changed = draftHistoryReducer(createDraftHistory(initial), event);
      const repeated = draftHistoryReducer(changed, structuredClone(event));
      expect(repeated).toBe(changed);
      expect(repeated.past).toHaveLength(1);
      const undone = draftHistoryReducer(repeated, { type: 'undo' });
      expect(undone.present.labels[0]).toEqual(label);
      const unchanged = draftHistoryReducer(undone, {
        ...event,
        actions: [{ type: 'update-label', id: label.id, patch: structuredClone(label) }],
      });
      expect(unchanged).toBe(undone);
      expect(draftHistoryReducer(unchanged, { type: 'redo' }).present.labels[0]).toMatchObject(patch);
    }
  });

  it('rejects a recorded action batch with no net data change', () => {
    const initial = createDraftHistory(createInitialDraft());
    expect(draftHistoryReducer(initial, {
      type: 'apply', actions: [
        { type: 'set-business', business: '临时' },
        { type: 'set-business', business: '' },
      ], description: '无变化', record: true,
    })).toBe(initial);
  });
  it('undoes and redoes one recorded edit', () => {
    const changed = draftHistoryReducer(createDraftHistory(createInitialDraft()), {
      type: 'apply',
      actions: [{ type: 'set-business', business: '义乌铺' }],
      description: '修改业务类型',
      record: true,
    });

    expect(canUndo(changed)).toBe(true);
    expect(canRedo(changed)).toBe(false);
    const undone = draftHistoryReducer(changed, { type: 'undo' });
    expect(undone.present.business).toBe('');
    expect(undone.lastTransition).toEqual({ kind: 'undo', description: '修改业务类型' });
    expect(canRedo(undone)).toBe(true);
    const redone = draftHistoryReducer(undone, { type: 'redo' });
    expect(redone.present.business).toBe('义乌铺');
    expect(redone.lastTransition).toEqual({ kind: 'redo', description: '修改业务类型' });
  });

  it('treats several actions as one undoable edit', () => {
    const changed = draftHistoryReducer(createDraftHistory(createInitialDraft()), {
      type: 'apply',
      actions: [
        { type: 'set-business', business: '义乌铺' },
        { type: 'set-purpose', purpose: 'envelope' },
      ],
      description: '修改业务上下文',
      record: true,
    });

    expect(changed.past).toHaveLength(1);
    expect(changed.present).toMatchObject({ business: '义乌铺', purpose: 'envelope' });
    expect(draftHistoryReducer(changed, { type: 'undo' }).present).toMatchObject({
      business: '',
      purpose: 'carton',
    });
  });

  it('keeps synchronized non-history state when undoing a recorded edit', () => {
    const initial = createInitialDraft();
    const labelId = initial.labels[0].id;
    const quantityChanged = draftHistoryReducer(createDraftHistory(initial), {
      type: 'apply',
      actions: [{ type: 'update-label', id: labelId, patch: { quantity: 2 } }],
      description: '修改打印数量',
      record: true,
    });
    const selected = draftHistoryReducer(quantityChanged, {
      type: 'apply',
      actions: [{ type: 'set-selected', ids: [labelId] }],
      description: '选择唛头',
      record: false,
    });

    const undone = draftHistoryReducer(selected, { type: 'undo' });
    expect(undone.present.labels[0].quantity).toBe(1);
    expect(undone.present.selectedLabelIds).toEqual([labelId]);
    expect(draftHistoryReducer(undone, { type: 'redo' }).present.selectedLabelIds).toEqual([labelId]);
  });

  it('normalizes relative selection after a recorded action changed snapshot selection', () => {
    const base = createInitialDraft();
    const firstId = base.labels[0].id;
    const initial = { ...base, selectedLabelIds: [firstId] };
    const inserted = createLabel({
      content: 'B',
      quantity: 1,
      source: 'manual',
      needsReview: false,
    });
    const withInserted = draftHistoryReducer(createDraftHistory(initial), {
      type: 'apply',
      actions: [{ type: 'insert-labels', labels: [inserted], afterId: firstId }],
      description: '插入唛头',
      record: true,
    });
    const synchronized = draftHistoryReducer(withInserted, {
      type: 'apply',
      actions: [
        { type: 'toggle-selected', id: firstId },
        { type: 'remember-printed-size', widthMm: 88, heightMm: 44 },
      ],
      description: '同步辅助状态',
      record: false,
    });

    expect(synchronized.present.selectedLabelIds).toEqual([inserted.id, firstId]);
    const undone = draftHistoryReducer(synchronized, { type: 'undo' });
    expect(undone.present.selectedLabelIds).toEqual([firstId]);
    expect(undone.present.lastPrintedSize).toEqual({ widthMm: 88, heightMm: 44 });
  });

  it('bounds recorded history to the latest 100 edits', () => {
    let history = createDraftHistory(createInitialDraft());
    for (let index = 1; index <= 101; index += 1) {
      history = draftHistoryReducer(history, {
        type: 'apply',
        actions: [{ type: 'set-business', business: `业务-${index}` }],
        description: `修改业务-${index}`,
        record: true,
      });
    }

    expect(history.past).toHaveLength(100);
    for (let index = 0; index < 100; index += 1) {
      history = draftHistoryReducer(history, { type: 'undo' });
    }
    expect(history.present.business).toBe('业务-1');
    expect(canUndo(history)).toBe(false);
  });

  it('invalidates redo after a new recorded edit', () => {
    const changed = draftHistoryReducer(createDraftHistory(createInitialDraft()), {
      type: 'apply',
      actions: [{ type: 'set-business', business: '义乌铺' }],
      description: '修改业务类型',
      record: true,
    });
    const undone = draftHistoryReducer(changed, { type: 'undo' });
    const branched = draftHistoryReducer(undone, {
      type: 'apply',
      actions: [{ type: 'set-purpose', purpose: 'envelope' }],
      description: '修改唛头用途',
      record: true,
    });

    expect(branched.future).toEqual([]);
    expect(canRedo(branched)).toBe(false);
  });
});
