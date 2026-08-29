import type { LabelTextLine, TextPlacement } from './labels';

const centeredPlacement: TextPlacement = {
  xPercent: 50,
  yPercent: 50,
  horizontalSnap: 'center',
  verticalSnap: 'middle',
};

export function createTextLines(content: string): LabelTextLine[] {
  const values = content.replace(/\r\n?/g, '\n').split('\n');
  return values.map((text, index) => ({
    id: crypto.randomUUID(),
    text,
    placement: values.length === 1 ? { ...centeredPlacement } : {
      xPercent: 50,
      yPercent: Math.round((((index + 1) * 100) / (values.length + 1)) * 100) / 100,
      horizontalSnap: 'center',
      verticalSnap: 'free',
    },
    style: {},
    textOrientation: 'horizontal',
  }));
}

export function syncTextLines(existing: LabelTextLine[], content: string): LabelTextLine[] {
  const fresh = createTextLines(content);
  return fresh.map((line, index) => existing[index] ? {
    ...existing[index],
    text: line.text,
    placement: { ...existing[index].placement },
    style: { ...existing[index].style },
  } : line);
}

export function updateTextLine(
  lines: LabelTextLine[],
  id: string,
  patch: Partial<Omit<LabelTextLine, 'id' | 'text'>>,
): LabelTextLine[] {
  return lines.map((line) => line.id === id ? {
    ...line,
    ...patch,
    placement: patch.placement ? { ...patch.placement } : line.placement,
    style: patch.style ? { ...patch.style } : line.style,
  } : line);
}

export function contentWithUpdatedTextLine(lines: LabelTextLine[], id: string, text: string): string {
  return lines.map((line) => line.id === id ? text : line.text).join('\n');
}
