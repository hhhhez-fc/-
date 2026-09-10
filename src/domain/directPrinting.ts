export const PRINT_PROTOCOL_VERSION = 1 as const;
export const DIRECT_PRINT_DEFAULT_COPIES = 1 as const;

export const XP420B_100X75_PROFILE = {
  id: 'xp420b-100x75-203dpi',
  widthMm: 100,
  heightMm: 75,
  dotsPerMm: 8,
  widthDots: 800,
  heightDots: 600,
} as const;

export interface DirectPrintRange {
  from: number;
  to: number;
}

export interface DirectPrintThreshold {
  mode: 'text' | 'auto' | 'custom';
  value?: number;
}

export interface DirectPrintGroup {
  widthMm: number;
  heightMm: number;
}

export interface PrintSequenceEntry {
  ordinal: number;
  assetId: string;
  labelId: string;
  sourcePageNumber: number;
  copyNumber: number;
}

export interface DirectPrintAsset {
  assetId: string;
  labelId: string;
  widthDots: 800;
  heightDots: 600;
  rotation: 0 | 90 | 180 | 270;
  pngBase64: string;
  sha256: string;
}

export interface DirectPrintJobManifest {
  protocolVersion: 1;
  jobId: string;
  createdAtUtc: string;
  websiteVersion: string;
  printerId: string;
  printerName: string;
  profileId: typeof XP420B_100X75_PROFILE.id;
  printerProfileVersion: string;
  widthMm: 100;
  heightMm: 75;
  widthDots: 800;
  heightDots: 600;
  layout: 'landscape' | 'portrait';
  range: { from: number; to: number };
  copies: number;
  collate: boolean;
  horizontalOffsetMm: number;
  verticalOffsetMm: number;
  threshold: { mode: 'text' | 'auto' | 'custom'; value?: number };
  expectedLabels: number;
  assets: DirectPrintAsset[];
  sequence: PrintSequenceEntry[];
}

export interface CreatePrintJobManifestInput {
  jobId: string;
  createdAtUtc: string;
  websiteVersion: string;
  printerId: string;
  printerName: string;
  printerProfileVersion: string;
  group: DirectPrintGroup;
  layout: DirectPrintJobManifest['layout'];
  range: DirectPrintRange;
  copies?: number;
  collate: boolean;
  horizontalOffsetMm: number;
  verticalOffsetMm: number;
  threshold: DirectPrintThreshold;
  expectedLabels: number;
  assets: DirectPrintAsset[];
}

export function millimetersToDots(mm: number, dotsPerMm: number): number {
  if (!Number.isFinite(mm) || !Number.isFinite(dotsPerMm)) {
    throw new Error('毫米和每毫米点数必须是有限数字');
  }
  return Math.round(mm * dotsPerMm);
}

export function normalizePrintRange(range: DirectPrintRange, totalPages: number): DirectPrintRange {
  if (!Number.isInteger(totalPages) || totalPages < 1) {
    throw new Error('可打印页数必须是正整数');
  }
  if (!Number.isInteger(range.from) || range.from < 1 || range.from > totalPages) {
    throw new Error(`打印起始页必须在 1–${totalPages} 之间`);
  }
  if (!Number.isInteger(range.to) || range.to < 1 || range.to > totalPages) {
    throw new Error(`打印结束页必须在 1–${totalPages} 之间`);
  }
  if (range.from > range.to) {
    throw new Error('打印起始页不能大于结束页');
  }
  return { from: range.from, to: range.to };
}

export function expandPrintSequence(assetIds: string[], copies: number, collate: boolean): string[] {
  validateCopies(copies);
  if (assetIds.length === 0) {
    throw new Error('打印序列不能为空');
  }
  if (collate) {
    return Array.from({ length: copies }, () => assetIds).flat();
  }
  return assetIds.flatMap((assetId) => Array.from({ length: copies }, () => assetId));
}

