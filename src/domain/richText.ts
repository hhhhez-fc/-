import type { InlineTextStyle, TextStyleRange } from './labels';

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
