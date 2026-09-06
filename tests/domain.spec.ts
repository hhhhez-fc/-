import { describe, expect, it } from 'vitest';
import { identifyExcelColumns, rowsToLabels } from '../src/domain/importing';
import {
  createLabel,
  defaultSizePresets,
  defaultSizeTypeForBusiness,
  defaultStyle,
  getPrintCopies,
  validateSizePreset,
} from '../src/domain/labels';
import { parseQuantity } from '../src/domain/quantity';
import { getPreviewScale, solveLabelTextLayout, solveTextLayout, validateLabelForPrint } from '../src/domain/layout';

describe('Excel 表头识别', () => {
  it('规范化后识别含“唛头”与“数量/件数”的表头', () => {
    expect(identifyExcelColumns([' 唛头内容 ', '装箱数量（件数）', '备注'])).toEqual({
      contentColumn: 0,
      quantityColumn: 1,
      needsManualMapping: false,
    });
  });

  it('将表格行转换为唛头记录，无效数量保留为不可打印的零值', () => {
    const labels = rowsToLabels(['唛头', '数量'], [['箱唛 A', '3'], ['箱唛 B', '错误']], 'small');
    expect(labels.map(({ content, quantity, needsReview }) => ({ content, quantity, needsReview }))).toEqual([
      { content: '箱唛 A', quantity: 3, needsReview: false },
      { content: '箱唛 B', quantity: 0, needsReview: false },
    ]);
  });
});

describe('业务默认规格', () => {
  it('义乌铺默认使用大唛头，其他业务默认使用小唛头', () => {
    expect(defaultSizeTypeForBusiness('义乌铺')).toBe('large');
    expect(defaultSizeTypeForBusiness('外贸')).toBe('small');
  });
});

describe('打印数量校验', () => {
  it('人工校对状态不阻止合法唛头打印', () => {
    const label = createLabel({ content: 'FY-01', quantity: 1, source: 'manual', needsReview: true });

    expect(validateLabelForPrint(label, defaultSizePresets[0])).not.toContain('该唛头尚未完成校对');
  });

  it.each(['0', '-3', '1.5', 'abc', ''])('将非法数量 %j 保留为不可打印的零值', (input) => {
    expect(parseQuantity(input)).toEqual({ quantity: 0 });
  });

  it('接受正整数数量', () => {
    expect(parseQuantity('12')).toEqual({ quantity: 12 });
  });

  it('将超过单条打印上限的数量保留为不可打印的零值', () => {
    expect(parseQuantity('1001')).toEqual({ quantity: 0 });
  });

  it('阻止手动输入超过单条上限的打印数量', () => {
    const label = createLabel({ content: 'A', quantity: 1001, source: 'manual', needsReview: false });
    expect(validateLabelForPrint(label, defaultSizePresets[1])).toContain('打印数量不能超过 1000');
  });

  it('将列表打印数量与张贴面数相乘得到最终打印份数', () => {
    const label = createLabel({
      content: 'FY-01',
      contentType: 'text',
      purpose: 'carton',
      source: 'manual',
      quantity: 3,
      sides: 2,
      sizePresetId: 'small',
      style: defaultStyle,
      needsReview: false,
    });

    expect(getPrintCopies(label)).toBe(6);
  });
});

describe('尺寸与样式默认值', () => {
  it('提供可编辑的大、小唛头预设和可直接调整的固定字号样式', () => {
    expect(defaultSizePresets.map(({ id, widthMm, heightMm }) => ({ id, widthMm, heightMm }))).toEqual([
      { id: 'large', widthMm: 100, heightMm: 60 },
      { id: 'small', widthMm: 70, heightMm: 45 },
    ]);
    expect(defaultStyle).toMatchObject({
      fontMode: 'fixed',
      horizontalAlign: 'center',
      verticalAlign: 'middle',
      fontWeight: 700,
    });
  });

  it('校验自定义毫米尺寸和内边距', () => {
    expect(validateSizePreset({ ...defaultSizePresets[0], widthMm: 0, heightMm: 10, paddingMm: 8 })).toEqual([
      '宽度必须在 20–300 mm 之间',
      '高度必须在 15–300 mm 之间',
      '内边距必须小于短边的一半',
    ]);
    expect(validateSizePreset({ ...defaultSizePresets[0], widthMm: 90, heightMm: 50, paddingMm: 4 })).toEqual([]);
  });
});

