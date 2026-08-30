export const WORKSPACE_PANEL_IDS = ['intake', 'preview', 'records', 'history'] as const;

export type WorkspacePanelId = typeof WORKSPACE_PANEL_IDS[number];

export interface WorkspacePanelSize {
  widthPx: number;
  heightPx: number;
  zoom: number;
}

export interface WorkspaceLayout {
  order: WorkspacePanelId[];
  sizes: Record<WorkspacePanelId, WorkspacePanelSize>;
}

export const DEFAULT_WORKSPACE_LAYOUT: WorkspaceLayout = {
  order: ['intake', 'preview', 'records', 'history'],
  sizes: {
    intake: { widthPx: 360, heightPx: 640, zoom: 1 },
    preview: { widthPx: 640, heightPx: 760, zoom: 1 },
    records: { widthPx: 420, heightPx: 640, zoom: 1 },
    history: { widthPx: 420, heightPx: 640, zoom: 1 },
  },
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function isWorkspacePanelId(value: unknown): value is WorkspacePanelId {
  return typeof value === 'string' && WORKSPACE_PANEL_IDS.includes(value as WorkspacePanelId);
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function hydrateWorkspaceLayout(value: unknown): WorkspaceLayout {
  const candidate = value && typeof value === 'object' ? value as Partial<WorkspaceLayout> : {};
  const savedOrder = Array.isArray(candidate.order) ? candidate.order : [];
  const order = [
    ...savedOrder.filter(isWorkspacePanelId).filter((id, index, entries) => entries.indexOf(id) === index),
    ...WORKSPACE_PANEL_IDS.filter((id) => !savedOrder.includes(id)),
  ];
  const savedSizes = candidate.sizes && typeof candidate.sizes === 'object' ? candidate.sizes : {};
  const sizes = Object.fromEntries(WORKSPACE_PANEL_IDS.map((id) => {
    const defaultSize = DEFAULT_WORKSPACE_LAYOUT.sizes[id];
    const savedSize = (savedSizes as Partial<Record<WorkspacePanelId, Partial<WorkspacePanelSize>>>)[id];
    return [id, {
      widthPx: clamp(finiteNumber(savedSize?.widthPx, defaultSize.widthPx), 220, 900),
      heightPx: clamp(finiteNumber(savedSize?.heightPx, defaultSize.heightPx), 320, 1200),
      zoom: Math.round(clamp(finiteNumber(savedSize?.zoom, defaultSize.zoom), .75, 1.25) * 100) / 100,
    }];
  })) as Record<WorkspacePanelId, WorkspacePanelSize>;

  return { order, sizes };
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
        widthPx: clamp(patch.widthPx ?? current.widthPx, 220, 900),
        heightPx: clamp(patch.heightPx ?? current.heightPx, 320, 1200),
        zoom: Math.round(clamp(patch.zoom ?? current.zoom, .75, 1.25) * 100) / 100,
      },
    },
  };
}
