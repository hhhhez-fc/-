import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { getPreviewScale, MM_TO_PX, solveLabelTextLayout } from '../domain/layout';
import { describePlacement, movePrintArea, resizePrintArea, resolvePrintArea, type PrintAreaResizeHandle } from '../domain/placement';
import {
  didPointerMove,
  resolvePointerDragUpdate,
  resolveTextResizeFontSize,
  type PointerDragStart,
  type TextResizeHandle,
} from '../domain/pointerDrag';
import { contentWithUpdatedTextLine, moveSelectedTextLines, updateTextLine } from '../domain/textLines';
import type { LabelRecord, LabelTextLine, PrintAreaMm, SizePreset } from '../domain/labels';
import { placementTransform } from '../domain/printRotation';
import { StyledTextLine } from './StyledText';

interface LabelPreviewProps {
  label: LabelRecord;
  preset: SizePreset;
  activeLineId: string | null;
  selectedLineIds: string[];
  onActiveLineChange: (id: string) => void;
  onSelectLine: (id: string) => void;
  onClearLineSelection: () => void;
  onChange: (patch: Partial<LabelRecord>) => void;
}

interface PrintAreaDragStart {
  clientX: number;
  clientY: number;
  area: PrintAreaMm;
  mode: 'move' | 'resize';
  handle?: PrintAreaResizeHandle;
}

interface TextResizeStart {
  clientX: number;
  clientY: number;
  fontSizePt: number;
  width: number;
  height: number;
  lineId: string;
  handle: TextResizeHandle;
}

const resizeHandles: Array<{ id: PrintAreaResizeHandle; label: string }> = [
  { id: 'nw', label: '从左上调整打印区域' },
  { id: 'n', label: '从顶部调整打印区域' },
  { id: 'ne', label: '从右上调整打印区域' },
  { id: 'e', label: '从右侧调整打印区域' },
  { id: 'se', label: '从右下调整打印区域' },
  { id: 's', label: '从底部调整打印区域' },
  { id: 'sw', label: '从左下调整打印区域' },
  { id: 'w', label: '从左侧调整打印区域' },
];

const textResizeHandles: TextResizeHandle[] = ['nw', 'ne', 'se', 'sw'];

