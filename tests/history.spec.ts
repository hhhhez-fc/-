import { describe, expect, it } from 'vitest';
import {
  hydrateRecentLabels,
  recordRecentLabels,
  restoreRecentLabel,
  type RecentLabelInput,
} from '../src/domain/history';
import { createLabel, defaultSizePresets } from '../src/domain/labels';

const historyInput = (content: string): RecentLabelInput => ({
  label: createLabel({ content, quantity: 1, source: 'manual', needsReview: false }),
  preset: { ...defaultSizePresets[0] },
});

describe('最近预览历史', () => {
  it('相同快照去重移到最前，并最多保留 20 条', () => {
    const inputs = Array.from({ length: 21 }, (_, index) => historyInput(`LABEL-${index}`));
    const first = recordRecentLabels([], inputs, 1000);

    expect(first).toHaveLength(20);
    expect(first[0].label.content).toBe('LABEL-20');
    const repeated = recordRecentLabels(first, [historyInput('LABEL-5')], 2000);
    expect(repeated).toHaveLength(20);
    expect(repeated[0].label.content).toBe('LABEL-5');
    expect(repeated[0].previewedAt).toBe(2000);
    expect(repeated.filter((entry) => entry.label.content === 'LABEL-5')).toHaveLength(1);
  });

  it('快照深拷贝标签、文字行、样式和尺寸预设', () => {
    const input = historyInput('A\nB');
    input.label.textLines[0].style = { fontSizePt: 22 };
    const entry = recordRecentLabels([], [input], 1000)[0];

    input.label.style.fontSizePt = 99;
    input.label.textLines[0].style.fontSizePt = 88;
    input.label.textLines[0].placement.xPercent = 1;
    input.preset.widthMm = 222;

    expect(entry.label.style.fontSizePt).not.toBe(99);
    expect(entry.label.textLines[0].style.fontSizePt).toBe(22);
    expect(entry.label.textLines[0].placement.xPercent).not.toBe(1);
    expect(entry.preset.widthMm).toBe(defaultSizePresets[0].widthMm);
  });

  it('再次使用会重建唛头和文字行 ID', () => {
    const entry = recordRecentLabels([], [historyInput('A\nB')], 1000)[0];
    const restored = restoreRecentLabel(entry);

    expect(restored.label.id).not.toBe(entry.label.id);
    expect(restored.label.textLines.map((line) => line.id)).not.toEqual(entry.label.textLines.map((line) => line.id));
    expect(restored.preset).toEqual(entry.preset);
    expect(restored.preset).not.toBe(entry.preset);
  });

  it('读取时过滤损坏条目和没有回退图像的图片条目', () => {
    const valid = recordRecentLabels([], [historyInput('VALID')], 1000)[0];
    const imageWithoutFallback = recordRecentLabels([], [{
      label: createLabel({
        content: 'photo.png',
        quantity: 1,
        source: 'image',
        contentType: 'image',
        needsReview: false,
      }),
      preset: { ...defaultSizePresets[0] },
    }], 1000);

    expect(imageWithoutFallback).toEqual([]);
    expect(hydrateRecentLabels([
      valid,
      { ...valid, id: '', signature: '' },
      { ...valid, previewedAt: Number.NaN },
      { ...valid, previewedAt: -1 },
      { ...valid, preset: { ...valid.preset, widthMm: 999 } },
      { bad: true },
    ])).toEqual([valid]);
  });

  it('损坏项不会挤掉排在后面的合法历史', () => {
    const valid = recordRecentLabels([], [historyInput('VALID-AFTER-DAMAGE')], 1000)[0];

    expect(hydrateRecentLabels([
      ...Array.from({ length: 20 }, () => ({ bad: true })),
      valid,
    ])).toEqual([valid]);
  });
});
