import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import App from '../src/App';
import { createInitialDraft } from '../src/domain/draft';
import { createLabel, defaultSizePresets } from '../src/domain/labels';
import LabelPreview from '../src/features/LabelPreview';
import ImageCropSelector from '../src/features/ImageCropSelector';
import PrintReviewDialog, * as printReviewModule from '../src/features/PrintReviewDialog';
import PrintPages from '../src/features/PrintPages';
import SizeStylePanel from '../src/features/SizeStylePanel';
import { createPrintPlan } from '../src/domain/printing';

describe('唛头打印工作台', () => {
  it('空草稿提供三种清晰的录入入口和下一步说明', () => {
    const html = renderToStaticMarkup(<App initialState={createInitialDraft()} />);

    expect(html).toContain('唛头打印工作台');
    expect(html).toContain('导入 Excel');
    expect(html).toContain('导入图片');
    expect(html).toContain('手动新增');
    expect(html).toContain('还没有唛头');
  });
});

describe('打印检查', () => {
  it('把精确毫米尺寸写入剪贴板，并报告浏览器拒绝写入', async () => {
    const clipboard = printReviewModule as unknown as {
      copyPaperSizeToClipboard: (
        sizeLabel: string,
        writer?: { writeText: (text: string) => Promise<void> },
      ) => Promise<boolean>;
    };
    const copiedText: string[] = [];

    await expect(clipboard.copyPaperSizeToClipboard('86 × 45 mm', {
      writeText: async (text) => { copiedText.push(text); },
    })).resolves.toBe(true);
    expect(copiedText).toEqual(['86 × 45 mm']);
    await expect(clipboard.copyPaperSizeToClipboard('86 × 45 mm', {
      writeText: async () => { throw new Error('denied'); },
    })).resolves.toBe(false);
  });

  it('明确要求系统打印份数保持 1，并按基础数量乘张贴面数生成打印张数', () => {
    const label = createLabel({
      content: 'FYF-TTT0103',
      quantity: 3,
      sides: 2,
      source: 'manual',
      needsReview: false,
    });
    const plan = createPrintPlan([label], defaultSizePresets);
    const html = renderToStaticMarkup(<PrintReviewDialog
      open
      plan={plan}
      onClose={() => undefined}
      onEditLabel={() => undefined}
      onPrintGroup={() => undefined}
    />);

    expect(html).toContain('系统打印份数保持 1');
    expect(html).toContain('1 × 程序生成 6 张 = 实际打印 6 张');
  });

  it('为浏览器系统打印窗口提供精确纸张尺寸和驱动设置说明', () => {
    const label = createLabel({
      content: 'FYF-TTT0103',
      quantity: 1,
      source: 'manual',
      needsReview: false,
    });
    const plan = createPrintPlan([label], defaultSizePresets);
    const html = renderToStaticMarkup(<PrintReviewDialog
      open
      plan={plan}
      onClose={() => undefined}
      onEditLabel={() => undefined}
      onPrintGroup={() => undefined}
    />);

    expect(html).toContain('自定义纸张');
    expect(html).toContain('复制 70 × 45 mm');
    expect(html).toContain('打印机首选项');
    expect(html).toContain('缩放保持 100%');
    expect(html).toContain('不要选择 A4 或信纸代替');
  });

  it('打印输出仅保留实际纸张，非打印界面不参与浏览器分页', () => {
    const label = createLabel({
      content: 'FYF-TTT0103',
      quantity: 2,
      sides: 2,
      source: 'manual',
      needsReview: false,
    });
    const group = createPrintPlan([label], defaultSizePresets).groups[0];
    const html = renderToStaticMarkup(<PrintPages group={group} />);

    expect(html.match(/<section class="print-page"/g)).toHaveLength(4);
    expect(html).toMatch(/\.app-shell[^}]*display:\s*none\s*!important/);
    expect(html).toMatch(/\.dialog-backdrop[^}]*display:\s*none\s*!important/);
    expect(html).toMatch(/\.print-root[^}]*position:\s*static\s*!important/);
  });

  it('实际打印使用预览中设置的毫米打印区域', () => {
    const label = {
      ...createLabel({ content: 'FYF-TTT0103', quantity: 1, source: 'manual', needsReview: false }),
      printArea: { leftMm: 10, topMm: 5, widthMm: 40, heightMm: 20 },
    };
    const group = createPrintPlan([label,], defaultSizePresets).groups[0];
    const html = renderToStaticMarkup(<PrintPages group={group} />);

    expect(html).toContain('left:10mm');
    expect(html).toContain('top:5mm');
    expect(html).toContain('width:40mm');
    expect(html).toContain('height:20mm');
  });
});

