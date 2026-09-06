// @vitest-environment jsdom

import { useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { createInitialDraft } from '../src/domain/draft';
import { rowsToLabels } from '../src/domain/importing';
import { createLabel, defaultSizePresets, type LabelRecord } from '../src/domain/labels';
import { solveLabelTextLayout, solveTextLayout, validateLabelForPrint } from '../src/domain/layout';
import * as imagesDomain from '../src/domain/images';
import { createPrintPlan } from '../src/domain/printing';
import { recordRecentLabels } from '../src/domain/history';
import { DRAFT_STORAGE_KEY, loadDraft, saveDraft } from '../src/domain/storage';
import LabelPreview from '../src/features/LabelPreview';
import LabelEditor from '../src/features/LabelEditor';
import PrintLabelThumbnail from '../src/features/PrintLabelThumbnail';
import PrintPages from '../src/features/PrintPages';
import SourceHistory from '../src/features/SourceHistory';
import ImageImporter from '../src/features/ImageImporter';

beforeAll(() => {
  Object.defineProperty(window, 'PointerEvent', { configurable: true, value: MouseEvent });
  Object.defineProperties(HTMLElement.prototype, {
    hasPointerCapture: { configurable: true, value: () => false },
    setPointerCapture: { configurable: true, value: () => undefined },
    releasePointerCapture: { configurable: true, value: () => undefined },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const labelFor = (content: string) => createLabel({ content, quantity: 1, source: 'manual', needsReview: false });

function PreviewHarness({ fontSizePt = 26 }: { fontSizePt?: number } = {}) {
  const [label, setLabel] = useState(() => {
    const initial = labelFor('A\nB\nC');
    initial.style.fontSizePt = fontSizePt;
    initial.printArea = { leftMm: 5, topMm: 5, widthMm: 50, heightMm: 30 };
    initial.textLines.forEach((line, index) => { line.placement.xPercent = 30 + index * 20; });
    return initial;
  });
  const [selected, setSelected] = useState(label.textLines.slice(0, 2).map((line) => line.id));
  return <><LabelPreview label={label} preset={defaultSizePresets[1]}
    activeLineId={label.textLines[0].id} selectedLineIds={selected}
    onActiveLineChange={() => undefined}
    onSelectLine={(id) => setSelected((ids) => ids.includes(id) ? ids : [...ids, id])}
    onClearLineSelection={() => setSelected([])}
    onChange={(patch) => setLabel((current) => ({ ...current, ...patch }))} />
    <output data-testid="state">{JSON.stringify(label)}</output></>;
}

const currentLabel = () => JSON.parse(screen.getByTestId('state').textContent!) as LabelRecord;
const mockBounds = (element: Element, width = 200, height = 120) => vi.spyOn(element, 'getBoundingClientRect')
  .mockReturnValue({ width, height, left: 0, top: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) });

describe('最终审查回归', () => {
  it.each(['abc', '1001', '0', ''])('无效 Excel 数量 %j 持久化后仍阻止打印并可在列表纠正', async (quantity) => {
    const [label] = rowsToLabels(['唛头', '数量'], [['FY', quantity]], 'small');
    const state = { ...createInitialDraft(), labels: [label], activeLabelId: label.id };
    saveDraft(window.localStorage, state);
    const restored = loadDraft(window.localStorage)!;
    expect(validateLabelForPrint(restored.labels[0], defaultSizePresets[1])).toContain('打印数量必须是正整数');
    expect(createPrintPlan(restored.labels, restored.sizePresets).groups).toHaveLength(0);
    render(<App initialState={restored} />);
    const input = screen.getByRole('spinbutton', { name: '第 1 条唛头的打印数量' });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect((screen.getByRole('button', { name: '打印预览' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '检查并打印' }));
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem(DRAFT_STORAGE_KEY)!).recentLabels).toEqual([]));
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    fireEvent.change(input, { target: { value: '3' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input.getAttribute('aria-invalid')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: '打印预览' }));
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem(DRAFT_STORAGE_KEY)!).recentLabels[0].label.quantity).toBe(3));
  });

  it('有效旧 needsReview 唛头仍可打印', () => {
    const label = { ...labelFor('FY'), needsReview: true, reviewReason: '旧校对字段' };
    expect(validateLabelForPrint(label, defaultSizePresets[1])).toEqual([]);
  });

  it('多次 pointermove 使用按下位置计算位移并能返回起点', () => {
    render(<PreviewHarness />);
    mockBounds(document.querySelector('.label-content-layer')!);
    const line = screen.getByRole('button', { name: /拖动第 1 行/ });
    fireEvent.pointerDown(line, { clientX: 100, clientY: 60 });
    for (const [clientX, expected] of [[112, [36, 56, 70]], [124, [42, 62, 70]], [108, [34, 54, 70]], [102, [31, 51, 70]], [100, [30, 50, 70]]] as const) {
      fireEvent.pointerMove(line, { clientX, clientY: 60 });
      expect(currentLabel().textLines.map((item) => item.placement.xPercent)).toEqual(expected);
    }
  });

  it('固定字号文字拖动到边缘后保持渲染字号且不裁剪或显示越界错误', () => {
    render(<PreviewHarness fontSizePt={120} />);
    mockBounds(document.querySelector('.label-content-layer')!);
    const line = screen.getByRole('button', { name: /拖动第 1 行/ });
    const renderedFontSize = line.style.fontSize;

    fireEvent.pointerDown(line, { clientX: 100, clientY: 60 });
    fireEvent.pointerMove(line, { clientX: 180, clientY: 60 });

    expect(currentLabel().style).toMatchObject({ fontMode: 'fixed', fontSizePt: 120 });
    expect(screen.getByRole('button', { name: /拖动第 1 行/ }).style.fontSize).toBe(renderedFontSize);
    expect(screen.queryByText('固定字号下内容超出唛头范围')).toBeNull();
    expect((document.querySelector('.label-content-layer') as HTMLElement).style.overflow).toBe('visible');
  });

  it('固定字号内容超出范围时仍可从编辑器进入打印检查', () => {
    const label = labelFor('VERY-LONG-SHIPPING-MARK-THAT-OVERFLOWS');
    label.style.fontSizePt = 300;
    const state = { ...createInitialDraft(), labels: [label], activeLabelId: label.id };

    render(<App initialState={state} />);

    expect(screen.queryByText(/打印前请处理：固定字号下内容超出唛头范围/)).toBeNull();
    expect(screen.getByTestId('label-preview').classList.contains('has-overflow')).toBe(false);
    const previewButton = screen.getByRole('button', { name: '打印预览' }) as HTMLButtonElement;
    expect(previewButton.disabled).toBe(false);
    fireEvent.click(previewButton);
    expect(screen.getByRole('dialog', { name: /共 1 张，可以打印/ })).toBeTruthy();
  });

  it('实际打印允许文字超出内部打印区域且仍只生成一张纸', () => {
    const label = labelFor('VERY-LONG-SHIPPING-MARK-THAT-OVERFLOWS');
    label.style.fontSizePt = 300;
    const group = createPrintPlan([label], defaultSizePresets).groups[0];

    const html = renderToStaticMarkup(<PrintPages group={group} />);

    expect(html).toContain('class="print-content-layer"');
    expect(html).toContain('overflow:visible');
    expect(html.match(/<section class="print-page"/g)).toHaveLength(1);
  });

  it('文字方向键只移动选中行，打印区域和未选行保持物理位置', () => {
    render(<PreviewHarness />);
    const original = currentLabel();
    fireEvent.keyDown(screen.getByRole('button', { name: /拖动第 1 行/ }), { key: 'ArrowRight' });
    expect(currentLabel().textLines.map((line) => line.placement.xPercent)).toEqual([31, 51, 70]);
    expect(currentLabel().printArea).toEqual(original.printArea);
    expect(currentLabel().textLines[2]).toEqual(original.textLines[2]);
  });

  it('打印区域边框拖动后的 click 保留选择，后续普通空白 click 清空', () => {
    render(<PreviewHarness />);
    mockBounds(screen.getByTestId('label-preview'), 280, 180);
    const area = screen.getByRole('group', { name: /拖动内容打印区域/ });
    fireEvent.pointerDown(area, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(area, { clientX: 18, clientY: 18 });
    fireEvent.pointerUp(area, { clientX: 18, clientY: 18 });
    fireEvent.click(area);
    expect(screen.getByRole('button', { name: /拖动第 1 行/ }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.pointerDown(area, { clientX: 18, clientY: 18 });
    fireEvent.pointerUp(area, { clientX: 18, clientY: 18 });
    fireEvent.click(area);
    expect(screen.getByRole('button', { name: /拖动第 1 行/ }).getAttribute('aria-pressed')).toBe('false');
  });

  it('显式字符字号在编辑预览、缩略图和打印中保持相同物理比例', () => {
    const label = labelFor('AB');
    label.textStyleRanges = [{ start: 0, end: 1, style: { fontSizePt: 48 } }];
    const preset = defaultSizePresets[1];
    const { container } = render(<>
      <LabelPreview label={label} preset={preset} activeLineId={null} selectedLineIds={[]}
        onActiveLineChange={() => undefined} onSelectLine={() => undefined} onClearLineSelection={() => undefined} onChange={() => undefined} />
      <PrintLabelThumbnail label={label} preset={preset} rotation={0} />
      <PrintPages group={createPrintPlan([label], [preset]).groups[0]} />
    </>);
    const preview = container.querySelector('.draggable-text > span') as HTMLElement;
    const thumbnail = container.querySelector('.print-label-thumbnail-text > span') as HTMLElement;
    const printed = container.querySelector('.print-positioned-text > span') as HTMLElement;
    expect(preview.style.fontSize).toBe('64px');
    expect(printed.style.fontSize).toBe('48pt');
    expect(thumbnail.style.fontSize.endsWith('px')).toBe(true);
    expect(parseFloat(thumbnail.style.fontSize)).toBeCloseTo(36.286, 3);
  });

  it.each([1e20, Number.MAX_VALUE])('字号求解对巨大有限值 %j 保持有界', (fontSizePt) => {
    const label = labelFor('A');
    label.style.fontSizePt = fontSizePt;
    const push = Array.prototype.push;
    Array.prototype.push = function (this: unknown[], ...items: unknown[]) {
      if (this.length > 128 && items.every((item) => typeof item === 'number')) throw new Error('font search exceeded 128 candidates');
      return push.apply(this, items);
    };
    try {
      const layout = solveLabelTextLayout(label, { ...defaultSizePresets[1], minFontSize: 1e20 });
      expect(layout.fontSize).toBeLessThanOrEqual(300);
    } finally { Array.prototype.push = push; }
  });

  it('草稿水合规范全局、行和字符范围字号', () => {
    const label = labelFor('AB');
    label.style.fontSizePt = 1e20;
    label.textLines[0].style.fontSizePt = -5;
    label.textStyleRanges = [{ start: 0, end: 1, style: { fontSizePt: Number.MAX_VALUE } }];
    saveDraft(window.localStorage, { ...createInitialDraft(), labels: [label] });
    const hydrated = loadDraft(window.localStorage)!.labels[0];
    expect(hydrated.style.fontSizePt).toBe(300);
    expect(hydrated.textLines[0].style.fontSizePt).toBe(8);
    expect(hydrated.textStyleRanges[0].style.fontSizePt).toBe(300);
  });

  it('旧自动换行求解入口也限制巨大字号范围', () => {
    expect(solveTextLayout({ content: 'A', widthMm: 70, heightMm: 45, paddingMm: 4,
      maxFontSize: 1e20, minFontSize: 8 })).toMatchObject({ ok: true });
  });

  it('OCR 成功只返回可编辑内容与完成反馈，不新增人工校对状态', async () => {
    vi.spyOn(imagesDomain, 'recognizeImageLayout').mockResolvedValue({ text: 'FY', lines: [{ text: 'FY', xPercent: 50, yPercent: 50 }] });
    const onImport = vi.fn();
    const onStatus = vi.fn();
    const { container } = render(<ImageImporter sizePresetId="small" purpose="carton" onImport={onImport} onStatus={onStatus} />);
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['png'], 'mark.png', { type: 'image/png' })] } });
    const image = await screen.findByRole('img');
    Object.defineProperties(image, { naturalWidth: { value: 100 }, naturalHeight: { value: 100 } });
    fireEvent.load(image);
    fireEvent.click(screen.getByRole('button', { name: '识别文字' }));
    await waitFor(() => expect(onImport).toHaveBeenCalled());
    const label = onImport.mock.lastCall![0][0] as LabelRecord;
    expect(label).toMatchObject({ content: 'FY', needsReview: false });
    expect(label.reviewReason).toBeUndefined();
    expect(onStatus.mock.lastCall![0]).toBe('图片文字已识别：mark.png');
    expect(validateLabelForPrint(label, defaultSizePresets[1])).toEqual([]);
  });

  it.each([['1e20', 300], ['0', 8], ['-9', 8]])('编辑器在失焦后把字号 %s 钳制到可编辑范围', (value, expected) => {
    const label = labelFor('A');
    const onChange = vi.fn();
    render(<LabelEditor label={label} activeLineId={label.textLines[0].id} selectedLineIds={[label.textLines[0].id]}
      onActiveLineChange={() => undefined} onSelectLine={() => undefined} onChange={onChange}
      onPrintPreview={() => undefined} reviewErrors={[]} onDuplicate={() => undefined} onDelete={() => undefined} />);
    const input = screen.getByRole('spinbutton', { name: '字号（pt）' });
    fireEvent.change(input, { target: { value } });
    fireEvent.blur(input);
    expect(onChange.mock.lastCall?.[0].textLines[0].style.fontSizePt).toBe(expected);
  });

  it('每条历史都显示本地化来源以区分相似唛头', () => {
    const entries = (['manual', 'excel', 'image'] as const).flatMap((source) => recordRecentLabels([], [{
      label: { ...labelFor('FY'), source }, preset: defaultSizePresets[1],
    }]));
    render(<SourceHistory entries={entries} onRestore={() => undefined} />);
    screen.getAllByRole('listitem').forEach((row, index) => {
      expect(within(row).getByText(new RegExp(['手动', 'Excel', '图片'][index]))).toBeTruthy();
    });
  });
});
