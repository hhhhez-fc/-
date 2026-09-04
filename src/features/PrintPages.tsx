import type { CSSProperties } from 'react';
import { solveLabelTextLayout } from '../domain/layout';
import type { PrintGroup } from '../domain/printing';
import { resolvePrintArea } from '../domain/placement';
import { rotationTransform, type PrintRotation } from '../domain/printRotation';
import { StyledTextLine } from './StyledText';

interface PrintPagesProps {
  group: PrintGroup | null;
  rotations?: Record<string, PrintRotation>;
}

export default function PrintPages({ group, rotations = {} }: PrintPagesProps) {
  if (!group) return null;
  return (
    <>
      <style media="print">{`
        @page { size: ${group.widthMm}mm ${group.heightMm}mm; margin: 0; }
        /* Printed labels must override screen layout and pagination rules. */
        .app-shell, .dialog-backdrop { display: none !important; }
        .print-root { position: static !important; }
      `}</style>
      <div className="print-root" aria-hidden="true">
        {group.pages.map(({ label, preset, copyNumber }) => {
          const rotation = label.contentType === 'text' ? rotations[label.id] ?? 0 : 0;
          const layout = label.contentType === 'text' ? solveLabelTextLayout(label, preset, rotation) : null;
          const printArea = resolvePrintArea(label.printArea, preset);
          const fontSize = layout?.fontSize
            ?? (label.style.fontMode === 'auto' ? preset.minFontSize : label.style.fontSizePt);
          const style: CSSProperties = {
            width: `${preset.widthMm}mm`,
            height: `${preset.heightMm}mm`,
            fontFamily: label.style.fontFamily,
            fontSize: `${fontSize}pt`,
            fontWeight: label.style.fontWeight,
            fontStyle: label.style.italic ? 'italic' : 'normal',
            textDecoration: label.style.underline ? 'underline' : 'none',
            textAlign: label.style.horizontalAlign,
            lineHeight: label.style.lineHeight,
            borderWidth: label.style.borderWidthMm ? `${label.style.borderWidthMm}mm` : 0,
          };
          return (
            <section className="print-page" style={style} key={`${label.id}-${copyNumber}`}>
              <div className="print-content-layer" style={{
                left: `${printArea.leftMm}mm`, top: `${printArea.topMm}mm`,
                width: `${printArea.widthMm}mm`, height: `${printArea.heightMm}mm`,
              }}>
                {label.contentType === 'image' && label.imageFallback
                  ? <img src={label.imageFallback} alt="" />
                  : label.textLines.map((line, lineIndex) => {
                    const lineLayout = layout?.lineLayouts?.[line.id];
                    const renderedFontSize = lineLayout?.fontSizePt ?? line.style.fontSizePt ?? label.style.fontSizePt;
                    return <span className="print-positioned-text" key={line.id} style={{
                      left: `${line.placement.xPercent}%`, top: `${line.placement.yPercent}%`,
                      transform: rotationTransform(line.placement, rotation), textAlign: label.style.horizontalAlign,
                      whiteSpace: 'nowrap',
                      writingMode: line.textOrientation === 'vertical' ? 'vertical-rl' : 'horizontal-tb',
                      fontFamily: line.style.fontFamily,
                      fontSize: `${renderedFontSize}pt`,
                      fontWeight: line.style.fontWeight,
                      fontStyle: line.style.italic ? 'italic' : undefined,
                      textDecoration: line.style.underline ? 'underline' : undefined,
                    }}><StyledTextLine
                      label={label}
                      line={line}
                      lineIndex={lineIndex}
                      fontScale={lineLayout?.fontScale}
                    /></span>;
                  })}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
