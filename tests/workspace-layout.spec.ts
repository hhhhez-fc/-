import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import {
  canPointerReorderWorkspacePanels,
  DEFAULT_WORKSPACE_LAYOUT,
  hydrateWorkspaceLayout,
  moveWorkspacePanel,
  placeWorkspacePanel,
  reorderWorkspacePanels,
  resizeWorkspacePanel,
  workspacePanelKeyboardMove,
} from '../src/domain/workspaceLayout';

it('limits pointer reordering at the single-column breakpoint while keeping a keyboard alternative', () => {
  expect(canPointerReorderWorkspacePanels(720)).toBe(false);
  expect(canPointerReorderWorkspacePanels(721)).toBe(true);
  expect(workspacePanelKeyboardMove('ArrowLeft')).toBe(-1);
  expect(workspacePanelKeyboardMove('ArrowRight')).toBe(1);
  expect(workspacePanelKeyboardMove('Enter')).toBeNull();
});

it('lets each saved panel width size its wrapping workspace slot', () => {
  const workspaceStyles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

  expect(workspaceStyles).toMatch(/\.workspace\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;/s);
  expect(workspaceStyles).toMatch(/\.workspace-panel\s*\{[^}]*inline-size:\s*var\(--panel-width\);[^}]*max-inline-size:\s*100%;/s);
  expect(workspaceStyles).toMatch(/\.workspace-panel\s*\{[^}]*flex:\s*0\s+0\s+var\(--panel-width\);/s);
  expect(workspaceStyles).toMatch(/@media\s*\(max-width:\s*720px\)[\s\S]*?\.panel-drag-handle\s*\{[^}]*touch-action:\s*pan-y;/s);
  expect(workspaceStyles).not.toContain('inline-size: min(100%, var(--panel-width))');
});

it('repairs duplicate, missing, and unknown panel ids', () => {
  expect(hydrateWorkspaceLayout({ order: ['history', 'preview', 'preview', 'unknown'] })).toEqual({
    ...DEFAULT_WORKSPACE_LAYOUT,
    order: ['preview', 'intake', 'records'],
  });
});

it('reorders by the target position and clamps saved sizes', () => {
  const reordered = reorderWorkspacePanels(DEFAULT_WORKSPACE_LAYOUT, 'records', 'preview');
  expect(reordered.order).toEqual(['intake', 'records', 'preview']);
  expect(resizeWorkspacePanel(reordered, 'records', { widthPx: 2000, heightPx: 100 }))
    .toMatchObject({ sizes: { records: { widthPx: 900, heightPx: 320 } } });
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
