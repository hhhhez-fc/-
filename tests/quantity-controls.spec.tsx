// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createLabel } from '../src/domain/labels';
import LabelList from '../src/features/LabelList';

beforeAll(() => {
  Object.defineProperties(HTMLElement.prototype, {
    hasPointerCapture: { configurable: true, value: () => false },
    setPointerCapture: { configurable: true, value: () => undefined },
    releasePointerCapture: { configurable: true, value: () => undefined },
  });
});

afterEach(cleanup);

describe('列表打印数量控件', () => {
  it('列表内加减和直接输入打印数量，不触发行切换', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    const onActivate = vi.fn();
    const label = createLabel({ content: 'FY-01', quantity: 2, source: 'manual', needsReview: false });
    render(<LabelList
      labels={[label]}
      activeLabelId={label.id}
      selectedLabelIds={[]}
      onActivate={onActivate}
      onToggleSelect={() => undefined}
      onQuantityChange={onCommit}
      onDuplicate={() => undefined}
      onDelete={() => undefined}
    />);

    await user.click(screen.getByRole('button', { name: '增加第 1 条唛头的打印数量' }));
    expect(onCommit).toHaveBeenLastCalledWith(label.id, 3);
    expect(onActivate).not.toHaveBeenCalled();
    const input = screen.getByRole('spinbutton', { name: '第 1 条唛头的打印数量' });
    await user.clear(input);
    await user.type(input, '7{Enter}');
    expect(onCommit).toHaveBeenLastCalledWith(label.id, 7);
  });

  it('在最小值和最大值禁用对应按钮，并把越界输入钳制到合法范围', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    const minimum = createLabel({ content: 'MIN', quantity: 1, source: 'manual', needsReview: false });
    const props = {
      activeLabelId: minimum.id,
      selectedLabelIds: [] as string[],
      onActivate: () => undefined,
      onToggleSelect: () => undefined,
      onQuantityChange: onCommit,
      onDuplicate: () => undefined,
      onDelete: () => undefined,
    };
    const { rerender } = render(<LabelList labels={[minimum]} {...props} />);

    expect((screen.getByRole('button', { name: '减少第 1 条唛头的打印数量' }) as HTMLButtonElement).disabled).toBe(true);
    const input = screen.getByRole('spinbutton', { name: '第 1 条唛头的打印数量' });
    await user.clear(input);
    await user.type(input, '0{Enter}');
    expect(input.getAttribute('aria-invalid')).toBe('false');
    expect(screen.getByText('打印数量超出范围，已调整为 1。').id).toBe(input.getAttribute('aria-describedby'));
    expect(onCommit).toHaveBeenLastCalledWith(minimum.id, 1);
    await user.clear(input);
    await user.type(input, '1001');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('打印数量必须在 1 至 1000 之间。').id).toBe(input.getAttribute('aria-describedby'));
    await user.keyboard('{Enter}');
    expect(input.getAttribute('aria-invalid')).toBe('false');
    expect(screen.getByText('打印数量超出范围，已调整为 1000。').id).toBe(input.getAttribute('aria-describedby'));
    expect(onCommit).toHaveBeenLastCalledWith(minimum.id, 1000);

    const maximum = { ...minimum, quantity: 1000 };
    rerender(<LabelList labels={[maximum]} {...props} />);
    expect((screen.getByRole('button', { name: '增加第 1 条唛头的打印数量' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('空白输入失焦时归一为最小打印数量', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    const label = createLabel({ content: 'BLANK', quantity: 6, source: 'manual', needsReview: false });
    render(<LabelList
      labels={[label]}
      activeLabelId={label.id}
      selectedLabelIds={[]}
      onActivate={() => undefined}
      onToggleSelect={() => undefined}
      onQuantityChange={onCommit}
      onDuplicate={() => undefined}
      onDelete={() => undefined}
    />);

    const input = screen.getByRole('spinbutton', { name: '第 1 条唛头的打印数量' });
    await user.clear(input);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('请输入 1 至 1000 的整数。').id).toBe(input.getAttribute('aria-describedby'));
    await user.tab();

    expect((input as HTMLInputElement).value).toBe('1');
    expect(input.getAttribute('aria-invalid')).toBe('false');
    expect(screen.getByText('打印数量为空，已调整为 1。').id).toBe(input.getAttribute('aria-describedby'));
    expect(onCommit).toHaveBeenLastCalledWith(label.id, 1);
  });

  it('非整数输入显示关联错误并在失焦时恢复当前打印数量', () => {
    const onCommit = vi.fn();
    const label = createLabel({ content: 'DECIMAL', quantity: 6, source: 'manual', needsReview: false });
    render(<LabelList
      labels={[label]}
      activeLabelId={label.id}
      selectedLabelIds={[]}
      onActivate={() => undefined}
      onToggleSelect={() => undefined}
      onQuantityChange={onCommit}
      onDuplicate={() => undefined}
      onDelete={() => undefined}
    />);

    const input = screen.getByRole('spinbutton', { name: '第 1 条唛头的打印数量' });
    fireEvent.change(input, { target: { value: '1.5' } });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('请输入 1 至 1000 的整数。').id).toBe(input.getAttribute('aria-describedby'));
    fireEvent.blur(input);

    expect((input as HTMLInputElement).value).toBe('6');
    expect(input.getAttribute('aria-invalid')).toBe('false');
    expect(screen.getByText('打印数量必须为整数，已恢复为 6。').id).toBe(input.getAttribute('aria-describedby'));
    expect(onCommit).toHaveBeenLastCalledWith(label.id, 6);
  });
});
