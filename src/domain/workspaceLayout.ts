export const WORKSPACE_PANEL_IDS = ['intake', 'preview', 'records'] as const;

export type WorkspacePanelId = typeof WORKSPACE_PANEL_IDS[number];

export interface WorkspacePanelSize {
  widthPx: number;
  heightPx: number;
}

export interface WorkspaceLayout {
  version: 2;
  order: WorkspacePanelId[];
  sizes: Record<WorkspacePanelId, WorkspacePanelSize>;
}

export interface WorkspacePanelInlineRect {
  id: WorkspacePanelId;
  left: number;
  width: number;
}

export interface WorkspacePanelDropTarget {
  targetId: WorkspacePanelId;
  position: 'before' | 'after';
}

export const WORKSPACE_PANEL_MIN_WIDTH = 180;

const LEGACY_DEFAULT_PANEL_WIDTHS: Record<WorkspacePanelId, number> = {
  intake: 360,
  preview: 640,
  records: 420,
};

export const DEFAULT_WORKSPACE_LAYOUT: WorkspaceLayout = {
  version: 2,
  order: ['intake', 'preview', 'records'],
  sizes: {
    intake: { widthPx: 300, heightPx: 640 },
    preview: { widthPx: 540, heightPx: 760 },
    records: { widthPx: 340, heightPx: 640 },
  },
};

export function canPointerReorderWorkspacePanels(viewportWidth: number): boolean {
  return viewportWidth > 720;
}

export function workspacePanelKeyboardMove(key: string): -1 | 1 | null {
  if (key === 'ArrowLeft') return -1;
  if (key === 'ArrowRight') return 1;
  return null;
}

export function workspacePanelDragHasStarted(wasStarted: boolean, deltaX: number, deltaY: number): boolean {
  return wasStarted || Math.hypot(deltaX, deltaY) >= 4;
}

export function workspacePanelAutoScrollDirection(
  pointerX: number,
  workspaceLeft: number,
  workspaceRight: number,
  edgeSize = 48,
): -1 | 0 | 1 {
  if (pointerX < workspaceLeft + edgeSize) return -1;
  if (pointerX > workspaceRight - edgeSize) return 1;
  return 0;
}

export function findWorkspacePanelDropTarget(
  sourceId: WorkspacePanelId,
  pointerX: number,
  panels: WorkspacePanelInlineRect[],
): WorkspacePanelDropTarget | null {
  const candidates = panels.filter((panel) => panel.id !== sourceId);
  if (candidates.length === 0) return null;
  const target = candidates.find((panel) => pointerX < panel.left + panel.width / 2);
  if (target) return { targetId: target.id, position: 'before' };
  return { targetId: candidates[candidates.length - 1].id, position: 'after' };
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function isWorkspacePanelId(value: unknown): value is WorkspacePanelId {
  return typeof value === 'string' && WORKSPACE_PANEL_IDS.includes(value as WorkspacePanelId);
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function hydrateWorkspaceLayout(value: unknown): WorkspaceLayout {
  const candidate = value && typeof value === 'object' ? value as Partial<WorkspaceLayout> : {};
  const migrateLegacyDefaults = candidate.version !== 2;
  const savedOrder = Array.isArray(candidate.order) ? candidate.order : [];
  const order = [
    ...savedOrder.filter(isWorkspacePanelId).filter((id, index, entries) => entries.indexOf(id) === index),
    ...WORKSPACE_PANEL_IDS.filter((id) => !savedOrder.includes(id)),
  ];
  const savedSizes = candidate.sizes && typeof candidate.sizes === 'object' ? candidate.sizes : {};
  const sizes = Object.fromEntries(WORKSPACE_PANEL_IDS.map((id) => {
    const defaultSize = DEFAULT_WORKSPACE_LAYOUT.sizes[id];
    const savedSize = (savedSizes as Partial<Record<WorkspacePanelId, Partial<WorkspacePanelSize>>>)[id];
    const savedWidth = finiteNumber(savedSize?.widthPx, defaultSize.widthPx);
    return [id, {
      widthPx: clamp(
        migrateLegacyDefaults && savedWidth === LEGACY_DEFAULT_PANEL_WIDTHS[id] ? defaultSize.widthPx : savedWidth,
        WORKSPACE_PANEL_MIN_WIDTH,
        900,
      ),
      heightPx: clamp(finiteNumber(savedSize?.heightPx, defaultSize.heightPx), 320, 1200),
    }];
  })) as Record<WorkspacePanelId, WorkspacePanelSize>;

  return { version: 2, order, sizes };
}

export function reorderWorkspacePanels(
  layout: WorkspaceLayout,
  sourceId: WorkspacePanelId,
  targetId: WorkspacePanelId,
): WorkspaceLayout {
  if (sourceId === targetId) return { ...layout, order: [...layout.order] };
  const sourceIndex = layout.order.indexOf(sourceId);
  const targetIndex = layout.order.indexOf(targetId);
  if (sourceIndex < 0 || targetIndex < 0) return { ...layout, order: [...layout.order] };
  const order = [...layout.order];
  order.splice(sourceIndex, 1);
  order.splice(sourceIndex < targetIndex ? targetIndex - 1 : targetIndex, 0, sourceId);
  return { ...layout, order };
}

export function placeWorkspacePanel(
  layout: WorkspaceLayout,
  sourceId: WorkspacePanelId,
  targetId: WorkspacePanelId,
  position: 'before' | 'after',
): WorkspaceLayout {
  if (sourceId === targetId) return { ...layout, order: [...layout.order] };
  const order = layout.order.filter((id) => id !== sourceId);
  const targetIndex = order.indexOf(targetId);
  if (targetIndex < 0 || !layout.order.includes(sourceId)) return { ...layout, order: [...layout.order] };
  order.splice(targetIndex + (position === 'after' ? 1 : 0), 0, sourceId);
  return { ...layout, order };
}

export function moveWorkspacePanel(
  layout: WorkspaceLayout,
  id: WorkspacePanelId,
  delta: -1 | 1,
): WorkspaceLayout {
  const sourceIndex = layout.order.indexOf(id);
  const targetIndex = sourceIndex + delta;
  if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= layout.order.length) {
    return { ...layout, order: [...layout.order] };
  }
  const order = [...layout.order];
  [order[sourceIndex], order[targetIndex]] = [order[targetIndex], order[sourceIndex]];
  return { ...layout, order };
}

export function resizeWorkspacePanel(
  layout: WorkspaceLayout,
  id: WorkspacePanelId,
  patch: Partial<WorkspacePanelSize>,
): WorkspaceLayout {
  const current = layout.sizes[id];
  return {
    ...layout,
    sizes: {
      ...layout.sizes,
      [id]: {
        widthPx: clamp(patch.widthPx ?? current.widthPx, WORKSPACE_PANEL_MIN_WIDTH, 900),
        heightPx: clamp(patch.heightPx ?? current.heightPx, 320, 1200),
      },
    },
  };
}
