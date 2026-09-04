import { validateSizePreset, type LabelRecord, type SizePreset } from './labels';
import { cloneTextLinesWithFreshIds } from './textLines';

export interface RecentLabelInput {
  label: LabelRecord;
  preset: SizePreset;
}

export interface RecentLabelEntry extends RecentLabelInput {
  id: string;
  signature: string;
  previewedAt: number;
}

export const MAX_RECENT_LABELS = 20;

function cloneLabel(label: LabelRecord): LabelRecord {
  return {
    id: label.id,
    content: label.content,
    quantity: label.quantity,
    sizeType: label.sizeType,
    sizePresetId: label.sizePresetId,
    source: label.source,
    purpose: label.purpose,
    contentType: label.contentType,
    sides: label.sides,
    style: { ...label.style },
    textStyleRanges: label.textStyleRanges.map((range) => ({ ...range, style: { ...range.style } })),
    placement: { ...label.placement },
    printArea: label.printArea ? { ...label.printArea } : undefined,
    textLines: label.textLines.map((line) => ({
      ...line,
      placement: { ...line.placement },
      style: { ...line.style },
    })),
    imageFallback: typeof label.imageFallback === 'string' && label.imageFallback.length > 0
      ? label.imageFallback
      : undefined,
    needsReview: label.needsReview,
    reviewReason: label.reviewReason,
  };
}

function clonePreset(preset: SizePreset): SizePreset {
  return { ...preset };
}

function signatureFor({ label, preset }: RecentLabelInput): string {
  return JSON.stringify({
    content: label.content,
    quantity: label.quantity,
    sides: label.sides,
    purpose: label.purpose,
    contentType: label.contentType,
    style: label.style,
    textStyleRanges: label.textStyleRanges,
    placement: label.placement,
    printArea: label.printArea,
    textLines: label.textLines.map(({ id: _id, ...line }) => line),
    imageFallback: label.imageFallback,
    size: {
      widthMm: preset.widthMm,
      heightMm: preset.heightMm,
      paddingMm: preset.paddingMm,
      maxFontSize: preset.maxFontSize,
      minFontSize: preset.minFontSize,
      paperSize: preset.paperSize,
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function isValidLabel(value: unknown): value is LabelRecord {
  if (!isRecord(value)) return false;
  const label = value as Partial<LabelRecord>;
  const hasPrintableContent = label.contentType === 'image'
    ? typeof label.imageFallback === 'string' && label.imageFallback.length > 0
    : label.contentType === 'text' && typeof label.content === 'string' && label.content.trim().length > 0;
  return hasPrintableContent
    && typeof label.id === 'string'
    && typeof label.content === 'string'
    && Number.isSafeInteger(label.quantity)
    && Number.isSafeInteger(label.sides)
    && (label.sizeType === 'large' || label.sizeType === 'small')
    && typeof label.sizePresetId === 'string'
    && (label.source === 'excel' || label.source === 'image' || label.source === 'manual')
    && (label.purpose === 'carton' || label.purpose === 'envelope')
    && isRecord(label.style)
    && Array.isArray(label.textStyleRanges)
    && isRecord(label.placement)
    && Array.isArray(label.textLines)
    && label.textLines.every((line) => isRecord(line) && typeof line.id === 'string'
      && typeof line.text === 'string' && isRecord(line.placement) && isRecord(line.style))
    && typeof label.needsReview === 'boolean';
}

function isValidPreset(value: unknown): value is SizePreset {
  if (!isRecord(value)) return false;
  const preset = value as Partial<SizePreset>;
  return typeof preset.id === 'string'
    && preset.id.length > 0
    && typeof preset.name === 'string'
    && Number.isFinite(preset.maxFontSize)
    && Number.isFinite(preset.minFontSize)
    && typeof preset.paperSize === 'string'
    && validateSizePreset(preset as SizePreset).length === 0;
}

function snapshotInput(input: RecentLabelInput): RecentLabelInput | null {
  if (!isValidLabel(input.label) || !isValidPreset(input.preset)) return null;
  return { label: cloneLabel(input.label), preset: clonePreset(input.preset) };
}

function cloneEntry(entry: RecentLabelEntry): RecentLabelEntry {
  return {
    id: entry.id,
    signature: entry.signature,
    previewedAt: entry.previewedAt,
    label: cloneLabel(entry.label),
    preset: clonePreset(entry.preset),
  };
}

export function recordRecentLabels(
  current: RecentLabelEntry[],
  inputs: RecentLabelInput[],
  now: number = Date.now(),
): RecentLabelEntry[] {
  let entries = hydrateRecentLabels(current);
  inputs.forEach((input) => {
    const snapshot = snapshotInput(input);
    if (!snapshot) return;
    const signature = signatureFor(snapshot);
    entries = [{
      ...snapshot,
      id: crypto.randomUUID(),
      signature,
      previewedAt: now,
    }, ...entries.filter((entry) => entry.signature !== signature)].slice(0, MAX_RECENT_LABELS);
  });
  return entries;
}

export function restoreRecentLabel(entry: RecentLabelEntry): RecentLabelInput {
  const label = cloneLabel(entry.label);
  return {
    label: {
      ...label,
      id: crypto.randomUUID(),
      textLines: cloneTextLinesWithFreshIds(label.textLines),
    },
    preset: clonePreset(entry.preset),
  };
}

export function hydrateRecentLabels(value: unknown): RecentLabelEntry[] {
  if (!Array.isArray(value)) return [];
  const hydrated: RecentLabelEntry[] = [];
  for (const candidate of value) {
    if (hydrated.length >= MAX_RECENT_LABELS) break;
    if (!isRecord(candidate)) continue;
    const entry = candidate as Partial<RecentLabelEntry>;
    if (typeof entry.id !== 'string' || entry.id.length === 0
      || typeof entry.signature !== 'string' || entry.signature.length === 0
      || !Number.isFinite(entry.previewedAt)
      || Number(entry.previewedAt) < 0
      || !isValidLabel(entry.label)
      || !isValidPreset(entry.preset)) continue;
    try {
      const cloned = cloneEntry(entry as RecentLabelEntry);
      if (signatureFor(cloned) === cloned.signature) hydrated.push(cloned);
    } catch {
      // Ignore a single corrupt history item without discarding the rest of the draft.
    }
  }
  return hydrated;
}
