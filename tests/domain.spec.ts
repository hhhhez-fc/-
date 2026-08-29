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

  it('将表格行转换为待校对的唛头记录，并保持有效数量', () => {
    const labels = rowsToLabels(['唛头', '数量'], [['箱唛 A', '3'], ['箱唛 B', '错误']], 'small');
    expect(labels.map(({ content, quantity, needsReview }) => ({ content, quantity, needsReview }))).toEqual([
      { content: '箱唛 A', quantity: 3, needsReview: false },
      { content: '箱唛 B', quantity: 1, needsReview: true },
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
  it.each(['0', '-3', '1.5', 'abc', ''])('将非法数量 %j 标记为需要校对', (input) => {
    expect(parseQuantity(input)).toEqual({ quantity: 1, needsReview: true });
  });

  it('接受正整数数量', () => {
    expect(parseQuantity('12')).toEqual({ quantity: 12, needsReview: false });
  });

  it('将超过单条打印上限的数量标记为需要校对', () => {
    expect(parseQuantity('1001')).toEqual({ quantity: 1, needsReview: true });
  });

  it('阻止手动输入超过单条上限的基础数量', () => {
    const label = createLabel({ content: 'A', quantity: 1001, source: 'manual', needsReview: false });
    expect(validateLabelForPrint(label, defaultSizePresets[1])).toContain('基础数量不能超过 1000');
  });

  it('将基础数量与张贴面数相乘得到最终打印份数', () => {
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
  it('提供可编辑的大、小唛头预设和居中自动字号样式', () => {
    expect(defaultSizePresets.map(({ id, widthMm, heightMm }) => ({ id, widthMm, heightMm }))).toEqual([
      { id: 'large', widthMm: 100, heightMm: 60 },
      { id: 'small', widthMm: 70, heightMm: 45 },
    ]);
    expect(defaultStyle).toMatchObject({
      fontMode: 'auto',
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

  it('移动文字只改变位置校验，不改变自动字号', () => {
    const label = createLabel({
      content: 'FYF-TTT0103',
      quantity: 1,
      source: 'manual',
      needsReview: false,
    });
    const preset = { ...defaultSizePresets[0], widthMm: 130, heightMm: 70, maxFontSize: 56, minFontSize: 8 };
    const centered = solveLabelTextLayout(label, preset);

    label.textLines[0].placement = {
      xPercent: 90,
      yPercent: 50,
      horizontalSnap: 'free',
      verticalSnap: 'middle',
    };
    const moved = solveLabelTextLayout(label, preset);

    expect(centered).toEqual({ ok: true, fontSize: 50, lines: ['FYF-TTT0103'] });
    expect(moved).toEqual({ ok: false, error: '文字位置超出唛头范围', fontSize: 50 });
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

  it('固定字号溢出时返回明确的打印阻断原因', () => {
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

    expect(result).toEqual({ ok: false, error: '固定字号下内容超出唛头范围' });
  });

  it('打印前同时报告待校对、数量和内容问题', () => {
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
      '该唛头尚未完成校对',
    ]);
  });
});
