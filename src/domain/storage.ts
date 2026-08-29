import { createInitialDraft, type DraftState } from './draft';
import { defaultStyle, type LabelRecord } from './labels';
import { createTextLines } from './textLines';

export const DRAFT_STORAGE_KEY = 'label-printing-local:draft:v1';

type DraftReader = Pick<Storage, 'getItem'>;
type DraftWriter = Pick<Storage, 'setItem'>;

function isDraftState(value: unknown): value is DraftState {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<DraftState>;
  return candidate.version === 1
    && Array.isArray(candidate.labels)
    && Array.isArray(candidate.sizePresets)
    && Array.isArray(candidate.stylePresets);
}

function hydrateDraft(parsed: DraftState): DraftState {
  const defaults = createInitialDraft();
  const labels = parsed.labels.map((label) => {
    const legacy = label as Partial<LabelRecord>;
    const sizePresetId = legacy.sizePresetId ?? legacy.sizeType ?? 'small';
    return {
      ...legacy,
      purpose: legacy.purpose ?? 'carton',
      contentType: legacy.contentType ?? 'text',
      sides: legacy.sides ?? 1,
      sizeType: legacy.sizeType ?? (sizePresetId === 'large' ? 'large' : 'small'),
      sizePresetId,
      style: { ...defaultStyle, ...legacy.style, fontMode: 'fixed' },
      textStyleRanges: Array.isArray(legacy.textStyleRanges)
        ? legacy.textStyleRanges.map((range) => ({ ...range, style: { ...range.style } }))
        : [],
      placement: legacy.placement ? { ...legacy.placement } : {
        xPercent: 50,
        yPercent: 50,
        horizontalSnap: 'center',
        verticalSnap: 'middle',
      },
      printArea: legacy.printArea ? { ...legacy.printArea } : undefined,
      textLines: Array.isArray(legacy.textLines)
        ? legacy.textLines.map((line) => ({ ...line, placement: { ...line.placement }, style: { ...line.style } }))
        : createTextLines(legacy.content ?? ''),
      needsReview: typeof legacy.needsReview === 'boolean' ? legacy.needsReview : true,
    } as LabelRecord;
  });
  const validIds = new Set(labels.map((label) => label.id));
  const selectedLabelIds = Array.isArray(parsed.selectedLabelIds)
    ? parsed.selectedLabelIds.filter((id) => typeof id === 'string' && validIds.has(id))
    : [];
  return {
    ...defaults,
    ...parsed,
    business: typeof parsed.business === 'string' ? parsed.business : '',
    purpose: parsed.purpose === 'envelope' ? 'envelope' : 'carton',
    labels,
    recentSizes: Array.isArray(parsed.recentSizes) ? parsed.recentSizes.map((preset) => ({ ...preset })) : [],
    selectedLabelIds,
    activeLabelId: typeof parsed.activeLabelId === 'string' && validIds.has(parsed.activeLabelId)
      ? parsed.activeLabelId
      : labels[0]?.id ?? null,
  };
}

export function loadDraft(storage: DraftReader): DraftState | null {
  try {
    const serialized = storage.getItem(DRAFT_STORAGE_KEY);
    if (!serialized) return null;
    const parsed: unknown = JSON.parse(serialized);
    return isDraftState(parsed) ? hydrateDraft(parsed) : null;
  } catch {
    return null;
  }
}

export function saveDraft(storage: DraftWriter, state: DraftState): boolean {
  try {
    storage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}
