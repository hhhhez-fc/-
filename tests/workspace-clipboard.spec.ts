import { describe, expect, it } from 'vitest';
import { createInitialDraft, draftReducer } from '../src/domain/draft';
import { createDraftHistory, draftHistoryReducer } from '../src/domain/draftHistory';
import { createPrintPlan } from '../src/domain/printing';
import { createLabel } from '../src/domain/labels';
import { buildPasteAction, createWorkspaceClipboard } from '../src/domain/workspaceClipboard';

describe('workspace clipboard', () => {
  it.each(['removed', 'conflicting', 'cleared'] as const)('restores copied dimensions after the source preset is %s in one undoable action', (change) => {
    const initial = createInitialDraft();
    const preset = { ...initial.sizePresets[0], id: 'custom', widthMm: 88, heightMm: 44 };
    const label = createLabel({ content: 'BOX', quantity: 1, source: 'manual', needsReview: false, sizePresetId: preset.id });
    const source = { ...initial, labels: [label], sizePresets: [...initial.sizePresets, preset], activeLabelId: label.id };
    const clipboard = createWorkspaceClipboard(source, [label.id], 'copy');
    const deleted = draftReducer(source, { type: 'delete-label', id: label.id });
    const destination = change === 'cleared'
      ? draftReducer(source, { type: 'clear-draft' })
      : draftReducer(deleted, change === 'removed'
        ? { type: 'remove-size-preset', id: preset.id }
        : { type: 'update-size-preset', id: preset.id, patch: { widthMm: 120 } });
    // Mutating the source object must not mutate its captured clipboard snapshot.
    preset.heightMm = 99;
    const result = buildPasteAction(destination, clipboard, () => 'copy-id')!;
    const pasted = draftHistoryReducer(createDraftHistory(destination), {
      type: 'apply', actions: [result.action], description: '粘贴', record: true,
    });
    const copy = pasted.present.labels.find(({ id }) => id === 'copy-id')!;
    const plan = createPrintPlan([copy], pasted.present.sizePresets);
    expect(plan.blockers).toEqual([]);
    expect(plan.groups).toMatchObject([{ widthMm: 88, heightMm: 44 }]);
    expect(pasted.present.sizePresets).toHaveLength(destination.sizePresets.length + 1);
    expect(pasted.past).toHaveLength(1);
    if (change === 'conflicting') {
      expect(copy.sizePresetId).not.toBe('custom');
      expect(pasted.present.sizePresets.find(({ id }) => id === 'custom')?.widthMm).toBe(120);
    }
    const undone = draftHistoryReducer(pasted, { type: 'undo' });
    expect(undone.present).toEqual(destination);
    expect(undone.present.labels.some(({ id }) => id === copy.id)).toBe(false);
    expect(draftHistoryReducer(undone, { type: 'redo' }).present).toEqual(pasted.present);
  });

  it('reuses an equivalent preset and resolves occupied conflict suffixes deterministically', () => {
    const initial = createInitialDraft();
    const preset = { ...initial.sizePresets[0], id: 'custom', widthMm: 88, heightMm: 44 };
    const label = createLabel({ content: 'A', quantity: 1, source: 'manual', needsReview: false, sizePresetId: preset.id });
    const source = { ...initial, labels: [label], sizePresets: [...initial.sizePresets, preset] };
    const clipboard = createWorkspaceClipboard(source, [label.id], 'copy');
    const conflicting = { ...source, sizePresets: [
      ...initial.sizePresets, { ...preset, widthMm: 120 }, { ...preset, id: 'custom-copy-1', widthMm: 121 },
    ] };
    const result = buildPasteAction(conflicting, clipboard, () => 'copy-id')!;
    const pasted = draftReducer(conflicting, result.action);
    expect(pasted.labels.find(({ id }) => id === 'copy-id')?.sizePresetId).toBe('custom-copy-2');
    const repeated = draftReducer(pasted, buildPasteAction(pasted, clipboard, () => 'second-copy')!.action);
    expect(repeated.sizePresets).toEqual(pasted.sizePresets);
    expect(repeated.labels.find(({ id }) => id === 'second-copy')?.sizePresetId).toBe('custom-copy-2');
  });

  it('cut preserves record and preset identities even when the preset changes', () => {
    const source = createInitialDraft();
    const label = source.labels[0];
    const clipboard = createWorkspaceClipboard(source, [label.id], 'cut');
    const changed = { ...draftReducer(source, {
      type: 'update-size-preset', id: label.sizePresetId, patch: { widthMm: 88 },
    }), activeLabelId: null };
    const moved = draftReducer(changed, buildPasteAction(changed, clipboard, () => 'unused')!.action);
    expect(moved.labels[0]).toBe(label);
    expect(moved.sizePresets).toBe(changed.sizePresets);
  });
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

    expect(buildPasteAction(source, clipboard, crypto.randomUUID)?.action).toMatchObject({
      type: 'move-labels',
      ids: [label.id],
    });
    expect(buildPasteAction(createInitialDraft(), clipboard, crypto.randomUUID)).toBeNull();
  });
});
