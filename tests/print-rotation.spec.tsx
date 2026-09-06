// @vitest-environment jsdom

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createLabel, defaultSizePresets } from '../src/domain/labels';
import { nextPrintRotation } from '../src/domain/printRotation';
import { createPrintPlan } from '../src/domain/printing';
import PrintPages from '../src/features/PrintPages';
import PrintLabelThumbnail from '../src/features/PrintLabelThumbnail';
import PrintReviewDialog from '../src/features/PrintReviewDialog';

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

  it('实际打印将两行唛头作为一个整体旋转且字号不变', () => {
    const created = textLabel('1546\n4548');
    const label = {
      ...created,
      textLines: created.textLines.map((line) => ({ ...line, style: { ...line.style, fontSizePt: 12 } })),
    };
    const group = createPrintPlan([label], defaultSizePresets).groups[0];
    const html = renderToStaticMarkup(<PrintPages group={group} rotations={{ [label.id]: 90 }} />);

    expect(html).toContain(`@page { size: ${group.widthMm}mm ${group.heightMm}mm; margin: 0; }`);
    expect(html).toContain(`width:${group.widthMm}mm`);
    expect(html).toContain(`height:${group.heightMm}mm`);
    expect(html).not.toContain(`size: ${group.heightMm}mm ${group.widthMm}mm`);
    expect(html.match(/class="print-positioned-text"/g)).toHaveLength(2);
    expect(html).not.toContain('class="print-rotated-character"');
    expect(html.match(/class="print-text-layer"/g)).toHaveLength(1);
    expect(html.match(/rotate\(90deg\)/g)).toHaveLength(1);
    expect(html).toContain('transform-origin:center');
    expect(html).toContain('transform:translate(-50%, -50%)');
    expect(html).not.toContain('transform:translate(-50%, -50%) rotate(90deg)');
    expect(html).not.toContain('scale(');
    expect(html.match(/font-size:12pt/g)).toHaveLength(2);
    expect(html).toContain(`left:${label.textLines[0].placement.xPercent}%`);
    expect(html).toContain(`top:${label.textLines[0].placement.yPercent}%`);
    expect(html).toContain(`left:${label.textLines[1].placement.xPercent}%`);
    expect(html).toContain(`top:${label.textLines[1].placement.yPercent}%`);
    expect(html.match(/transform:translate\(-50%, -50%\)/g)).toHaveLength(2);
    expect(html.match(/<section class="print-page"/g)).toHaveLength(1);
  });

  it('旋转后不缩小文字并保持该组可打印', () => {
    const label = textLabel('MMMMMM');
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

    expect(html).not.toContain('class="print-rotated-character"');
    expect(html.match(/rotate\(90deg\)/g)).toHaveLength(1);
    expect(html).not.toContain('transform:translate(-50%, -50%) rotate(90deg)');
    expect(html).not.toContain('scale(');
    expect(html).toContain('输出纸张 70 × 45 mm');
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>打印这一组<\/button>/);
    expect(html).toContain('共 1 张，可以打印');
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

  it('缩略图保持原纸张比例，并像实际打印一样整体旋转两行唛头', () => {
    const created = textLabel('1546\n4548');
    const label = {
      ...created,
      textLines: created.textLines.map((line) => ({ ...line, style: { ...line.style, fontSizePt: 12 } })),
    };
    const html = renderToStaticMarkup(<PrintLabelThumbnail
      label={label}
      preset={defaultSizePresets[1]}
      rotation={90}
    />);

    expect(html.match(/class="print-label-thumbnail-text"/g)).toHaveLength(2);
    expect(html).toContain('class="print-label-thumbnail-content"');
    expect(html).toContain('overflow:visible');
    expect(html).not.toContain('class="print-rotated-character"');
    expect(html.match(/class="print-text-layer"/g)).toHaveLength(1);
    expect(html.match(/rotate\(90deg\)/g)).toHaveLength(1);
    expect(html).toContain('aspect-ratio:70 / 45');
    expect(html).not.toContain('scale(');
    expect(html.match(/transform:translate\(-50%, -50%\)/g)).toHaveLength(2);
    expect(html).not.toContain('transform:translate(-50%, -50%) rotate(90deg)');
  });
});
