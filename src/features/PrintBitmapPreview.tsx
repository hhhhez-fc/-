import { useEffect, useRef, useState } from 'react';
import { XP420B_100X75_PROFILE } from '../domain/directPrinting';
import PrintBitmapSurface, { type PrintBitmapSurfaceProps } from './PrintBitmapSurface';

interface PrintBitmapPreviewProps extends PrintBitmapSurfaceProps {
  widthPx?: number;
  accessibleLabel?: string;
}

export default function PrintBitmapPreview({ widthPx = 400, accessibleLabel, ...surfaceProps }: PrintBitmapPreviewProps) {
  const width = Number.isFinite(widthPx) && widthPx > 0 ? widthPx : 400;
  const frameRef = useRef<HTMLDivElement>(null);
  const [renderedWidth, setRenderedWidth] = useState(width);
  const scale = renderedWidth / XP420B_100X75_PROFILE.widthDots;

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const measure = () => {
      const measuredWidth = frame.getBoundingClientRect().width;
      if (measuredWidth > 0) setRenderedWidth(Math.min(width, measuredWidth));
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(frame);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [width]);

  return <div role="img" aria-label={accessibleLabel ?? `100 × 75 mm 标签预览：${surfaceProps.page.label.content || '图片唛头'}`}
    ref={frameRef} style={{ width: '100%', maxWidth: width, height: XP420B_100X75_PROFILE.heightDots * scale, overflow: 'hidden' }}>
    <div aria-hidden="true" style={{ transform: `scale(${scale})`, transformOrigin: 'top left',
      width: XP420B_100X75_PROFILE.widthDots, height: XP420B_100X75_PROFILE.heightDots }}>
      <PrintBitmapSurface {...surfaceProps} />
    </div>
  </div>;
}
