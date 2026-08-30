import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import {
  canPointerReorderWorkspacePanels,
  findWorkspacePanelDropTarget,
  WORKSPACE_PANEL_MIN_WIDTH,
  workspacePanelAutoScrollDirection,
  workspacePanelDragHasStarted,
  workspacePanelKeyboardMove,
  type WorkspacePanelDropTarget,
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
  onDragPreview: (target: WorkspacePanelDropTarget | null) => void;
  onMove: (id: WorkspacePanelId, delta: -1 | 1) => void;
  onResize: (id: WorkspacePanelId, patch: Partial<WorkspacePanelSize>) => void;
  children: ReactNode;
  className?: string;
  dropPosition?: WorkspacePanelDropTarget['position'];
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
  startScrollLeft: number;
  lastX: number;
  lastY: number;
  started: boolean;
  dropTarget: WorkspacePanelDropTarget | null;
}

interface ActiveAutoScroll {
  frameId: number;
  direction: -1 | 1;
  workspace: HTMLElement;
}

export default function WorkspacePanel({
  id,
  titleId,
  size,
  onDropAt,
  onDragPreview,
  onMove,
  onResize,
  children,
  className,
  dropPosition,
}: WorkspacePanelProps) {
  const resizeRef = useRef<ActiveResize | null>(null);
  const dragRef = useRef<ActiveDrag | null>(null);
  const autoScrollRef = useRef<ActiveAutoScroll | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const title = PANEL_TITLES[id];
  const styles = {
    '--panel-width': `${size.widthPx}px`,
    '--panel-height': `${size.heightPx}px`,
    '--panel-drag-x': `${dragOffset.x}px`,
    '--panel-drag-y': `${dragOffset.y}px`,
  } as CSSProperties;

  useEffect(() => () => {
    if (autoScrollRef.current) cancelAnimationFrame(autoScrollRef.current.frameId);
  }, []);

  const emitResize = (axis: ResizeAxis, nextWidth: number, nextHeight: number) => {
    const narrowViewport = isNarrowViewport();
    const patch: Partial<WorkspacePanelSize> = {};
    if ((axis === 'x' || axis === 'corner') && !narrowViewport) {
      patch.widthPx = clamp(nextWidth, WORKSPACE_PANEL_MIN_WIDTH, 900);
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

  const findDropTargetAt = (pointerX: number) => findWorkspacePanelDropTarget(id, pointerX, Array.from(
    document.querySelectorAll<HTMLElement>('[data-workspace-panel-id]'),
  ).map((panel) => {
    const bounds = panel.getBoundingClientRect();
    return {
      id: panel.dataset.workspacePanelId as WorkspacePanelId,
      left: bounds.left,
      width: bounds.width,
    };
  }));

  const publishDropTarget = (active: ActiveDrag, pointerX: number) => {
    const target = findDropTargetAt(pointerX);
    const targetKey = target ? `${target.targetId}:${target.position}` : null;
    const currentKey = active.dropTarget ? `${active.dropTarget.targetId}:${active.dropTarget.position}` : null;
    if (targetKey === currentKey) return;
    active.dropTarget = target;
    onDragPreview(target);
  };

  const syncDragOffset = (active: ActiveDrag, workspace: HTMLElement) => {
    setDragOffset({
      x: active.lastX - active.startX + workspace.scrollLeft - active.startScrollLeft,
      y: active.lastY - active.startY,
    });
  };

  const stopWorkspaceAutoScroll = () => {
    if (!autoScrollRef.current) return;
    cancelAnimationFrame(autoScrollRef.current.frameId);
    autoScrollRef.current = null;
  };

  const startWorkspaceAutoScroll = (direction: -1 | 0 | 1, workspace: HTMLElement) => {
    if (direction === 0) {
      stopWorkspaceAutoScroll();
      return;
    }
    const current = autoScrollRef.current;
    if (current?.direction === direction && current.workspace === workspace) return;
    stopWorkspaceAutoScroll();
    const tick = () => {
      const active = dragRef.current;
      if (!active?.started) {
        stopWorkspaceAutoScroll();
        return;
      }
      const previousScrollLeft = workspace.scrollLeft;
      workspace.scrollLeft += direction * 12;
      syncDragOffset(active, workspace);
      publishDropTarget(active, active.lastX);
      if (workspace.scrollLeft === previousScrollLeft) {
        stopWorkspaceAutoScroll();
        return;
      }
      const frameId = requestAnimationFrame(tick);
      if (autoScrollRef.current) autoScrollRef.current.frameId = frameId;
    };
    autoScrollRef.current = { direction, workspace, frameId: requestAnimationFrame(tick) };
  };

  const startTitleDrag = (event: PointerEvent<HTMLElement>) => {
    if (isNarrowViewport() || event.button !== 0 || !(event.target as HTMLElement).closest('[data-panel-drag-handle]')) return;
    const workspace = event.currentTarget.closest('.workspace') as HTMLElement | null;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: workspace?.scrollLeft ?? 0,
      lastX: event.clientX,
      lastY: event.clientY,
      started: false,
      dropTarget: null,
    };
    onDragPreview(null);
  };

  const continueTitleDrag = (event: PointerEvent<HTMLElement>) => {
    const active = dragRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    active.started = workspacePanelDragHasStarted(
      active.started,
      event.clientX - active.startX,
      event.clientY - active.startY,
    );
    if (!active.started) return;
    active.lastX = event.clientX;
    active.lastY = event.clientY;
    setIsDragging(true);
    const workspace = event.currentTarget.closest('.workspace') as HTMLElement;
    syncDragOffset(active, workspace);
    publishDropTarget(active, event.clientX);
    const bounds = workspace.getBoundingClientRect();
    let direction = workspacePanelAutoScrollDirection(event.clientX, bounds.left, bounds.right);
    if (direction < 0 && workspace.scrollLeft <= 0) direction = 0;
    if (direction > 0 && workspace.scrollLeft + workspace.clientWidth >= workspace.scrollWidth - 1) direction = 0;
    startWorkspaceAutoScroll(direction, workspace);
  };

  const finishTitleDrag = (event: PointerEvent<HTMLElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    const dropTarget = dragRef.current.dropTarget;
    stopWorkspaceAutoScroll();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
    setIsDragging(false);
    setDragOffset({ x: 0, y: 0 });
    onDragPreview(null);
    if (event.type === 'pointerup' && dropTarget) onDropAt(id, dropTarget.targetId, dropTarget.position);
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
      data-drop-position={dropPosition}
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
        aria-valuemin={WORKSPACE_PANEL_MIN_WIDTH}
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
