import { describe, expect, it } from 'vitest';
import {
  extractRegionText,
  formatCellRange,
  normalizeCellRange,
  regionsToLabels,
  type CellRange,
  type ParsedSheet,
} from '../src/domain/importing';
import { applyTextStyleRange, buildStyledSegments } from '../src/domain/richText';
import { describePlacement, resolvePlacement } from '../src/domain/placement';
import { createInitialDraft, draftReducer } from '../src/domain/draft';
import { createLabel, defaultSizePresets } from '../src/domain/labels';

const sheet: ParsedSheet = {
  name: 'Sheet1',
  headers: ['唛头', '型号', '数量'],
  rows: [
    ['FY-01', 'BLUE', '2'],
    ['MADE IN CHINA', '', ''],
    ['FY-02', 'RED', '1'],
  ],
};

describe('Excel 多区域框选', () => {
  it('规范化反向拖动区域并显示 Excel 地址', () => {
    expect(normalizeCellRange({ startRow: 2, startCol: 2, endRow: 1, endCol: 0 })).toEqual({
      startRow: 1,
      startCol: 0,
      endRow: 2,
      endCol: 2,
    });
    expect(formatCellRange({ startRow: 0, startCol: 0, endRow: 2, endCol: 27 })).toBe('A1:AB3');
  });

  it('按行列顺序合并区域内非空文字', () => {
    const range: CellRange = { startRow: 1, startCol: 0, endRow: 2, endCol: 2 };
    expect(extractRegionText(sheet, range)).toBe('FY-01\nBLUE\n2\nMADE IN CHINA');
  });

  it('多个区域分别生成多条待校对唛头', () => {
    const labels = regionsToLabels(sheet, [
      { startRow: 1, startCol: 0, endRow: 2, endCol: 1 },
      { startRow: 3, startCol: 0, endRow: 3, endCol: 1 },
    ], 'small');

    expect(labels.map((label) => ({ content: label.content, quantity: label.quantity, review: label.needsReview }))).toEqual([
      { content: 'FY-01\nBLUE\nMADE IN CHINA', quantity: 1, review: true },
      { content: 'FY-02\nRED', quantity: 1, review: true },
    ]);
  });
});

describe('局部文字样式', () => {
  it('把选中文字拆成带局部样式的渲染片段', () => {
    const ranges = applyTextStyleRange([], 0, 5, { fontSizePt: 48, fontWeight: 700 });

    expect(buildStyledSegments('FY-01 MADE', ranges)).toEqual([
      { text: 'FY-01', style: { fontSizePt: 48, fontWeight: 700 } },
      { text: ' MADE', style: {} },
    ]);
  });

  it('编辑正文时清除旧字符范围，避免样式套到错误文字', () => {
    const label = createLabel({
      content: 'FY-01',
      quantity: 1,
      source: 'manual',
      needsReview: false,
      textStyleRanges: [{ start: 0, end: 2, style: { underline: true } }],
    });
    const state = { ...createInitialDraft(), labels: [label] };

    const next = draftReducer(state, { type: 'update-label', id: label.id, patch: { content: 'FY-02' } });

    expect(next.labels[0].textStyleRanges).toEqual([]);
  });
});

describe('拖动定位与自动吸附', () => {
  it('靠近中心和顶部时吸附并报告对齐类型', () => {
    const placement = resolvePlacement(52, 4, 6);
    expect(placement).toEqual({
      xPercent: 50,
      yPercent: 0,
      horizontalSnap: 'center',
      verticalSnap: 'top',
    });
    expect(describePlacement(placement)).toBe('顶部居中');
  });

  it('离开吸附线时保留自由位置', () => {
    expect(resolvePlacement(27, 61, 6)).toEqual({
      xPercent: 27,
      yPercent: 61,
      horizontalSnap: 'free',
      verticalSnap: 'free',
    });
  });
});

describe('常用尺寸', () => {
  it('最近使用尺寸去重并移动到最前', () => {
    const state = createInitialDraft();
    const first = draftReducer(state, { type: 'remember-size', preset: defaultSizePresets[0] });
    const second = draftReducer(first, { type: 'remember-size', preset: defaultSizePresets[1] });
    const third = draftReducer(second, { type: 'remember-size', preset: defaultSizePresets[0] });

    expect(third.recentSizes.map((size) => `${size.widthMm}x${size.heightMm}`)).toEqual(['100x60', '70x45']);
  });
});
