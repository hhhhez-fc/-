import { describe, expect, it } from 'vitest';
import { didPointerMove, resolvePointerDragUpdate } from '../src/domain/pointerDrag';
import * as pointerDragDomain from '../src/domain/pointerDrag';

describe('预览文字拖动', () => {
  const start = {
    clientX: 100,
    clientY: 50,
    placement: {
      xPercent: 50,
      yPercent: 50,
      horizontalSnap: 'center' as const,
      verticalSnap: 'middle' as const,
    },
  };

  it('单击或轻微抖动只选中文字，不产生位置更新', () => {
    expect(resolvePointerDragUpdate(start, { clientX: 102, clientY: 52 }, { width: 200, height: 100 })).toBeNull();
    expect(didPointerMove(start, { clientX: 102, clientY: 52 })).toBe(false);
    expect(didPointerMove(start, { clientX: 105, clientY: 50 })).toBe(true);
  });

  it('超过拖动阈值后按起始位置计算新位置', () => {
    expect(resolvePointerDragUpdate(start, { clientX: 120, clientY: 60 }, { width: 200, height: 100 })).toEqual({
      xPercent: 60,
      yPercent: 60,
      horizontalSnap: 'free',
      verticalSnap: 'free',
    });
  });

  it('拖动文字边框角点会按比例调整字号并限制在可用范围', () => {
    const resolveTextResizeFontSize = (pointerDragDomain as typeof pointerDragDomain & {
      resolveTextResizeFontSize?: (
        start: { fontSizePt: number; width: number; height: number; handle: 'nw' | 'ne' | 'se' | 'sw' },
        pointer: { deltaX: number; deltaY: number },
      ) => number;
    }).resolveTextResizeFontSize;

    expect(typeof resolveTextResizeFontSize).toBe('function');
    expect(resolveTextResizeFontSize?.(
      { fontSizePt: 32, width: 160, height: 40, handle: 'se' },
      { deltaX: 40, deltaY: 10 },
    )).toBe(40);
    expect(resolveTextResizeFontSize?.(
      { fontSizePt: 10, width: 100, height: 20, handle: 'nw' },
      { deltaX: 300, deltaY: 300 },
    )).toBe(8);
    expect(resolveTextResizeFontSize?.(
      { fontSizePt: 240, width: 100, height: 20, handle: 'se' },
      { deltaX: 300, deltaY: 300 },
    )).toBe(300);
  });
});
