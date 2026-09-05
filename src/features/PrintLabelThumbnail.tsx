import type { CSSProperties } from 'react';
import { MM_TO_PX, solveLabelTextLayout } from '../domain/layout';
import type { LabelRecord, SizePreset } from '../domain/labels';
import { resolvePrintArea } from '../domain/placement';
import { rotationTransform, type PrintRotation } from '../domain/printRotation';
import { StyledTextLine } from './StyledText';

interface PrintLabelThumbnailProps {
  label: LabelRecord;
  preset: SizePreset;
  rotation: PrintRotation;
}

const THUMBNAIL_WIDTH_PX = 150;

export default function PrintLabelThumbnail({ label, preset, rotation }: PrintLabelThumbnailProps) {
  const appliedRotation = label.contentType === 'text' ? rotation : 0;
  const layout = label.contentType === 'text' ? solveLabelTextLayout(label, preset, appliedRotation) : null;
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
      }}>
        {label.contentType === 'image' && label.imageFallback
          ? <img src={label.imageFallback} alt="" />
          : label.textLines.map((line, lineIndex) => {
            const lineLayout = layout?.lineLayouts?.[line.id];
            const renderedFontSize = lineLayout?.fontSizePt ?? line.style.fontSizePt ?? label.style.fontSizePt;
            return <span className="print-label-thumbnail-text" key={line.id} style={{
              left: `${line.placement.xPercent}%`,
              top: `${line.placement.yPercent}%`,
              transform: rotationTransform(line.placement, appliedRotation),
              textAlign: label.style.horizontalAlign,
              whiteSpace: 'nowrap',
              writingMode: line.textOrientation === 'vertical' ? 'vertical-rl' : 'horizontal-tb',
              fontFamily: line.style.fontFamily,
              fontSize: `${renderedFontSize * (96 / 72) * previewScale}px`,
              fontWeight: line.style.fontWeight,
              fontStyle: line.style.italic ? 'italic' : undefined,
              textDecoration: line.style.underline ? 'underline' : undefined,
            }}><StyledTextLine
              label={label}
              line={line}
              lineIndex={lineIndex}
              previewScale={previewScale}
              fontScale={lineLayout?.fontScale}
            /></span>;
          })}
      </div>
    </div>
  );
}
