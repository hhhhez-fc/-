import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import {
  canPointerReorderWorkspacePanels,
  DEFAULT_WORKSPACE_LAYOUT,
  findWorkspacePanelDropTarget,
  hydrateWorkspaceLayout,
  moveWorkspacePanel,
  placeWorkspacePanel,
  reorderWorkspacePanels,
  resizeWorkspacePanel,
  workspacePanelAutoScrollDirection,
  workspacePanelDragHasStarted,
  workspacePanelKeyboardMove,
} from '../src/domain/workspaceLayout';

it('limits pointer reordering at the single-column breakpoint while keeping a keyboard alternative', () => {
  expect(canPointerReorderWorkspacePanels(720)).toBe(false);
  expect(canPointerReorderWorkspacePanels(721)).toBe(true);
  expect(workspacePanelKeyboardMove('ArrowLeft')).toBe(-1);
  expect(workspacePanelKeyboardMove('ArrowRight')).toBe(1);
  expect(workspacePanelKeyboardMove('Enter')).toBeNull();
});

it('keeps the three desktop panels on one horizontal row and preserves mobile stacking', () => {
  const workspaceStyles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

  expect(workspaceStyles).toMatch(/\.workspace\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*nowrap;[^}]*overflow-x:\s*auto;/s);
  expect(workspaceStyles).toMatch(/\.workspace-panel\s*\{[^}]*inline-size:\s*var\(--panel-width\);[^}]*max-inline-size:\s*100%;/s);
  expect(workspaceStyles).toMatch(/\.workspace-panel\s*\{[^}]*flex:\s*0\s+0\s+var\(--panel-width\);/s);
  expect(workspaceStyles).toMatch(/@media\s*\(max-width:\s*720px\)[\s\S]*?\.workspace\s*\{[^}]*flex-direction:\s*column;[^}]*overflow-x:\s*visible;/s);
  expect(workspaceStyles).toMatch(/@media\s*\(max-width:\s*720px\)[\s\S]*?\.panel-drag-handle\s*\{[^}]*touch-action:\s*pan-y;/s);
  expect(workspaceStyles).not.toContain('inline-size: min(100%, var(--panel-width))');
});

it('fits the default three-panel row inside the 1294px annotated workspace', () => {
  const occupiedWidth = Object.values(DEFAULT_WORKSPACE_LAYOUT.sizes)
    .reduce((total, size) => total + size.widthPx, 0) + 32;

  expect(occupiedWidth).toBeLessThanOrEqual(1246);
});

it('chooses the nearest horizontal insertion slot even when the pointer is over a gap', () => {
  const panels = [
    { id: 'intake' as const, left: 24, width: 300 },
    { id: 'preview' as const, left: 340, width: 540 },
    { id: 'records' as const, left: 896, width: 340 },
  ];

  expect(findWorkspacePanelDropTarget('intake', 888, panels)).toEqual({ targetId: 'records', position: 'before' });
  expect(findWorkspacePanelDropTarget('records', 500, panels)).toEqual({ targetId: 'preview', position: 'before' });
  expect(findWorkspacePanelDropTarget('intake', 1240, panels)).toEqual({ targetId: 'records', position: 'after' });
});

it('keeps an active panel drag alive when the pointer returns near its origin', () => {
  expect(workspacePanelDragHasStarted(false, 2, 2)).toBe(false);
  expect(workspacePanelDragHasStarted(false, 5, 0)).toBe(true);
  expect(workspacePanelDragHasStarted(true, 0, 0)).toBe(true);
});

it('requests horizontal auto-scroll only inside the workspace edge zones', () => {
  expect(workspacePanelAutoScrollDirection(30, 24, 1236)).toBe(-1);
  expect(workspacePanelAutoScrollDirection(600, 24, 1236)).toBe(0);
  expect(workspacePanelAutoScrollDirection(1220, 24, 1236)).toBe(1);
});

it('repairs duplicate, missing, and unknown panel ids', () => {
  expect(hydrateWorkspaceLayout({ order: ['history', 'preview', 'preview', 'unknown'] })).toEqual({
    ...DEFAULT_WORKSPACE_LAYOUT,
    order: ['preview', 'intake', 'records'],
  });
});

it('migrates untouched legacy default widths so existing users receive the single-row layout', () => {
  const hydrated = hydrateWorkspaceLayout({
    order: ['preview', 'intake', 'records'],
    sizes: {
      intake: { widthPx: 360, heightPx: 640 },
      preview: { widthPx: 640, heightPx: 760 },
      records: { widthPx: 420, heightPx: 640 },
    },
  });

  expect(hydrated.order).toEqual(['preview', 'intake', 'records']);
  expect(hydrated.sizes).toEqual({
    intake: { widthPx: 300, heightPx: 640 },
    preview: { widthPx: 540, heightPx: 760 },
    records: { widthPx: 340, heightPx: 640 },
  });
});

it('reorders by the target position and clamps saved sizes', () => {
  const reordered = reorderWorkspacePanels(DEFAULT_WORKSPACE_LAYOUT, 'records', 'preview');
  expect(reordered.order).toEqual(['intake', 'records', 'preview']);
  expect(resizeWorkspacePanel(reordered, 'records', { widthPx: 2000, heightPx: 100 }))
    .toMatchObject({ sizes: { records: { widthPx: 900, heightPx: 320 } } });
});

it('allows a panel to shrink to 180px without collapsing below the usable minimum', () => {
  expect(resizeWorkspacePanel(DEFAULT_WORKSPACE_LAYOUT, 'preview', { widthPx: 100 }))
    .toMatchObject({ sizes: { preview: { widthPx: 180 } } });
  expect(resizeWorkspacePanel(DEFAULT_WORKSPACE_LAYOUT, 'preview', { widthPx: 184 }))
    .toMatchObject({ sizes: { preview: { widthPx: 184 } } });
});

it('places a preceding panel at its target position', () => {
  expect(reorderWorkspacePanels(DEFAULT_WORKSPACE_LAYOUT, 'intake', 'records').order)
    .toEqual(['preview', 'intake', 'records']);
});

it('can drop a panel before or after a target including the terminal position', () => {
  expect(placeWorkspacePanel(DEFAULT_WORKSPACE_LAYOUT, 'intake', 'records', 'before').order)
    .toEqual(['preview', 'intake', 'records']);
  expect(placeWorkspacePanel(DEFAULT_WORKSPACE_LAYOUT, 'intake', 'records', 'after').order)
    .toEqual(['preview', 'records', 'intake']);
});

it('moves a panel one position with a keyboard-safe command', () => {
  expect(moveWorkspacePanel(DEFAULT_WORKSPACE_LAYOUT, 'preview', 1).order)
    .toEqual(['intake', 'records', 'preview']);
  expect(moveWorkspacePanel(DEFAULT_WORKSPACE_LAYOUT, 'intake', -1).order)
    .toEqual(DEFAULT_WORKSPACE_LAYOUT.order);
});
