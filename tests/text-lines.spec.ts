import { describe, expect, it } from 'vitest';
import { createLabel } from '../src/domain/labels';
import { createTextLines, syncTextLines } from '../src/domain/textLines';
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
});
