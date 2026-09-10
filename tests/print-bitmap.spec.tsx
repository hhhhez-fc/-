// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { toPng } from 'html-to-image';
import { render, waitFor } from '@testing-library/react';
import { cloneNode } from 'html-to-image/lib/clone-node';
import { createLabel, defaultSizePresets, type SizePreset } from '../src/domain/labels';
import PrintTextLayer from '../src/features/PrintTextLayer';
import PrintBitmapSurface from '../src/features/PrintBitmapSurface';
import PrintBitmapPreview from '../src/features/PrintBitmapPreview';
import { renderPrintAsset } from '../src/services/printBitmapRenderer';

vi.mock('html-to-image', () => ({ toPng: vi.fn() }));
// Valid 800×600 one-bit white PNG, generated independently with zlib + PNG CRCs.
const PNG = [
  'iVBORw0KGgoAAAANSUhEUgAAAyAAAAJYAQAAAACyDb/dAAAA6ElEQVR4nO3NMQEA',
  'AAwCIPuX1hbbAwVID0QikUgkEolEIpFIJBKJRCKRSCQSiUQikUgkEolEIpFIJBKJ',
  'RCKRSCQSiUQikUgkEolEIpFIJBKJRCKRSCQSiUQikUgkEolEIpFIJBKJRCKRSCQS',
  'iUQikUgkEolEIpFIJBKJRCKRSCQSiUQikUgkEolEIpFIJBKJRCKRSCQSiUQikUgk',
  'EolEIpFIJBKJRCKRSCQSiUQikUgkEolEIpFIJBKJRCKRSCQSiUQikUgkEolEIpFI',
  'JBKJRCKRSCQSiUQikUgkEolEIpFIJBKJRCL5TQZi5oNI3Iui0QAAAABJRU5ErkJg',
  'gg==',
].join('');
const HASH = 'c2b1a5619dac25e4c1bc6ab24a2ad94cc547b4fac43e4b7293ea17e8eb05f968';

const preset: SizePreset = { ...defaultSizePresets[0], widthMm: 100, heightMm: 75 };
const makePage = () => ({
  label: createLabel({
    content: 'meche\n08065289076', quantity: 1, source: 'manual', needsReview: false,
    style: { ...createLabel({ content: '', quantity: 1, source: 'manual', needsReview: false }).style,
      fontMode: 'fixed', fontSizePt: 12 },
  }),
  preset,
  copyNumber: 1,
});

