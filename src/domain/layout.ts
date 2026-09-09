import { clampFontSizePt, MAX_FONT_SIZE_PT, MIN_FONT_SIZE_PT, type LabelRecord, type SizePreset } from './labels';
import { buildStyledSegments } from './richText';
import { resolvePrintArea } from './placement';
import { MAX_LABEL_QUANTITY } from './quantity';

export interface ResolvedLineLayout {
  fontSizePt: number;
  fontScale: number;
}

export type LabelLayoutResult =
  | { ok: true; fontSize: number; lineLayouts: Record<string, ResolvedLineLayout>; lines: string[] }
  | { ok: false; error: string; fontSize?: number; lineLayouts?: Record<string, ResolvedLineLayout> };

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

function requestedLineSize(label: LabelRecord, lineIndex: number): number {
  const requested = label.textLines[lineIndex].style.fontSizePt ?? label.style.fontSizePt;
  return clampFontSizePt(requested);
}

function fontSizeCandidates(requested: number, minimum: number): number[] {
  const upperBound = clampFontSizePt(requested);
  const lowerBound = Math.min(upperBound, clampFontSizePt(minimum));
  const candidates: number[] = [];
  // The iteration limit also protects this search independently of input magnitude.
  for (let step = 0; step <= MAX_FONT_SIZE_PT - MIN_FONT_SIZE_PT; step += 1) {
    const candidate = upperBound - step;
    if (candidate <= lowerBound) break;
    candidates.push(candidate);
  }
  candidates.push(lowerBound);
  return candidates;
}

function scaledLineDimensions(
  label: LabelRecord,
  lineIndex: number,
  baseFontSizePt: number,
  fontScale: number,
) {
  const line = label.textLines[lineIndex];
  const segments = buildStyledSegments(line.text || ' ', rangeForLine(label, lineIndex));
  const styled = segments.map((segment) => {
    const style = {
      fontWeight: label.style.fontWeight,
      italic: label.style.italic,
      ...line.style,
      ...segment.style,
    };
    const explicitFontSizePt = segment.style.fontSizePt ?? line.style.fontSizePt;
    const fontSizePt = explicitFontSizePt === undefined ? baseFontSizePt : clampFontSizePt(explicitFontSizePt) * fontScale;
    const fontSizePx = fontSizePt * PT_TO_PX;
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

function scaledLineRect(
  label: LabelRecord,
  lineIndex: number,
  baseFontSizePt: number,
  fontScale: number,
  width: number,
  height: number,
) {
  const line = label.textLines[lineIndex];
  const measured = scaledLineDimensions(label, lineIndex, baseFontSizePt, fontScale);
  const anchorX = width * (Math.max(0, Math.min(100, line.placement.xPercent)) / 100);
  const anchorY = height * (Math.max(0, Math.min(100, line.placement.yPercent)) / 100);
  const translateX = line.placement.horizontalSnap === 'left'
    ? 0
    : line.placement.horizontalSnap === 'right' ? -measured.width : -measured.width / 2;
  const translateY = line.placement.verticalSnap === 'top'
    ? 0
    : line.placement.verticalSnap === 'bottom' ? -measured.height : -measured.height / 2;
  const centerX = anchorX + measured.width / 2 + translateX;
  const centerY = anchorY + measured.height / 2 + translateY;
  const left = centerX - measured.width / 2;
  const top = centerY - measured.height / 2;
  return {
    left,
    top,
    right: left + measured.width,
    bottom: top + measured.height,
  };
}

function scaledRectFitsBounds(rect: ReturnType<typeof scaledLineRect>, width: number, height: number): boolean {
  return rect.left >= 0 && rect.top >= 0 && rect.right <= width && rect.bottom <= height;
}

export function solveLabelTextLayout(label: LabelRecord, preset: SizePreset): LabelLayoutResult {
  const printArea = resolvePrintArea(label.printArea, preset);
  const usesFixedFontSize = label.style.fontMode === 'fixed';
  const width = Math.max(1, printArea.widthMm * MM_TO_PX);
  const height = Math.max(1, printArea.heightMm * MM_TO_PX);
  const printableLineIndexes = label.textLines
    .map((line, index) => line.text.trim() ? index : -1)
    .filter((index) => index >= 0);
  const lineLayouts: Record<string, ResolvedLineLayout> = {};
  let firstOverflowFontSize: number | undefined;

  for (const index of printableLineIndexes) {
    const requested = requestedLineSize(label, index);
    const usesFixedLineSize = usesFixedFontSize || label.textLines[index].style.fontSizePt !== undefined;
    const autoFillRequested = printableLineIndexes.length === 1 ? MAX_FONT_SIZE_PT : requested;
    const candidates = usesFixedLineSize ? [requested] : fontSizeCandidates(autoFillRequested, preset.minFontSize);
    const resolved = candidates.find((candidate) => {
      const fontScale = candidate / requested;
      const rect = scaledLineRect(label, index, candidate, fontScale, width, height);
      return scaledRectFitsBounds(rect, width, height);
    });
    if (resolved === undefined) {
      const fallbackFontSize = usesFixedLineSize
        ? requested
        : Math.min(requested, clampFontSizePt(preset.minFontSize));
      lineLayouts[label.textLines[index].id] = {
        fontSizePt: fallbackFontSize,
        fontScale: fallbackFontSize / requested,
      };
      if (!usesFixedLineSize) firstOverflowFontSize ??= fallbackFontSize;
      continue;
    }
    const fontScale = resolved / requested;
    lineLayouts[label.textLines[index].id] = { fontSizePt: resolved, fontScale };
  }

  const fontSize = printableLineIndexes.length > 0
    ? lineLayouts[label.textLines[printableLineIndexes[0]].id].fontSizePt
    : label.style.fontSizePt;
  if (firstOverflowFontSize !== undefined) {
    return {
      ok: false,
      error: '内容在最小字号下仍无法完整显示',
      fontSize: firstOverflowFontSize,
      lineLayouts,
    };
  }
  return { ok: true, fontSize, lineLayouts, lines: label.textLines.map((line) => line.text) };
}

export function validateLabelForPrint(label: LabelRecord, preset: SizePreset): string[] {
  const errors: string[] = [];
  if (label.contentType === 'text' && !label.content.trim()) errors.push('唛头内容不能为空');
  if (label.contentType === 'image' && !label.imageFallback) errors.push('唛头图片不可用');
  if (!Number.isSafeInteger(label.quantity) || label.quantity < 1) errors.push('打印数量必须是正整数');
  else if (label.quantity > MAX_LABEL_QUANTITY) errors.push(`打印数量不能超过 ${MAX_LABEL_QUANTITY}`);
  if (!Number.isSafeInteger(label.sides) || label.sides < 1) errors.push('张贴面数必须是正整数');
  if (label.contentType === 'text' && label.content.trim()) {
    const layout = solveLabelTextLayout(label, preset);
    if (!layout.ok) errors.push(layout.error);
  }

  return errors;
}
