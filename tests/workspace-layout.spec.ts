import { expect, it } from 'vitest';
import {
  DEFAULT_WORKSPACE_LAYOUT,
  hydrateWorkspaceLayout,
  moveWorkspacePanel,
  placeWorkspacePanel,
  reorderWorkspacePanels,
  resizeWorkspacePanel,
} from '../src/domain/workspaceLayout';

it('repairs duplicate, missing, and unknown panel ids', () => {
  expect(hydrateWorkspaceLayout({ order: ['preview', 'preview', 'unknown'] })).toEqual({
    ...DEFAULT_WORKSPACE_LAYOUT,
    order: ['preview', 'intake', 'records', 'history'],
  });
});

it('reorders by the target position and clamps saved sizes', () => {
  const reordered = reorderWorkspacePanels(DEFAULT_WORKSPACE_LAYOUT, 'history', 'preview');
  expect(reordered.order).toEqual(['intake', 'history', 'preview', 'records']);
  expect(resizeWorkspacePanel(reordered, 'history', { widthPx: 2000, heightPx: 100 }))
    .toMatchObject({ sizes: { history: { widthPx: 900, heightPx: 320 } } });
  expect(resizeWorkspacePanel(reordered, 'history', { zoom: 9 }))
    .toMatchObject({ sizes: { history: { zoom: 1.25 } } });
});

it('places a preceding panel at its target position', () => {
  expect(reorderWorkspacePanels(DEFAULT_WORKSPACE_LAYOUT, 'preview', 'history').order)
    .toEqual(['intake', 'records', 'preview', 'history']);
});

it('can drop a panel before or after a target including the terminal position', () => {
  expect(placeWorkspacePanel(DEFAULT_WORKSPACE_LAYOUT, 'intake', 'history', 'before').order)
    .toEqual(['preview', 'records', 'intake', 'history']);
  expect(placeWorkspacePanel(DEFAULT_WORKSPACE_LAYOUT, 'intake', 'history', 'after').order)
    .toEqual(['preview', 'records', 'history', 'intake']);
});

it('moves a panel one position with a keyboard-safe command', () => {
  expect(moveWorkspacePanel(DEFAULT_WORKSPACE_LAYOUT, 'preview', 1).order)
    .toEqual(['intake', 'records', 'preview', 'history']);
  expect(moveWorkspacePanel(DEFAULT_WORKSPACE_LAYOUT, 'intake', -1).order)
    .toEqual(DEFAULT_WORKSPACE_LAYOUT.order);
});
