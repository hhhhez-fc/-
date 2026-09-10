import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  DIRECT_PRINT_DEFAULT_COPIES,
  createPrintJobManifest,
  expandPrintSequence,
  millimetersToDots,
  normalizePrintRange,
  validateDirectPrintJobManifest,
} from '../src/domain/directPrinting';

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlHSj8AAAAASUVORK5CYII=';

describe('direct printing protocol', () => {
  it('converts the XP-420B label dimensions into 800 by 600 dots', () => {
    expect(millimetersToDots(100, 8)).toBe(800);
    expect(millimetersToDots(75, 8)).toBe(600);
  });

  it('keeps a valid inclusive print range', () => {
    expect(normalizePrintRange({ from: 2, to: 4 }, 5)).toEqual({ from: 2, to: 4 });
  });

  it('orders collated copies by complete label sets', () => {
    expect(expandPrintSequence(['A', 'B'], 2, true)).toEqual(['A', 'B', 'A', 'B']);
  });

  it('orders uncollated copies by each label', () => {
    expect(expandPrintSequence(['A', 'B'], 2, false)).toEqual(['A', 'A', 'B', 'B']);
  });

  it('rejects a range whose first page is outside the available pages', () => {
    expect(() => normalizePrintRange({ from: 0, to: 3 }, 5)).toThrow('打印起始页必须在 1–5 之间');
  });

  it('builds one manifest entry for every physical label in collated order', () => {
    const manifest = createPrintJobManifest({
      jobId: 'job-001',
      createdAtUtc: '2026-09-08T00:00:00.000Z',
      websiteVersion: '1.0.0',
      printerId: 'printer-001',
      printerName: 'XP-420B',
      printerProfileVersion: '1.0.0',
      group: { widthMm: 100, heightMm: 75 },
      layout: 'landscape',
      range: { from: 1, to: 2 },
      copies: 2,
      collate: true,
      horizontalOffsetMm: 0,
      verticalOffsetMm: 0,
      threshold: { mode: 'auto' },
      expectedLabels: 4,
      assets: [
        { assetId: 'asset-a', labelId: 'A', widthDots: 800, heightDots: 600, rotation: 0, pngBase64: PNG_BASE64, sha256: 'a'.repeat(64) },
        { assetId: 'asset-b', labelId: 'B', widthDots: 800, heightDots: 600, rotation: 0, pngBase64: PNG_BASE64, sha256: 'b'.repeat(64) },
      ],
    });

    expect(manifest.sequence).toEqual([
      { ordinal: 1, assetId: 'asset-a', labelId: 'A', sourcePageNumber: 1, copyNumber: 1 },
      { ordinal: 2, assetId: 'asset-b', labelId: 'B', sourcePageNumber: 2, copyNumber: 1 },
      { ordinal: 3, assetId: 'asset-a', labelId: 'A', sourcePageNumber: 1, copyNumber: 2 },
      { ordinal: 4, assetId: 'asset-b', labelId: 'B', sourcePageNumber: 2, copyNumber: 2 },
    ]);
    expect(manifest.assets).toHaveLength(2);
  });

  it('uploads a repeated source bitmap once while preserving every physical source-page copy', () => {
    const shared = { assetId: 'asset-a', labelId: 'A', widthDots: 800 as const, heightDots: 600 as const,
      rotation: 0 as const, pngBase64: PNG_BASE64, sha256: 'a'.repeat(64) };
    const manifest = createPrintJobManifest({
      jobId: 'job-repeated-pages', createdAtUtc: '2026-09-08T00:00:00.000Z', websiteVersion: '1.0.0',
      printerId: 'printer-001', printerName: 'XP-420B', printerProfileVersion: '1.0.0',
      group: { widthMm: 100, heightMm: 75 }, layout: 'landscape', range: { from: 1, to: 2 }, copies: 2,
      collate: true, horizontalOffsetMm: 0, verticalOffsetMm: 0, threshold: { mode: 'auto' }, expectedLabels: 4,
      assets: [shared, { ...shared }],
    });

    expect(manifest.assets).toEqual([shared]);
    expect(manifest.sequence).toEqual([
      { ordinal: 1, assetId: 'asset-a', labelId: 'A', sourcePageNumber: 1, copyNumber: 1 },
      { ordinal: 2, assetId: 'asset-a', labelId: 'A', sourcePageNumber: 2, copyNumber: 1 },
      { ordinal: 3, assetId: 'asset-a', labelId: 'A', sourcePageNumber: 1, copyNumber: 2 },
      { ordinal: 4, assetId: 'asset-a', labelId: 'A', sourcePageNumber: 2, copyNumber: 2 },
    ]);
    expect(() => validateDirectPrintJobManifest(manifest)).not.toThrow();
  });

  it('treats input assets as the already selected non-first source-page range', () => {
    const assets = [
      { assetId: 'asset-b', labelId: 'B', widthDots: 800 as const, heightDots: 600 as const, rotation: 0 as const, pngBase64: PNG_BASE64, sha256: 'b'.repeat(64) },
      { assetId: 'asset-c', labelId: 'C', widthDots: 800 as const, heightDots: 600 as const, rotation: 0 as const, pngBase64: PNG_BASE64, sha256: 'c'.repeat(64) },
    ];
    const manifest = createPrintJobManifest({
      jobId: 'job-selected-range', createdAtUtc: '2026-09-08T00:00:00.000Z', websiteVersion: '1.0.0',
      printerId: 'printer-001', printerName: 'XP-420B', printerProfileVersion: '1.0.0',
      group: { widthMm: 100, heightMm: 75 }, layout: 'landscape', range: { from: 2, to: 3 }, copies: 1,
      collate: true, horizontalOffsetMm: 0, verticalOffsetMm: 0, threshold: { mode: 'auto' }, expectedLabels: 2, assets,
    });

    expect(manifest.assets).toEqual(assets);
    expect(manifest.sequence.map((entry) => entry.sourcePageNumber)).toEqual([2, 3]);
  });

  it('defaults a direct-print manifest to one physical copy when copies is omitted', () => {
    const manifest = createPrintJobManifest({
      jobId: 'job-default-copy', createdAtUtc: '2026-09-08T00:00:00.000Z', websiteVersion: '1.0.0',
      printerId: 'printer-001', printerName: 'XP-420B', printerProfileVersion: '1.0.0',
      group: { widthMm: 100, heightMm: 75 }, layout: 'landscape', range: { from: 1, to: 1 },
      collate: true, horizontalOffsetMm: 0, verticalOffsetMm: 0, threshold: { mode: 'auto' }, expectedLabels: 1,
      assets: [{ assetId: 'asset-a', labelId: 'A', widthDots: 800, heightDots: 600, rotation: 0, pngBase64: PNG_BASE64, sha256: 'a'.repeat(64) }],
    });

    expect(DIRECT_PRINT_DEFAULT_COPIES).toBe(1);
    expect(manifest.copies).toBe(1);
    expect(manifest.sequence).toHaveLength(1);
  });

  it('rejects copies, offsets, groups, sequence gaps, and label-count mismatches outside the protocol limits', () => {
    const input = {
      jobId: 'job-001', createdAtUtc: '2026-09-08T00:00:00.000Z', websiteVersion: '1.0.0',
      printerId: 'printer-001', printerName: 'XP-420B', printerProfileVersion: '1.0.0',
      group: { widthMm: 100, heightMm: 75 }, layout: 'landscape' as const,
      range: { from: 1, to: 2 }, copies: 1, collate: true,
      horizontalOffsetMm: 0, verticalOffsetMm: 0, threshold: { mode: 'text' as const },
      expectedLabels: 2,
      assets: [
        { assetId: 'asset-a', labelId: 'A', widthDots: 800 as const, heightDots: 600 as const, rotation: 0 as const, pngBase64: PNG_BASE64, sha256: 'a'.repeat(64) },
        { assetId: 'asset-b', labelId: 'B', widthDots: 800 as const, heightDots: 600 as const, rotation: 0 as const, pngBase64: PNG_BASE64, sha256: 'b'.repeat(64) },
      ],
    };

    expect(() => createPrintJobManifest({ ...input, copies: 101 })).toThrow('打印份数必须在 1–100 之间');
    expect(() => createPrintJobManifest({ ...input, horizontalOffsetMm: 10.1 })).toThrow('水平偏移必须在 -10–10 mm 之间');
    expect(() => createPrintJobManifest({ ...input, group: { widthMm: 100, heightMm: 60 } })).toThrow('仅支持 100 × 75 mm 标签组');
    expect(() => createPrintJobManifest({ ...input, range: { from: 1, to: 1 }, assets: input.assets.slice(0, 1), expectedLabels: 2 })).toThrow('预期标签数必须与打印序列一致');
    expect(() => createPrintJobManifest({ ...input, threshold: { mode: 'custom' } })).toThrow('自定义阈值必须在 0–255 之间');
    expect(() => createPrintJobManifest({ ...input, threshold: { mode: 'auto', value: 128 } })).toThrow('仅自定义阈值模式可设置阈值');
  });

  it('rejects externally supplied manifests with ordinal gaps and label-count mismatches', () => {
    const manifest = createPrintJobManifest({
      jobId: 'job-external', createdAtUtc: '2026-09-08T00:00:00.000Z', websiteVersion: '1.0.0',
      printerId: 'printer-001', printerName: 'XP-420B', printerProfileVersion: '1.0.0',
      group: { widthMm: 100, heightMm: 75 }, layout: 'landscape', range: { from: 1, to: 2 }, copies: 1,
      collate: true, horizontalOffsetMm: 0, verticalOffsetMm: 0, threshold: { mode: 'custom', value: 128 }, expectedLabels: 2,
      assets: [
        { assetId: 'asset-a', labelId: 'A', widthDots: 800, heightDots: 600, rotation: 0, pngBase64: PNG_BASE64, sha256: 'a'.repeat(64) },
        { assetId: 'asset-b', labelId: 'B', widthDots: 800, heightDots: 600, rotation: 90, pngBase64: PNG_BASE64, sha256: 'b'.repeat(64) },
      ],
    });

    expect(() => validateDirectPrintJobManifest({ ...manifest, sequence: [{ ...manifest.sequence[0], ordinal: 2 }, manifest.sequence[1]] })).toThrow('打印序列序号必须从 1 连续递增');
    expect(() => validateDirectPrintJobManifest({ ...manifest, expectedLabels: 3 })).toThrow('预期标签数必须与打印序列一致');
  });

  it('rejects untrusted manifest fields and invalid PNG assets before direct printing', () => {
    const manifest = createPrintJobManifest({
      jobId: 'job-untrusted', createdAtUtc: '2026-09-08T00:00:00.000Z', websiteVersion: '1.0.0',
      printerId: 'printer-001', printerName: 'XP-420B', printerProfileVersion: '1.0.0',
      group: { widthMm: 100, heightMm: 75 }, layout: 'landscape', range: { from: 1, to: 1 }, copies: 1,
      collate: true, horizontalOffsetMm: 0, verticalOffsetMm: 0, threshold: { mode: 'auto' }, expectedLabels: 1,
      assets: [{ assetId: 'asset-a', labelId: 'A', widthDots: 800, heightDots: 600, rotation: 0, pngBase64: PNG_BASE64, sha256: 'a'.repeat(64) }],
    });
    const asset = manifest.assets[0];

    expect(() => validateDirectPrintJobManifest({ ...manifest, layout: 'diagonal' } as never)).toThrow('打印布局必须为 landscape 或 portrait');
    expect(() => validateDirectPrintJobManifest({ ...manifest, threshold: { mode: 'binary' } } as never)).toThrow('阈值模式必须为 text、auto 或 custom');
    expect(() => validateDirectPrintJobManifest({ ...manifest, jobId: '' })).toThrow('任务标识不能为空');
    expect(() => validateDirectPrintJobManifest({ ...manifest, createdAtUtc: 'not-a-date' })).toThrow('创建时间必须是有效的 UTC 日期时间');
    expect(() => validateDirectPrintJobManifest({ ...manifest, assets: [{ ...asset, rotation: 45 }] } as never)).toThrow('打印资产旋转角度无效');
    expect(() => validateDirectPrintJobManifest({ ...manifest, assets: [{ ...asset, assetId: '' }] })).toThrow('打印资产标识不能为空');
    expect(() => validateDirectPrintJobManifest({ ...manifest, assets: [{ ...asset, labelId: '' }] })).toThrow('打印资产标签标识不能为空');
    expect(() => validateDirectPrintJobManifest({ ...manifest, assets: [{ ...asset, pngBase64: 'not-base64!' }] })).toThrow('打印资产 PNG 数据不是有效的 Base64');
    expect(() => validateDirectPrintJobManifest({ ...manifest, assets: [{ ...asset, pngBase64: 'aGVsbG8=' }] })).toThrow('打印资产必须是 PNG 图像');
    expect(() => validateDirectPrintJobManifest({ ...manifest, assets: [{ ...asset, sha256: 'not-a-hash' }] })).toThrow('打印资产 SHA-256 格式无效');
  });

  it('rejects extra root, range, and sequence fields in external manifests', () => {
    const manifest = createPrintJobManifest({
      jobId: 'job-boundaries', createdAtUtc: '2026-09-08T00:00:00.000Z', websiteVersion: '1.0.0',
      printerId: 'printer-001', printerName: 'XP-420B', printerProfileVersion: '1.0.0',
      group: { widthMm: 100, heightMm: 75 }, layout: 'landscape', range: { from: 1, to: 1 }, copies: 1,
      collate: true, horizontalOffsetMm: 0, verticalOffsetMm: 0, threshold: { mode: 'auto' }, expectedLabels: 1,
      assets: [{ assetId: 'asset-a', labelId: 'A', widthDots: 800, heightDots: 600, rotation: 0, pngBase64: PNG_BASE64, sha256: 'a'.repeat(64) }],
    });

    expect(() => validateDirectPrintJobManifest({ ...manifest, injected: true } as never)).toThrow('打印任务包含不支持的字段');
    expect(() => validateDirectPrintJobManifest({ ...manifest, range: { ...manifest.range, injected: true } } as never)).toThrow('打印范围包含不支持的字段');
    expect(() => validateDirectPrintJobManifest({ ...manifest, sequence: [{ ...manifest.sequence[0], injected: true }] } as never)).toThrow('打印序列项包含不支持的字段');
  });

  it('accepts the official XP-420B example as a complete direct-print manifest', () => {
    const fixture = JSON.parse(readFileSync(new URL('../print-protocol/examples/xp420b-100x75-job.json', import.meta.url), 'utf8'));

    expect(() => validateDirectPrintJobManifest(fixture)).not.toThrow();
  });

  it('rejects non-RFC3339 UTC timestamps and normalized impossible dates', () => {
    const manifest = createPrintJobManifest({
      jobId: 'job-date', createdAtUtc: '2026-09-08T00:00:00.000Z', websiteVersion: '1.0.0',
      printerId: 'printer-001', printerName: 'XP-420B', printerProfileVersion: '1.0.0',
      group: { widthMm: 100, heightMm: 75 }, layout: 'landscape', range: { from: 1, to: 1 }, copies: 1,
      collate: true, horizontalOffsetMm: 0, verticalOffsetMm: 0, threshold: { mode: 'auto' }, expectedLabels: 1,
      assets: [{ assetId: 'asset-a', labelId: 'A', widthDots: 800, heightDots: 600, rotation: 0, pngBase64: PNG_BASE64, sha256: 'a'.repeat(64) }],
    });

    expect(() => validateDirectPrintJobManifest({ ...manifest, createdAtUtc: '2026-01-01Z' })).toThrow('创建时间必须是有效的 UTC 日期时间');
    expect(() => validateDirectPrintJobManifest({ ...manifest, createdAtUtc: '2026-02-30T00:00:00Z' })).toThrow('创建时间必须是有效的 UTC 日期时间');
  });

  it('rejects a PNG payload that has a valid signature but is truncated before IEND', () => {
    const manifest = createPrintJobManifest({
      jobId: 'job-png', createdAtUtc: '2026-09-08T00:00:00.000Z', websiteVersion: '1.0.0',
      printerId: 'printer-001', printerName: 'XP-420B', printerProfileVersion: '1.0.0',
      group: { widthMm: 100, heightMm: 75 }, layout: 'landscape', range: { from: 1, to: 1 }, copies: 1,
      collate: true, horizontalOffsetMm: 0, verticalOffsetMm: 0, threshold: { mode: 'auto' }, expectedLabels: 1,
      assets: [{ assetId: 'asset-a', labelId: 'A', widthDots: 800, heightDots: 600, rotation: 0, pngBase64: PNG_BASE64, sha256: 'a'.repeat(64) }],
    });
    const truncatedPngBase64 = btoa(atob(PNG_BASE64).slice(0, -12));

    expect(() => validateDirectPrintJobManifest({ ...manifest, assets: [{ ...manifest.assets[0], pngBase64: truncatedPngBase64 }] })).toThrow('打印资产 PNG 图像结构不完整');
  });

  it('requires every asset to be referenced exactly once per requested copy', () => {
    const manifest = createPrintJobManifest({
      jobId: 'job-cross-field', createdAtUtc: '2026-09-08T00:00:00.000Z', websiteVersion: '1.0.0',
      printerId: 'printer-001', printerName: 'XP-420B', printerProfileVersion: '1.0.0',
      group: { widthMm: 100, heightMm: 75 }, layout: 'landscape', range: { from: 1, to: 2 }, copies: 1,
      collate: true, horizontalOffsetMm: 0, verticalOffsetMm: 0, threshold: { mode: 'auto' }, expectedLabels: 2,
      assets: [
        { assetId: 'asset-a', labelId: 'A', widthDots: 800, heightDots: 600, rotation: 0, pngBase64: PNG_BASE64, sha256: 'a'.repeat(64) },
        { assetId: 'asset-b', labelId: 'B', widthDots: 800, heightDots: 600, rotation: 0, pngBase64: PNG_BASE64, sha256: 'b'.repeat(64) },
      ],
    });
    const repeatedFirstAsset = { ...manifest, sequence: [manifest.sequence[0], { ...manifest.sequence[0], ordinal: 2, sourcePageNumber: 2 }] };
    const missingCopy = createPrintJobManifest({ ...{
      jobId: 'job-missing-copy', createdAtUtc: '2026-09-08T00:00:00.000Z', websiteVersion: '1.0.0',
      printerId: 'printer-001', printerName: 'XP-420B', printerProfileVersion: '1.0.0', group: { widthMm: 100, heightMm: 75 },
      layout: 'landscape' as const, range: { from: 1, to: 1 }, copies: 2, collate: true, horizontalOffsetMm: 0, verticalOffsetMm: 0,
      threshold: { mode: 'auto' as const }, expectedLabels: 2,
      assets: [{ assetId: 'asset-c', labelId: 'C', widthDots: 800 as const, heightDots: 600 as const, rotation: 0 as const, pngBase64: PNG_BASE64, sha256: 'c'.repeat(64) }],
    } } as never);

    expect(() => validateDirectPrintJobManifest(repeatedFirstAsset)).toThrow('每个打印资产必须在序列中出现一次');
    expect(() => validateDirectPrintJobManifest({ ...missingCopy, expectedLabels: 1, sequence: [missingCopy.sequence[0]] })).toThrow('打印序列必须完整覆盖每个源页和副本');
  });

  it('requires every source page and copy pair exactly once with stable asset and label references', () => {
    const shared = { assetId: 'asset-shared', labelId: 'A', widthDots: 800 as const, heightDots: 600 as const,
      rotation: 0 as const, pngBase64: PNG_BASE64, sha256: 'a'.repeat(64) };
    const manifest = createPrintJobManifest({
      jobId: 'job-source-pairs', createdAtUtc: '2026-09-08T00:00:00.000Z', websiteVersion: '1.0.0',
      printerId: 'printer-001', printerName: 'XP-420B', printerProfileVersion: '1.0.0',
      group: { widthMm: 100, heightMm: 75 }, layout: 'landscape', range: { from: 1, to: 2 }, copies: 2,
      collate: true, horizontalOffsetMm: 0, verticalOffsetMm: 0, threshold: { mode: 'auto' }, expectedLabels: 4,
      assets: [shared, shared],
    });

    const duplicatePair = { ...manifest, sequence: [
      manifest.sequence[0],
      { ...manifest.sequence[0], ordinal: 2 },
      manifest.sequence[2],
      manifest.sequence[3],
    ] };
    const inconsistentSource = { ...manifest, sequence: manifest.sequence.map((entry, index) => index === 3
      ? { ...entry, assetId: 'asset-other', labelId: 'B' } : entry), assets: [...manifest.assets,
      { ...shared, assetId: 'asset-other', labelId: 'B', sha256: 'b'.repeat(64) }] };

    expect(() => validateDirectPrintJobManifest(duplicatePair)).toThrow('打印序列必须完整覆盖每个源页和副本');
    expect(() => validateDirectPrintJobManifest(inconsistentSource)).toThrow('同一源页必须引用同一打印资产和标签');
  });

  it('rejects a complete physical sequence when its order disagrees with collate', () => {
    const assets = [
      { assetId: 'asset-a', labelId: 'A', widthDots: 800 as const, heightDots: 600 as const, rotation: 0 as const, pngBase64: PNG_BASE64, sha256: 'a'.repeat(64) },
      { assetId: 'asset-b', labelId: 'B', widthDots: 800 as const, heightDots: 600 as const, rotation: 0 as const, pngBase64: PNG_BASE64, sha256: 'b'.repeat(64) },
    ];
    const manifest = createPrintJobManifest({
      jobId: 'job-order', createdAtUtc: '2026-09-08T00:00:00.000Z', websiteVersion: '1.0.0',
      printerId: 'printer-001', printerName: 'XP-420B', printerProfileVersion: '1.0.0',
      group: { widthMm: 100, heightMm: 75 }, layout: 'landscape', range: { from: 1, to: 2 }, copies: 2,
      collate: true, horizontalOffsetMm: 0, verticalOffsetMm: 0, threshold: { mode: 'auto' }, expectedLabels: 4, assets,
    });
    const reordered = { ...manifest, sequence: [manifest.sequence[1], manifest.sequence[0], ...manifest.sequence.slice(2)]
      .map((entry, index) => ({ ...entry, ordinal: index + 1 })) };

    expect(() => validateDirectPrintJobManifest(reordered)).toThrow('打印序列顺序与逐份打印设置不一致');
  });

  it('defines strict asset boundaries and aligned threshold combinations in the v1 schema', () => {
    const schema = JSON.parse(readFileSync(new URL('../print-protocol/v1.schema.json', import.meta.url), 'utf8'));
    const asset = schema.properties.assets.items;
    const thresholdModes = schema.properties.threshold.oneOf;

    expect(schema.required).toContain('assets');
    expect(asset.additionalProperties).toBe(false);
    expect(asset.required).toEqual(['assetId', 'labelId', 'widthDots', 'heightDots', 'rotation', 'pngBase64', 'sha256']);
    expect(thresholdModes.find((entry: { properties: { mode: { const: string } } }) => entry.properties.mode.const === 'custom')).toMatchObject({ required: ['mode', 'value'] });
    expect(thresholdModes.find((entry: { properties: { mode: { const: string } } }) => entry.properties.mode.const === 'auto').properties).not.toHaveProperty('value');
  });
});
