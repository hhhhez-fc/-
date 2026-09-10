import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { XP420B_100X75_PROFILE, type DirectPrintAsset, type DirectPrintThreshold } from '../domain/directPrinting';
import { validateLabelForPrint } from '../domain/layout';
import PrintBitmapSurface, { validateBitmapSurfaceInput, type PrintBitmapSurfaceProps } from '../features/PrintBitmapSurface';

export interface RenderPrintAssetInput extends PrintBitmapSurfaceProps {
  threshold: DirectPrintThreshold;
}

const PROFILE = XP420B_100X75_PROFILE;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const GENERIC_FONTS = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
  'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'math', 'fangsong']);

export async function renderPrintAsset(input: RenderPrintAssetInput): Promise<DirectPrintAsset> {
  // Freeze the print decision before any await; edits in the workbench cannot change this job.
  const snapshot = structuredClone(input);
  validateBitmapSurfaceInput(snapshot);
  validateThreshold(snapshot.threshold);
  const errors = validateLabelForPrint(snapshot.page.label, snapshot.page.preset);
  if (errors.length) throw new Error(errors.join('；'));
  if (!globalThis.crypto?.subtle) throw new Error('当前浏览器无法安全生成打印资产，请使用 HTTPS 网站');

  const host = document.createElement('div');
  host.dataset.printBitmapHost = '';
  host.setAttribute('aria-hidden', 'true');
  host.inert = true;
  Object.assign(host.style, { position: 'fixed', left: '-10000px', top: '0', width: '800px', height: '600px', pointerEvents: 'none' });
  document.body.append(host);
  let renderError: unknown;
  const root = createRoot(host, { onUncaughtError: (error) => { renderError = error; } });
  try {
    // Synchronous React commit followed by font/image readiness and a real layout read.
    flushSync(() => root.render(createElement(PrintBitmapSurface, snapshot)));
    if (renderError) throw renderError;
    const surface = host.querySelector<HTMLElement>('[data-print-bitmap-surface]');
    if (!surface) throw new Error('无法生成打印标签');
    if (!document.fonts) throw new Error('当前浏览器无法确认打印字体就绪');
    try { await document.fonts.ready; } catch { throw new Error('打印字体尚未就绪，请检查字体后重试'); }
    validateRenderedFonts(surface);
    await Promise.all([...surface.querySelectorAll('img')].map(async (image) => {
      try { await image.decode(); } catch { throw new Error('唛头图片无法解码，请重新导入图片'); }
      if (!image.naturalWidth || !image.naturalHeight) throw new Error('唛头图片不可用');
    }));
    validatePhysicalBounds(surface);
    const { toPng } = await import('html-to-image');
    const dataUrl = await toPng(surface, {
      width: PROFILE.widthDots, height: PROFILE.heightDots,
      canvasWidth: PROFILE.widthDots, canvasHeight: PROFILE.heightDots,
      pixelRatio: 1, backgroundColor: 'white', cacheBust: false,
      // This app uses installed fonts. Never scan/fetch remote stylesheets or embed web fonts.
      skipFonts: true,
      // html-to-image 1.11.13 floors computed font-size. Native cloning already preserves
      // our exact inline px sizes; let unstyled text segments inherit those values.
      // Exclude the shorthand too, because copying it would overwrite the inline size.
      includeStyleProperties: [...new Set([
        ...Array.from(getComputedStyle(document.documentElement)),
        ...[surface, ...surface.querySelectorAll<HTMLElement>('*')].flatMap((element) => Array.from(getComputedStyle(element))),
      ])].filter((property) => property !== 'font-size' && property !== 'font'),
    });
    const { pngBase64, bytes } = decodePng(dataUrl);
    const sha256 = await digest(bytes);
    const identity = stableJson({ ...snapshot, page: { ...snapshot.page, copyNumber: undefined }, horizontalOffsetMm: snapshot.horizontalOffsetMm ?? 0,
      verticalOffsetMm: snapshot.verticalOffsetMm ?? 0, sha256 });
    return {
      assetId: `asset-${await digest(new TextEncoder().encode(identity))}`,
      labelId: snapshot.page.label.id,
      widthDots: PROFILE.widthDots, heightDots: PROFILE.heightDots,
      rotation: snapshot.page.label.contentType === 'image' ? 0 : snapshot.rotation,
      pngBase64, sha256,
    };
  } finally {
    root.unmount();
    host.remove();
  }
}

