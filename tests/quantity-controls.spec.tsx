// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
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
});
