import type { TextPlacement } from './labels';

export type PrintRotation = 0 | 90 | 180 | 270;

export function nextPrintRotation(rotation: PrintRotation): PrintRotation {
  return ((rotation + 90) % 360) as PrintRotation;
}

export function rotationSwapsAxes(rotation: PrintRotation): boolean {
  return rotation === 90 || rotation === 270;
}

export function placementTransform(placement: TextPlacement): string {
  const x = placement.horizontalSnap === 'left' ? '0%' : placement.horizontalSnap === 'right' ? '-100%' : '-50%';
  const y = placement.verticalSnap === 'top' ? '0%' : placement.verticalSnap === 'bottom' ? '-100%' : '-50%';
  return `translate(${x}, ${y})`;
}

export function paperRotationTransform(rotation: PrintRotation): string {
  return `translate(-50%, -50%) rotate(${rotation}deg)`;
}
