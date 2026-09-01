// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import FontSizePicker from '../src/features/FontSizePicker';

beforeAll(() => {
  Object.defineProperties(HTMLElement.prototype, {
    hasPointerCapture: { configurable: true, value: () => false },
    setPointerCapture: { configurable: true, value: () => undefined },
    releasePointerCapture: { configurable: true, value: () => undefined },
    scrollIntoView: { configurable: true, value: () => undefined },
  });
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
});

afterEach(cleanup);

describe('字号预览选择器', () => {
  it('用方向键预览字号，按 Escape 取消且不提交', async () => {
    const user = userEvent.setup();
    const onPreview = vi.fn();
    const onCommit = vi.fn();
    render(
      <FontSizePicker
        value={{ fontMode: 'fixed', fontSizePt: 26 }}
        onPreview={onPreview}
        onCommit={onCommit}
      />,
    );

    const trigger = screen.getByRole('combobox', { name: '全部字号' });
    await user.click(trigger);
    await user.keyboard('{ArrowDown}');

    expect(onPreview).toHaveBeenLastCalledWith({ fontMode: 'fixed', fontSizePt: 28 });
    await user.keyboard('{Escape}');
    expect(onPreview).toHaveBeenLastCalledWith(null);
    expect(onCommit).not.toHaveBeenCalled();
    expect(trigger.textContent).toContain('26 pt');
  });

  it('悬停时预览可感知的字号名称，点击后提交并清除临时预览', async () => {
    const user = userEvent.setup();
    const onPreview = vi.fn();
    const onCommit = vi.fn();
    render(
      <FontSizePicker
        value={{ fontMode: 'fixed', fontSizePt: 26 }}
        onPreview={onPreview}
        onCommit={onCommit}
      />,
    );

    await user.click(screen.getByRole('combobox', { name: '全部字号' }));
    const option = screen.getByRole('option', { name: '64 pt' });
    await user.hover(option);
    expect(onPreview).toHaveBeenLastCalledWith({ fontMode: 'fixed', fontSizePt: 64 });

    await user.click(option);
    expect(onCommit).toHaveBeenCalledWith({ fontMode: 'fixed', fontSizePt: 64 });
    expect(onPreview).toHaveBeenLastCalledWith(null);
  });

  it('按 Enter 提交键盘当前预览的字号', async () => {
    const user = userEvent.setup();
    const onPreview = vi.fn();
    const onCommit = vi.fn();
    render(
      <FontSizePicker
        value={{ fontMode: 'fixed', fontSizePt: 26 }}
        onPreview={onPreview}
        onCommit={onCommit}
      />,
    );

    await user.click(screen.getByRole('combobox', { name: '全部字号' }));
    await user.keyboard('{ArrowDown}{Enter}');

    expect(onCommit).toHaveBeenCalledWith({ fontMode: 'fixed', fontSizePt: 28 });
    expect(onPreview).toHaveBeenLastCalledWith(null);
  });
});
