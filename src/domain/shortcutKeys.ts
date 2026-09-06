export type WorkspaceShortcut =
  | 'copy'
  | 'cut'
  | 'paste'
  | 'undo'
  | 'redo'
  | 'find'
  | 'help'
  | 'escape';

export interface ShortcutInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  textEditing: boolean;
  isComposing: boolean;
  modalOpen: boolean;
}

export function resolveWorkspaceShortcut(input: ShortcutInput): WorkspaceShortcut | null {
  if (input.altKey || input.textEditing || input.isComposing || input.modalOpen) return null;

  const key = input.key.toLowerCase();
  const commandModifierCount = Number(input.ctrlKey) + Number(input.metaKey);

  if (commandModifierCount === 0) {
    if (input.shiftKey) return null;
    if (key === 'f1') return 'help';
    if (key === 'escape') return 'escape';
    return null;
  }

  if (commandModifierCount !== 1) return null;

  if (input.shiftKey) return key === 'z' ? 'redo' : null;

  if (key === 'c') return 'copy';
  if (key === 'x') return 'cut';
  if (key === 'v') return 'paste';
  if (key === 'z') return 'undo';
  if (key === 'y' && input.ctrlKey) return 'redo';
  if (key === 'f') return 'find';
  return null;
}

export function isTextEditingTarget(element: Element | null): boolean {
  return Boolean(element?.closest(
    'input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]',
  ));
}
