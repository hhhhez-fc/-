// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
});

afterEach(() => { cleanup(); window.localStorage.clear(); });

function renderEditor() {
  const label = createLabel({ content: 'AB', quantity: 1, source: 'manual', needsReview: false });
  render(<App initialState={{ ...createInitialDraft(), labels: [label], activeLabelId: label.id }} />);
  return screen.getByRole('spinbutton', { name: '字号（pt）' }) as HTMLInputElement;
}

async function expectSavedSize(expected: number) {
  await waitFor(() => {
    const saved = JSON.parse(window.localStorage.getItem(DRAFT_STORAGE_KEY) ?? '{}');
    expect(saved.labels?.[0]?.textLines[0].style.fontSizePt ?? saved.labels?.[0]?.style.fontSizePt).toBe(expected);
  });
}

describe('字号逐字输入', () => {
  it('清空 26 后逐字键入 24，保留中间输入并立即应用最终合法字号', async () => {
    const user = userEvent.setup();
    const input = renderEditor();
    expect(input.value).toBe('26');
    await user.clear(input);
    await user.type(input, '24');
    expect(input.value).toBe('24');
    await expectSavedSize(24);
    expect(screen.getByRole('button', { name: /拖动第 1 行/ }).style.fontSize).toBe('32px');
  });

  it('空白和未完成的首位数字暂不改动已应用字号', async () => {
    const user = userEvent.setup();
    const input = renderEditor();
    await user.clear(input);
    expect(input.value).toBe('');
    await expectSavedSize(26);
    await user.type(input, '2');
    expect(input.value).toBe('2');
    await expectSavedSize(26);
    await user.type(input, '4');
    expect(input.value).toBe('24');
    await expectSavedSize(24);
  });

  it.each([
    { raw: '', action: 'blur', lastApplied: 26, expected: 8 },
    { raw: '2', action: 'Enter', lastApplied: 26, expected: 8 },
    { raw: '1e', action: 'Enter', lastApplied: 26, expected: 8 },
    { raw: '0', action: 'blur', lastApplied: 26, expected: 8 },
    { raw: '121', action: 'Enter', lastApplied: 12, expected: 120 },
    { raw: '999', action: 'blur', lastApplied: 99, expected: 120 },
    { raw: '1e20', action: 'Enter', lastApplied: 100, expected: 120 },
  ])('输入 $raw 在 $action 时规范化，编辑期间保留最后合法值', async ({ raw, action, lastApplied, expected }) => {
    const user = userEvent.setup();
    const input = renderEditor();
    await user.clear(input);
    if (raw) await user.type(input, raw);
    await expectSavedSize(lastApplied);
    if (action === 'blur') await user.tab();
    else await user.keyboard('{Enter}');
    expect(input.value).toBe(String(expected));
    await expectSavedSize(expected);
    await user.clear(input);
    await user.type(input, '24');
    expect(input.value).toBe('24');
    await expectSavedSize(24);
  });

  it('合法小数字号输入与失焦后保持一致', async () => {
    const user = userEvent.setup();
    const input = renderEditor();
    await user.clear(input);
    await user.type(input, '24.5');
    expect(input.value).toBe('24.5');
    await expectSavedSize(24.5);
    await user.tab();
    expect(input.value).toBe('24.5');
  });
});
