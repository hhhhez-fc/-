import { describe, expect, it } from 'vitest';
import * as placement from '../src/domain/placement';

interface PrintAreaMm {
  leftMm: number;
  topMm: number;
  widthMm: number;
  heightMm: number;
}

type PrintAreaApi = {
  resolvePrintArea: (area: PrintAreaMm | undefined, preset: { widthMm: number; heightMm: number; paddingMm: number }) => PrintAreaMm;
  movePrintArea: (area: PrintAreaMm, deltaXmm: number, deltaYmm: number, preset: { widthMm: number; heightMm: number }) => PrintAreaMm;
  resizePrintArea: (area: PrintAreaMm, handle: string, deltaXmm: number, deltaYmm: number, preset: { widthMm: number; heightMm: number }) => PrintAreaMm;
};

const printArea = placement as unknown as PrintAreaApi;

describe('内容打印区域', () => {
  it('旧记录默认使用纸张内边距范围', () => {
    expect(printArea.resolvePrintArea(undefined, { widthMm: 70, heightMm: 45, paddingMm: 4 })).toEqual({
      leftMm: 4,
      topMm: 4,
      widthMm: 62,
      heightMm: 37,
    });
  });

  it('整体拖动时保持尺寸并限制在纸张内', () => {
    expect(printArea.movePrintArea(
      { leftMm: 45, topMm: 20, widthMm: 20, heightMm: 20 },
      20,
      20,
      { widthMm: 70, heightMm: 45 },
    )).toEqual({ leftMm: 50, topMm: 25, widthMm: 20, heightMm: 20 });
  });

  it('从左上角缩放时固定右下角并遵守最小尺寸', () => {
    expect(printArea.resizePrintArea(
      { leftMm: 10, topMm: 10, widthMm: 40, heightMm: 20 },
      'nw',
      -20,
      -20,
      { widthMm: 70, heightMm: 45 },
    )).toEqual({ leftMm: 0, topMm: 0, widthMm: 50, heightMm: 30 });

    expect(printArea.resizePrintArea(
      { leftMm: 10, topMm: 10, widthMm: 40, heightMm: 20 },
      'se',
      -100,
      -100,
      { widthMm: 70, heightMm: 45 },
    )).toEqual({ leftMm: 10, topMm: 10, widthMm: 5, heightMm: 5 });
  });
});
