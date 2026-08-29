import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

const parseVersion = (version: string) => {
  const parts = version.split('.');
  if (parts.length !== 3 || parts.some((part) => !/^\d+$/.test(part))) return null;
  return parts.map((part) => Number(part));
};

const isAtLeast = (version: string, minimum: [number, number, number]) => {
  const actual = parseVersion(version);
  if (!actual) return false;

  for (let index = 0; index < minimum.length; index += 1) {
    if (actual[index] > minimum[index]) return true;
    if (actual[index] < minimum[index]) return false;
  }

  return true;
};

describe('spreadsheet dependency security floor', () => {
  it('rejects malformed semantic versions', () => {
    expect(isAtLeast('0.20.x', [0, 20, 2])).toBe(false);
  });

  it('uses a SheetJS release with the prototype-pollution and ReDoS fixes', () => {
    expect(isAtLeast(XLSX.version, [0, 20, 2])).toBe(true);
  });
});
