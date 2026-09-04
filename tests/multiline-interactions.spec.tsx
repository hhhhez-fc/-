// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import App from '../src/App';
import { createInitialDraft } from '../src/domain/draft';
import { createLabel } from '../src/domain/labels';

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

afterEach(cleanup);

const stateWithLabel = (content: string) => {
  const label = createLabel({ content, quantity: 1, source: 'manual', needsReview: false });
  return { ...createInitialDraft(), labels: [label], activeLabelId: label.id };
};

describe('多行文字交互', () => {
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
