import { describe, expect, it } from 'vitest';
import { resolvePointerDragUpdate } from '../src/domain/pointerDrag';

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
  });

  it('超过拖动阈值后按起始位置计算新位置', () => {
    expect(resolvePointerDragUpdate(start, { clientX: 120, clientY: 60 }, { width: 200, height: 100 })).toEqual({
      xPercent: 60,
      yPercent: 60,
      horizontalSnap: 'free',
      verticalSnap: 'free',
    });
  });
});
