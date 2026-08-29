import type { InlineTextStyle, LabelRecord, LabelStyle, TextStyleRange } from './labels';
import { updateTextLine } from './textLines';

export interface StyledTextSegment {
  text: string;
  style: InlineTextStyle;
}

export function applyTextStyleRange(
  ranges: TextStyleRange[],
  start: number,
  end: number,
  style: InlineTextStyle,
): TextStyleRange[] {
  const normalizedStart = Math.max(0, Math.min(start, end));
  const normalizedEnd = Math.max(0, Math.max(start, end));
  if (normalizedEnd <= normalizedStart) return ranges;
  return [...ranges, { start: normalizedStart, end: normalizedEnd, style: { ...style } }];
}

export function buildStyledSegments(content: string, ranges: TextStyleRange[]): StyledTextSegment[] {
  if (!content) return [];
  const boundaries = new Set([0, content.length]);
  ranges.forEach((range) => {
    boundaries.add(Math.max(0, Math.min(content.length, range.start)));
    boundaries.add(Math.max(0, Math.min(content.length, range.end)));
  });
  const points = [...boundaries].sort((a, b) => a - b);
  return points.slice(0, -1).map((start, index) => {
    const end = points[index + 1];
    const style = ranges.reduce<InlineTextStyle>((combined, range) => (
      range.start <= start && range.end >= end ? { ...combined, ...range.style } : combined
    ), {});
    return { text: content.slice(start, end), style };
  }).filter((segment) => segment.text.length > 0);
}

export function buildImmediateTextStylePatch(
  label: LabelRecord,
  activeLineId: string,
  selection: { start: number; end: number },
  style: InlineTextStyle,
): Partial<LabelRecord> {
  if (selection.end > selection.start) {
    return { textStyleRanges: applyTextStyleRange(label.textStyleRanges, selection.start, selection.end, style) };
  }
  const activeLine = label.textLines.find((line) => line.id === activeLineId);
  if (!activeLine) return {};
  return {
    textLines: updateTextLine(label.textLines, activeLine.id, { style: { ...activeLine.style, ...style } }),
  };
}

export type AllTextStylePatch = Partial<Pick<
  LabelStyle,
  'fontFamily' | 'fontMode' | 'fontSizePt' | 'fontWeight' | 'italic' | 'underline'
>>;

function applyAllTextInlineStyle(
  style: InlineTextStyle,
  patch: AllTextStylePatch,
): InlineTextStyle {
  const next = { ...style };
  if (patch.fontFamily !== undefined) next.fontFamily = patch.fontFamily;
  if (patch.fontSizePt !== undefined) next.fontSizePt = patch.fontSizePt;
  if (patch.fontWeight !== undefined) next.fontWeight = patch.fontWeight;
  if (patch.italic !== undefined) next.italic = patch.italic;
  if (patch.underline !== undefined) next.underline = patch.underline;
  if (patch.fontMode === 'auto') delete next.fontSizePt;
  return next;
}

export function buildAllTextStylePatch(
  label: LabelRecord,
  patch: AllTextStylePatch,
): Partial<LabelRecord> {
  return {
    style: { ...label.style, ...patch },
    textLines: label.textLines.map((line) => ({
      ...line,
      style: applyAllTextInlineStyle(line.style, patch),
    })),
    textStyleRanges: label.textStyleRanges.map((range) => ({
      ...range,
      style: applyAllTextInlineStyle(range.style, patch),
    })),
  };
}