describe('图片识别区域', () => {
  it('提供可视框选和精确数值输入作为非拖动操作', () => {
    const html = renderToStaticMarkup(<ImageCropSelector
      previewUrl="data:image/png;base64,AA=="
      fileName="mark.png"
      selection={{ xPercent: 10, yPercent: 20, widthPercent: 60, heightPercent: 40 }}
      onChange={() => undefined}
      onImageSize={() => undefined}
    />);

    expect(html).toContain('选择识别区域');
    expect(html).toContain('框选宽度（%）');
    expect(html).toContain('重新选择整张图片');
    expect(html).toContain('“唛头”同列下方或同行右侧');
    expect(html).toContain('去除其他标点与短噪声');
  });
});

describe('逐行预览', () => {
  it('每一行都渲染成独立可拖动对象', () => {
    const label = createLabel({ content: 'FY-01\nMADE IN CHINA', quantity: 1, source: 'manual', needsReview: false });
    const html = renderToStaticMarkup(<LabelPreview
      label={label}
      preset={defaultSizePresets[0]}
      activeLineId={label.textLines[0].id}
      onActiveLineChange={() => undefined}
      onChange={() => undefined}
    />);

    expect(html.match(/拖动第 \d 行/g)).toHaveLength(2);
    expect(html).toContain('aria-pressed="true"');
    expect(html.match(/white-space:nowrap/g)).toHaveLength(2);
  });

  it('文字行重叠时保持内容适配字号并显示位置错误', () => {
    const label = createLabel({
      content: Array.from({ length: 9 }, (_, index) => `LONG SHIPPING MARK LINE ${index + 1}`).join('\n'),
      quantity: 1,
      source: 'image',
      needsReview: true,
    });
    const preset = defaultSizePresets.find((item) => item.id === 'small')!;
    const html = renderToStaticMarkup(<LabelPreview
      label={label}
      preset={preset}
      activeLineId={label.textLines[0].id}
      onActiveLineChange={() => undefined}
      onChange={() => undefined}
    />);

    expect(html).toContain('font-size:16px');
    expect(html).toContain('文字行发生重叠');
  });

  it('提供整体拖动和八方向缩放打印区域的语义控件', () => {
    const label = createLabel({ content: 'FY-01', quantity: 1, source: 'manual', needsReview: false });
    const html = renderToStaticMarkup(<LabelPreview
      label={label}
      preset={defaultSizePresets[0]}
      activeLineId={label.textLines[0].id}
      onActiveLineChange={() => undefined}
      onChange={() => undefined}
    />);

    expect(html).toContain('拖动内容打印区域');
    expect(html.match(/调整打印区域/g)).toHaveLength(8);
  });
});

describe('右侧样式设置', () => {
  it('尺寸设置后只保留行距，不再重复整单文字样式', () => {
    const label = createLabel({ content: 'FYF-TTT0103\n4576', quantity: 1, source: 'manual', needsReview: false });
    const html = renderToStaticMarkup(<SizeStylePanel
      label={label}
      presets={defaultSizePresets}
      onChange={() => undefined}
      onPresetChange={() => undefined}
      onCreatePreset={() => undefined}
      recentSizes={[]}
      onUseRecent={() => undefined}
      onRememberSize={() => undefined}
      activeLine={label.textLines[0]}
      onLineChange={() => undefined}
    />);

    expect(html).toContain('<span>行距</span>');
    expect(html).not.toContain('<span>文字方向</span>');
    expect(html).not.toContain('<span>字体</span>');
    expect(html).not.toContain('<span>字号模式</span>');
    expect(html).not.toContain('<span>固定字号（pt）</span>');
    expect(html).not.toContain('<span>水平对齐</span>');
    expect(html).not.toContain('<span>垂直对齐</span>');
    expect(html).not.toContain('<span>边框粗细（mm）</span>');
  });

  it('提供毫米数值输入和恢复默认作为拖动替代操作', () => {
    const label = createLabel({ content: 'FYF-TTT0103', quantity: 1, source: 'manual', needsReview: false });
    const html = renderToStaticMarkup(<SizeStylePanel
      label={label}
      presets={defaultSizePresets}
      onChange={() => undefined}
      onPresetChange={() => undefined}
      onCreatePreset={() => undefined}
      recentSizes={[]}
      onUseRecent={() => undefined}
      onRememberSize={() => undefined}
      activeLine={label.textLines[0]}
      onLineChange={() => undefined}
    />);

    expect(html).toContain('内容打印区域（mm）');
    expect(html).toContain('区域左边距');
    expect(html).toContain('区域上边距');
    expect(html).toContain('区域宽度');
    expect(html).toContain('区域高度');
    expect(html).toContain('恢复默认区域');
  });
});
