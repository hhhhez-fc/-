import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import {
  canPointerReorderWorkspacePanels,
  workspacePanelKeyboardMove,
  type WorkspacePanelId,
  type WorkspacePanelSize,
} from '../domain/workspaceLayout';

const PANEL_TITLES: Record<WorkspacePanelId, string> = {
  intake: '录入来源',
  preview: '尺寸与预览',
  records: '校对清单',
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const isNarrowViewport = () => typeof window !== 'undefined' && !canPointerReorderWorkspacePanels(window.innerWidth);

type ResizeAxis = 'x' | 'y' | 'corner';

interface WorkspacePanelProps {
  id: WorkspacePanelId;
  titleId: string;
  size: WorkspacePanelSize;
  onDropAt: (sourceId: WorkspacePanelId, targetId: WorkspacePanelId, position: 'before' | 'after') => void;
  onMove: (id: WorkspacePanelId, delta: -1 | 1) => void;
  onResize: (id: WorkspacePanelId, patch: Partial<WorkspacePanelSize>) => void;
  children: ReactNode;
  className?: string;
}

interface ActiveResize {
  axis: ResizeAxis;
  pointerId: number;
  startX: number;
  startY: number;
  size: WorkspacePanelSize;
}

interface ActiveDrag {
  pointerId: number;
  startX: number;
  startY: number;
  lastTarget: string | null;
}

export default function WorkspacePanel({ id, titleId, size, onDropAt, onMove, onResize, children, className }: WorkspacePanelProps) {
  const resizeRef = useRef<ActiveResize | null>(null);
  const dragRef = useRef<ActiveDrag | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const title = PANEL_TITLES[id];
  const styles = {
    '--panel-width': `${size.widthPx}px`,
    '--panel-height': `${size.heightPx}px`,
  } as CSSProperties;

  const emitResize = (axis: ResizeAxis, nextWidth: number, nextHeight: number) => {
    const narrowViewport = isNarrowViewport();
    const patch: Partial<WorkspacePanelSize> = {};
    if ((axis === 'x' || axis === 'corner') && !narrowViewport) {
      patch.widthPx = clamp(nextWidth, 220, 900);
    }
    if (axis === 'y' || axis === 'corner') {
      patch.heightPx = clamp(nextHeight, 320, 1200);
    }
    if (Object.keys(patch).length > 0) onResize(id, patch);
  };

  const startResize = (axis: ResizeAxis) => (event: PointerEvent<HTMLSpanElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeRef.current = {
      axis,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      size: { ...size },
    };
  };

  const continueResize = (event: PointerEvent<HTMLSpanElement>) => {
    const active = resizeRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    emitResize(
      active.axis,
      active.size.widthPx + event.clientX - active.startX,
      active.size.heightPx + event.clientY - active.startY,
    );
  };

  const finishResize = (event: PointerEvent<HTMLSpanElement>) => {
    if (resizeRef.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    resizeRef.current = null;
  };

  const resizeWithKeyboard = (axis: ResizeAxis) => (event: KeyboardEvent<HTMLSpanElement>) => {
    const step = event.shiftKey ? 20 : 4;
    let width = size.widthPx;
    let height = size.heightPx;
    if ((axis === 'x' || axis === 'corner') && event.key === 'ArrowLeft') width -= step;
    else if ((axis === 'x' || axis === 'corner') && event.key === 'ArrowRight') width += step;
    else if ((axis === 'y' || axis === 'corner') && event.key === 'ArrowUp') height -= step;
    else if ((axis === 'y' || axis === 'corner') && event.key === 'ArrowDown') height += step;
    else return;
    event.preventDefault();
    emitResize(axis, width, height);
  };

  const startTitleDrag = (event: PointerEvent<HTMLElement>) => {
    if (isNarrowViewport() || event.button !== 0 || !(event.target as HTMLElement).closest('[data-panel-drag-handle]')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastTarget: null,
    };
  };

  const continueTitleDrag = (event: PointerEvent<HTMLElement>) => {
    const active = dragRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - active.startX, event.clientY - active.startY) < 4) return;
    setIsDragging(true);
    const targetPanel = document.elementFromPoint(event.clientX, event.clientY)
      ?.closest('[data-workspace-panel-id]') as HTMLElement | null;
    const targetId = targetPanel?.dataset.workspacePanelId as WorkspacePanelId | undefined;
    if (!targetPanel || !targetId || targetId === id) return;
    const bounds = targetPanel.getBoundingClientRect();
    const position = event.clientX >= bounds.left + bounds.width / 2 ? 'after' : 'before';
    const targetKey = `${targetId}:${position}`;
    if (targetKey === active.lastTarget) return;
    active.lastTarget = targetKey;
    onDropAt(id, targetId, position);
  };

  const finishTitleDrag = (event: PointerEvent<HTMLElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
    setIsDragging(false);
  };

  const moveTitleWithKeyboard = (event: KeyboardEvent<HTMLElement>) => {
    if (!(event.target as HTMLElement).closest('[data-panel-drag-handle]')) return;
    const delta = workspacePanelKeyboardMove(event.key);
    if (delta === null) return;
    event.preventDefault();
    onMove(id, delta);
  };

  return (
    <section
      className={`panel workspace-panel ${className ?? ''}`.trim()}
      style={styles}
      role="region"
      aria-labelledby={titleId}
      data-workspace-panel-id={id}
      data-dragging={isDragging || undefined}
      onPointerDown={startTitleDrag}
      onPointerMove={continueTitleDrag}
      onPointerUp={finishTitleDrag}
      onPointerCancel={finishTitleDrag}
      onKeyDown={moveTitleWithKeyboard}
    >
      <div className="workspace-panel-body">{children}</div>
      <span
        role="separator"
        tabIndex={0}
        aria-label={`调整${title}宽度`}
        aria-orientation="vertical"
        aria-valuemin={220}
        aria-valuemax={900}
        aria-valuenow={size.widthPx}
        className="panel-resizer panel-resizer-x"
        onPointerDown={startResize('x')}
        onPointerMove={continueResize}
        onPointerUp={finishResize}
        onPointerCancel={finishResize}
        onKeyDown={resizeWithKeyboard('x')}
      />
      <span
        role="separator"
        tabIndex={0}
        aria-label={`调整${title}高度`}
        aria-orientation="horizontal"
        aria-valuemin={320}
        aria-valuemax={1200}
        aria-valuenow={size.heightPx}
        className="panel-resizer panel-resizer-y"
        onPointerDown={startResize('y')}
        onPointerMove={continueResize}
        onPointerUp={finishResize}
        onPointerCancel={finishResize}
        onKeyDown={resizeWithKeyboard('y')}
      />
      <span
        aria-hidden="true"
        className="panel-resizer panel-resizer-corner"
        onPointerDown={startResize('corner')}
        onPointerMove={continueResize}
        onPointerUp={finishResize}
        onPointerCancel={finishResize}
      />
    </section>
  );
}
