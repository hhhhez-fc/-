import { resolvePlacement } from './placement';
import type { TextPlacement } from './labels';

const DRAG_THRESHOLD_PX = 4;

export interface PointerDragStart {
  clientX: number;
  clientY: number;
  placement: TextPlacement;
}

export function resolvePointerDragUpdate(
  start: PointerDragStart,
  current: { clientX: number; clientY: number },
  bounds: { width: number; height: number },
): TextPlacement | null {
  const deltaX = current.clientX - start.clientX;
  const deltaY = current.clientY - start.clientY;
  if ((deltaX * deltaX) + (deltaY * deltaY) < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return null;
  if (!bounds.width || !bounds.height) return null;
  return resolvePlacement(
    start.placement.xPercent + (deltaX / bounds.width) * 100,
    start.placement.yPercent + (deltaY / bounds.height) * 100,
  );
}
