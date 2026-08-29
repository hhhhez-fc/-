import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { parseWorkbook, rowsToLabelsWithColumns } from '../src/domain/importing';

describe('Excel 工作簿导入', () => {
  it('保留工作表名称、表头和数据行供用户选择', () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([['唛头', '数量'], ['FY-01', 3]]),
      '外箱唛头',
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([['内容', '件数'], ['ENVELOPE', 1]]),
      '信封',
    );
    const data = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;

    expect(parseWorkbook(data)).toEqual({
      sheets: [
        { name: '外箱唛头', headers: ['唛头', '数量'], rows: [['FY-01', '3']] },
        { name: '信封', headers: ['内容', '件数'], rows: [['ENVELOPE', '1']] },
      ],
    });
  });

  it('允许用明确列索引转换无法自动识别的表格', () => {
    const labels = rowsToLabelsWithColumns(['A', 'B'], [['FY-02', '4']], 'small', {
      contentColumn: 0,
      quantityColumn: 1,
    });

    expect(labels[0]).toMatchObject({
      content: 'FY-02',
      quantity: 4,
      sizePresetId: 'small',
      source: 'excel',
      needsReview: false,
    });
  });
});
