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
    ]);
  });

  it('keeps fixed-size overflow printable without adding a blocker', () => {
    const label = createLabel({
      content: 'VERY-LONG-SHIPPING-MARK-THAT-OVERFLOWS',
      quantity: 1,
      source: 'manual',
      needsReview: false,
      sizePresetId: 'small',
    });
    label.style.fontSizePt = 300;

    const plan = createPrintPlan([label], defaultSizePresets);

    expect(plan.blockers).toEqual([]);
    expect(plan.groups).toHaveLength(1);
    expect(plan.totalCopies).toBe(1);
  });

  it('blocks labels that reference a missing or invalid size preset', () => {
    const label = createLabel({ content: 'A', quantity: 1, source: 'manual', needsReview: false, sizePresetId: 'missing' });
    expect(createPrintPlan([label], defaultSizePresets).blockers[0].reasons).toEqual(['找不到对应的尺寸预设']);

    const invalid = [{ ...defaultSizePresets[0], widthMm: 0 }];
    const label2 = createLabel({ content: 'B', quantity: 1, source: 'manual', needsReview: false, sizePresetId: 'large' });
    expect(createPrintPlan([label2], invalid).blockers[0].reasons).toContain('宽度必须在 20–300 mm 之间');
  });

  it('blocks a label before expanding more than 1000 print pages', () => {
    const label = createLabel({
      content: 'TOO MANY',
      quantity: 1001,
      source: 'manual',
      needsReview: false,
      sizePresetId: 'small',
    });

    const plan = createPrintPlan([label], defaultSizePresets);

    expect(plan.groups).toEqual([]);
    expect(plan.totalCopies).toBe(0);
    expect(plan.blockers[0].reasons).toContain('单条唛头最多打印 1000 张');
  });

  it('never expands more than 5000 print pages for one plan', () => {
    const labels = Array.from({ length: 6 }, (_, index) =>
      createLabel({
        content: `BATCH-${index + 1}`,
        quantity: 1000,
        source: 'manual',
        needsReview: false,
        sizePresetId: 'small',
      }),
    );

    const plan = createPrintPlan(labels, defaultSizePresets);

    expect(plan.totalCopies).toBe(5000);
    expect(plan.blockers).toHaveLength(1);
    expect(plan.blockers[0].reasons).toContain('本次打印总张数不能超过 5000 张');
  });
});
