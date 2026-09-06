import type { CSSProperties } from 'react';
import { MM_TO_PX } from '../domain/layout';
import type { LabelRecord, SizePreset } from '../domain/labels';
import { resolvePrintArea } from '../domain/placement';
import type { PrintRotation } from '../domain/printRotation';
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
  const previewScale = THUMBNAIL_WIDTH_PX / (preset.widthMm * MM_TO_PX);
  const paperStyle: CSSProperties = {
    width: `${THUMBNAIL_WIDTH_PX}px`,
    aspectRatio: `${preset.widthMm} / ${preset.heightMm}`,
    fontFamily: label.style.fontFamily,
    fontWeight: label.style.fontWeight,
    fontStyle: label.style.italic ? 'italic' : 'normal',
    textDecoration: label.style.underline ? 'underline' : 'none',
    textAlign: label.style.horizontalAlign,
    lineHeight: label.style.lineHeight,
  };

  return (
    <div className="print-label-thumbnail" style={paperStyle} aria-hidden="true">
      <div className="print-label-thumbnail-content" style={{
        left: `${(printArea.leftMm / preset.widthMm) * 100}%`,
        top: `${(printArea.topMm / preset.heightMm) * 100}%`,
        width: `${(printArea.widthMm / preset.widthMm) * 100}%`,
        height: `${(printArea.heightMm / preset.heightMm) * 100}%`,
        overflow: label.contentType === 'text' ? 'visible' : undefined,
      }}>
        {label.contentType === 'image' && label.imageFallback
          ? <img src={label.imageFallback} alt="" />
          : <PrintTextLayer
            label={label}
            preset={preset}
            rotation={appliedRotation}
            lineClassName="print-label-thumbnail-text"
            previewScale={previewScale}
          />}
      </div>
    </div>
  );
}
