import type { CSSProperties } from 'react';
import { XP420B_100X75_PROFILE } from '../domain/directPrinting';
import { resolvePrintArea } from '../domain/placement';
import { resolvePrintPageGeometry, type PrintLayout } from '../domain/printLayout';
import type { PrintPage } from '../domain/printing';
import type { PrintRotation } from '../domain/printRotation';
import PrintTextLayer from './PrintTextLayer';

export interface PrintBitmapSurfaceProps {
  page: PrintPage;
  layout: PrintLayout;
  rotation: PrintRotation;
  horizontalOffsetMm?: number;
  verticalOffsetMm?: number;
}

const PROFILE = XP420B_100X75_PROFILE;
const PAPER_STYLE: CSSProperties = {
  position: 'relative', width: PROFILE.widthDots, height: PROFILE.heightDots,
  minWidth: PROFILE.widthDots, minHeight: PROFILE.heightDots,
  boxSizing: 'border-box', backgroundColor: 'white', color: 'black',
  overflow: 'hidden', margin: 0, padding: 0, border: 0,
};
const LOCAL_RASTER_IMAGE = /^data:image\/(?:png|jpeg|jpg|webp|gif|bmp);base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/i;

export function validateBitmapSurfaceInput({ page, layout, rotation, horizontalOffsetMm = 0, verticalOffsetMm = 0 }: PrintBitmapSurfaceProps): void {
  if (page.preset.widthMm !== PROFILE.widthMm || page.preset.heightMm !== PROFILE.heightMm) {
    throw new Error('直接打印仅支持 100 × 75 mm 标签');
  }
  if (layout !== 'landscape' && layout !== 'portrait') throw new Error('打印布局无效');
  if (![0, 90, 180, 270].includes(rotation)) throw new Error('打印旋转角度无效');
  if ([horizontalOffsetMm, verticalOffsetMm].some((value) => !Number.isFinite(value) || Math.abs(value) > 10)) {
    throw new Error('打印偏移必须在 -10–10 mm 之间');
  }
  if (page.label.contentType === 'image' && (!page.label.imageFallback || !LOCAL_RASTER_IMAGE.test(page.label.imageFallback))) {
    throw new Error('仅支持已导入的本地位图图片，请重新导入图片');
  }
}

/** Both on-screen preview and capture consume this one physical layout. */
export default function PrintBitmapSurface(props: PrintBitmapSurfaceProps) {
  validateBitmapSurfaceInput(props);
  const { page: { label, preset }, layout, rotation, horizontalOffsetMm = 0, verticalOffsetMm = 0 } = props;
  const area = resolvePrintArea(label.printArea, preset);
  const { contentRotation } = resolvePrintPageGeometry(preset.widthMm, preset.heightMm, layout);
  return <div data-print-bitmap-surface style={{
    ...PAPER_STYLE,
    fontFamily: label.style.fontFamily,
    fontWeight: label.style.fontWeight,
    fontStyle: label.style.italic ? 'italic' : 'normal',
    textDecoration: label.style.underline ? 'underline' : 'none',
    textAlign: label.style.horizontalAlign,
    lineHeight: label.style.lineHeight,
  }}>
    <div data-bitmap-offset style={{ position: 'absolute', inset: 0,
      transform: `translate(${horizontalOffsetMm * PROFILE.dotsPerMm}px, ${verticalOffsetMm * PROFILE.dotsPerMm}px)` }}>
      <div data-bitmap-layout style={{ position: 'absolute', left: '50%', top: '50%',
        width: preset.widthMm * PROFILE.dotsPerMm, height: preset.heightMm * PROFILE.dotsPerMm,
        transform: `translate(-50%, -50%) rotate(${contentRotation}deg)`, transformOrigin: 'center' }}>
        <div data-bitmap-area style={{ position: 'absolute',
          left: area.leftMm * PROFILE.dotsPerMm, top: area.topMm * PROFILE.dotsPerMm,
          width: area.widthMm * PROFILE.dotsPerMm, height: area.heightMm * PROFILE.dotsPerMm,
          overflow: 'visible', display: label.contentType === 'image' ? 'flex' : undefined,
          alignItems: 'center', justifyContent: 'center',
        }}>
          {label.contentType === 'image'
            ? <img data-bitmap-image src={label.imageFallback} alt="" style={{
              display: 'block', width: '100%', height: '100%', objectFit: 'contain',
            }} />
            : <PrintTextLayer label={label} preset={preset} rotation={rotation}
              lineClassName="print-bitmap-text" physicalDotsPerMm={PROFILE.dotsPerMm} />}
        </div>
      </div>
    </div>
  </div>;
}
