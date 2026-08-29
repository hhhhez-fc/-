import type { LabelRecord, SizePreset } from './labels';
import { buildStyledSegments } from './richText';
import { resolvePrintArea } from './placement';
import { MAX_LABEL_QUANTITY } from './quantity';

export interface LayoutInput {
  content: string;
  widthMm: number;
  heightMm: number;
  paddingMm: number;
  maxFontSize: number;
  minFontSize: number;
  fixedFontSize?: number;
  lineHeight?: number;
}

export type LayoutResult = { ok: true; fontSize: number; lines: string[] } | { ok: false; error: string; fontSize?: number };

export const MM_TO_PX = 3.7795;
const PT_TO_PX = 96 / 72;

export function getPreviewScale(renderedWidthPx: number, widthMm: number): number {
  if (!Number.isFinite(renderedWidthPx) || renderedWidthPx <= 0 || !Number.isFinite(widthMm) || widthMm <= 0) return 1;
  return renderedWidthPx / (widthMm * MM_TO_PX);
}

function estimateTextWidthEm(text: string): number {
  return Array.from(text).reduce((total, char) => {
    if (/\s/.test(char)) return total + 0.33;
    if (/[MW@%&]/.test(char)) return total + 0.92;
    if (/[I1|il]/.test(char)) return total + 0.36;
    if (/[A-Z0-9]/.test(char)) return total + 0.66;
    if (/[a-z]/.test(char)) return total + 0.56;
    if (/[-/.,:()_+#]/.test(char)) return total + 0.42;
    return total + 1;
  }, 0);
}

function rangeForLine(label: LabelRecord, lineIndex: number) {
  const values = label.content.replace(/\r\n?/g, '\n').split('\n');
  const line = label.textLines[lineIndex];
  const offset = values.slice(0, lineIndex).reduce((total, value) => total + value.length + 1, 0);
  return label.textStyleRanges
    .filter((range) => range.end > offset && range.start < offset + line.text.length)
    .map((range) => ({
      ...range,
      start: Math.max(0, range.start - offset),
      end: Math.min(line.text.length, range.end - offset),
    }));
}

function lineDimensions(label: LabelRecord, lineIndex: number, baseFontSizePt: number) {
  const line = label.textLines[lineIndex];
  const segments = buildStyledSegments(line.text || ' ', rangeForLine(label, lineIndex));
  const styled = segments.map((segment) => {
    const style = { ...line.style, ...segment.style };
    const fontSizePx = (style.fontSizePt ?? baseFontSizePt) * PT_TO_PX;
    const emphasis = (style.fontWeight === 700 ? 1.04 : 1) * (style.italic ? 1.04 : 1);
    return { text: segment.text, fontSizePx, emphasis };
  });
  if (line.textOrientation === 'vertical') {
    return {
      width: Math.max(...styled.map(({ fontSizePx, emphasis }) => fontSizePx * emphasis), 0) * label.style.lineHeight,
      height: styled.reduce((total, { text, fontSizePx }) => total + Array.from(text).length * fontSizePx, 0),
    };
  }
  return {
    width: styled.reduce((total, { text, fontSizePx, emphasis }) => total + estimateTextWidthEm(text) * fontSizePx * emphasis, 0),
    height: Math.max(...styled.map(({ fontSizePx }) => fontSizePx), 0) * label.style.lineHeight,
  };
}

function lineRect(label: LabelRecord, lineIndex: number, baseFontSizePt: number, width: number, height: number) {
  const line = label.textLines[lineIndex];
  const dimensions = lineDimensions(label, lineIndex, baseFontSizePt);
  const anchorX = width * (Math.max(0, Math.min(100, line.placement.xPercent)) / 100);
  const anchorY = height * (Math.max(0, Math.min(100, line.placement.yPercent)) / 100);
  const left = line.placement.horizontalSnap === 'left'
    ? anchorX
    : line.placement.horizontalSnap === 'right' ? anchorX - dimensions.width : anchorX - dimensions.width / 2;
  const top = line.placement.verticalSnap === 'top'
    ? anchorY
    : line.placement.verticalSnap === 'bottom' ? anchorY - dimensions.height : anchorY - dimensions.height / 2;
  return { left, top, right: left + dimensions.width, bottom: top + dimensions.height };
}

function rectsOverlap(a: ReturnType<typeof lineRect>, b: ReturnType<typeof lineRect>): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

export function solveLabelTextLayout(label: LabelRecord, preset: SizePreset): LayoutResult {
  const printArea = resolvePrintArea(label.printArea, preset);
  const width = Math.max(1, printArea.widthMm * MM_TO_PX);
  const height = Math.max(1, printArea.heightMm * MM_TO_PX);
  const candidates = label.style.fontMode === 'fixed'
    ? [label.style.fontSizePt]
    : Array.from({ length: Math.max(0, preset.maxFontSize - preset.minFontSize + 1) }, (_, index) => preset.maxFontSize - index);
  const printableLineIndexes = label.textLines
    .map((line, index) => line.text.trim() ? index : -1)
    .filter((index) => index >= 0);

  const fontSize = candidates.find((candidate) => printableLineIndexes.every((index) => {
    const dimensions = lineDimensions(label, index, candidate);
    return dimensions.width <= width && dimensions.height <= height;
  }));
  if (fontSize === undefined) {
    const fallbackFontSize = candidates.at(-1);
    return label.style.fontMode === 'auto'
      ? { ok: false, error: '内容在最小字号下仍无法完整显示', fontSize: fallbackFontSize }
      : { ok: false, error: '固定字号下内容超出唛头范围', fontSize: fallbackFontSize };
  }

  const rects = printableLineIndexes.map((index) => lineRect(label, index, fontSize, width, height));
  const fitsBounds = rects.every((rect) => rect.left >= 0 && rect.top >= 0 && rect.right <= width && rect.bottom <= height);
  if (!fitsBounds) return { ok: false, error: '文字位置超出唛头范围', fontSize };
  const fitsWithoutOverlap = rects.every((rect, index) => rects.slice(index + 1).every((other) => !rectsOverlap(rect, other)));
  if (!fitsWithoutOverlap) return { ok: false, error: '文字行发生重叠', fontSize };
  return { ok: true, fontSize, lines: label.textLines.map((line) => line.text) };
}

function wrapText(content: string, maxChars: number) {
  const lines: string[] = [];
  for (const paragraph of content.split(/\r?\n/)) {
    let remaining = paragraph.trim();
    if (!remaining) { lines.push(''); continue; }
    while (remaining.length > maxChars) {
      let breakAt = remaining.lastIndexOf(' ', maxChars);
      if (breakAt < Math.floor(maxChars * 0.55)) breakAt = maxChars;
      lines.push(remaining.slice(0, breakAt).trim());
      remaining = remaining.slice(breakAt).trim();
    }
    lines.push(remaining);
  }
  return lines;
}

export function solveTextLayout(input: LayoutInput): LayoutResult {
  const width = Math.max(1, (input.widthMm - input.paddingMm * 2) * MM_TO_PX);
  const height = Math.max(1, (input.heightMm - input.paddingMm * 2) * MM_TO_PX);
  const lineHeight = input.lineHeight ?? 1.28;
  const candidates = input.fixedFontSize === undefined
    ? Array.from(
      { length: Math.max(0, input.maxFontSize - input.minFontSize + 1) },
      (_, index) => input.maxFontSize - index,
    )
    : [input.fixedFontSize];

  for (const fontSize of candidates) {
    const fontSizePx = fontSize * (96 / 72);
    const maxChars = Math.floor(width / (fontSizePx * 0.62));
    if (maxChars < 1) continue;
    const lines = wrapText(input.content, maxChars);
    const longest = Math.max(...lines.map((line) => line.length), 0);
    const totalHeight = lines.length * fontSizePx * lineHeight;
    if (longest * fontSizePx * 0.62 <= width && totalHeight <= height) {
      return { ok: true, fontSize, lines };
    }
  }
  return input.fixedFontSize === undefined
    ? { ok: false, error: '内容在最小字号下仍无法完整显示' }
    : { ok: false, error: '固定字号下内容超出唛头范围' };
}

export function validateLabelForPrint(label: LabelRecord, preset: SizePreset): string[] {
  const errors: string[] = [];
  if (label.contentType === 'text' && !label.content.trim()) errors.push('唛头内容不能为空');
  if (label.contentType === 'image' && !label.imageFallback) errors.push('唛头图片不可用');
  if (!Number.isSafeInteger(label.quantity) || label.quantity < 1) errors.push('打印数量必须是正整数');
  else if (label.quantity > MAX_LABEL_QUANTITY) errors.push(`基础数量不能超过 ${MAX_LABEL_QUANTITY}`);
  if (!Number.isSafeInteger(label.sides) || label.sides < 1) errors.push('张贴面数必须是正整数');
  if (label.needsReview) errors.push('该唛头尚未完成校对');

  if (label.contentType === 'text' && label.content.trim()) {
    const layout = solveLabelTextLayout(label, preset);
    if (!layout.ok) errors.push(layout.error);
  }

  return errors;
}
