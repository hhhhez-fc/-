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
  it('可直接输入 8 到 300 pt 的任意字号并立即提交合法值', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(
      <FontSizePicker
        value={{ fontMode: 'fixed', fontSizePt: 26 }}
        onPreview={() => undefined}
        onCommit={onCommit}
      />,
    );

    const input = screen.getByRole('spinbutton', { name: '全部字号' });
    expect(input.getAttribute('min')).toBe('8');
    expect(input.getAttribute('max')).toBe('300');
    await user.clear(input);
    await user.type(input, '275');

    expect((input as HTMLInputElement).value).toBe('275');
    expect(onCommit).toHaveBeenLastCalledWith({ fontMode: 'fixed', fontSizePt: 275 });
  });

  it('失焦时把越界输入规范到新的最大字号 300 pt', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(
      <FontSizePicker
        value={{ fontMode: 'fixed', fontSizePt: 26 }}
        onPreview={() => undefined}
        onCommit={onCommit}
      />,
    );

    const input = screen.getByRole('spinbutton', { name: '全部字号' });
    await user.clear(input);
    await user.type(input, '999');
    await user.tab();

    expect((input as HTMLInputElement).value).toBe('300');
    expect(onCommit).toHaveBeenLastCalledWith({ fontMode: 'fixed', fontSizePt: 300 });
  });

  it('按 Escape 放弃未完成的越界输入，不把它提交为边界值', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(
      <FontSizePicker
        value={{ fontMode: 'fixed', fontSizePt: 26 }}
        onPreview={() => undefined}
        onCommit={onCommit}
      />,
    );

    const input = screen.getByRole('spinbutton', { name: '全部字号' });
    await user.clear(input);
    await user.type(input, '999');
    await user.keyboard('{Escape}');

    expect((input as HTMLInputElement).value).toBe('26');
    expect(onCommit).toHaveBeenLastCalledWith({ fontMode: 'fixed', fontSizePt: 99 });
  });

  it('常用字号菜单包含扩展的大字号选项', async () => {
    const user = userEvent.setup();
    render(
      <FontSizePicker
        value={{ fontMode: 'fixed', fontSizePt: 26 }}
        onPreview={() => undefined}
        onCommit={() => undefined}
      />,
    );

    await user.click(screen.getByRole('combobox', { name: '选择常用字号' }));
    expect(screen.getByRole('option', { name: '144 pt' })).toBeTruthy();
    expect(screen.getByRole('option', { name: '180 pt' })).toBeTruthy();
    expect(screen.getByRole('option', { name: '240 pt' })).toBeTruthy();
    expect(screen.getByRole('option', { name: '300 pt' })).toBeTruthy();
  });

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

    const trigger = screen.getByRole('combobox', { name: '选择常用字号' });
    await user.click(trigger);
    await user.keyboard('{ArrowDown}');

    expect(onPreview).toHaveBeenLastCalledWith({ fontMode: 'fixed', fontSizePt: 28 });
    await user.keyboard('{Escape}');
    expect(onPreview).toHaveBeenLastCalledWith(null);
    expect(onCommit).not.toHaveBeenCalled();
    expect((screen.getByRole('spinbutton', { name: '全部字号' }) as HTMLInputElement).value).toBe('26');
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

    await user.click(screen.getByRole('combobox', { name: '选择常用字号' }));
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

    await user.click(screen.getByRole('combobox', { name: '选择常用字号' }));
    await user.keyboard('{ArrowDown}{Enter}');

    expect(onCommit).toHaveBeenCalledWith({ fontMode: 'fixed', fontSizePt: 28 });
    expect(onPreview).toHaveBeenLastCalledWith(null);
  });
});