describe('唛头排版', () => {
  it('屏幕预览按纸张实际毫米宽度等比例缩放字号', () => {
    expect(getPreviewScale(260, 130)).toBeCloseTo(0.5292, 3);
  });

  it('自动适配保留能容纳的字号，并把长内容缩小到最大可用字号', () => {
    const short = createLabel({ content: 'FY', quantity: 1, source: 'manual', needsReview: false });
    short.style.fontMode = 'auto';
    short.style.fontSizePt = 48;
    const shortLayout = solveLabelTextLayout(short, defaultSizePresets[0]);

    const long = createLabel({
      content: 'LONG-SHIPPING-MARK-1234',
      quantity: 1,
      source: 'manual',
      needsReview: false,
    });
    long.style.fontMode = 'auto';
    long.style.fontSizePt = 48;
    const longLayout = solveLabelTextLayout(long, defaultSizePresets[1]);

    expect(shortLayout.ok && shortLayout.lineLayouts[short.textLines[0].id].fontSizePt).toBe(48);
    expect(longLayout.ok).toBe(true);
    expect(longLayout.ok && longLayout.lineLayouts[long.textLines[0].id].fontSizePt).toBeLessThan(48);
  });

  it('局部字符字号按同一比例缩小', () => {
    const label = createLabel({ content: 'LONG-LONG-LONG', quantity: 1, source: 'manual', needsReview: false });
    label.style.fontMode = 'auto';
    label.style.fontSizePt = 40;
    label.textStyleRanges = [{ start: 0, end: 4, style: { fontSizePt: 60 } }];

    const result = solveLabelTextLayout(label, defaultSizePresets[1]);

    expect(result.ok).toBe(true);
    expect(result.ok && result.lineLayouts[label.textLines[0].id]).toMatchObject({ fontSizePt: expect.any(Number) });
    expect(result.ok && result.lineLayouts[label.textLines[0].id].fontScale).toBeLessThan(1);
  });

  it('全局粗体被文字行继承时会在边界处触发缩小', () => {
    const plain = createLabel({
      content: 'MMMM',
      quantity: 1,
      source: 'manual',
      needsReview: false,
      printArea: { leftMm: 25.25, topMm: 15, widthMm: 49.5, heightMm: 30 },
    });
    plain.style.fontSizePt = 38;
    plain.style.fontMode = 'auto';
    plain.style.fontWeight = 400;
    const bold = createLabel({
      content: 'MMMM',
      quantity: 1,
      source: 'manual',
      needsReview: false,
      printArea: { leftMm: 25.25, topMm: 15, widthMm: 49.5, heightMm: 30 },
    });
    bold.style.fontSizePt = 38;
    bold.style.fontMode = 'auto';
    bold.style.fontWeight = 700;

    const plainResult = solveLabelTextLayout(plain, defaultSizePresets[0]);
    const boldResult = solveLabelTextLayout(bold, defaultSizePresets[0]);

    expect(plainResult.ok && plainResult.lineLayouts[plain.textLines[0].id].fontSizePt).toBe(38);
    expect(boldResult.ok && boldResult.lineLayouts[bold.textLines[0].id].fontSizePt).toBeLessThan(38);
  });

  it('全局斜体被文字行继承时会在边界处触发缩小', () => {
    const plain = createLabel({
      content: 'MMMM',
      quantity: 1,
      source: 'manual',
      needsReview: false,
      printArea: { leftMm: 25.25, topMm: 15, widthMm: 49.5, heightMm: 30 },
    });
    plain.style.fontSizePt = 38;
    plain.style.fontMode = 'auto';
    plain.style.fontWeight = 400;
    plain.style.italic = false;
    const italic = createLabel({
      content: 'MMMM',
      quantity: 1,
      source: 'manual',
      needsReview: false,
      printArea: { leftMm: 25.25, topMm: 15, widthMm: 49.5, heightMm: 30 },
    });
    italic.style.fontSizePt = 38;
    italic.style.fontMode = 'auto';
    italic.style.fontWeight = 400;
    italic.style.italic = true;

    const plainResult = solveLabelTextLayout(plain, defaultSizePresets[0]);
    const italicResult = solveLabelTextLayout(italic, defaultSizePresets[0]);

    expect(plainResult.ok && plainResult.lineLayouts[plain.textLines[0].id].fontSizePt).toBe(38);
    expect(italicResult.ok && italicResult.lineLayouts[italic.textLines[0].id].fontSizePt).toBeLessThan(38);
  });

  it('最小字号仍无法容纳时保持打印阻断', () => {
    const label = createLabel({
      content: 'MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM',
      quantity: 1,
      source: 'manual',
      needsReview: false,
    });
    label.style.fontMode = 'auto';
    label.style.fontSizePt = 48;

    const result = solveLabelTextLayout(label, defaultSizePresets[1]);

    expect(result).toMatchObject({
      ok: false,
      error: '内容在最小字号下仍无法完整显示',
      lineLayouts: {
        [label.textLines[0].id]: { fontSizePt: defaultSizePresets[1].minFontSize },
      },
    });
  });

  it('任一行在最小字号仍失败时仍会返回所有非空行的尝试排版', () => {
    const label = createLabel({
      content: 'MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM\nI',
      quantity: 1,
      source: 'manual',
      needsReview: false,
    });
    label.style.fontMode = 'auto';
    label.style.fontSizePt = 48;

    const result = solveLabelTextLayout(label, defaultSizePresets[1]);

    expect(result.ok).toBe(false);
    expect(result.lineLayouts).toMatchObject({
      [label.textLines[0].id]: { fontSizePt: defaultSizePresets[1].minFontSize },
      [label.textLines[1].id]: { fontSizePt: expect.any(Number) },
    });
  });

  it('固定字号文字移动到边缘后保持字号并允许打印', () => {
    const label = createLabel({
      content: 'FYF-TTT0103',
      quantity: 1,
      source: 'manual',
      needsReview: false,
    });
    label.style.fontSizePt = 32;
    const preset = { ...defaultSizePresets[0], widthMm: 130, heightMm: 70, maxFontSize: 56, minFontSize: 8 };
    const centered = solveLabelTextLayout(label, preset);

    label.textLines[0].placement = {
      xPercent: 90,
      yPercent: 50,
      horizontalSnap: 'free',
      verticalSnap: 'middle',
    };
    const moved = solveLabelTextLayout(label, preset);

    expect(centered).toMatchObject({
      ok: true,
      fontSize: 32,
      lineLayouts: { [label.textLines[0].id]: { fontSizePt: 32, fontScale: 1 } },
      lines: ['FYF-TTT0103'],
    });
    expect(moved).toMatchObject({
      ok: true,
      fontSize: 32,
      lineLayouts: { [label.textLines[0].id]: { fontSizePt: 32, fontScale: 1 } },
      lines: ['FYF-TTT0103'],
    });
    expect(validateLabelForPrint(label, preset)).toEqual([]);
    expect(label.style.fontSizePt).toBe(32);
  });

  it('自动适配忽略不产生打印内容的空行', () => {
    const label = createLabel({ content: 'FYF-TTT0103\n', quantity: 1, source: 'manual', needsReview: false });
    label.textLines[1].placement = { ...label.textLines[0].placement };

    const result = solveLabelTextLayout(label, { ...defaultSizePresets[0], widthMm: 130, heightMm: 70 });

    expect(result.ok).toBe(true);
  });

  it('为可容纳的短文本返回可用字号', () => {
    const result = solveTextLayout({
      content: 'MADE IN CHINA',
      widthMm: 100,
      heightMm: 60,
      paddingMm: 5,
      maxFontSize: 56,
      minFontSize: 12,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.fontSize).toBeGreaterThanOrEqual(12);
  });

  it('当文本在最小字号仍无法完整显示时返回错误', () => {
    const result = solveTextLayout({
      content: 'THIS IS AN UNBREAKABLE_LABEL_TEXT_THAT_CANNOT_FIT',
      widthMm: 10,
      heightMm: 10,
      paddingMm: 2,
      maxFontSize: 16,
      minFontSize: 12,
    });

    expect(result).toEqual({
      ok: false,
      error: '内容在最小字号下仍无法完整显示',
    });
  });

  it('固定字号溢出时保留原始文字并允许打印', () => {
    const result = solveTextLayout({
      content: 'VERY LONG SHIPPING MARK',
      widthMm: 20,
      heightMm: 10,
      paddingMm: 2,
      maxFontSize: 80,
      minFontSize: 8,
      fixedFontSize: 80,
      lineHeight: 1.2,
    });

    expect(result).toEqual({
      ok: true,
      fontSize: 80,
      lines: ['VERY LONG SHIPPING MARK'],
    });
  });

  it('打印前报告数量和内容问题，但不报告人工校对状态', () => {
    const label = createLabel({
      content: '   ',
      contentType: 'text',
      purpose: 'carton',
      source: 'manual',
      quantity: 0,
      sides: 1,
      sizePresetId: 'small',
      style: defaultStyle,
      needsReview: true,
    });

    expect(validateLabelForPrint(label, defaultSizePresets[1])).toEqual([
      '唛头内容不能为空',
      '打印数量必须是正整数',
    ]);
  });
});
