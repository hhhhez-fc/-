import type { CSSProperties } from 'react';
import { solveLabelTextLayout } from '../domain/layout';
import type { LabelRecord, SizePreset } from '../domain/labels';
import { placementTransform } from '../domain/printRotation';
import { StyledTextLine } from './StyledText';

interface PrintTextLayerProps {
  label: LabelRecord;
  preset: SizePreset;
  lineClassName: string;
  previewScale?: number;
}

export default function PrintTextLayer({
  label,
  preset,
  lineClassName,
  previewScale,
}: PrintTextLayerProps) {
  const layout = solveLabelTextLayout(label, preset);
  const layerStyle: CSSProperties = {
    position: 'absolute',
    inset: 0,
  };

  return <div className="print-text-layer" style={layerStyle}>
    {label.textLines.map((line, lineIndex) => {
      const lineLayout = layout.lineLayouts?.[line.id];
      const renderedFontSize = lineLayout?.fontSizePt ?? line.style.fontSizePt ?? label.style.fontSizePt;
      return <span className={lineClassName} key={line.id} style={{
        left: `${line.placement.xPercent}%`,
        top: `${line.placement.yPercent}%`,
        transform: placementTransform(line.placement),
        textAlign: label.style.horizontalAlign,
        whiteSpace: 'nowrap',
        writingMode: line.textOrientation === 'vertical' ? 'vertical-rl' : 'horizontal-tb',
        fontFamily: line.style.fontFamily,
        fontSize: previewScale === undefined
          ? `${renderedFontSize}pt`
          : `${renderedFontSize * (96 / 72) * previewScale}px`,
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
  </div>;
}