function validateThreshold(threshold: DirectPrintThreshold): void {
  if (!threshold || !['text', 'auto', 'custom'].includes(threshold.mode)
    || (threshold.mode === 'custom'
      ? !Number.isInteger(threshold.value) || threshold.value! < 0 || threshold.value! > 255
      : threshold.value !== undefined)) {
    throw new Error('打印阈值无效，自定义阈值必须在 0–255 之间');
  }
}

function inheritedStyle(element: HTMLElement, property: 'fontFamily' | 'fontStyle' | 'fontWeight'): string {
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const value = getComputedStyle(node)[property];
    if (value) return value;
  }
  return property === 'fontFamily' ? 'sans-serif' : 'normal';
}

function validateRenderedFonts(surface: HTMLElement): void {
  const context = document.createElement('canvas').getContext('2d');
  const checked = new Set<string>();
  // StyledTextLine emits leaf spans, so overridden base fonts that draw no characters aren't checked.
  for (const element of surface.querySelectorAll<HTMLElement>('.print-bitmap-text span')) {
    if (!element.textContent?.trim()) continue;
    const family = inheritedStyle(element, 'fontFamily');
    const fontStyle = inheritedStyle(element, 'fontStyle');
    const weight = inheritedStyle(element, 'fontWeight');
    const key = `${fontStyle}|${weight}|${family}`;
    if (checked.has(key)) continue;
    const sample = `WwMm012345汉字 ${element.textContent}`;
    const families = family.match(/"[^"]+"|'[^']+'|[^,]+/g) ?? [];
    const available = families.some((entry) => {
      const name = entry.trim().replace(/^['"]|['"]$/g, '');
      const generic = GENERIC_FONTS.has(name.toLowerCase());
      const quotedName = generic ? name : `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
      const prefix = `${fontStyle} ${weight} 48px `;
      if (!document.fonts.check(`${prefix}${quotedName}`, sample)) return false;
      if (generic) return true;
      if (!context) return false;
      // FontFaceSet.check alone reports true for unknown system fonts. Compare two distinct
      // fallback metrics: a missing named face leaves both unchanged, an installed face won't.
      return ['monospace', 'serif'].some((fallback) => {
        context.font = `${prefix}${fallback}`;
        const fallbackWidth = context.measureText(sample).width;
        context.font = `${prefix}${quotedName}, ${fallback}`;
        return Math.abs(context.measureText(sample).width - fallbackWidth) > 0.01;
      });
    });
    if (!available) throw new Error(`打印字体“${family}”不可用，请安装字体或选择系统字体`);
    checked.add(key);
  }
}

function validatePhysicalBounds(surface: HTMLElement): void {
  const paper = surface.getBoundingClientRect();
  if (Math.abs(paper.width - PROFILE.widthDots) > 0.01 || Math.abs(paper.height - PROFILE.heightDots) > 0.01) {
    throw new Error('无法确认 800 × 600 打印表面的实际尺寸');
  }
  // Measure final DOM boxes after all ancestor transforms, including the millimeter offsets.
  for (const element of surface.querySelectorAll<HTMLElement>('.print-bitmap-text, .print-bitmap-text span, [data-bitmap-image]')) {
    if (!element.matches('[data-bitmap-image]') && !element.textContent?.trim()) continue;
    const bounds = element instanceof HTMLImageElement
      ? measureContainedImageBounds(element) : element.getBoundingClientRect();
    if (!bounds.width || !bounds.height) throw new Error('无法确认打印内容的实际尺寸');
    const tolerance = 0.01;
    if (bounds.left < paper.left - tolerance || bounds.top < paper.top - tolerance
      || bounds.right > paper.right + tolerance || bounds.bottom > paper.bottom + tolerance) {
      throw new Error('内容超出 100 × 75 mm 纸张边缘，请调整位置、旋转或字号');
    }
  }
}

function measureContainedImageBounds(image: HTMLImageElement): DOMRect {
  const parent = image.parentElement;
  if (!parent?.hasAttribute('data-bitmap-area') || image.style.width !== '100%' || image.style.height !== '100%'
    || !image.naturalWidth || !image.naturalHeight) {
    throw new Error('无法确认打印图片的实际尺寸');
  }
  // The canonical area emits exact inline px dimensions and the image fills that area.
  // client/offset dimensions round to integers and lose the editor's fractional-dot precision.
  const boxWidth = exactPixelDimension(parent.style.width);
  const boxHeight = exactPixelDimension(parent.style.height);
  // Standard object-fit: contain with centered object-position. This only measures the
  // painted image inside its CSS box; all paper/layout/offset transforms remain on the
  // existing ancestors and are applied by the browser to the measurement marker.
  const scale = Math.min(boxWidth / image.naturalWidth, boxHeight / image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  const marker = document.createElement('div');
  marker.dataset.bitmapContentMeasure = '';
  marker.setAttribute('aria-hidden', 'true');
  Object.assign(marker.style, {
    position: 'absolute', boxSizing: 'border-box', border: '0', padding: '0', margin: '0',
    left: `${(boxWidth - width) / 2}px`,
    top: `${(boxHeight - height) / 2}px`,
    width: `${width}px`, height: `${height}px`, visibility: 'hidden', pointerEvents: 'none',
  });
  parent.append(marker);
  try { return marker.getBoundingClientRect(); } finally { marker.remove(); }
}

function exactPixelDimension(value: string): number {
  const dimension = /^(?:\d+\.?\d*|\.\d+)px$/.test(value) ? Number(value.slice(0, -2)) : NaN;
  if (!Number.isFinite(dimension) || dimension <= 0) throw new Error('无法确认打印图片的精确区域尺寸');
  return dimension;
}

function decodePng(dataUrl: string): { pngBase64: string; bytes: Uint8Array<ArrayBuffer> } {
  const match = /^data:image\/png;base64,((?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)$/.exec(dataUrl);
  if (!match?.[1]) throw new Error('捕获结果不是有效的 PNG Base64 图片');
  const binary = atob(match[1]);
  if (btoa(binary) !== match[1]) throw new Error('PNG Base64 编码不规范');
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  if (bytes.length < 33 || !PNG_SIGNATURE.every((value, index) => bytes[index] === value)) {
    throw new Error('捕获结果不是有效的 PNG 图片');
  }
  const view = new DataView(bytes.buffer);
  if (view.getUint32(8) !== 13 || binary.slice(12, 16) !== 'IHDR'
    || view.getUint32(16) !== PROFILE.widthDots || view.getUint32(20) !== PROFILE.heightDots) {
    throw new Error('PNG 图片尺寸必须为 800 × 600 dots');
  }
  let offset = 8;
  let imageDataSeen = false;
  while (offset + 12 <= bytes.length) {
    const size = view.getUint32(offset);
    const type = binary.slice(offset + 4, offset + 8);
    const next = offset + size + 12;
    if (next > bytes.length) break;
    if (type === 'IDAT') imageDataSeen = true;
    if (type === 'IEND') {
      if (imageDataSeen && size === 0 && next === bytes.length) return { pngBase64: match[1], bytes };
      break;
    }
    offset = next;
  }
  throw new Error('PNG 图片数据不完整');
}

async function digest(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
      return Object.fromEntries(Object.entries(item).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
    }
    return item;
  });
}
