import type { PrintAreaMm, SizePreset, TextPlacement } from './labels';

export type PrintAreaResizeHandle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

const MIN_PRINT_AREA_MM = 5;

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));
const roundMm = (value: number) => Math.round(value * 100) / 100;

export function resolvePrintArea(
  area: PrintAreaMm | undefined,
  preset: Pick<SizePreset, 'widthMm' | 'heightMm' | 'paddingMm'>,
): PrintAreaMm {
  const padding = Number.isFinite(preset.paddingMm)
    ? clamp(preset.paddingMm, 0, Math.min(preset.widthMm, preset.heightMm) / 2)
    : 0;
  const fallback = {
    leftMm: padding,
    topMm: padding,
    widthMm: Math.max(MIN_PRINT_AREA_MM, preset.widthMm - padding * 2),
    heightMm: Math.max(MIN_PRINT_AREA_MM, preset.heightMm - padding * 2),
  };
  const candidate = area && Object.values(area).every(Number.isFinite) ? area : fallback;
  const widthMm = clamp(candidate.widthMm, MIN_PRINT_AREA_MM, preset.widthMm);
  const heightMm = clamp(candidate.heightMm, MIN_PRINT_AREA_MM, preset.heightMm);
  return {
    leftMm: roundMm(clamp(candidate.leftMm, 0, preset.widthMm - widthMm)),
    topMm: roundMm(clamp(candidate.topMm, 0, preset.heightMm - heightMm)),
    widthMm: roundMm(widthMm),
    heightMm: roundMm(heightMm),
  };
}

export function movePrintArea(
  area: PrintAreaMm,
  deltaXmm: number,
  deltaYmm: number,
  preset: Pick<SizePreset, 'widthMm' | 'heightMm'>,
): PrintAreaMm {
  const current = resolvePrintArea(area, { ...preset, paddingMm: 0 });
  return {
    ...current,
    leftMm: roundMm(clamp(current.leftMm + deltaXmm, 0, preset.widthMm - current.widthMm)),
    topMm: roundMm(clamp(current.topMm + deltaYmm, 0, preset.heightMm - current.heightMm)),
  };
}

export function resizePrintArea(
  area: PrintAreaMm,
  handle: PrintAreaResizeHandle,
  deltaXmm: number,
  deltaYmm: number,
  preset: Pick<SizePreset, 'widthMm' | 'heightMm'>,
): PrintAreaMm {
  const current = resolvePrintArea(area, { ...preset, paddingMm: 0 });
  let left = current.leftMm;
  let top = current.topMm;
  let right = left + current.widthMm;
  let bottom = top + current.heightMm;
  if (handle.includes('w')) left = clamp(left + deltaXmm, 0, right - MIN_PRINT_AREA_MM);
  if (handle.includes('e')) right = clamp(right + deltaXmm, left + MIN_PRINT_AREA_MM, preset.widthMm);
  if (handle.includes('n')) top = clamp(top + deltaYmm, 0, bottom - MIN_PRINT_AREA_MM);
  if (handle.includes('s')) bottom = clamp(bottom + deltaYmm, top + MIN_PRINT_AREA_MM, preset.heightMm);
  return {
    leftMm: roundMm(left),
    topMm: roundMm(top),
    widthMm: roundMm(right - left),
    heightMm: roundMm(bottom - top),
  };
}

function resolveAxis(
  value: number,
  threshold: number,
  snaps: readonly [number, string][],
): { value: number; snap: string } {
  const clamped = Math.max(0, Math.min(100, value));
  const target = snaps.find(([point]) => Math.abs(point - clamped) <= threshold);
  return target ? { value: target[0], snap: target[1] } : { value: clamped, snap: 'free' };
}

export function resolvePlacement(xPercent: number, yPercent: number, threshold = 6): TextPlacement {
  const x = resolveAxis(xPercent, threshold, [[0, 'left'], [50, 'center'], [100, 'right']]);
  const y = resolveAxis(yPercent, threshold, [[0, 'top'], [50, 'middle'], [100, 'bottom']]);
  return {
    xPercent: x.value,
    yPercent: y.value,
    horizontalSnap: x.snap as TextPlacement['horizontalSnap'],
    verticalSnap: y.snap as TextPlacement['verticalSnap'],
  };
}

export function describePlacement(placement: TextPlacement): string {
  const exact: Record<string, string> = {
    'top-left': '左上角',
    'top-center': '顶部居中',
    'top-right': '右上角',
    'middle-left': '左侧居中',
    'middle-center': '正中',
    'middle-right': '右侧居中',
    'bottom-left': '左下角',
    'bottom-center': '底部居中',
    'bottom-right': '右下角',
  };
  const key = `${placement.verticalSnap}-${placement.horizontalSnap}`;
  if (exact[key]) return exact[key];
  if (placement.horizontalSnap === 'free' && placement.verticalSnap === 'free') return '自由位置';
  const horizontal = { left: '左对齐', center: '水平居中', right: '右对齐', free: '水平自由' }[placement.horizontalSnap];
  const vertical = { top: '顶部', middle: '垂直居中', bottom: '底部', free: '垂直自由' }[placement.verticalSnap];
  return `${vertical} · ${horizontal}`;
}
