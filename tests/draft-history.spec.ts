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