export function createPrintJobManifest(input: CreatePrintJobManifestInput): DirectPrintJobManifest {
  validateGroup(input.group);
  const copies = input.copies ?? DIRECT_PRINT_DEFAULT_COPIES;
  validateCopies(copies);
  validateOffset(input.horizontalOffsetMm, '水平偏移');
  validateOffset(input.verticalOffsetMm, '垂直偏移');
  validateThreshold(input.threshold);
  const range = normalizePrintRange(input.range, input.range.to);
  const selectedAssets = input.assets;
  if (selectedAssets.length !== range.to - range.from + 1) {
    throw new Error('打印资产必须覆盖打印范围');
  }
  selectedAssets.forEach(validateAsset);

  const assetsById = new Map<string, DirectPrintAsset>();
  selectedAssets.forEach((asset) => {
    const existing = assetsById.get(asset.assetId);
    if (existing && !sameAsset(existing, asset)) {
      throw new Error('同一打印资产标识必须对应相同内容');
    }
    assetsById.set(asset.assetId, asset);
  });
  const sourcePages = selectedAssets.map((asset, index) => ({
    asset,
    sourcePageNumber: range.from + index,
  }));
  const sequenceSources = input.collate
    ? Array.from({ length: copies }, (_, index) => sourcePages.map((source) => ({ ...source, copyNumber: index + 1 }))).flat()
    : sourcePages.flatMap((source) => Array.from({ length: copies }, (_, index) => ({ ...source, copyNumber: index + 1 })));
  const sequence = sequenceSources.map(({ asset, sourcePageNumber, copyNumber }, index) => ({
    ordinal: index + 1,
    assetId: asset.assetId,
    labelId: asset.labelId,
    sourcePageNumber,
    copyNumber,
  }));

  if (!Number.isInteger(input.expectedLabels) || input.expectedLabels !== sequence.length) {
    throw new Error('预期标签数必须与打印序列一致');
  }

  return {
    protocolVersion: PRINT_PROTOCOL_VERSION,
    jobId: input.jobId,
    createdAtUtc: input.createdAtUtc,
    websiteVersion: input.websiteVersion,
    printerId: input.printerId,
    printerName: input.printerName,
    profileId: XP420B_100X75_PROFILE.id,
    printerProfileVersion: input.printerProfileVersion,
    widthMm: XP420B_100X75_PROFILE.widthMm,
    heightMm: XP420B_100X75_PROFILE.heightMm,
    widthDots: XP420B_100X75_PROFILE.widthDots,
    heightDots: XP420B_100X75_PROFILE.heightDots,
    layout: input.layout,
    range,
    copies,
    collate: input.collate,
    horizontalOffsetMm: input.horizontalOffsetMm,
    verticalOffsetMm: input.verticalOffsetMm,
    threshold: input.threshold,
    expectedLabels: input.expectedLabels,
    assets: Array.from(assetsById.values()),
    sequence,
  };
}

