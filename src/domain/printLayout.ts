export type PrintLayout = 'landscape' | 'portrait';

export interface PrintPageGeometry {
  widthMm: number;
  heightMm: number;
  contentRotation: 0 | 90;
  sizeLabel: string;
}

export function defaultPrintLayout(widthMm: number, heightMm: number): PrintLayout {
  return widthMm >= heightMm ? 'landscape' : 'portrait';
}

export function resolvePrintPageGeometry(
  widthMm: number,
  heightMm: number,
  layout: PrintLayout,
): PrintPageGeometry {
  const layoutMatchesPaper = widthMm === heightMm || defaultPrintLayout(widthMm, heightMm) === layout;
  const resolvedWidthMm = layoutMatchesPaper ? widthMm : heightMm;
  const resolvedHeightMm = layoutMatchesPaper ? heightMm : widthMm;
  return {
    widthMm: resolvedWidthMm,
    heightMm: resolvedHeightMm,
    contentRotation: layoutMatchesPaper ? 0 : 90,
    sizeLabel: `${resolvedWidthMm} × ${resolvedHeightMm} mm`,
  };
}
