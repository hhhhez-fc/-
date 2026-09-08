import type { CSSProperties } from 'react';
import type { PrintGroup } from '../domain/printing';
import {
  defaultPrintLayout,
  resolvePrintPageGeometry,
  type PrintLayout,
} from '../domain/printLayout';
import { resolvePrintArea } from '../domain/placement';
import type { PrintRotation } from '../domain/printRotation';
import PrintTextLayer from './PrintTextLayer';

interface PrintPagesProps {
  group: PrintGroup | null;
  layout?: PrintLayout;
  rotations?: Record<string, PrintRotation>;
}

export default function PrintPages({ group, layout, rotations = {} }: PrintPagesProps) {
  if (!group) return null;
  const resolvedLayout = layout ?? defaultPrintLayout(group.widthMm, group.heightMm);
  const pageGeometry = resolvePrintPageGeometry(group.widthMm, group.heightMm, resolvedLayout);
  return (
    <>
      <style media="print">{`
        @page { size: ${pageGeometry.widthMm}mm ${pageGeometry.heightMm}mm; margin: 0; }
        /* Printed labels must override screen layout and pagination rules. */
        .app-shell, .dialog-backdrop { display: none !important; }
        .print-root { position: static !important; }
      `}</style>
      <div className="print-root" data-print-layout={resolvedLayout} aria-hidden="true">
        {group.pages.map(({ label, preset, copyNumber }) => {
          const rotation = label.contentType === 'text' ? rotations[label.id] ?? 0 : 0;
          const printArea = resolvePrintArea(label.printArea, preset);
          const style: CSSProperties = {
            width: `${pageGeometry.widthMm}mm`,
            height: `${pageGeometry.heightMm}mm`,
            fontFamily: label.style.fontFamily,
            fontWeight: label.style.fontWeight,
            fontStyle: label.style.italic ? 'italic' : 'normal',
            textDecoration: label.style.underline ? 'underline' : 'none',
            textAlign: label.style.horizontalAlign,
            lineHeight: label.style.lineHeight,
            borderWidth: label.style.borderWidthMm ? `${label.style.borderWidthMm}mm` : 0,
          };
          return (
            <section
              className="print-page"
              style={style}
              key={`${label.id}-${copyNumber}`}
            >
              <div className="print-page-content" style={pageGeometry.contentRotation === 0 ? {
                position: 'absolute', inset: 0,
                width: `${preset.widthMm}mm`, height: `${preset.heightMm}mm`,
              } : {
                position: 'absolute', left: '50%', top: '50%',
                width: `${preset.widthMm}mm`, height: `${preset.heightMm}mm`,
                transform: `translate(-50%, -50%) rotate(${pageGeometry.contentRotation}deg)`,
                transformOrigin: 'center',
              }}>
                <div className="print-content-layer" style={{
                  left: `${printArea.leftMm}mm`, top: `${printArea.topMm}mm`,
                  width: `${printArea.widthMm}mm`, height: `${printArea.heightMm}mm`,
                  overflow: label.contentType === 'text' ? 'visible' : undefined,
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
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
