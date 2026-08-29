import type { CSSProperties } from 'react';
import { solveLabelTextLayout } from '../domain/layout';
import type { PrintGroup } from '../domain/printing';
import type { TextPlacement } from '../domain/labels';
import { resolvePrintArea } from '../domain/placement';
import { StyledTextLine } from './StyledText';

interface PrintPagesProps {
  group: PrintGroup | null;
}

function placementTransform(placement: TextPlacement): string {
  const x = placement.horizontalSnap === 'left' ? '0%' : placement.horizontalSnap === 'right' ? '-100%' : '-50%';
  const y = placement.verticalSnap === 'top' ? '0%' : placement.verticalSnap === 'bottom' ? '-100%' : '-50%';
  return `translate(${x}, ${y})`;
}

export default function PrintPages({ group }: PrintPagesProps) {
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
          const layout = label.contentType === 'text' ? solveLabelTextLayout(label, preset) : null;
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
                  : label.textLines.map((line, lineIndex) => <span className="print-positioned-text" key={line.id} style={{
                    left: `${line.placement.xPercent}%`, top: `${line.placement.yPercent}%`,
                    transform: placementTransform(line.placement), textAlign: label.style.horizontalAlign,
                    whiteSpace: 'nowrap',
                    writingMode: line.textOrientation === 'vertical' ? 'vertical-rl' : 'horizontal-tb',
                    fontFamily: line.style.fontFamily,
                    fontSize: line.style.fontSizePt ? `${line.style.fontSizePt}pt` : undefined,
                    fontWeight: line.style.fontWeight,
                    fontStyle: line.style.italic ? 'italic' : undefined,
                    textDecoration: line.style.underline ? 'underline' : undefined,
                  }}><StyledTextLine label={label} line={line} lineIndex={lineIndex} /></span>)}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
