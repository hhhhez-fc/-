import type { LabelRecord } from './labels';

export function filterLabelsByQuery(labels: LabelRecord[], query: string): LabelRecord[] {
  const normalized = query.trim().toLocaleLowerCase();
  return normalized
    ? labels.filter(({ content }) => content.toLocaleLowerCase().includes(normalized))
    : labels;
}
