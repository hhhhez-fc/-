// @vitest-environment jsdom

import * as XLSX from 'xlsx';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseWorkbook, rowsToLabelsWithColumns } from '../src/domain/importing';
import ExcelImporter from '../src/features/ExcelImporter';

afterEach(cleanup);

const createWorkbookFile = (rows: unknown[][]) => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), '外箱唛头');
  const data = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const file = new File([data], 'marks.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  if (!file.arrayBuffer) {
    Object.defineProperty(file, 'arrayBuffer', { configurable: true, value: () => Promise.resolve(data) });
  }
  return file;
};

const importWorkbook = async (file: File) => {
  const input = screen.getByLabelText('选择 Excel 文件') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => expect(screen.getByText('marks.xlsx')).toBeTruthy());
};

const selectRange = async (start: HTMLElement, end: HTMLElement = start) => {
  fireEvent.pointerDown(start, { button: 0 });
  fireEvent.pointerEnter(end);
  await waitFor(() => expect(start.className).toContain('is-draft-region'));
  fireEvent.pointerUp(window);
};

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

  it('框选多个非空区域后只导入一条且保留区域顺序与状态文案', async () => {
    const onImport = vi.fn();
    const onStatus = vi.fn();
    const userFile = createWorkbookFile([
      ['A', 'B'],
      ['FY-01', 'BLUE'],
      ['MADE IN CHINA', ''],
      ['FY-02', 'RED'],
    ]);
    render(createElement(ExcelImporter, { sizePresetId: 'small', purpose: 'carton', onImport, onStatus }));
    await importWorkbook(userFile);
    fireEvent.click(screen.getByRole('button', { name: '框选区域' }));

    const cells = within(screen.getByRole('table', { name: '外箱唛头 可框选区域' })).getAllByRole('cell');
    await selectRange(cells[2], cells[5]);
    await selectRange(cells[6], cells[7]);
    fireEvent.click(screen.getByRole('button', { name: '提取 2 个区域' }));

    expect(onImport).toHaveBeenCalledTimes(1);
    expect(onImport.mock.calls[0][0]).toHaveLength(1);
    expect(onImport.mock.calls[0][0][0]).toMatchObject({
      content: 'FY-01\nBLUE\nMADE IN CHINA\nFY-02\nRED',
      quantity: 1,
      sides: 1,
      source: 'excel',
    });
    expect(onStatus).toHaveBeenLastCalledWith('已从 外箱唛头 提取 1 条唛头');
  });

  it('框选空区域后显示错误且不导入', async () => {
    const onImport = vi.fn();
    const onStatus = vi.fn();
    render(createElement(ExcelImporter, { sizePresetId: 'small', purpose: 'carton', onImport, onStatus }));
    await importWorkbook(createWorkbookFile([
      ['A', 'B'],
      ['FY-01', ''],
    ]));
    fireEvent.click(screen.getByRole('button', { name: '框选区域' }));

    const cells = within(screen.getByRole('table', { name: '外箱唛头 可框选区域' })).getAllByRole('cell');
    await selectRange(cells[3]);
    fireEvent.click(screen.getByRole('button', { name: '提取 1 个区域' }));

    expect(screen.getByRole('alert').textContent).toContain('框选区域没有可导入内容');
    expect(onImport).not.toHaveBeenCalled();
  });
});
