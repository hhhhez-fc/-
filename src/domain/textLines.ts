import type { InlineTextStyle, LabelTextLine, TextPlacement } from './labels';

export type TextLineAlignment = 'left' | 'center' | 'right' | 'keep';

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
  const expandsDefaultCenteredLine = existing.length === 1
    && existing[0].placement.xPercent === 50
    && existing[0].placement.yPercent === 50
    && existing[0].placement.horizontalSnap === 'center'
    && existing[0].placement.verticalSnap === 'middle'
    && fresh.length > 1;
  return fresh.map((line, index) => existing[index] ? {
    ...existing[index],
    text: line.text,
    placement: expandsDefaultCenteredLine ? {
      xPercent: 50,
      yPercent: Math.round((((index + .5) * 100) / fresh.length) * 100) / 100,
      horizontalSnap: 'center',
      verticalSnap: 'free',
    } : { ...existing[index].placement },
    style: { ...existing[index].style },
  } : expandsDefaultCenteredLine ? {
    ...line,
    placement: {
      xPercent: 50,
      yPercent: Math.round((((index + .5) * 100) / fresh.length) * 100) / 100,
      horizontalSnap: 'center',
      verticalSnap: 'free',
    },
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

export function alignTextLines(lines: LabelTextLine[], alignment: TextLineAlignment): LabelTextLine[] {
  const printable = lines.filter((line) => line.text.trim());
  let printableIndex = 0;
  return lines.map((line) => {
    if (!line.text.trim()) return line;
    const yPercent = printable.length === 1
      ? 50
      : Math.round((((printableIndex + 1) * 100) / (printable.length + 1)) * 100) / 100;
    printableIndex += 1;
    const horizontal = alignment === 'keep'
      ? { xPercent: line.placement.xPercent, horizontalSnap: line.placement.horizontalSnap }
      : alignment === 'left'
        ? { xPercent: 0, horizontalSnap: 'left' as const }
        : alignment === 'right'
          ? { xPercent: 100, horizontalSnap: 'right' as const }
          : { xPercent: 50, horizontalSnap: 'center' as const };
    return {
      ...line,
      placement: {
        ...line.placement,
        ...horizontal,
        yPercent,
        verticalSnap: printable.length === 1 ? 'middle' : 'free',
      },
    };
  });
}

export function contentWithUpdatedTextLine(lines: LabelTextLine[], id: string, text: string): string {
  return lines.map((line) => line.id === id ? text : line.text).join('\n');
}

export type TextLinePatch = Partial<Pick<LabelTextLine, 'textOrientation'>> & { style?: InlineTextStyle };

export function updateSelectedTextLines(
  lines: LabelTextLine[],
  selectedIds: string[],
  patch: TextLinePatch,
): LabelTextLine[] {
  const selected = new Set(selectedIds);
  return lines.map((line) => selected.has(line.id) ? {
    ...line,
    ...patch,
    style: patch.style ? { ...line.style, ...patch.style } : { ...line.style },
    placement: { ...line.placement },
  } : line);
}

export function moveSelectedTextLines(
  lines: LabelTextLine[],
  selectedIds: string[],
  dx: number,
  dy: number,
): LabelTextLine[] {
  const selected = new Set(selectedIds);
  const moving = lines.filter((line) => selected.has(line.id));
  if (!moving.length) return lines;
  const clampedX = Math.max(
    -Math.min(...moving.map((line) => line.placement.xPercent)),
    Math.min(dx, 100 - Math.max(...moving.map((line) => line.placement.xPercent))),
  );
  const clampedY = Math.max(
    -Math.min(...moving.map((line) => line.placement.yPercent)),
    Math.min(dy, 100 - Math.max(...moving.map((line) => line.placement.yPercent))),
  );
  return lines.map((line) => selected.has(line.id) ? {
    ...line,
    placement: {
      xPercent: line.placement.xPercent + clampedX,
      yPercent: line.placement.yPercent + clampedY,
      horizontalSnap: clampedX ? 'free' : line.placement.horizontalSnap,
      verticalSnap: clampedY ? 'free' : line.placement.verticalSnap,
    },
  } : line);
}

export function cloneTextLinesWithFreshIds(lines: LabelTextLine[]): LabelTextLine[] {
  return lines.map((line) => ({
    ...line,
    id: crypto.randomUUID(),
    style: { ...line.style },
    placement: { ...line.placement },
  }));
}
