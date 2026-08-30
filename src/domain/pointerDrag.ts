import { resolvePlacement } from './placement';
import type { TextPlacement } from './labels';

const DRAG_THRESHOLD_PX = 4;

export function didPointerMove(
  start: { clientX: number; clientY: number },
  current: { clientX: number; clientY: number },
): boolean {
  const deltaX = current.clientX - start.clientX;
  const deltaY = current.clientY - start.clientY;
  return (deltaX * deltaX) + (deltaY * deltaY) >= DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX;
}

export interface PointerDragStart {
  clientX: number;
  clientY: number;
  placement: TextPlacement;
}

export type TextResizeHandle = 'nw' | 'ne' | 'se' | 'sw';

export interface TextResizeStart {
  fontSizePt: number;
  width: number;
  height: number;
  handle: TextResizeHandle;
}

export function resolveTextResizeFontSize(
  start: TextResizeStart,
  pointer: { deltaX: number; deltaY: number },
): number {
  if (start.width <= 0 || start.height <= 0) return Math.max(8, Math.min(120, start.fontSizePt));
  const directionX = start.handle.includes('w') ? -1 : 1;
  const directionY = start.handle.includes('n') ? -1 : 1;
  const scale = 1 + (
    (pointer.deltaX * directionX) / start.width
    + (pointer.deltaY * directionY) / start.height
  ) / 2;
  return Math.round(Math.max(8, Math.min(120, start.fontSizePt * scale)) * 2) / 2;
}

export function resolvePointerDragUpdate(
  start: PointerDragStart,
  current: { clientX: number; clientY: number },
  bounds: { width: number; height: number },
): TextPlacement | null {
  const deltaX = current.clientX - start.clientX;
  const deltaY = current.clientY - start.clientY;
  if (!didPointerMove(start, current)) return null;
  if (!bounds.width || !bounds.height) return null;
  return resolvePlacement(
    start.placement.xPercent + (deltaX / bounds.width) * 100,
    start.placement.yPercent + (deltaY / bounds.height) * 100,
  );
}
