export type SizeType = 'large' | 'small';
export type LabelSource = 'excel' | 'image' | 'manual';
export type LabelPurpose = 'carton' | 'envelope';
export type LabelContentType = 'text' | 'image';

export interface InlineTextStyle {
  fontFamily?: string;
  fontSizePt?: number;
  fontWeight?: 400 | 700;
  italic?: boolean;
  underline?: boolean;
}

export interface TextStyleRange {
  start: number;
  end: number;
  style: InlineTextStyle;
}

export interface TextPlacement {
  xPercent: number;
  yPercent: number;
  horizontalSnap: 'left' | 'center' | 'right' | 'free';
  verticalSnap: 'top' | 'middle' | 'bottom' | 'free';
}

export interface PrintAreaMm {
  leftMm: number;
  topMm: number;
  widthMm: number;
  heightMm: number;
}

export interface LabelTextLine {
  id: string;
  text: string;
  placement: TextPlacement;
  style: InlineTextStyle;
  textOrientation: 'horizontal' | 'vertical';
}

export interface LabelStyle {
  fontFamily: string;
  fontMode: 'auto' | 'fixed';
  fontSizePt: number;
  fontWeight: 400 | 700;
  italic: boolean;
  underline: boolean;
  textOrientation: 'horizontal' | 'vertical';
  horizontalAlign: 'left' | 'center' | 'right';
  verticalAlign: 'top' | 'middle' | 'bottom';
  lineHeight: 1.05 | 1.2 | 1.4;
  borderWidthMm: number;
}

export const defaultStyle: LabelStyle = {
  fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
  fontMode: 'fixed',
  fontSizePt: 26,
  fontWeight: 700,
  italic: false,
  underline: false,
  textOrientation: 'horizontal',
  horizontalAlign: 'center',
  verticalAlign: 'middle',
  lineHeight: 1.2,
  borderWidthMm: 0,
};

export interface LabelRecord {
  id: string;
  content: string;
  quantity: number;
  sizeType: SizeType;
  sizePresetId: string;
  source: LabelSource;
  purpose: LabelPurpose;
  contentType: LabelContentType;
  sides: number;
  style: LabelStyle;
  textStyleRanges: TextStyleRange[];
  placement: TextPlacement;
  printArea?: PrintAreaMm;
  textLines: LabelTextLine[];
  imageFallback?: string;
  needsReview: boolean;
  reviewReason?: string;
}

export interface LabelSpec {
  widthMm: number;
  heightMm: number;
  paddingMm: number;
  maxFontSize: number;
  minFontSize: number;
  paperSize: string;
}

export interface SizePreset extends LabelSpec {
  id: string;
  name: string;
}

export type LabelSpecs = Record<SizeType, LabelSpec>;

export const defaultSpecs: LabelSpecs = {
  large: { widthMm: 100, heightMm: 60, paddingMm: 5, maxFontSize: 56, minFontSize: 12, paperSize: 'custom' },
  small: { widthMm: 70, heightMm: 45, paddingMm: 4, maxFontSize: 38, minFontSize: 10, paperSize: 'custom' },
};

export const defaultSizePresets: SizePreset[] = [
  { id: 'large', name: '大唛头', ...defaultSpecs.large },
  { id: 'small', name: '小唛头', ...defaultSpecs.small },
];

export function defaultSizeTypeForBusiness(business: string): SizeType {
  return business.trim() === '义乌铺' ? 'large' : 'small';
}

type CreateLabelInput = Pick<LabelRecord, 'content' | 'quantity' | 'source' | 'needsReview'>
  & Partial<Omit<LabelRecord, 'id' | 'content' | 'quantity' | 'source' | 'needsReview'>>;

export function createLabel(partial: CreateLabelInput): LabelRecord {
  const sizePresetId = partial.sizePresetId ?? partial.sizeType ?? 'small';
  const sizeType: SizeType = sizePresetId === 'large' ? 'large' : 'small';
  const defaultPlacement: TextPlacement = {
    xPercent: 50,
    yPercent: 50,
    horizontalSnap: 'center',
    verticalSnap: 'middle',
  };
  const record = {
    id: crypto.randomUUID(),
    purpose: 'carton',
    contentType: 'text',
    sides: 1,
    sizePresetId,
    sizeType,
    style: { ...defaultStyle },
    ...partial,
    printArea: partial.printArea ? { ...partial.printArea } : undefined,
    textStyleRanges: partial.textStyleRanges?.map((range) => ({
      ...range,
      style: { ...range.style },
    })) ?? [],
    placement: partial.placement ? { ...partial.placement } : defaultPlacement,
  } as LabelRecord;
  record.textLines = partial.textLines?.map((line) => ({
    ...line,
    placement: { ...line.placement },
    style: { ...line.style },
  })) ?? createDefaultTextLines(record.content, record.placement);
  return record;
}

function createDefaultTextLines(content: string, fallbackPlacement: TextPlacement): LabelTextLine[] {
  const values = content.replace(/\r\n?/g, '\n').split('\n');
  if (values.length === 1) {
    return [{ id: crypto.randomUUID(), text: values[0], placement: { ...fallbackPlacement }, style: {}, textOrientation: 'horizontal' }];
  }
  return values.map((text, index) => ({
    id: crypto.randomUUID(),
    text,
    placement: {
      xPercent: 50,
      yPercent: Math.round((((index + 1) * 100) / (values.length + 1)) * 100) / 100,
      horizontalSnap: 'center',
      verticalSnap: 'free',
    },
    style: {},
    textOrientation: 'horizontal',
  }));
}

export function getPrintCopies(label: LabelRecord): number {
  return label.quantity * label.sides;
}

export function validateSizePreset(preset: SizePreset): string[] {
  const errors: string[] = [];
  if (!Number.isFinite(preset.widthMm) || preset.widthMm < 20 || preset.widthMm > 300) {
    errors.push('宽度必须在 20–300 mm 之间');
  }
  if (!Number.isFinite(preset.heightMm) || preset.heightMm < 15 || preset.heightMm > 300) {
    errors.push('高度必须在 15–300 mm 之间');
  }
  if (!Number.isFinite(preset.paddingMm) || preset.paddingMm < 0 || preset.paddingMm >= Math.min(preset.widthMm, preset.heightMm) / 2) {
    errors.push('内边距必须小于短边的一半');
  }
  return errors;
}
