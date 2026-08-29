import * as XLSX from 'xlsx';
import { createLabel, type LabelPurpose, type LabelRecord } from './labels';
import { parseQuantity } from './quantity';

const contentWords = ['唛头', '内容', 'mark', 'label', 'shipping mark'];
const quantityWords = ['数量', '件数', '箱数', 'ctns', 'qty', 'quantity', '件'];

const normalise = (value: string) => value.toLowerCase().replace(/[\s（）()\[\]【】_\-]/g, '');

export function identifyExcelColumns(headers: string[]) {
  const find = (words: string[]) => headers.findIndex((header) => {
    const candidate = normalise(header);
    return words.some((word) => candidate.includes(normalise(word)));
  });
  const contentColumn = find(contentWords);
  const quantityColumn = find(quantityWords);
  return { contentColumn, quantityColumn, needsManualMapping: contentColumn < 0 || quantityColumn < 0 };
}

export interface ExcelColumns {
  contentColumn: number;
  quantityColumn: number;
}

export interface ParsedSheet {
  name: string;
  headers: string[];
  rows: unknown[][];
}

export interface ParsedWorkbook {
  sheets: ParsedSheet[];
}

export interface CellRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

export function normalizeCellRange(range: CellRange): CellRange {
  return {
    startRow: Math.min(range.startRow, range.endRow),
    startCol: Math.min(range.startCol, range.endCol),
    endRow: Math.max(range.startRow, range.endRow),
    endCol: Math.max(range.startCol, range.endCol),
  };
}

function columnName(index: number): string {
  let value = index + 1;
  let result = '';
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

export function formatCellRange(range: CellRange): string {
  const normalized = normalizeCellRange(range);
  return `${columnName(normalized.startCol)}${normalized.startRow + 1}:${columnName(normalized.endCol)}${normalized.endRow + 1}`;
}

function sheetMatrix(sheet: ParsedSheet): unknown[][] {
  return [sheet.headers, ...sheet.rows];
}

export function extractRegionText(sheet: ParsedSheet, range: CellRange): string {
  const matrix = sheetMatrix(sheet);
  const normalized = normalizeCellRange(range);
  const values: string[] = [];
  for (let row = normalized.startRow; row <= normalized.endRow; row += 1) {
    for (let col = normalized.startCol; col <= normalized.endCol; col += 1) {
      const value = String(matrix[row]?.[col] ?? '').trim();
      if (value) values.push(value);
    }
  }
  return values.join('\n');
}

export function regionsToLabels(
  sheet: ParsedSheet,
  ranges: CellRange[],
  sizePresetId: string,
  purpose: LabelPurpose = 'carton',
): LabelRecord[] {
  return ranges.map((range) => extractRegionText(sheet, range)).filter(Boolean).map((content) => createLabel({
    content,
    contentType: 'text',
    purpose,
    sizePresetId,
    quantity: 1,
    sides: 1,
    source: 'excel',
    needsReview: true,
    reviewReason: 'Excel 框选内容需要人工校对',
  }));
}

export function parseWorkbook(data: ArrayBuffer | Uint8Array): ParsedWorkbook {
  const workbook = XLSX.read(data, { type: 'array' });
  const sheets = workbook.SheetNames.map((name) => {
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], {
      header: 1,
      raw: false,
      defval: '',
    });
    const [headerRow = [], ...dataRows] = matrix;
    const headers = headerRow.map((value) => String(value ?? '').trim());
    const rows = dataRows.filter((row) => row.some((value) => String(value ?? '').trim() !== ''));
    return { name, headers, rows };
  });
  return { sheets };
}

export function rowsToLabelsWithColumns(
  _headers: string[],
  rows: unknown[][],
  sizePresetId: string,
  columns: ExcelColumns,
  purpose: LabelPurpose = 'carton',
): LabelRecord[] {
  return rows
    .map((row) => {
      const content = String(row[columns.contentColumn] ?? '').trim();
      const parsed = parseQuantity(row[columns.quantityColumn]);
      if (!content) return null;
      return createLabel({
        content,
        contentType: 'text',
        purpose,
        sizePresetId,
        quantity: parsed.quantity,
        sides: 1,
        source: 'excel',
        needsReview: parsed.needsReview,
        reviewReason: parsed.needsReview ? '未识别到有效数量，请确认打印数量' : undefined,
      });
    })
    .filter((label): label is LabelRecord => label !== null);
}

export function rowsToLabels(headers: string[], rows: unknown[][], sizeType: string): LabelRecord[] {
  const columns = identifyExcelColumns(headers);
  if (columns.needsManualMapping) return [];
  return rowsToLabelsWithColumns(headers, rows, sizeType, columns);
}
