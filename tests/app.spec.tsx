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
import LabelEditor from '../src/features/LabelEditor';
import { createPrintPlan } from '../src/domain/printing';
import { buildFontSizePreviewLabel } from '../src/domain/fontSizePreview';

describe('唛头打印工作台', () => {
  it('首次打开自动创建空白唛头，并可在预览内直接输入', () => {
    const html = renderToStaticMarkup(<App initialState={createInitialDraft()} />);

    expect(html).toContain('唛头打印工作台');
    expect(html).toContain('导入 Excel');
    expect(html).toContain('导入图片');
    expect(html).toContain('手动新增');
    expect(html).toContain('未填写内容');
    expect(html).toContain('aria-label="直接输入唛头内容"');
    expect(html).toContain('placeholder="在此输入唛头内容"');
    expect(html).toContain('唛头清单');
    expect(html).not.toContain('待校对');
    expect(html).not.toContain('<span>基础数量</span>');
    expect(html).toContain('张贴面数');
  });

  it('将三个工作区板块暴露为可拖动、边缘可调整大小的区域，并把历史并入来源', () => {
    const html = renderToStaticMarkup(<App initialState={createInitialDraft()} />);

    expect(html).not.toContain('aria-labelledby="history-title"');
    expect(html).toContain('使用过的唛头');
    expect(html).toContain('最近使用的唛头会保存在录入来源中');
    expect(html.match(/data-testid="panel-drag-handle"/g)).toHaveLength(3);
    expect(html.match(/class="[^"]*panel-drag-handle[^"]*"/g)).toHaveLength(3);
    expect(html.match(/role="separator"[^>]*aria-label="调整[^\"]*宽度"/g)).toHaveLength(3);
    expect(html.match(/aria-valuemin="180"/g)).toHaveLength(3);
    expect(html.match(/role="separator"[^>]*aria-label="调整[^\"]*高度"/g)).toHaveLength(3);
    expect(html).not.toContain('板块缩放比例');
    expect(html).not.toContain('向前移动');
    expect(html).not.toContain('向后移动');
    expect(html.match(/role="group"[^>]*aria-roledescription="可拖动板块"[^>]*tabindex="0"[^>]*data-panel-drag-handle/g)).toHaveLength(3);
    expect(html).not.toContain(' draggable=');
    expect(html.match(/aria-valuenow=/g)).toHaveLength(6);
    expect(html.match(/aria-label="收起[^"]*板块"/g)).toHaveLength(3);
    expect(html).toContain('恢复默认布局');
  });

  it('把全部文字工具栏紧贴尺寸与预览标题并放在预览画布之前', () => {
    const label = createLabel({ content: 'AREEN-21\n56614', quantity: 1, source: 'manual', needsReview: false });
    const state = { ...createInitialDraft(), labels: [label], activeLabelId: label.id };
    const html = renderToStaticMarkup(<App initialState={state} />);

    const previewHeading = html.indexOf('尺寸与预览');
    const textToolbar = html.indexOf('aria-label="全部文字样式"');
    const previewCanvas = html.indexOf('class="preview-stage"');

    expect(previewHeading).toBeGreaterThanOrEqual(0);
    expect(textToolbar).toBeGreaterThan(previewHeading);
    expect(previewCanvas).toBeGreaterThan(textToolbar);
  });

  it('在尺寸与预览标题中提供新增唛头入口', () => {
    const html = renderToStaticMarkup(<App initialState={createInitialDraft()} />);

    expect(html).toContain('aria-label="在尺寸与预览中新增唛头"');
    expect(html).toContain('>新增唛头</button>');
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
      ...createLabel({ content: 'FY', quantity: 1, source: 'manual', needsReview: false }),
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
    expect(html.match(/调整第 1 行文字大小/g)).toHaveLength(4);
    expect(html).toContain('text-line-frame is-active-line');
  });

  it('文字行重叠时保持内容适配字号并显示位置错误', () => {
    const label = createLabel({
      content: Array.from({ length: 9 }, (_, index) => `LONG SHIPPING MARK LINE ${index + 1}`).join('\n'),
      quantity: 1,
      source: 'image',
      needsReview: true,
    });
    label.style.fontSizePt = 12;
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
    expect(html).toContain('本行恢复正中');
    expect(html).toContain('layout-status-action');
  });
});

describe('右侧样式设置', () => {
  it('字号使用应用自有选择器，并把临时字号只应用到预览副本', () => {
    const label = createLabel({ content: 'FY-01\nMADE IN CHINA', quantity: 1, source: 'manual', needsReview: false });
    const html = renderToStaticMarkup(<SizeStylePanel
      label={label}
      presets={defaultSizePresets}
      onChange={() => undefined}
      onPresetChange={() => undefined}
      onFontSizePreview={() => undefined}
    />);

    const preview = buildFontSizePreviewLabel(label, { fontMode: 'fixed', fontSizePt: 64 });

    expect(html).toContain('aria-label="全部字号"');
    expect(html).toContain('role="combobox"');
    expect(preview).not.toBe(label);
    expect(preview.style).toMatchObject({ fontMode: 'fixed', fontSizePt: 64 });
    expect(preview.textLines.every((line) => line.style.fontSizePt === 64)).toBe(true);
    expect(label.style.fontSizePt).not.toBe(64);
  });

  it('省去重复区域标题和说明，只保留直接操作控件', () => {
    const label = createLabel({ content: 'FYF-TTT0103\n4576', quantity: 1, source: 'manual', needsReview: false });
    const html = renderToStaticMarkup(<SizeStylePanel
      label={label}
      presets={defaultSizePresets}
      onChange={() => undefined}
      onPresetChange={() => undefined}
    />);

    expect(html).toContain('aria-label="全部文字样式"');
    expect(html).not.toContain('>文字与尺寸<');
    expect(html).not.toContain('修改后覆盖预览中的全部文字');
    expect(html).toContain('全部文字强调');
  });

  it('提供直接的全部文字设置和始终可见的宽高输入', () => {
    const label = createLabel({ content: 'FYF-TTT0103\n4576', quantity: 1, source: 'manual', needsReview: false });
    const html = renderToStaticMarkup(<SizeStylePanel
      label={label}
      presets={defaultSizePresets}
      onChange={() => undefined}
      onPresetChange={() => undefined}
    />);

    expect(html).toContain('全部文字样式');
    expect(html).toContain('<span>全部字体</span>');
    expect(html).toContain('<span>全部字号</span>');
    expect(html).not.toContain('字号模式');
    expect(html).toContain('<span>自动排列方式</span>');
    expect(html).toContain('选择即应用');
    expect(html).toContain('保持当前左右位置');
    expect(html).not.toContain('全部自动排列');
    expect(html).not.toContain('<summary>');
    expect(html).toContain('宽度（mm）');
    expect(html).toContain('高度（mm）');
    expect(html).not.toContain('尺寸预设');
    expect(html).not.toContain('内边距（mm）');
    expect(html).not.toContain('内容打印区域（mm）');
    expect(html).toContain('<span>行距</span>');
    expect(html).not.toContain('<span>文字方向</span>');
    expect(html).not.toContain('<span>水平对齐</span>');
    expect(html).not.toContain('<span>垂直对齐</span>');
    expect(html).not.toContain('<span>边框粗细（mm）</span>');
    expect(html).not.toContain('placement-control');
  });

  it('当前行和选中文字样式说明修改后立即生效，不再需要应用按钮', () => {
    const label = createLabel({ content: 'FYF-TTT0103\n4576', quantity: 1, source: 'manual', needsReview: false });
    const html = renderToStaticMarkup(<LabelEditor
      label={label}
      activeLineId={label.textLines[0].id}
      onActiveLineChange={() => undefined}
      onChange={() => undefined}
      onPrintPreview={() => undefined}
      reviewErrors={[]}
      onDuplicate={() => undefined}
      onDelete={() => undefined}
    />);

    expect(html).toContain('修改后立即生效');
    expect(html).not.toContain('应用到第');
    expect(html).not.toContain('应用到选中文字');
    expect(html).toContain('打印预览');
    expect(html).not.toContain('确认校对完成');
  });

  it('尺寸区只保留可修改的宽度和高度', () => {
    const label = createLabel({ content: 'FYF-TTT0103', quantity: 1, source: 'manual', needsReview: false });
    const html = renderToStaticMarkup(<SizeStylePanel
      label={label}
      presets={defaultSizePresets}
      onChange={() => undefined}
      onPresetChange={() => undefined}
    />);

    expect(html).toContain('宽度（mm）');
    expect(html).toContain('高度（mm）');
    expect(html).not.toContain('区域左边距');
    expect(html).not.toContain('恢复默认区域');
  });
});
