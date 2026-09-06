import { describe, expect, it } from 'vitest';
import { createInitialDraft } from '../src/domain/draft';
import { createLabel } from '../src/domain/labels';
import { buildPasteAction, createWorkspaceClipboard } from '../src/domain/workspaceClipboard';

describe('workspace clipboard', () => {
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
