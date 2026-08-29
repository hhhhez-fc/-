import { describe, expect, it } from 'vitest';
import { createLabel, defaultSizePresets } from '../src/domain/labels';
import { createPrintPlan } from '../src/domain/printing';

describe('print planning', () => {
  it('groups labels by exact millimeter size and expands copies', () => {
    const small = createLabel({ content: 'SMALL', quantity: 2, sides: 2, source: 'manual', needsReview: false, sizePresetId: 'small' });
    const large = createLabel({ content: 'LARGE', quantity: 1, sides: 1, source: 'manual', needsReview: false, sizePresetId: 'large' });

    const plan = createPrintPlan([small, large], defaultSizePresets);

    expect(plan.blockers).toEqual([]);
    expect(plan.groups.map((group) => ({ size: group.sizeLabel, copies: group.pages.length }))).toEqual([
      { size: '70 × 45 mm', copies: 4 },
      { size: '100 × 60 mm', copies: 1 },
    ]);
    expect(plan.totalCopies).toBe(5);
  });

  it('reports the record and every reason that blocks printing', () => {
    const label = createLabel({ content: '', quantity: 0, source: 'manual', needsReview: true, sizePresetId: 'small' });

    const plan = createPrintPlan([label], defaultSizePresets);

    expect(plan.groups).toEqual([]);
    expect(plan.blockers[0]).toMatchObject({ labelId: label.id, labelNumber: 1 });
    expect(plan.blockers[0].reasons).toEqual([
      '唛头内容不能为空',
      '打印数量必须是正整数',
      '该唛头尚未完成校对',
    ]);
  });

  it('blocks labels that reference a missing or invalid size preset', () => {
    const label = createLabel({ content: 'A', quantity: 1, source: 'manual', needsReview: false, sizePresetId: 'missing' });
    expect(createPrintPlan([label], defaultSizePresets).blockers[0].reasons).toEqual(['找不到对应的尺寸预设']);

    const invalid = [{ ...defaultSizePresets[0], widthMm: 0 }];
    const label2 = createLabel({ content: 'B', quantity: 1, source: 'manual', needsReview: false, sizePresetId: 'large' });
    expect(createPrintPlan([label2], invalid).blockers[0].reasons).toContain('宽度必须在 20–300 mm 之间');
  });
});
