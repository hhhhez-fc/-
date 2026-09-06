// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import {
  isTextEditingTarget,
  resolveWorkspaceShortcut,
  type ShortcutInput,
} from '../src/domain/shortcutKeys';

const base: ShortcutInput = {
  key: '',
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  textEditing: false,
  isComposing: false,
  modalOpen: false,
};

afterEach(() => {
  document.body.replaceChildren();
});

describe('workspace shortcut resolver', () => {
  it.each([
    [{ key: 'c', ctrlKey: true }, 'copy'],
    [{ key: 'C', metaKey: true }, 'copy'],
    [{ key: 'x', ctrlKey: true }, 'cut'],
    [{ key: 'v', metaKey: true }, 'paste'],
    [{ key: 'z', ctrlKey: true }, 'undo'],
    [{ key: 'z', metaKey: true, shiftKey: true }, 'redo'],
    [{ key: 'y', ctrlKey: true }, 'redo'],
    [{ key: 'f', metaKey: true }, 'find'],
    [{ key: 'F1' }, 'help'],
    [{ key: 'Escape' }, 'escape'],
  ] as const)('maps %o to %s', (patch, expected) => {
    expect(resolveWorkspaceShortcut({ ...base, ...patch })).toBe(expected);
  });

  it.each([
    { key: 'c', ctrlKey: true, altKey: true },
    { key: 'c', ctrlKey: true, metaKey: true },
    { key: 'c', ctrlKey: true, shiftKey: true },
    { key: 'c', ctrlKey: true, textEditing: true },
    { key: 'v', ctrlKey: true, isComposing: true },
    { key: 'z', ctrlKey: true, modalOpen: true },
    { key: 'F1', shiftKey: true },
    { key: 'Escape', ctrlKey: true },
  ])('blocks unsupported or unsafe input %o', (patch) => {
    expect(resolveWorkspaceShortcut({ ...base, ...patch })).toBeNull();
  });
});

describe('text editing target detection', () => {
  it.each(['input', 'textarea', 'select'])('recognizes a nested target inside %s', (tagName) => {
    const editor = document.createElement(tagName);
    const child = document.createElement('span');
    editor.append(child);
    document.body.append(editor);

    expect(isTextEditingTarget(child)).toBe(true);
  });

  it.each(['', 'true', 'plaintext-only'])('recognizes contenteditable="%s" ancestors', (value) => {
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', value);
    const child = document.createElement('span');
    editor.append(child);
    document.body.append(editor);

    expect(isTextEditingTarget(child)).toBe(true);
  });

  it('does not classify ordinary content as a text editor', () => {
    const content = document.createElement('div');
    const child = document.createElement('span');
    content.append(child);
    document.body.append(content);

    expect(isTextEditingTarget(child)).toBe(false);
    expect(isTextEditingTarget(null)).toBe(false);
  });
});