describe('位图捕获与打印资产', () => {
  const fontCheck = vi.fn(() => true);
  beforeEach(() => {
    vi.stubGlobal('crypto', webcrypto);
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: Promise.resolve(), check: fontCheck } });
    fontCheck.mockReset().mockReturnValue(true);
    vi.mocked(toPng).mockReset().mockResolvedValue(`data:image/png;base64,${PNG}`);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute('data-print-bitmap-surface')
        ? new DOMRect(0, 0, 800, 600) : new DOMRect(100, 100, 200, 40);
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
      font: '',
      measureText(this: { font: string }) {
        return { width: this.font.includes('Installed Face') ? 120 : this.font.includes('monospace') ? 80 : 100 };
      },
    }) as unknown as CanvasRenderingContext2D);
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('以精确尺寸捕获，并对真实解码字节计算 SHA-256；相同页面稳定且清理临时 DOM', async () => {
    const input = { page: makePage(), layout: 'landscape' as const, rotation: 0 as const, threshold: { mode: 'text' as const } };
    const first = await renderPrintAsset(input);
    expect(first).toEqual({ assetId: expect.stringMatching(/^asset-[a-f0-9]{64}$/), labelId: input.page.label.id,
      widthDots: 800, heightDots: 600, rotation: 0, pngBase64: PNG, sha256: HASH });
    expect(await renderPrintAsset(input)).toEqual(first);
    expect(toPng).toHaveBeenCalledWith(expect.any(HTMLElement), {
      width: 800, height: 600, canvasWidth: 800, canvasHeight: 600,
      pixelRatio: 1, backgroundColor: 'white', cacheBust: false, skipFonts: true,
      includeStyleProperties: expect.any(Array),
    });
    expect(vi.mocked(toPng).mock.calls[0][1]!.includeStyleProperties).not.toContain('font-size');
    expect(document.querySelector('[data-print-bitmap-host]')).toBeNull();
    expect((await renderPrintAsset({ ...input, horizontalOffsetMm: 1 })).assetId).not.toBe(first.assetId);
    expect((await renderPrintAsset({ ...input, threshold: { mode: 'custom', value: 128 } })).assetId).not.toBe(first.assetId);
    expect((await renderPrintAsset({ ...input, page: { ...input.page, copyNumber: 2 } })).assetId).toBe(first.assetId);
    const otherLabel = { ...input.page.label, id: 'same-pixels-different-label' };
    expect((await renderPrintAsset({ ...input, page: { ...input.page, label: otherLabel } })).assetId).not.toBe(first.assetId);
  });

  it('真实 html-to-image 克隆路径保留分数字号及继承字号，不执行库内字体取整', async () => {
    const getComputed = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
      const style = getComputed(element);
      // Chrome's computed CSS declaration takes the cssText-empty copy-properties branch.
      return new Proxy(style, { get(target, property) {
        if (property === 'cssText') return '';
        if (property === 'getPropertyValue') return (name: string) => pseudo && name === 'content' ? 'none' : target.getPropertyValue(name);
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      } });
    });
    const page = makePage();
    page.label.textStyleRanges = [{ start: 0, end: 2, style: { fontSizePt: 18 } }];
    document.documentElement.style.fontSize = '16px';
    try {
      vi.mocked(toPng).mockImplementation(async (surface, options) => {
        const cloned = await cloneNode(surface, options!, true) as HTMLElement;
        const sourceLines = [...surface.querySelectorAll<HTMLElement>('.print-bitmap-text')];
        const clonedLines = [...cloned.querySelectorAll<HTMLElement>('.print-bitmap-text')];
        expect(clonedLines.map((line) => line.style.fontSize)).toEqual(sourceLines.map((line) => line.style.fontSize));
        expect(clonedLines[0].querySelector<HTMLElement>('span')!.style.fontSize)
          .toBe(sourceLines[0].querySelector<HTMLElement>('span')!.style.fontSize);
        // Unstyled leaf text must inherit the exact inline size from the physical line.
        const leaf = clonedLines[1].querySelector<HTMLElement>('span')!;
        expect(leaf.style.fontSize).toBe('');
        expect(parseFloat(clonedLines[1].style.fontSize)).toBeCloseTo(33.8666666667, 8);
        return `data:image/png;base64,${PNG}`;
      });
      await renderPrintAsset({ page, layout: 'landscape', rotation: 0, threshold: { mode: 'text' } });
    } finally { document.documentElement.style.removeProperty('font-size'); }
  });

  it('等待字体就绪后才捕获，不采用定时延迟', async () => {
    let ready!: () => void;
    Object.defineProperty(document, 'fonts', { value: { ready: new Promise<void>((resolve) => { ready = resolve; }), check: fontCheck } });
    const pending = renderPrintAsset({ page: makePage(), layout: 'portrait', rotation: 90, threshold: { mode: 'auto' } });
    await Promise.resolve();
    expect(toPng).not.toHaveBeenCalled();
    ready();
    expect((await pending).rotation).toBe(90);
  });

  it('字体未就绪、缺失的显式字体或局部字体均阻止生成资产并清理 DOM', async () => {
    const page = makePage();
    page.label.style.fontFamily = 'Missing Face';
    await expect(renderPrintAsset({ page, layout: 'landscape', rotation: 0, threshold: { mode: 'text' } })).rejects.toThrow(/字体.*不可用/);
    page.label.style.fontFamily = 'sans-serif';
    page.label.textStyleRanges = [{ start: 0, end: 2, style: { fontFamily: 'Missing Face' } }];
    await expect(renderPrintAsset({ page, layout: 'landscape', rotation: 0, threshold: { mode: 'text' } })).rejects.toThrow(/字体.*不可用/);
    Object.defineProperty(document, 'fonts', { value: { ready: Promise.reject(new Error('load failed')), check: fontCheck } });
    await expect(renderPrintAsset({ page, layout: 'landscape', rotation: 0, threshold: { mode: 'text' } })).rejects.toThrow(/字体.*就绪/);
    expect(toPng).not.toHaveBeenCalled();
    expect(document.querySelector('[data-print-bitmap-host]')).toBeNull();
  });

  it('系统回退字体栈中至少一个可用字体即可打印，单个真实可用字体也通过', async () => {
    const page = makePage();
    page.label.style.fontFamily = 'Missing Face, sans-serif';
    await expect(renderPrintAsset({ page, layout: 'landscape', rotation: 0, threshold: { mode: 'text' } })).resolves.toMatchObject({ sha256: HASH });
    page.label.style.fontFamily = 'Installed Face';
    await expect(renderPrintAsset({ page, layout: 'landscape', rotation: 0, threshold: { mode: 'text' } })).resolves.toMatchObject({ sha256: HASH });
  });

  it('只在内容越过实体纸边时阻止，不把内部定位框当成裁剪边界', async () => {
    const input = { page: makePage(), layout: 'landscape' as const, rotation: 270 as const, threshold: { mode: 'text' as const } };
    input.page.label.printArea = { leftMm: 40, topMm: 15, widthMm: 10, heightMm: 60 };
    await expect(renderPrintAsset(input)).resolves.toMatchObject({ sha256: HASH });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute('data-print-bitmap-surface')
        ? new DOMRect(0, 0, 800, 600) : new DOMRect(790, 100, 20, 40);
    });
    await expect(renderPrintAsset(input)).rejects.toThrow(/超出.*纸张/);
    expect(document.querySelector('[data-print-bitmap-host]')).toBeNull();
  });

  it.each([
    { name: '竖向布局接受 400×800 图片旋转后的 600×300 内容', layout: 'portrait' as const, x: 0, y: 0, pixels: [100, 150, 600, 300], fits: true },
    { name: '偏移后仅 letterbox 越纸仍接受', layout: 'portrait' as const, x: 10, y: 1, pixels: [180, 158, 600, 300], fits: true },
    { name: '真正像素越纸时拒绝', layout: 'landscape' as const, x: 0, y: 1, pixels: [250, 8, 300, 600], fits: false },
  ])('$name，测量标记在完成或失败后均移除', async ({ layout, x, y, pixels, fits }) => {
    const page = makePage();
    page.label.contentType = 'image';
    page.label.imageFallback = `data:image/png;base64,${PNG}`;
    const originalDecode = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'decode');
    Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, value: async () => undefined });
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(400);
    vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
    const markers: HTMLElement[] = [];
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute('data-print-bitmap-surface')) return new DOMRect(0, 0, 800, 600);
      if (this.hasAttribute('data-bitmap-content-measure')) {
        markers.push(this);
        expect([this.style.left, this.style.top, this.style.width, this.style.height]).toEqual(['250px', '0px', '300px', '600px']);
        expect(this.parentElement).toBe(document.querySelector('[data-bitmap-image]')!.parentElement);
        expect(this.closest<HTMLElement>('[data-bitmap-layout]')!.style.transform)
          .toBe(`translate(-50%, -50%) rotate(${layout === 'portrait' ? 90 : 0}deg)`);
        expect(this.closest<HTMLElement>('[data-bitmap-offset]')!.style.transform).toBe(`translate(${x * 8}px, ${y * 8}px)`);
        // The browser supplies final transformed DOM bounds; jsdom has no layout engine.
        return new DOMRect(...pixels);
      }
      // Full image element box contains letterbox whitespace that crosses the label edge.
      return layout === 'portrait' ? new DOMRect(100 + x * 8, -100 + y * 8, 600, 800) : new DOMRect(0, 8, 800, 600);
    });
    vi.mocked(toPng).mockImplementation(async (surface) => {
      expect(surface.querySelector('[data-bitmap-content-measure]')).toBeNull();
      return `data:image/png;base64,${PNG}`;
    });
    try {
      const pending = renderPrintAsset({ page, layout, rotation: 0, horizontalOffsetMm: x, verticalOffsetMm: y, threshold: { mode: 'text' } });
      if (fits) await expect(pending).resolves.toMatchObject({ sha256: HASH });
      else await expect(pending).rejects.toThrow(/超出.*纸张/);
      expect(markers).toHaveLength(1);
      expect(markers.every((marker) => !marker.isConnected)).toBe(true);
      expect(document.querySelector('[data-bitmap-content-measure]')).toBeNull();
    } finally {
      if (originalDecode) Object.defineProperty(HTMLImageElement.prototype, 'decode', originalDecode);
      else Reflect.deleteProperty(HTMLImageElement.prototype, 'decode');
    }
  });

  it.each(['data:image/jpeg;base64,AA==', 'data:image/png;base64,!!!!', 'data:image/png;base64,AA==',
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEF8AAAAASUVORK5CYII='])
  ('拒绝非 PNG、无效 Base64、损坏图片及尺寸不符结果 %s', async (result) => {
    vi.mocked(toPng).mockResolvedValue(result);
    await expect(renderPrintAsset({ page: makePage(), layout: 'landscape', rotation: 0, threshold: { mode: 'text' } })).rejects.toThrow(/PNG|800/);
    expect(document.querySelector('[data-print-bitmap-host]')).toBeNull();
  });

  it.each([{ offsetMm: 0, fits: true }, { offsetMm: 0.01, fits: false }])
  ('保留 .06/99.94 mm 区域的小数点几何，额外偏移 $offsetMm mm 时按真实边缘判定', async ({ offsetMm, fits }) => {
    const page = makePage();
    page.label.contentType = 'image';
    page.label.imageFallback = `data:image/png;base64,${PNG}`;
    page.label.printArea = { leftMm: 0.06, topMm: 0, widthMm: 99.94, heightMm: 75 };
    const originalDecode = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'decode');
    Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, value: async () => undefined });
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(800);
    vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(600);
    // Real browsers round these properties, so they must not be used for physical geometry.
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
    const markers: HTMLElement[] = [];
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute('data-print-bitmap-surface')) return new DOMRect(0, 0, 800, 600);
      if (this.hasAttribute('data-bitmap-content-measure')) {
        markers.push(this);
        const parent = this.parentElement!;
        return new DOMRect(parseFloat(parent.style.left) + parseFloat(this.style.left) + offsetMm * 8,
          parseFloat(parent.style.top) + parseFloat(this.style.top), parseFloat(this.style.width), parseFloat(this.style.height));
      }
      return new DOMRect(0.48, 0, 799.52, 600);
    });
    try {
      const pending = renderPrintAsset({ page, layout: 'landscape', rotation: 0, horizontalOffsetMm: offsetMm, threshold: { mode: 'text' } });
      if (fits) await expect(pending).resolves.toMatchObject({ sha256: HASH });
      else await expect(pending).rejects.toThrow(/超出.*纸张/);
      expect(markers).toHaveLength(1);
      expect(parseFloat(markers[0].style.width)).toBeCloseTo(799.52, 8);
      expect(parseFloat(markers[0].style.height)).toBeCloseTo(599.64, 8);
      expect(parseFloat(markers[0].style.left)).toBe(0);
      expect(parseFloat(markers[0].style.top)).toBeCloseTo(0.18, 8);
      expect(markers[0].isConnected).toBe(false);
      expect(document.querySelector('[data-bitmap-content-measure]')).toBeNull();
    } finally {
      if (originalDecode) Object.defineProperty(HTMLImageElement.prototype, 'decode', originalDecode);
      else Reflect.deleteProperty(HTMLImageElement.prototype, 'decode');
    }
  });

  it('捕获失败及不合法阈值不会留下临时 React 根', async () => {
    vi.mocked(toPng).mockRejectedValue(new Error('capture failed'));
    const input = { page: makePage(), layout: 'landscape' as const, rotation: 0 as const, threshold: { mode: 'text' as const } };
    await expect(renderPrintAsset(input)).rejects.toThrow('capture failed');
    await expect(renderPrintAsset({ ...input, threshold: { mode: 'custom', value: 256 } })).rejects.toThrow(/阈值/);
    expect(document.querySelector('[data-print-bitmap-host]')).toBeNull();
  });
});

