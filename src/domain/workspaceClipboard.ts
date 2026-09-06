import type { DraftAction, DraftState } from './draft';
import type { LabelRecord, SizePreset } from './labels';
import { hasSameSizePresetSnapshot } from './history';

export type ClipboardMode = 'copy' | 'cut';

export interface WorkspaceClipboard {
  mode: ClipboardMode;
  sourceIds: string[];
  labels: LabelRecord[];
  sizePresets: SizePreset[];
}

export interface PasteActionResult {
  action: DraftAction;
  pastedIds: string[];
}

function cloneLabelRecord(label: LabelRecord, id = label.id): LabelRecord {
  const isCopy = id !== label.id;
  return {
    ...label,
    id,
    style: { ...label.style },
    textStyleRanges: label.textStyleRanges.map((range) => ({
      ...range,
      style: { ...range.style },
    })),
    placement: { ...label.placement },
    printArea: label.printArea ? { ...label.printArea } : undefined,
    textLines: label.textLines.map((line) => ({
      ...line,
      placement: { ...line.placement },
      style: { ...line.style },
    })),
    ...(isCopy
      ? { needsReview: true, reviewReason: '复制后请确认内容和数量' }
      : {}),
  };
}

export function createWorkspaceClipboard(
  state: Pick<DraftState, 'labels' | 'sizePresets'>,
  targetIds: string[],
  mode: ClipboardMode,
): WorkspaceClipboard | null {
  const targetSet = new Set(targetIds);
  const labels = state.labels
    .filter(({ id }) => targetSet.has(id))
    .map((label) => cloneLabelRecord(label));

  if (labels.length === 0) return null;
  return {
    mode,
    sourceIds: labels.map(({ id }) => id),
    labels,
    sizePresets: mode === 'copy'
      ? state.sizePresets.filter(({ id }) => labels.some((label) => label.sizePresetId === id))
        .map((preset) => ({ ...preset }))
      : [],
  };
}

export function buildPasteAction(
  state: Pick<DraftState, 'labels' | 'activeLabelId' | 'sizePresets'>,
  clipboard: WorkspaceClipboard | null,
  createId: () => string,
): PasteActionResult | null {
  if (!clipboard || clipboard.labels.length === 0) return null;

  if (clipboard.mode === 'copy') {
    const availablePresets = [...state.sizePresets];
    const sizePresets: SizePreset[] = [];
    const presetIds = new Map<string, string>();
    for (const snapshot of clipboard.sizePresets) {
      const sameId = availablePresets.find(({ id }) => id === snapshot.id);
      const equivalent = sameId && hasSameSizePresetSnapshot(sameId, snapshot)
        ? sameId
        : availablePresets.find((preset) => hasSameSizePresetSnapshot(preset, snapshot));
      if (equivalent) {
        presetIds.set(snapshot.id, equivalent.id);
        continue;
      }
      let id = snapshot.id;
      let suffix = 0;
      while (availablePresets.some((preset) => preset.id === id)) {
        id = `${snapshot.id}-copy-${suffix += 1}`;
      }
      const restored = { ...snapshot, id };
      availablePresets.push(restored);
      sizePresets.push(restored);
      presetIds.set(snapshot.id, id);
    }
    const labels = clipboard.labels.map((label) => ({
      ...cloneLabelRecord(label, createId()),
      sizePresetId: presetIds.get(label.sizePresetId) ?? label.sizePresetId,
    }));
    return {
      action: { type: 'insert-labels', labels, sizePresets, afterId: state.activeLabelId },
      pastedIds: labels.map(({ id }) => id),
    };
  }

  const availableIds = new Set(state.labels.map(({ id }) => id));
  if (
    clipboard.sourceIds.some((id) => !availableIds.has(id))
    || (state.activeLabelId !== null && clipboard.sourceIds.includes(state.activeLabelId))
  ) {
    return null;
  }

  return {
    action: { type: 'move-labels', ids: clipboard.sourceIds, afterId: state.activeLabelId },
    pastedIds: clipboard.sourceIds,
  };
}
