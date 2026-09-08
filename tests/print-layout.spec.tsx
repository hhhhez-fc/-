// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { createInitialDraft } from '../src/domain/draft';
import { createLabel, defaultSizePresets } from '../src/domain/labels';
import { createPrintPlan } from '../src/domain/printing';
import PrintPages from '../src/features/PrintPages';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('打印页面布局', () => {
  it('纵向布局交换系统打印纸张尺寸并将同组每一张唛头整体转向', () => {
    const first = createLabel({
      content: 'FIRST',
      quantity: 2,
      source: 'manual',
      needsReview: false,
    });
    const second = createLabel({
      content: 'SECOND',
      quantity: 1,
      source: 'manual',
      needsReview: false,
    });
    const group = createPrintPlan([first, second], defaultSizePresets).groups[0];
    const html = renderToStaticMarkup(<PrintPages
      group={group}
      layout="portrait"
      rotations={{ [first.id]: 90 }}
    />);

    expect(html).toContain('@page { size: 45mm 70mm; margin: 0; }');
    expect(html.match(/<section class="print-page" style="width:45mm;height:70mm/g)).toHaveLength(3);
    expect(html.match(/class="print-page-content"/g)).toHaveLength(3);
    expect(html.match(/class="print-page-content"[^>]*width:70mm;height:45mm[^>]*rotate\(90deg\)/g)).toHaveLength(3);
    expect(html.match(/class="print-text-layer"[^>]*rotate\(90deg\)/g)).toHaveLength(2);
    expect(html).toContain('SECOND');
  });

  it('把对话框选择的布局传到多张唛头打印页后才调用浏览器系统打印', async () => {
    const user = userEvent.setup();
    const frameCallbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    let systemPrintSnapshot = '';
    vi.spyOn(window, 'print').mockImplementation(() => {
      systemPrintSnapshot = document.body.innerHTML;
    });

    const first = createLabel({
      content: 'FIRST',
      quantity: 2,
      source: 'manual',
      needsReview: false,
    });
    const second = createLabel({
      content: 'SECOND',
      quantity: 1,
      source: 'manual',
      needsReview: false,
    });
    const state = {
      ...createInitialDraft(),
      labels: [first, second],
      activeLabelId: first.id,
    };
    render(<App initialState={state} />);

    await user.click(screen.getByRole('button', { name: '检查并打印' }));
    await user.click(screen.getByRole('button', {
      name: '旋转 70 × 45 mm 第 1 个文字唛头 FIRST 90°',
    }));
    const layoutSelect = screen.getByRole('combobox', { name: '70 × 45 mm 页面布局' });
    await user.selectOptions(layoutSelect, 'portrait');
    expect((layoutSelect as HTMLSelectElement).value).toBe('portrait');
    expect(screen.getAllByText('输出纸张 45 × 70 mm')).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: '打印这一组' }));

    const pages = Array.from(document.querySelectorAll<HTMLElement>('.print-page'));
    expect(pages).toHaveLength(3);
    pages.forEach((page) => {
      expect(page.style.width).toBe('45mm');
      expect(page.style.height).toBe('70mm');
      expect(page.querySelector<HTMLElement>('.print-page-content')?.style.transform)
        .toContain('rotate(90deg)');
    });
    expect(pages[0].querySelector<HTMLElement>('.print-text-layer')?.style.transform).toBe('rotate(90deg)');
    expect(pages[1].querySelector<HTMLElement>('.print-text-layer')?.style.transform).toBe('rotate(90deg)');
    expect(pages[2].querySelector<HTMLElement>('.print-text-layer')?.style.transform).toBe('');

    await act(async () => {
      frameCallbacks.shift()?.(0);
      frameCallbacks.shift()?.(16);
    });
    expect(window.print).toHaveBeenCalledOnce();
    expect(systemPrintSnapshot).toContain('@page { size: 45mm 70mm; margin: 0; }');
    expect(systemPrintSnapshot.match(/class="print-page"/g)).toHaveLength(3);
  });
});
