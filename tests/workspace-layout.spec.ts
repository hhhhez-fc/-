import { expect, it } from 'vitest';
import {
  DEFAULT_WORKSPACE_LAYOUT,
  hydrateWorkspaceLayout,
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
});

it('places a preceding panel at its target position', () => {
  expect(reorderWorkspacePanels(DEFAULT_WORKSPACE_LAYOUT, 'preview', 'history').order)
    .toEqual(['intake', 'records', 'preview', 'history']);
});
