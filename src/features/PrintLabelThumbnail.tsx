import type { CSSProperties } from 'react';
import { MM_TO_PX } from '../domain/layout';
import type { LabelRecord, SizePreset } from '../domain/labels';
import { resolvePrintArea } from '../domain/placement';
import { paperRotationTransform, rotationSwapsAxes, type PrintRotation } from '../domain/printRotation';
import PrintTextLayer from './PrintTextLayer';

interface PrintLabelThumbnailProps {
  label: LabelRecord;
  preset: SizePreset;
  rotation: PrintRotation;
}

const THUMBNAIL_WIDTH_PX = 150;

export default function PrintLabelThumbnail({ label, preset, rotation }: PrintLabelThumbnailProps) {
  const appliedRotation = label.contentType === 'text' ? rotation : 0;
  const printArea = resolvePrintArea(label.printArea, preset);
  const swapsAxes = rotationSwapsAxes(appliedRotation);
  const pageWidthMm = swapsAxes ? preset.heightMm : preset.widthMm;
  const pageHeightMm = swapsAxes ? preset.widthMm : preset.heightMm;
  const previewScale = THUMBNAIL_WIDTH_PX / (pageWidthMm * MM_TO_PX);
  const paperStyle: CSSProperties = {
    width: `${THUMBNAIL_WIDTH_PX}px`,
    aspectRatio: `${pageWidthMm} / ${pageHeightMm}`,
    fontFamily: label.style.fontFamily,
    fontWeight: label.style.fontWeight,
    fontStyle: label.style.italic ? 'italic' : 'normal',
    textDecoration: label.style.underline ? 'underline' : 'none',
    textAlign: label.style.horizontalAlign,
    lineHeight: label.style.lineHeight,
  };

  return (
    <div className="print-label-thumbnail" style={paperStyle} aria-hidden="true">
      <div className="print-label-thumbnail-paper" style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        width: `${preset.widthMm * MM_TO_PX * previewScale}px`,
        height: `${preset.heightMm * MM_TO_PX * previewScale}px`,
        transform: paperRotationTransform(appliedRotation),
        transformOrigin: 'center',
      }}>
        <div className="print-label-thumbnail-content" style={{
          left: `${(printArea.leftMm / preset.widthMm) * 100}%`,
          top: `${(printArea.topMm / preset.heightMm) * 100}%`,
          width: `${(printArea.widthMm / preset.widthMm) * 100}%`,
          height: `${(printArea.heightMm / preset.heightMm) * 100}%`,
        }}>
          {label.contentType === 'image' && label.imageFallback
            ? <img src={label.imageFallback} alt="" />
            : <PrintTextLayer
              label={label}
              preset={preset}
              lineClassName="print-label-thumbnail-text"
              previewScale={previewScale}
            />}
        </div>
      </div>
    </div>
  );
}
