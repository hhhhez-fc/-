// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import App from '../src/App';
import { createInitialDraft } from '../src/domain/draft';
import { createLabel } from '../src/domain/labels';
import { DRAFT_STORAGE_KEY } from '../src/domain/storage';

beforeAll(() => {
  Object.defineProperties(HTMLElement.prototype, {
    hasPointerCapture: { configurable: true, value: () => false },
    setPointerCapture: { configurable: true, value: () => undefined },
    releasePointerCapture: { configurable: true, value: () => undefined },
  });
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: class ResizeObserver {
      observe() {}
      disconnect() {}
    },
  });
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const stateWithLabel = (content: string) => {
  const label = createLabel({ content, quantity: 1, source: 'manual', needsReview: false });
  return { ...createInitialDraft(), labels: [label], activeLabelId: label.id };
};

describe('多行文字交互', () => {
  it('textarea 内移动光标或选中文字只切换活动行，不进入累加选择', async () => {
    const user = userEvent.setup();
    render(<App initialState={stateWithLabel('AB\nC')} />);

    const editor = screen.getByPlaceholderText(/FY-01/) as HTMLTextAreaElement;
    await user.click(editor);
    editor.setSelectionRange(0, 1);
    fireEvent.select(editor);
    fireEvent.keyUp(editor, { key: 'ArrowRight' });

    expect(screen.queryByText('已选 1 行')).toBeNull();
    expect(screen.getByRole('button', { name: /拖动第 1 行/ }).getAttribute('aria-pressed')).toBe('false');
  });

  it('只激活一行的字符选区样式保留为局部范围，而不是整行样式', async () => {
    render(<App initialState={stateWithLabel('AB\nC')} />);

    const editor = screen.getByPlaceholderText(/FY-01/) as HTMLTextAreaElement;
    editor.setSelectionRange(0, 1);
    fireEvent.select(editor);
    fireEvent.click(screen.getByRole('button', { name: '粗体' }));

    expect(screen.getByText('已应用 1 段局部样式；修改正文后会自动清除。')).toBeTruthy();
    expect(screen.getByText('A').style.fontWeight).toBe('400');
    expect(screen.getByRole('button', { name: /拖动第 1 行/ }).style.fontWeight).toBe('');
    await waitFor(() => {
      const saved = JSON.parse(window.localStorage.getItem(DRAFT_STORAGE_KEY) ?? '{}');
      expect(saved.labels?.[0]?.textStyleRanges).toEqual([
        {
          start: 0,
          end: 1,
          style: {
            fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
            fontSizePt: 26,
            fontWeight: 400,
          },
        },
      ]);
    });
  });

  it('连续单击累加文字行，单击打印区域空白清空', async () => {
    const user = userEvent.setup();
    render(<App initialState={stateWithLabel('A\nB\nC')} />);

    await user.click(screen.getByRole('button', { name: /拖动第 1 行/ }));
    await user.click(screen.getByRole('button', { name: /拖动第 2 行/ }));

    expect(screen.getByText('已选 2 行')).toBeTruthy();

    await user.click(screen.getByRole('group', { name: /拖动内容打印区域/ }));

    expect(screen.queryByText('已选 2 行')).toBeNull();
  });

  it('修改方向和方向键移动会作用到全部已选行', async () => {
    const user = userEvent.setup();
    render(<App initialState={stateWithLabel('A\nB')} />);

    await user.click(screen.getByRole('button', { name: /拖动第 1 行/ }));
    await user.click(screen.getByRole('button', { name: /拖动第 2 行/ }));
    await user.selectOptions(screen.getByRole('combobox', { name: '所选行方向' }), 'vertical');
    await user.keyboard('{ArrowRight}');

    expect(screen.getAllByText(/竖排/).length).toBeGreaterThan(0);
  });
});
