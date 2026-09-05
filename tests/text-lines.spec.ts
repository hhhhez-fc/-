import { describe, expect, it } from 'vitest';
import { createLabel } from '../src/domain/labels';
import {
  cloneTextLinesWithFreshIds,
  createTextLines,
  moveSelectedTextLines,
  syncTextLines,
  updateSelectedTextLines,
} from '../src/domain/textLines';
import { createInitialDraft, draftReducer } from '../src/domain/draft';
import * as textLineDomain from '../src/domain/textLines';

describe('逐行文字模型', () => {
  it('把每个换行拆成独立文字行并分布在纸张内', () => {
    const lines = createTextLines('FY-01\nMADE IN CHINA');

    expect(lines.map((line) => ({ text: line.text, x: line.placement.xPercent, y: line.placement.yPercent }))).toEqual([
      { text: 'FY-01', x: 50, y: 33.33 },
      { text: 'MADE IN CHINA', x: 50, y: 66.67 },
    ]);
  });

  it('修改正文时保留原有行的位置和整行样式', () => {
    const existing = createTextLines('FY-01\nMADE IN CHINA');
    existing[0] = {
      ...existing[0],
      placement: { xPercent: 12, yPercent: 18, horizontalSnap: 'free', verticalSnap: 'free' },
      style: { fontSizePt: 48, underline: true },
    };

    const next = syncTextLines(existing, 'FY-02\nMADE IN CHINA');

    expect(next[0]).toMatchObject({
      text: 'FY-02',
      placement: { xPercent: 12, yPercent: 18 },
      style: { fontSizePt: 48, underline: true },
    });
    expect(next[1].id).toBe(existing[1].id);
  });

  it('在空白预览直接输入多行时把默认居中的单行均匀展开', () => {
    const existing = createTextLines('');
    const next = syncTextLines(existing, 'FY-01\nMADE IN CHINA');

    expect(next.map((line) => line.placement.yPercent)).toEqual([25, 75]);
  });

  it('reducer 同步正文与文字行', () => {
    const label = createLabel({ content: 'A\nB', quantity: 1, source: 'manual', needsReview: false });
    const state = { ...createInitialDraft(), labels: [label] };

    const next = draftReducer(state, { type: 'update-label', id: label.id, patch: { content: 'A\nB\nC' } });

    expect(next.labels[0].textLines.map((line) => line.text)).toEqual(['A', 'B', 'C']);
  });

  it('预览内编辑只替换当前行内容，并保留其他行', () => {
    const lines = createTextLines('FYF-TTT0103\n4576\nMADE IN CHINA');
    const contentWithUpdatedTextLine = (textLineDomain as typeof textLineDomain & {
      contentWithUpdatedTextLine?: (source: typeof lines, lineId: string, text: string) => string;
    }).contentWithUpdatedTextLine;

    expect(typeof contentWithUpdatedTextLine).toBe('function');
    expect(contentWithUpdatedTextLine?.(lines, lines[1].id, '8899')).toBe('FYF-TTT0103\n8899\nMADE IN CHINA');
  });

  it('自动排列会按选择的左右方式均匀分布非空文字行', () => {
    const lines = createTextLines('FYF-TTT0103\nGhana\n');
    lines[2].placement = { xPercent: 17, yPercent: 88, horizontalSnap: 'free', verticalSnap: 'free' };
    const alignTextLines = (textLineDomain as typeof textLineDomain & {
      alignTextLines?: (source: typeof lines, alignment: 'left' | 'center' | 'right' | 'keep') => typeof lines;
    }).alignTextLines;

    expect(typeof alignTextLines).toBe('function');
    expect(alignTextLines?.(lines, 'left').map((line) => ({
      text: line.text,
      x: line.placement.xPercent,
      y: line.placement.yPercent,
      horizontal: line.placement.horizontalSnap,
      vertical: line.placement.verticalSnap,
    }))).toEqual([
      { text: 'FYF-TTT0103', x: 0, y: 33.33, horizontal: 'left', vertical: 'free' },
      { text: 'Ghana', x: 0, y: 66.67, horizontal: 'left', vertical: 'free' },
      { text: '', x: 17, y: 88, horizontal: 'free', vertical: 'free' },
    ]);
  });

  it('保持左右位置时只调整上下分布，单行位于垂直中央', () => {
    const lines = createTextLines('ONLY');
    lines[0].placement = { xPercent: 24, yPercent: 10, horizontalSnap: 'free', verticalSnap: 'free' };
    const alignTextLines = (textLineDomain as typeof textLineDomain & {
      alignTextLines?: (source: typeof lines, alignment: 'keep') => typeof lines;
    }).alignTextLines;

    expect(alignTextLines?.(lines, 'keep')[0].placement).toEqual({
      xPercent: 24,
      yPercent: 50,
      horizontalSnap: 'free',
      verticalSnap: 'middle',
    });
  });

  it('批量样式和方向只更新已选行', () => {
    const lines = createTextLines('A\nB\nC');
    const next = updateSelectedTextLines(lines, [lines[0].id, lines[2].id], {
      style: { fontSizePt: 32, italic: true },
      textOrientation: 'vertical',
    });
    expect(next.map((line) => [line.style.fontSizePt, line.textOrientation])).toEqual([
      [32, 'vertical'], [undefined, 'horizontal'], [32, 'vertical'],
    ]);
    expect(next[0]).not.toBe(lines[0]);
    expect(next[0].style).not.toBe(lines[0].style);
    expect(next[0].placement).not.toBe(lines[0].placement);
    expect(next[1]).toBe(lines[1]);
  });

  it('整组移动保持间距并用共同边界限制位移', () => {
    const lines = createTextLines('A\nB');
    lines[0].placement.xPercent = 10;
    lines[1].placement.xPercent = 90;
    const next = moveSelectedTextLines(lines, lines.map((line) => line.id), 20, -5);
    expect(next.map((line) => line.placement.xPercent)).toEqual([20, 100]);
    expect(next[1].placement.xPercent - next[0].placement.xPercent).toBe(80);
  });

  it('恢复历史时重建每条文字行 ID', () => {
    const lines = createTextLines('A\nB');
    lines[0].style = { italic: false, fontSizePt: 24 };
    lines[0].placement.xPercent = 17;
    const copy = cloneTextLinesWithFreshIds(lines);
    expect(copy.map((line) => line.id)).not.toEqual(lines.map((line) => line.id));
    expect(copy.map((line) => line.text)).toEqual(['A', 'B']);
    copy[0].style.italic = true;
    copy[0].placement.xPercent = 81;
    expect(lines[0].style).toEqual({ italic: false, fontSizePt: 24 });
    expect(lines[0].placement.xPercent).toBe(17);
  });
});