describe('实体标签位图', () => {
  it.each([[80, 60], [800, 600], [1600, 1200], [80, 160]])
  ('图片 %i×%i 始终使用现有打印区域的 contain-fill 语义', (width, height) => {
    const page = makePage();
    page.label.contentType = 'image';
    page.label.imageFallback = `data:image/png;base64,${PNG}`;
    const dom = document.createElement('div');
    dom.innerHTML = renderToStaticMarkup(<PrintBitmapSurface page={page} layout="landscape" rotation={0} />);
    const image = dom.querySelector<HTMLImageElement>('img')!;
    Object.defineProperties(image, { naturalWidth: { value: width }, naturalHeight: { value: height } });
    expect([image.style.width, image.style.height, image.style.objectFit]).toEqual(['100%', '100%', 'contain']);
  });
  it.each(['landscape', 'portrait'] as const)('%s 保持 800×600 白纸并在纸边裁剪，布局只旋转内容', (layout) => {
    const html = renderToStaticMarkup(<PrintBitmapSurface page={makePage()} layout={layout} rotation={0} />);
    const dom = document.createElement('div');
    dom.innerHTML = html;
    const paper = dom.querySelector<HTMLElement>('[data-print-bitmap-surface]')!;
    expect(paper.style.width).toBe('800px');
    expect(paper.style.height).toBe('600px');
    expect(paper.style.backgroundColor).toBe('white');
    expect(paper.style.overflow).toBe('hidden');
    expect(dom.querySelector<HTMLElement>('[data-bitmap-layout]')!.style.transform)
      .toBe(`translate(-50%, -50%) rotate(${layout === 'portrait' ? 90 : 0}deg)`);
    expect(html).not.toMatch(/@page|print-root|print-page|<button|<input|shadow|ruler/);
  });

  it('毫米定位和偏移按每毫米 8 点处理，整块旋转保持字符串及相对坐标', () => {
    const page = makePage();
    page.label.printArea = { leftMm: 1, topMm: 2, widthMm: 90, heightMm: 60 };
    const dom = document.createElement('div');
    dom.innerHTML = renderToStaticMarkup(<PrintBitmapSurface page={page} layout="landscape" rotation={270}
      horizontalOffsetMm={1.25} verticalOffsetMm={-2} />);
    const area = dom.querySelector<HTMLElement>('[data-bitmap-area]')!;
    expect([area.style.left, area.style.top, area.style.width, area.style.height]).toEqual(['8px', '16px', '720px', '480px']);
    expect(area.style.overflow).toBe('visible');
    expect(dom.querySelector<HTMLElement>('[data-bitmap-offset]')!.style.transform).toBe('translate(10px, -16px)');
    expect(dom.querySelector<HTMLElement>('.print-text-layer')!.style.transform).toBe('rotate(270deg)');
    const lines = [...dom.querySelectorAll<HTMLElement>('.print-bitmap-text')];
    expect(lines.map((line) => line.textContent)).toEqual(['meche', '08065289076']);
    expect(lines.map((line) => [line.style.left, line.style.top])).toEqual([['50%', '33.33%'], ['50%', '66.67%']]);
  });

  it('预览仅缩放同一个物理表面并提供文字替代', () => {
    const html = renderToStaticMarkup(<PrintBitmapPreview page={makePage()} layout="landscape" rotation={90} widthPx={400} />);
    const dom = document.createElement('div');
    dom.innerHTML = html;
    expect(dom.querySelector('[role="img"]')!.getAttribute('aria-label')).toContain('100 × 75 mm');
    expect(dom.querySelectorAll('[data-print-bitmap-surface]')).toHaveLength(1);
    expect(html).toContain('scale(0.5)');
    expect(html).toContain('width:800px');
    expect(html).toContain('height:600px');
  });

  it('预览宽度缩小时同步缩放同一个 800 × 600 物理表面', async () => {
    const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 280, bottom: 210, width: 280, height: 210,
      toJSON: () => ({}),
    });
    const { container } = render(<PrintBitmapPreview page={makePage()} layout="landscape" rotation={0} widthPx={400} />);
    const frame = container.querySelector<HTMLElement>('[role="img"]')!;
    expect(frame.style.width).toBe('100%');
    expect(frame.style.maxWidth).toBe('400px');
    await waitFor(() => expect(frame.firstElementChild?.getAttribute('style')).toContain('scale(0.35)'));
    bounds.mockRestore();
  });

  it('图片保留原始方向并拒绝远程或可引用外部资源的 SVG', () => {
    const page = makePage();
    page.label.contentType = 'image';
    page.label.imageFallback = 'data:image/png;base64,AA==';
    const html = renderToStaticMarkup(<PrintBitmapSurface page={page} layout="landscape" rotation={90} />);
    expect(html).toContain('data:image/png;base64,AA==');
    expect(html).not.toContain('rotate(90deg)');
    for (const url of ['https://example.com/image.png', 'data:image/svg+xml;base64,PHN2Zz4=']) {
      page.label.imageFallback = url;
      expect(() => renderToStaticMarkup(<PrintBitmapSurface page={page} layout="landscape" rotation={0} />)).toThrow(/本地.*图片/);
    }
  });
  it('共享文字层按物理点密度缩放字号及局部字号，不改变浏览器打印单位', () => {
    const { label } = makePage();
    label.textStyleRanges = [{ start: 0, end: 2, style: { fontSizePt: 18 } }];
    const bitmap = renderToStaticMarkup(<PrintTextLayer label={label} preset={preset}
      lineClassName="bitmap-line" rotation={0} physicalDotsPerMm={8} />);
    const dom = document.createElement('div');
    dom.innerHTML = bitmap;
    const line = dom.querySelector<HTMLElement>('.bitmap-line')!;
    expect(parseFloat(line.style.fontSize)).toBeCloseTo(33.8666666667, 8);
    expect(line.style.fontSize).toMatch(/px$/);
    expect(parseFloat(line.querySelector<HTMLElement>('span')!.style.fontSize)).toBeCloseTo(50.8, 8);
    const browser = renderToStaticMarkup(<PrintTextLayer label={label} preset={preset}
      lineClassName="browser-line" rotation={0} />);
    expect(browser).toContain('font-size:12pt');
    expect(browser).toContain('font-size:18pt');
  });
});
