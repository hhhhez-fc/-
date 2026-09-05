// @vitest-environment jsdom

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createLabel, defaultSizePresets, type TextPlacement } from '../src/domain/labels';
import { nextPrintRotation, rotationTransform } from '../src/domain/printRotation';
import { createPrintPlan } from '../src/domain/printing';
import PrintPages from '../src/features/PrintPages';
import PrintLabelThumbnail from '../src/features/PrintLabelThumbnail';
import PrintReviewDialog from '../src/features/PrintReviewDialog';

const centerPlacement: TextPlacement = {
  xPercent: 50,
  yPercent: 50,
  horizontalSnap: 'center',
  verticalSnap: 'middle',
};

const textLabel = (content: string, quantity = 1) => createLabel({
  content,
  quantity,
  source: 'manual',
  needsReview: false,
});

describe('打印文字旋转', () => {
  it('每次增加 90 度并在 270 度后回到 0 度', () => {
    expect([
      nextPrintRotation(0),
      nextPrintRotation(90),
      nextPrintRotation(180),
      nextPrintRotation(270),
    ]).toEqual([90, 180, 270, 0]);
  });

  it('保留吸附点平移并把旋转追加在变换末尾', () => {
    const cases: Array<[TextPlacement, 90 | 270, string]> = [
      [{ ...centerPlacement, horizontalSnap: 'left', verticalSnap: 'top' }, 90, 'translate(0%, 0%) rotate(90deg)'],
      [{ ...centerPlacement, horizontalSnap: 'right', verticalSnap: 'bottom' }, 90, 'translate(-100%, -100%) rotate(90deg)'],
      [{ ...centerPlacement, horizontalSnap: 'left', verticalSnap: 'bottom' }, 270, 'translate(0%, -100%) rotate(270deg)'],
      [{ ...centerPlacement, horizontalSnap: 'right', verticalSnap: 'top' }, 270, 'translate(-100%, 0%) rotate(270deg)'],
    ];

    expect(cases.map(([placement, rotation]) => rotationTransform(placement, rotation)))
      .toEqual(cases.map(([, , expected]) => expected));
    expect(rotationTransform(centerPlacement, 90)).toBe('translate(-50%, -50%) rotate(90deg)');
  });

  it('为每个不同文字唛头显示一个缩略图和唯一旋转控制，图片不显示旋转按钮', () => {
    const first = textLabel('A', 2);
    const second = textLabel('B');
    const image = createLabel({
      content: 'IMAGE',
      contentType: 'image',
      imageFallback: 'data:image/png;base64,AA==',
      quantity: 1,
      source: 'image',
      needsReview: false,
    });
    const plan = createPrintPlan([first, second, image], defaultSizePresets);
    const html = renderToStaticMarkup(<PrintReviewDialog
      open
      plan={plan}
      rotations={{ [first.id]: 90 }}
      onRotateLabel={() => undefined}
      onClose={() => undefined}
      onEditLabel={() => undefined}
      onPrintGroup={() => undefined}
    />);

    expect(html.match(/class="print-label-thumbnail"/g)).toHaveLength(3);
    expect(html.match(/>旋转 90°<\/button>/g)).toHaveLength(2);
    expect(html).toContain(`aria-label="旋转 70 × 45 mm 第 1 个文字唛头 A 90°"`);
    expect(html).toContain(`aria-label="旋转 70 × 45 mm 第 2 个文字唛头 B 90°"`);
    expect(html).toContain('当前 90°');
    expect(html).not.toContain('旋转第 3 个文字唛头');
  });

  it('实际打印旋转文字但保持纸张宽高顺序不变', () => {
    const label = textLabel('A');
    const group = createPrintPlan([label], defaultSizePresets).groups[0];
    const html = renderToStaticMarkup(<PrintPages group={group} rotations={{ [label.id]: 90 }} />);

    expect(html).toContain(`@page { size: ${group.widthMm}mm ${group.heightMm}mm; margin: 0; }`);
    expect(html).toContain('transform:translate(-50%, -50%) rotate(90deg)');
  });

  it('旋转后最小字号仍溢出时显示原因并禁止打印该组', () => {
    const label = textLabel('MMMMMMMMMMMMMMM');
    const plan = createPrintPlan([label], defaultSizePresets);
    expect(plan.blockers).toEqual([]);
    const html = renderToStaticMarkup(<PrintReviewDialog
      open
      plan={plan}
      rotations={{ [label.id]: 90 }}
      onRotateLabel={() => undefined}
      onClose={() => undefined}
      onEditLabel={() => undefined}
      onPrintGroup={() => undefined}
    />);

    expect(html).toContain('内容在最小字号下仍无法完整显示');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>打印这一组<\/button>/);
    expect(html).toContain('旋转后内容需要调整');
    expect(html).not.toContain('可以打印');
  });

  it('不同尺寸组使用重复摘要时仍提供全局唯一的旋转名称', () => {
    const small = textLabel('SAME');
    const large = createLabel({
      content: 'SAME', quantity: 1, source: 'manual', sizePresetId: 'large', needsReview: false,
    });
    const plan = createPrintPlan([small, large], defaultSizePresets);
    const html = renderToStaticMarkup(<PrintReviewDialog
      open
      plan={plan}
      rotations={{}}
      onRotateLabel={() => undefined}
      onClose={() => undefined}
      onEditLabel={() => undefined}
      onPrintGroup={() => undefined}
    />);

    expect(html).toContain('aria-label="旋转 70 × 45 mm 第 1 个文字唛头 SAME 90°"');
    expect(html).toContain('aria-label="旋转 100 × 60 mm 第 1 个文字唛头 SAME 90°"');
  });

  it('缩略纸张在窄屏堆叠后仍固定使用与字体计算一致的 150px 宽度', () => {
    const label = textLabel('A');
    const html = renderToStaticMarkup(<PrintLabelThumbnail
      label={label}
      preset={defaultSizePresets[1]}
      rotation={0}
    />);

    expect(html).toContain('class="print-label-thumbnail"');
    expect(html).toContain('width:150px');
    expect(html).toContain('aspect-ratio:70 / 45');
  });
});
