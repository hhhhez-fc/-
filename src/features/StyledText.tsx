import type { CSSProperties } from 'react';
import type { LabelRecord, LabelTextLine } from '../domain/labels';
import { buildStyledSegments } from '../domain/richText';

interface StyledTextProps {
  label: LabelRecord;
  fallback?: string;
}

export default function StyledText({ label, fallback = '' }: StyledTextProps) {
  const content = label.content || fallback;
  return <>{buildStyledSegments(content, label.textStyleRanges).map((segment, index) => {
    const style: CSSProperties = {
      fontFamily: segment.style.fontFamily,
      fontSize: segment.style.fontSizePt ? `${segment.style.fontSizePt}pt` : undefined,
      fontWeight: segment.style.fontWeight,
      fontStyle: segment.style.italic ? 'italic' : undefined,
      textDecoration: segment.style.underline ? 'underline' : undefined,
    };
    return <span style={style} key={`${index}-${segment.text}`}>{segment.text}</span>;
  })}</>;
}

export function StyledTextLine({
  label,
  line,
  lineIndex,
  previewScale,
  fontScale = 1,
}: {
  label: LabelRecord;
  line: LabelTextLine;
  lineIndex: number;
  previewScale?: number;
  fontScale?: number;
}) {
  const values = label.content.replace(/\r\n?/g, '\n').split('\n');
  const offset = values.slice(0, lineIndex).reduce((total, value) => total + value.length + 1, 0);
  const ranges = label.textStyleRanges
    .filter((range) => range.end > offset && range.start < offset + line.text.length)
    .map((range) => ({
      ...range,
      start: Math.max(0, range.start - offset),
      end: Math.min(line.text.length, range.end - offset),
    }));
  return <>{buildStyledSegments(line.text || ' ', ranges).map((segment, index) => {
    const style: CSSProperties = {
      fontFamily: segment.style.fontFamily,
      fontSize: segment.style.fontSizePt
        ? previewScale === undefined
          ? `${segment.style.fontSizePt * fontScale}pt`
          : `${segment.style.fontSizePt * fontScale * (96 / 72) * previewScale}px`
        : undefined,
      fontWeight: segment.style.fontWeight,
      fontStyle: segment.style.italic ? 'italic' : undefined,
      textDecoration: segment.style.underline ? 'underline' : undefined,
    };
    return <span style={style} key={`${index}-${segment.text}`}>{segment.text}</span>;
  })}</>;
}
