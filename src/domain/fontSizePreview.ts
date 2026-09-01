import type { LabelRecord } from './labels';
import { buildAllTextStylePatch, type AllTextStylePatch } from './richText';

export type FontSizeChoice =
  | { fontMode: 'auto' }
  | { fontMode: 'fixed'; fontSizePt: number };

export function buildFontSizePreviewLabel(
  label: LabelRecord,
  choice: FontSizeChoice,
): LabelRecord {
  const patch = buildAllTextStylePatch(label, choice as AllTextStylePatch);
  return { ...label, ...patch };
}
