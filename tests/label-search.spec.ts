import { expect, it } from 'vitest';
import { createLabel } from '../src/domain/labels';
import { filterLabelsByQuery } from '../src/domain/labelSearch';

it('matches content without case sensitivity and returns all labels for blank input', () => {
  const labels = [
    createLabel({ content: 'AREEN-21', quantity: 1, source: 'manual', needsReview: false }),
    createLabel({ content: 'BOX-9', quantity: 1, source: 'manual', needsReview: false }),
  ];
  expect(filterLabelsByQuery(labels, ' areen ')).toEqual([labels[0]]);
  expect(filterLabelsByQuery(labels, '  ')).toBe(labels);
  expect(labels.map(({ content }) => content)).toEqual(['AREEN-21', 'BOX-9']);
});