export function validateDirectPrintJobManifest(manifest: DirectPrintJobManifest): void {
  assertOnlyKeys(manifest, [
    'protocolVersion', 'jobId', 'createdAtUtc', 'websiteVersion', 'printerId', 'printerName', 'profileId', 'printerProfileVersion',
    'widthMm', 'heightMm', 'widthDots', 'heightDots', 'layout', 'range', 'copies', 'collate', 'horizontalOffsetMm', 'verticalOffsetMm',
    'threshold', 'expectedLabels', 'assets', 'sequence',
  ], '打印任务');
  validateRequiredString(manifest.jobId, '任务标识');
  validateUtcDate(manifest.createdAtUtc);
  validateRequiredString(manifest.websiteVersion, '网站版本');
  validateRequiredString(manifest.printerId, '打印机标识');
  validateRequiredString(manifest.printerName, '打印机名称');
  validateRequiredString(manifest.printerProfileVersion, '打印机配置版本');
  if (manifest.protocolVersion !== PRINT_PROTOCOL_VERSION
    || manifest.profileId !== XP420B_100X75_PROFILE.id
    || manifest.widthMm !== XP420B_100X75_PROFILE.widthMm
    || manifest.heightMm !== XP420B_100X75_PROFILE.heightMm
    || manifest.widthDots !== XP420B_100X75_PROFILE.widthDots
    || manifest.heightDots !== XP420B_100X75_PROFILE.heightDots) {
    throw new Error('打印任务必须使用 XP-420B 100 × 75 mm 配置');
  }
  if (manifest.layout !== 'landscape' && manifest.layout !== 'portrait') {
    throw new Error('打印布局必须为 landscape 或 portrait');
  }
  if (typeof manifest.collate !== 'boolean') {
    throw new Error('逐份打印标记必须为布尔值');
  }
  validateCopies(manifest.copies);
  validateOffset(manifest.horizontalOffsetMm, '水平偏移');
  validateOffset(manifest.verticalOffsetMm, '垂直偏移');
  validateThreshold(manifest.threshold);
  assertOnlyKeys(manifest.range, ['from', 'to'], '打印范围');
  if (!Number.isInteger(manifest.range.from) || !Number.isInteger(manifest.range.to) || manifest.range.from < 1 || manifest.range.from > manifest.range.to) {
    throw new Error('打印范围必须是正整数且起始页不大于结束页');
  }
  if (!Array.isArray(manifest.assets) || !Array.isArray(manifest.sequence)) {
    throw new Error('打印资产和打印序列必须为数组');
  }
  const assetsById = new Map(manifest.assets.map((asset) => [asset.assetId, asset]));
  if (assetsById.size !== manifest.assets.length) {
    throw new Error('打印资产标识必须唯一');
  }
  manifest.assets.forEach(validateAsset);
  if (!Number.isInteger(manifest.expectedLabels) || manifest.expectedLabels !== manifest.sequence.length) {
    throw new Error('预期标签数必须与打印序列一致');
  }
  const pageCount = manifest.range.to - manifest.range.from + 1;
  const expectedSequenceLength = pageCount * manifest.copies;
  if (!Number.isSafeInteger(pageCount) || !Number.isSafeInteger(expectedSequenceLength)
    || manifest.sequence.length !== expectedSequenceLength) {
    throw new Error('打印序列必须完整覆盖每个源页和副本');
  }
  const sourceReferences = new Map<number, { assetId: string; labelId: string }>();
  const sourceCopyPairs = new Set<string>();
  manifest.sequence.forEach((entry, index) => {
    assertOnlyKeys(entry, ['ordinal', 'assetId', 'labelId', 'sourcePageNumber', 'copyNumber'], '打印序列项');
    if (!Number.isInteger(entry.ordinal) || entry.ordinal !== index + 1) {
      throw new Error('打印序列序号必须从 1 连续递增');
    }
    if (!Number.isInteger(entry.copyNumber) || entry.copyNumber < 1 || entry.copyNumber > manifest.copies) {
      throw new Error('打印序列副本号必须在有效份数内');
    }
    if (!Number.isInteger(entry.sourcePageNumber) || entry.sourcePageNumber < manifest.range.from || entry.sourcePageNumber > manifest.range.to) {
      throw new Error('打印序列源页必须在打印范围内');
    }
    const asset = assetsById.get(entry.assetId);
    if (!asset || asset.labelId !== entry.labelId) {
      throw new Error('打印序列存在缺口');
    }
    const sourceReference = sourceReferences.get(entry.sourcePageNumber);
    if (sourceReference && (sourceReference.assetId !== entry.assetId || sourceReference.labelId !== entry.labelId)) {
      throw new Error('同一源页必须引用同一打印资产和标签');
    }
    sourceReferences.set(entry.sourcePageNumber, { assetId: entry.assetId, labelId: entry.labelId });
    const pair = `${entry.sourcePageNumber}:${entry.copyNumber}`;
    if (sourceCopyPairs.has(pair)) {
      throw new Error('打印序列必须完整覆盖每个源页和副本');
    }
    sourceCopyPairs.add(pair);
  });
  manifest.sequence.forEach((entry, index) => {
    const expectedSourcePageNumber = manifest.collate
      ? manifest.range.from + (index % pageCount)
      : manifest.range.from + Math.floor(index / manifest.copies);
    const expectedCopyNumber = manifest.collate
      ? Math.floor(index / pageCount) + 1
      : (index % manifest.copies) + 1;
    if (entry.sourcePageNumber !== expectedSourcePageNumber || entry.copyNumber !== expectedCopyNumber) {
      throw new Error('打印序列顺序与逐份打印设置不一致');
    }
  });
  const appearances = new Map(manifest.assets.map((asset) => [asset.assetId, 0]));
  manifest.sequence.forEach((entry) => appearances.set(entry.assetId, (appearances.get(entry.assetId) ?? 0) + 1));
  if (Array.from(appearances.values()).some((count) => count === 0)) {
    throw new Error('每个打印资产必须在序列中出现一次');
  }
  for (let sourcePageNumber = manifest.range.from; sourcePageNumber <= manifest.range.to; sourcePageNumber += 1) {
    for (let copyNumber = 1; copyNumber <= manifest.copies; copyNumber += 1) {
      if (!sourceCopyPairs.has(`${sourcePageNumber}:${copyNumber}`)) {
        throw new Error('打印序列必须完整覆盖每个源页和副本');
      }
    }
  }
}

function sameAsset(left: DirectPrintAsset, right: DirectPrintAsset): boolean {
  return left.assetId === right.assetId && left.labelId === right.labelId
    && left.widthDots === right.widthDots && left.heightDots === right.heightDots
    && left.rotation === right.rotation && left.pngBase64 === right.pngBase64 && left.sha256 === right.sha256;
}

function validateCopies(copies: number): void {
  if (!Number.isInteger(copies) || copies < 1 || copies > 100) {
    throw new Error('打印份数必须在 1–100 之间');
  }
}

