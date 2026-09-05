import { useCallback, useEffect, useId, useMemo, useState, type ChangeEvent, type KeyboardEvent, type PointerEvent } from 'react';
import {
  formatCellRange,
  identifyExcelColumns,
  normalizeCellRange,
  parseWorkbook,
  regionsToLabel,
  rowsToLabelsWithColumns,
  type CellRange,
  type ParsedWorkbook,
} from '../domain/importing';
import type { LabelPurpose, LabelRecord } from '../domain/labels';

interface ExcelImporterProps {
  sizePresetId: string;
  purpose: LabelPurpose;
  onImport: (labels: LabelRecord[]) => void;
  onStatus: (message: string) => void;
}

const MAX_EXCEL_BYTES = 20 * 1024 * 1024;

export default function ExcelImporter({ sizePresetId, purpose, onImport, onStatus }: ExcelImporterProps) {
  const [workbook, setWorkbook] = useState<ParsedWorkbook | null>(null);
  const [fileName, setFileName] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [contentColumn, setContentColumn] = useState(-1);
  const [quantityColumn, setQuantityColumn] = useState(-1);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'columns' | 'regions'>('columns');
  const [regions, setRegions] = useState<CellRange[]>([]);
  const [dragRange, setDragRange] = useState<CellRange | null>(null);
  const [keyboardRange, setKeyboardRange] = useState<CellRange | null>(null);
  const keyboardHelpId = useId();
  const activeSheet = useMemo(
    () => workbook?.sheets.find((sheet) => sheet.name === sheetName) ?? null,
    [sheetName, workbook],
  );
  const matrix = useMemo(() => activeSheet ? [activeSheet.headers, ...activeSheet.rows] : [], [activeSheet]);
  const columnCount = useMemo(() => matrix.reduce((maximum, row) => Math.max(maximum, row.length), 0), [matrix]);

  const appendRegion = useCallback((range: CellRange) => {
    const normalized = normalizeCellRange(range);
    setRegions((current) => current.some((item) => formatCellRange(item) === formatCellRange(normalized))
      ? current
      : [...current, normalized]);
  }, []);

  useEffect(() => {
    if (!dragRange) return;
    const finish = () => {
      appendRegion(dragRange);
      setDragRange(null);
    };
    window.addEventListener('pointerup', finish, { once: true });
    return () => window.removeEventListener('pointerup', finish);
  }, [appendRegion, dragRange]);

  const selectSheet = (nextName: string, parsed = workbook) => {
    setSheetName(nextName);
    setRegions([]);
    setDragRange(null);
    setKeyboardRange(null);
    const sheet = parsed?.sheets.find((item) => item.name === nextName);
    if (!sheet) return;
    const columns = identifyExcelColumns(sheet.headers);
    setContentColumn(columns.contentColumn);
    setQuantityColumn(columns.quantityColumn);
  };

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError('');
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (!extension || !['xlsx', 'xls', 'csv'].includes(extension)) {
      setError('仅支持 XLSX、XLS 和 CSV 文件');
      return;
    }
    if (file.size === 0 || file.size > MAX_EXCEL_BYTES) {
      setError(file.size === 0 ? 'Excel 文件为空' : 'Excel 文件不能超过 20 MB');
      return;
    }
    try {
      onStatus('正在读取 Excel…');
      const parsed = parseWorkbook(await file.arrayBuffer());
      if (!parsed.sheets.length || parsed.sheets.every((sheet) => sheet.headers.length === 0)) {
        throw new Error('工作簿没有可读取的工作表');
      }
      setWorkbook(parsed);
      setFileName(file.name);
      selectSheet(parsed.sheets[0].name, parsed);
      onStatus(`已读取 ${parsed.sheets.length} 个工作表`);
    } catch (cause) {
      setWorkbook(null);
      setError(cause instanceof Error ? cause.message : '无法读取 Excel 文件');
      onStatus('Excel 读取失败');
    }
  };

  const confirmImport = () => {
    if (!activeSheet || contentColumn < 0 || quantityColumn < 0) return;
    const labels = rowsToLabelsWithColumns(activeSheet.headers, activeSheet.rows, sizePresetId, {
      contentColumn,
      quantityColumn,
    }, purpose);
    if (labels.length === 0) {
      setError('所选工作表没有可导入的唛头内容');
      return;
    }
    onImport(labels);
    onStatus(`已从 ${activeSheet.name} 导入 ${labels.length} 条唛头`);
    setWorkbook(null);
  };

  const confirmRegionImport = () => {
    if (!activeSheet || regions.length === 0) return;
    const label = regionsToLabel(activeSheet, regions, sizePresetId, purpose);
    if (!label) {
      setError('框选区域没有可导入内容');
      return;
    }
    onImport([label]);
    onStatus(`已从 ${activeSheet.name} 提取 1 条唛头`);
    setWorkbook(null);
    setRegions([]);
    setKeyboardRange(null);
  };

  const startSelection = (event: PointerEvent<HTMLTableCellElement>, row: number, col: number) => {
    if (event.button !== 0) return;
    event.preventDefault();
    setDragRange({ startRow: row, startCol: col, endRow: row, endCol: col });
  };

  const extendSelection = (row: number, col: number) => {
    setDragRange((current) => current ? { ...current, endRow: row, endCol: col } : null);
  };

  const handleCellKeyDown = (event: KeyboardEvent<HTMLButtonElement>, row: number, col: number) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (keyboardRange) {
        appendRegion({ ...keyboardRange, endRow: row, endCol: col });
        setKeyboardRange(null);
      } else {
        setKeyboardRange({ startRow: row, startCol: col, endRow: row, endCol: col });
      }
      return;
    }
    if (event.key === 'Escape' && keyboardRange) {
      event.preventDefault();
      setKeyboardRange(null);
      return;
    }
    const movement = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    }[event.key];
    if (!movement) return;
    event.preventDefault();
    const nextRow = Math.max(0, Math.min(matrix.length - 1, row + movement[0]));
    const nextCol = Math.max(0, Math.min(columnCount - 1, col + movement[1]));
    event.currentTarget.closest('table')
      ?.querySelector<HTMLButtonElement>(`[data-sheet-row="${nextRow}"][data-sheet-col="${nextCol}"]`)
      ?.focus();
    setKeyboardRange((current) => current ? { ...current, endRow: nextRow, endCol: nextCol } : null);
  };

  const cellSelected = (row: number, col: number, range: CellRange) => {
    const normalized = normalizeCellRange(range);
    return row >= normalized.startRow && row <= normalized.endRow && col >= normalized.startCol && col <= normalized.endCol;
  };

  return (
    <div className="importer">
      <label className="upload-button">
        <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} aria-label="选择 Excel 文件" />
        <span>导入 Excel</span>
        <small>XLSX、XLS 或 CSV</small>
      </label>
      {error && <p className="import-error" role="alert">{error}</p>}
      {workbook && activeSheet && (
        <div className="import-mapping" aria-label="Excel 导入设置">
          <div className="file-summary"><strong>{fileName}</strong><span>{activeSheet.rows.length} 行数据</span></div>
          <label className="field">
            <span>工作表</span>
            <select value={sheetName} onChange={(event) => selectSheet(event.target.value)}>
              {workbook.sheets.map((sheet) => <option key={sheet.name} value={sheet.name}>{sheet.name}</option>)}
            </select>
          </label>
          <div className="import-mode" aria-label="Excel 提取方式">
            <button type="button" aria-pressed={mode === 'columns'} onClick={() => setMode('columns')}>按列导入</button>
            <button type="button" aria-pressed={mode === 'regions'} onClick={() => setMode('regions')}>框选区域</button>
          </div>
          {mode === 'columns' ? <>
          <div className="field-grid two-columns">
            <label className="field">
              <span>唛头内容列</span>
              <select value={contentColumn} onChange={(event) => setContentColumn(Number(event.target.value))}>
                <option value={-1}>请选择</option>
                {activeSheet.headers.map((header, index) => <option key={`${header}-${index}`} value={index}>{header || `第 ${index + 1} 列`}</option>)}
              </select>
            </label>
            <label className="field">
              <span>打印数量列</span>
              <select value={quantityColumn} onChange={(event) => setQuantityColumn(Number(event.target.value))}>
                <option value={-1}>请选择</option>
                {activeSheet.headers.map((header, index) => <option key={`${header}-${index}`} value={index}>{header || `第 ${index + 1} 列`}</option>)}
              </select>
            </label>
          </div>
          {(contentColumn < 0 || quantityColumn < 0) && <p className="mapping-note">未自动识别列，请手动选择内容列和数量列。</p>}
          <button className="button button-primary" type="button" disabled={contentColumn < 0 || quantityColumn < 0} onClick={confirmImport}>
            导入所选工作表
          </button>
          </> : <div className="region-importer">
            <p className="mapping-note">按住鼠标拖过单元格。可连续框选多个区域，确认后会按顺序合并为一条唛头。</p>
            <p className="mapping-note" id={keyboardHelpId}>键盘操作：聚焦单元格后按 Enter 或空格设起点，用方向键扩展，再按 Enter 或空格完成；Escape 取消。</p>
            <div className="sheet-grid-wrap">
              <table className="sheet-grid" aria-label={`${activeSheet.name} 可框选区域`} aria-describedby={keyboardHelpId}>
                <thead><tr><th aria-label="行号" />{Array.from({ length: columnCount }, (_, col) => <th key={col}>{formatCellRange({ startRow: 0, endRow: 0, startCol: col, endCol: col }).split(':')[0].replace(/\d+/g, '')}</th>)}</tr></thead>
                <tbody>{matrix.map((row, rowIndex) => <tr key={rowIndex}>
                  <th scope="row">{rowIndex + 1}</th>
                  {Array.from({ length: columnCount }, (_, colIndex) => {
                    const selectedIndex = regions.findIndex((range) => cellSelected(rowIndex, colIndex, range));
                    const draft = dragRange ?? keyboardRange;
                    const isDraft = draft ? cellSelected(rowIndex, colIndex, draft) : false;
                    const address = formatCellRange({ startRow: rowIndex, endRow: rowIndex, startCol: colIndex, endCol: colIndex }).split(':')[0];
                    const value = String(row[colIndex] ?? '');
                    return <td
                      key={colIndex}
                      className={`${selectedIndex >= 0 ? `is-region region-${selectedIndex % 4}` : ''} ${isDraft ? 'is-draft-region' : ''}`}
                      onPointerDown={(event) => startSelection(event, rowIndex, colIndex)}
                      onPointerEnter={() => extendSelection(rowIndex, colIndex)}
                    >
                      <button
                        type="button"
                        className="sheet-cell-button"
                        aria-label={`单元格 ${address}：${value || '空白'}`}
                        data-sheet-row={rowIndex}
                        data-sheet-col={colIndex}
                        onClick={(event) => {
                          // Pointer selection is completed by the table cell's pointer handlers.
                          // A zero-detail click is synthesized by keyboard/assistive technology.
                          if (event.detail === 0) {
                            appendRegion({ startRow: rowIndex, startCol: colIndex, endRow: rowIndex, endCol: colIndex });
                          }
                        }}
                        onKeyDown={(event) => handleCellKeyDown(event, rowIndex, colIndex)}
                      >{value}</button>
                    </td>;
                  })}
                </tr>)}</tbody>
              </table>
            </div>
            <div className="region-list" aria-live="polite">
              {keyboardRange && <span>正在键盘框选 {formatCellRange(keyboardRange)}</span>}
              {!keyboardRange && regions.length === 0 ? <span>尚未框选区域</span> : regions.map((range, index) => (
                <button type="button" key={formatCellRange(range)} onClick={() => setRegions((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                  区域 {index + 1} · {formatCellRange(range)} <b aria-hidden="true">×</b>
                </button>
              ))}
            </div>
            <button className="button button-primary" type="button" disabled={regions.length === 0} onClick={confirmRegionImport}>
              提取 {regions.length} 个区域
            </button>
          </div>}
        </div>
      )}
    </div>
  );
}
