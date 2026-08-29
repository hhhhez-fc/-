import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

const parseVersion = (version: string) => version.split('.').map((part) => Number(part));

const isAtLeast = (version: string, minimum: [number, number, number]) => {
  const actual = parseVersion(version);

  for (let index = 0; index < minimum.length; index += 1) {
    if (actual[index] > minimum[index]) return true;
    if (actual[index] < minimum[index]) return false;
  }

  return true;
};

describe('spreadsheet dependency security floor', () => {
  it('uses a SheetJS release with the prototype-pollution and ReDoS fixes', () => {
    expect(isAtLeast(XLSX.version, [0, 20, 2])).toBe(true);
  });
});
