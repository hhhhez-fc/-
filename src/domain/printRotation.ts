export type PrintRotation = 0 | 90 | 180 | 270;

export function rotationSwapsAxes(rotation: PrintRotation): boolean {
  return rotation === 90 || rotation === 270;
}