export default function LabelPreview({ label, preset, activeLineId, selectedLineIds, onActiveLineChange, onSelectLine, onClearLineSelection, onChange }: LabelPreviewProps) {
  const paperRef = useRef<HTMLDivElement>(null);
  const contentLayerRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<(PointerDragStart & { lineId: string; lines: LabelTextLine[]; selectedIds: string[]; moved: boolean }) | null>(null);
  const textResizeRef = useRef<TextResizeStart | null>(null);
  const printAreaDragRef = useRef<PrintAreaDragStart | null>(null);
  const printAreaHandleMovedRef = useRef(false);
  const editInputRef = useRef<HTMLInputElement>(null);
  const editStartRef = useRef<{ lineId: string; text: string } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [directEntryLabelId, setDirectEntryLabelId] = useState<string | null>(null);
  const [isAreaDragging, setIsAreaDragging] = useState(false);
  const [paperWidthPx, setPaperWidthPx] = useState(0);
  useLayoutEffect(() => {
    const paper = paperRef.current;
    if (!paper) return;
    const updateWidth = () => setPaperWidthPx(paper.getBoundingClientRect().width);
    updateWidth();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateWidth);
    observer.observe(paper);
    return () => observer.disconnect();
  }, [preset.widthMm]);
  useLayoutEffect(() => {
    if (!editingLineId) return;
    editInputRef.current?.focus();
    editInputRef.current?.select();
  }, [editingLineId]);
  const previewScale = paperWidthPx ? getPreviewScale(paperWidthPx, preset.widthMm) : 1;
  const printArea = resolvePrintArea(label.printArea, preset);
  const layout = label.contentType === 'text' ? solveLabelTextLayout(label, preset) : null;
  const fontSize = layout?.fontSize
    ?? (label.style.fontMode === 'auto' ? preset.minFontSize : label.style.fontSizePt);
  const paperStyle: CSSProperties = {
    aspectRatio: `${preset.widthMm} / ${preset.heightMm}`,
    fontFamily: label.style.fontFamily, fontSize: `${fontSize * (96 / 72) * previewScale}px`, fontWeight: label.style.fontWeight,
    fontStyle: label.style.italic ? 'italic' : 'normal', textDecoration: label.style.underline ? 'underline' : 'none',
    lineHeight: label.style.lineHeight,
    borderWidth: label.style.borderWidthMm ? `${label.style.borderWidthMm * MM_TO_PX * previewScale}px` : undefined,
  };
  const patchLine = (line: LabelTextLine, patch: Partial<Omit<LabelTextLine, 'id' | 'text'>>) => {
    onChange({ textLines: updateTextLine(label.textLines, line.id, patch) });
  };
  const updatePrintAreaFromPointer = (event: PointerEvent<HTMLElement>) => {
    const start = printAreaDragRef.current;
    const bounds = paperRef.current?.getBoundingClientRect();
    if (!start || !bounds?.width || !bounds.height) return;
    const deltaXpx = event.clientX - start.clientX;
    const deltaYpx = event.clientY - start.clientY;
    if (!didPointerMove(start, event)) return;
    printAreaHandleMovedRef.current = true;
    const deltaXmm = (deltaXpx / bounds.width) * preset.widthMm;
    const deltaYmm = (deltaYpx / bounds.height) * preset.heightMm;
    const next = start.mode === 'resize' && start.handle
      ? resizePrintArea(start.area, start.handle, deltaXmm, deltaYmm, preset)
      : movePrintArea(start.area, deltaXmm, deltaYmm, preset);
    setIsAreaDragging(true);
    onChange({ printArea: next });
  };
  const finishPrintAreaDrag = (event: PointerEvent<HTMLElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    printAreaDragRef.current = null;
    setIsAreaDragging(false);
  };
  const movePrintAreaWithKeyboard = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    const amount = event.shiftKey ? 2 : 0.5;
    const movement: Record<string, [number, number]> = {
      ArrowLeft: [-amount, 0], ArrowRight: [amount, 0], ArrowUp: [0, -amount], ArrowDown: [0, amount],
    };
    const delta = movement[event.key];
    if (!delta) return;
    event.preventDefault();
    onChange({ printArea: movePrintArea(printArea, delta[0], delta[1], preset) });
  };
  const resizePrintAreaWithKeyboard = (handle: PrintAreaResizeHandle, event: KeyboardEvent<HTMLButtonElement>) => {
    const amount = event.shiftKey ? 2 : 0.5;
    const movement: Record<string, [number, number]> = {
      ArrowLeft: [-amount, 0], ArrowRight: [amount, 0], ArrowUp: [0, -amount], ArrowDown: [0, amount],
    };
    const delta = movement[event.key];
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    onChange({ printArea: resizePrintArea(printArea, handle, delta[0], delta[1], preset) });
  };
  const expandPrintAreaFromHandle = (handle: PrintAreaResizeHandle) => {
    const deltaX = handle.includes('w') ? -0.5 : handle.includes('e') ? 0.5 : 0;
    const deltaY = handle.includes('n') ? -0.5 : handle.includes('s') ? 0.5 : 0;
    onChange({ printArea: resizePrintArea(printArea, handle, deltaX, deltaY, preset) });
  };
  const moveFromPointer = (line: LabelTextLine, event: PointerEvent<HTMLButtonElement>) => {
    const bounds = contentLayerRef.current?.getBoundingClientRect();
    const start = dragStartRef.current;
    if (!bounds || !start || start.lineId !== line.id) return;
    const placement = resolvePointerDragUpdate(start, event, bounds, start.moved);
    if (!placement) return;
    start.moved = true;
    setDraggingId(line.id);
    onChange({ textLines: moveSelectedTextLines(
      start.lines,
      start.selectedIds,
      placement.xPercent - start.placement.xPercent,
      placement.yPercent - start.placement.yPercent,
    ) });
  };
  const handleKeyDown = (line: LabelTextLine, event: KeyboardEvent<HTMLButtonElement>) => {
    const amount = event.shiftKey ? 5 : 1;
    const movement: Record<string, [number, number]> = {
      ArrowLeft: [-amount, 0], ArrowRight: [amount, 0], ArrowUp: [0, -amount], ArrowDown: [0, amount],
    };
    const delta = movement[event.key];
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    const ids = selectedLineIds.includes(line.id) ? selectedLineIds : [line.id];
    onChange({ textLines: moveSelectedTextLines(label.textLines, ids, delta[0], delta[1]) });
  };
  const resizeTextFromPointer = (line: LabelTextLine, event: PointerEvent<HTMLSpanElement>) => {
    const start = textResizeRef.current;
    if (!start || start.lineId !== line.id) return;
    event.stopPropagation();
    const nextFontSize = resolveTextResizeFontSize(start, {
      deltaX: event.clientX - start.clientX,
      deltaY: event.clientY - start.clientY,
    });
    patchLine(line, { style: { ...line.style, fontSizePt: nextFontSize } });
  };
  const finishTextResize = (event: PointerEvent<HTMLSpanElement>) => {
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    textResizeRef.current = null;
  };
  const resizeTextWithKeyboard = (line: LabelTextLine, event: KeyboardEvent<HTMLSpanElement>) => {
    const direction = event.key === 'ArrowUp' || event.key === 'ArrowRight'
      ? 1
      : event.key === 'ArrowDown' || event.key === 'ArrowLeft' ? -1 : 0;
    if (!direction) return;
    event.preventDefault();
    event.stopPropagation();
    const amount = event.shiftKey ? 5 : 1;
    const current = line.style.fontSizePt ?? label.style.fontSizePt;
    patchLine(line, { style: { ...line.style, fontSizePt: Math.max(8, Math.min(120, current + direction * amount)) } });
  };
  const startEditing = (line: LabelTextLine) => {
    onActiveLineChange(line.id);
    editStartRef.current = { lineId: line.id, text: line.text };
    setEditingLineId(line.id);
  };
  const finishEditing = () => {
    editStartRef.current = null;
    setEditingLineId(null);
  };
  const handleEditKeyDown = (line: LabelTextLine, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.blur();
      return;
    }
    if (event.key !== 'Escape') return;
    event.preventDefault();
    const editStart = editStartRef.current;
    if (editStart?.lineId === line.id) {
      onChange({ content: contentWithUpdatedTextLine(label.textLines, line.id, editStart.text) });
    }
    editStartRef.current = null;
    setEditingLineId(null);
  };
  const activeLine = label.textLines.find((line) => line.id === activeLineId) ?? label.textLines[0];
  const activeIndex = Math.max(0, label.textLines.findIndex((line) => line.id === activeLine?.id));
  const showDirectEntry = label.contentType === 'text'
    && (!label.content.trim() || directEntryLabelId === label.id);

  return <div className="preview-stage">
    <div className="ruler ruler-horizontal"><span>{preset.widthMm} mm</span></div>
    <div className="ruler ruler-vertical"><span>{preset.heightMm} mm</span></div>
    <div ref={paperRef} className={`label-paper ${layout && !layout.ok ? 'has-overflow' : ''}`} style={paperStyle} data-testid="label-preview">
      <div
        className={`print-area-frame ${isAreaDragging ? 'is-dragging-area' : ''}`}
        role="group"
        tabIndex={0}
        aria-label="拖动内容打印区域；方向键微调，Shift 加速"
        style={{
          left: `${printArea.leftMm * MM_TO_PX * previewScale}px`,
          top: `${printArea.topMm * MM_TO_PX * previewScale}px`,
          width: `${printArea.widthMm * MM_TO_PX * previewScale}px`,
          height: `${printArea.heightMm * MM_TO_PX * previewScale}px`,
        }}
        onKeyDown={movePrintAreaWithKeyboard}
        onPointerDown={(event) => {
          printAreaHandleMovedRef.current = false;
          event.currentTarget.setPointerCapture(event.pointerId);
          printAreaDragRef.current = { clientX: event.clientX, clientY: event.clientY, area: printArea, mode: 'move' };
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget && !printAreaHandleMovedRef.current) onClearLineSelection();
        }}
        onPointerMove={updatePrintAreaFromPointer}
        onPointerUp={finishPrintAreaDrag}
        onPointerCancel={() => { printAreaDragRef.current = null; setIsAreaDragging(false); }}
      >
        <div className="label-content-layer" ref={contentLayerRef} style={{ inset: 0 }} onClick={(event) => {
          if (event.target === event.currentTarget && !printAreaHandleMovedRef.current) onClearLineSelection();
        }}>
        {draggingId && <><i className="snap-guide guide-x" /><i className="snap-guide guide-y" /></>}
        {label.contentType === 'image' && label.imageFallback ? <img src={label.imageFallback} alt="待打印唛头" /> : showDirectEntry ? (
          <textarea
            className="empty-label-input resize-none"
            aria-label="直接输入唛头内容"
            placeholder="在此输入唛头内容"
            value={label.content}
            onFocus={() => setDirectEntryLabelId(label.id)}
            onBlur={() => setDirectEntryLabelId(null)}
            onChange={(event) => onChange({ content: event.target.value })}
            onKeyDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          />
        ) :
          label.textLines.map((line, index) => {
            const isSelected = selectedLineIds.includes(line.id);
            const isActive = line.id === activeLine?.id;
            const lineLayout = layout?.lineLayouts?.[line.id];
            const renderedFontSize = lineLayout?.fontSizePt ?? line.style.fontSizePt ?? label.style.fontSizePt;
            const frameStyle: CSSProperties = {
              left: `${line.placement.xPercent}%`, top: `${line.placement.yPercent}%`,
              transform: placementTransform(line.placement),
            };
            const textStyle: CSSProperties = {
              textAlign: label.style.horizontalAlign,
              whiteSpace: 'nowrap',
              writingMode: line.textOrientation === 'vertical' ? 'vertical-rl' : 'horizontal-tb',
              fontFamily: line.style.fontFamily,
              fontSize: `${renderedFontSize * (96 / 72) * previewScale}px`,
              fontWeight: line.style.fontWeight,
              fontStyle: line.style.italic ? 'italic' : undefined,
              textDecoration: line.style.underline ? 'underline' : undefined,
            };
            if (editingLineId === line.id) {
              return <div key={line.id} className="text-line-frame is-editing-line" style={frameStyle}><input
                  ref={editInputRef}
                  className="draggable-text direct-text-input"
                  style={textStyle}
                  type="text"
                  size={Math.max(1, line.text.length)}
                  value={line.text}
                  aria-label={`直接编辑第 ${index + 1} 行内容`}
                  onChange={(event) => onChange({ content: contentWithUpdatedTextLine(label.textLines, line.id, event.target.value) })}
                  onBlur={finishEditing}
                  onKeyDown={(event) => handleEditKeyDown(line, event)}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => event.stopPropagation()}
                /></div>;
            }
            return <div key={line.id} className={`text-line-frame ${isActive ? 'is-active-line' : ''} ${isSelected ? 'is-selected-line' : ''}`} style={frameStyle}>
              <button type="button"
                className={`draggable-text draggable-line ${draggingId === line.id ? 'is-dragging' : ''}`}
                style={textStyle} aria-pressed={isSelected}
                aria-label={`拖动第 ${index + 1} 行：${line.text || '空行'}，当前位置：${describePlacement(line.placement)}。方向键微调，Shift 加速。`}
                onClick={(event) => { event.stopPropagation(); onSelectLine(line.id); }}
                onDoubleClick={() => startEditing(line)}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  onSelectLine(line.id);
                  dragStartRef.current = {
                    lineId: line.id,
                    clientX: event.clientX,
                    clientY: event.clientY,
                    placement: line.placement,
                    lines: label.textLines,
                    selectedIds: selectedLineIds.includes(line.id) ? selectedLineIds : [...selectedLineIds, line.id],
                    moved: false,
                  };
                }}
                onPointerMove={(event) => { if (dragStartRef.current?.lineId === line.id) moveFromPointer(line, event); }}
                onPointerUp={(event) => {
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                  setDraggingId(null);
                  dragStartRef.current = null;
                }}
                onPointerCancel={() => { setDraggingId(null); dragStartRef.current = null; }} onKeyDown={(event) => handleKeyDown(line, event)}>
                <StyledTextLine
                  label={label}
                  line={line}
                  lineIndex={index}
                  previewScale={previewScale}
                  fontScale={lineLayout?.fontScale}
                />
              </button>
              {isActive && textResizeHandles.map((handle) => <span
                role="slider"
                tabIndex={0}
                key={handle}
                className={`text-resize-handle text-handle-${handle}`}
                aria-label={`从${handle === 'nw' ? '左上' : handle === 'ne' ? '右上' : handle === 'se' ? '右下' : '左下'}调整第 ${index + 1} 行文字大小；方向键调整字号，Shift 加速`}
                aria-valuemin={8}
                aria-valuemax={120}
                aria-valuenow={line.style.fontSizePt ?? label.style.fontSizePt}
                onKeyDown={(event) => resizeTextWithKeyboard(line, event)}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
                  if (!bounds?.width || !bounds.height) return;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  textResizeRef.current = {
                    clientX: event.clientX,
                    clientY: event.clientY,
                    fontSizePt: line.style.fontSizePt ?? label.style.fontSizePt,
                    width: bounds.width,
                    height: bounds.height,
                    lineId: line.id,
                    handle,
                  };
                }}
                onPointerMove={(event) => resizeTextFromPointer(line, event)}
                onPointerUp={finishTextResize}
                onPointerCancel={(event) => { event.stopPropagation(); textResizeRef.current = null; }}
              />)}
            </div>;
          })}
        </div>
        {resizeHandles.map((handle) => <button
          type="button"
          key={handle.id}
          className={`print-area-handle handle-${handle.id}`}
          aria-label={`${handle.label}，方向键微调，Shift 加速，按 Enter 向外扩展`}
          onClick={(event) => {
            event.stopPropagation();
            if (printAreaHandleMovedRef.current) return;
            expandPrintAreaFromHandle(handle.id);
          }}
          onKeyDown={(event) => resizePrintAreaWithKeyboard(handle.id, event)}
          onPointerDown={(event) => {
            event.stopPropagation();
            printAreaHandleMovedRef.current = false;
            event.currentTarget.setPointerCapture(event.pointerId);
            printAreaDragRef.current = {
              clientX: event.clientX,
              clientY: event.clientY,
              area: printArea,
              mode: 'resize',
              handle: handle.id,
            };
          }}
          onPointerMove={(event) => { event.stopPropagation(); updatePrintAreaFromPointer(event); }}
          onPointerUp={(event) => { event.stopPropagation(); finishPrintAreaDrag(event); }}
          onPointerCancel={(event) => { event.stopPropagation(); printAreaDragRef.current = null; setIsAreaDragging(false); }}
        />)}
      </div>
    </div>
    <div className={`layout-status ${layout && !layout.ok ? 'is-error' : ''}`} role="status">
      <span>{layout && !layout.ok ? layout.error : `第 ${activeIndex + 1} 行 · ${activeLine?.style.fontSizePt ?? label.style.fontSizePt} pt · ${describePlacement(activeLine?.placement ?? label.placement)}`}</span>
      {activeLine && <button
        className="layout-status-action"
        type="button"
        aria-label={`第 ${activeIndex + 1} 行恢复正中`}
        onClick={() => patchLine(activeLine, { placement: { xPercent: 50, yPercent: 50, horizontalSnap: 'center', verticalSnap: 'middle' } })}
      >本行恢复正中</button>}
    </div>
  </div>;
}