function validateGroup(group: DirectPrintGroup): void {
  if (group.widthMm !== 100 || group.heightMm !== 75) {
    throw new Error('仅支持 100 × 75 mm 标签组');
  }
}

function validateOffset(offsetMm: number, axis: string): void {
  if (!Number.isFinite(offsetMm) || offsetMm < -10 || offsetMm > 10) {
    throw new Error(`${axis}必须在 -10–10 mm 之间`);
  }
}

function validateThreshold(threshold: DirectPrintThreshold): void {
  assertOnlyKeys(threshold, ['mode', 'value'], '阈值');
  if (threshold.mode !== 'text' && threshold.mode !== 'auto' && threshold.mode !== 'custom') {
    throw new Error('阈值模式必须为 text、auto 或 custom');
  }
  if (threshold.mode === 'custom') {
    const value = threshold.value;
    if (!Number.isInteger(value) || value === undefined || value < 0 || value > 255) {
      throw new Error('自定义阈值必须在 0–255 之间');
    }
  }
  if (threshold.mode !== 'custom' && threshold.value !== undefined) {
    throw new Error('仅自定义阈值模式可设置阈值');
  }
  assertOnlyKeys(threshold, threshold.mode === 'custom' ? ['mode', 'value'] : ['mode'], '阈值');
}

function validateAsset(asset: DirectPrintAsset): void {
  assertOnlyKeys(asset, ['assetId', 'labelId', 'widthDots', 'heightDots', 'rotation', 'pngBase64', 'sha256'], '打印资产');
  validateRequiredString(asset.assetId, '打印资产标识');
  validateRequiredString(asset.labelId, '打印资产标签标识');
  if (asset.widthDots !== 800 || asset.heightDots !== 600) {
    throw new Error('打印资产必须为 800 × 600 dots');
  }
  if (asset.rotation !== 0 && asset.rotation !== 90 && asset.rotation !== 180 && asset.rotation !== 270) {
    throw new Error('打印资产旋转角度无效');
  }
  if (!isBase64(asset.pngBase64)) {
    throw new Error('打印资产 PNG 数据不是有效的 Base64');
  }
  const bytes = atob(asset.pngBase64);
  if (bytes.length < 8 || ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes.charCodeAt(index) === byte)) {
    throw new Error('打印资产必须是 PNG 图像');
  }
  if (!hasCompletePngStructure(bytes)) {
    throw new Error('打印资产 PNG 图像结构不完整');
  }
  if (typeof asset.sha256 !== 'string' || !/^[A-Fa-f0-9]{64}$/.test(asset.sha256)) {
    throw new Error('打印资产 SHA-256 格式无效');
  }
}

function assertOnlyKeys(value: unknown, allowedKeys: string[], subject: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.keys(value).some((key) => !allowedKeys.includes(key))) {
    throw new Error(`${subject}包含不支持的字段`);
  }
}

function validateRequiredString(value: unknown, subject: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${subject}不能为空`);
  }
}

function validateUtcDate(value: unknown): void {
  if (typeof value !== 'string') {
    throw new Error('创建时间必须是有效的 UTC 日期时间');
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/.exec(value);
  if (!match) {
    throw new Error('创建时间必须是有效的 UTC 日期时间');
  }
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())
    || date.getUTCFullYear() !== year
    || date.getUTCMonth() + 1 !== month
    || date.getUTCDate() !== day
    || date.getUTCHours() !== hour
    || date.getUTCMinutes() !== minute
    || date.getUTCSeconds() !== second) {
    throw new Error('创建时间必须是有效的 UTC 日期时间');
  }
}

function isBase64(value: unknown): value is string {
  return typeof value === 'string' && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
}

function hasCompletePngStructure(bytes: string): boolean {
  let offset = 8;
  let chunkIndex = 0;
  while (offset + 12 <= bytes.length) {
    const length = readPngUint32(bytes, offset);
    const type = bytes.slice(offset + 4, offset + 8);
    const nextOffset = offset + 12 + length;
    if (nextOffset > bytes.length || (chunkIndex === 0 && (type !== 'IHDR' || length !== 13))) {
      return false;
    }
    if (type === 'IEND') {
      return length === 0 && nextOffset === bytes.length;
    }
    offset = nextOffset;
    chunkIndex += 1;
  }
  return false;
}

function readPngUint32(bytes: string, offset: number): number {
  return (bytes.charCodeAt(offset) * 0x1000000)
    + (bytes.charCodeAt(offset + 1) << 16)
    + (bytes.charCodeAt(offset + 2) << 8)
    + bytes.charCodeAt(offset + 3);
}
