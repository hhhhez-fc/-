import type { CSSProperties } from 'react';
import type { PrintGroup } from '../domain/printing';
import { resolvePrintArea } from '../domain/placement';
import type { PrintRotation } from '../domain/printRotation';
import PrintTextLayer from './PrintTextLayer';

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
          const printArea = resolvePrintArea(label.printArea, preset);
          const style: CSSProperties = {
            width: `${preset.widthMm}mm`,
            height: `${preset.heightMm}mm`,
            fontFamily: label.style.fontFamily,
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
                  : <PrintTextLayer
                    label={label}
                    preset={preset}
                    rotation={rotation}
                    lineClassName="print-positioned-text"
                  />}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
