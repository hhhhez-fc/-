import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cropSelectionToPixels,
  filterEnglishOcrText,
  normalizeOcrText,
  processOcrLines,
  recognizeImage,
  recognizeImageLayout,
  validateImageFile,
} from '../src/domain/images';

const tesseract = vi.hoisted(() => ({
  recognize: vi.fn(() => new Promise(() => {})),
  setParameters: vi.fn(async () => undefined),
  terminate: vi.fn(async () => undefined),
  createWorker: vi.fn(),
}));

vi.mock('tesseract.js', () => ({
  OEM: { LSTM_ONLY: 1 },
  PSM: { SPARSE_TEXT: '11' },
  createWorker: tesseract.createWorker,
}));

beforeEach(() => {
  tesseract.recognize.mockReset();
  tesseract.recognize.mockImplementation(() => new Promise(() => {}));
  tesseract.setParameters.mockClear();
  tesseract.terminate.mockClear();
  tesseract.createWorker.mockReset();
  tesseract.createWorker.mockResolvedValue({
    recognize: tesseract.recognize,
    setParameters: tesseract.setParameters,
    terminate: tesseract.terminate,
  });
});

describe('image import', () => {
  it('only accepts supported bitmap formats', () => {
    expect(validateImageFile({ name: 'mark.gif', type: 'image/gif', size: 10 })).toBe(
      '仅支持 PNG、JPEG 和 WebP 图片',
    );
  });

  it('rejects empty and oversized files', () => {
    expect(validateImageFile({ name: 'empty.png', type: 'image/png', size: 0 })).toBe('图片文件为空');
    expect(validateImageFile({ name: 'huge.jpg', type: 'image/jpeg', size: 15 * 1024 * 1024 + 1 })).toBe(
      '单张图片不能超过 15 MB',
    );
  });

  it('normalizes OCR whitespace while preserving line breaks', () => {
    expect(normalizeOcrText(' FY-01 \n\n MADE   IN  CHINA \r\n 12 PCS ')).toBe(
      'FY-01\nMADE IN CHINA\n12 PCS',
    );
  });

  it('图片识别结果删除标点但保留唛头连接号', () => {
    expect(filterEnglishOcrText('箱唛 FY-01 / 蓝色\n数量 12#')).toBe('FY-01\n12');
  });

  it('把百分比框选区域换算成原图像素并规范反向尺寸', () => {
    expect(cropSelectionToPixels({ xPercent: 75, yPercent: 60, widthPercent: -50, heightPercent: -40 }, 1200, 800)).toEqual({
      left: 300,
      top: 160,
      width: 600,
      height: 320,
    });
  });

  it('检测到唛头时只保留其后内容并在第一个逗号停止', () => {
    const result = processOcrLines([
      { text: '发货 唛头 FY-01', bbox: { x0: 10, y0: 20, x1: 190, y1: 50 } },
      { text: 'MADE IN CHINA, 数量 12', bbox: { x0: 20, y0: 60, x1: 260, y1: 90 } },
      { text: 'SHOULD NOT KEEP', bbox: { x0: 20, y0: 100, x1: 260, y1: 130 } },
    ], { left: 0, top: 0, width: 300, height: 150 });

    expect(result.text).toBe('FY-01\nMADE IN CHINA');
    expect(result.lines.map((line) => line.text)).toEqual(['FY-01', 'MADE IN CHINA']);
  });

  it('表格中的唛头列只提取标题同列下方的数据', () => {
    const result = processOcrLines([
      {
        text: '品名 数量 唛头 件数',
        bbox: { x0: 10, y0: 10, x1: 390, y1: 40 },
        words: [
          { text: '品名', bbox: { x0: 10, y0: 10, x1: 70, y1: 40 } },
          { text: '数量', bbox: { x0: 90, y0: 10, x1: 150, y1: 40 } },
          { text: '唛头', bbox: { x0: 180, y0: 10, x1: 230, y1: 40 } },
          { text: '件数', bbox: { x0: 290, y0: 10, x1: 350, y1: 40 } },
        ],
      },
      {
        text: '8.18 6 ME3L FYF-TTT0103, 4',
        bbox: { x0: 10, y0: 55, x1: 390, y1: 85 },
        words: [
          { text: '8.18', bbox: { x0: 10, y0: 55, x1: 55, y1: 85 } },
          { text: '6', bbox: { x0: 100, y0: 55, x1: 112, y1: 85 } },
          {
            text: 'ME3LFYF-TTT0103,',
            bbox: { x0: 130, y0: 55, x1: 260, y1: 85 },
            symbols: [
              { text: 'ME3L', bbox: { x0: 130, y0: 55, x1: 165, y1: 85 } },
              { text: 'FYF-TTT0103,', bbox: { x0: 180, y0: 55, x1: 260, y1: 85 } },
            ],
          },
          { text: '4', bbox: { x0: 320, y0: 55, x1: 332, y1: 85 } },
        ],
      },
    ], { left: 0, top: 0, width: 400, height: 120 }, { requireMarker: true });

    expect(result.text).toBe('FYF-TTT0103');
  });

  it('框选行包含唛头编号时丢弃周围的短噪声和标点', () => {
    const result = processOcrLines([{
      text: '6 WE FYF-TTT0103, I',
      bbox: { x0: 0, y0: 20, x1: 300, y1: 60 },
      words: [
        { text: '6', bbox: { x0: 0, y0: 20, x1: 10, y1: 60 } },
        { text: 'WE', bbox: { x0: 20, y0: 20, x1: 50, y1: 60 } },
        { text: 'FYF-TTT0103,', bbox: { x0: 70, y0: 20, x1: 220, y1: 60 } },
        { text: 'I', bbox: { x0: 240, y0: 20, x1: 250, y1: 60 } },
      ],
    }], { left: 0, top: 0, width: 300, height: 80 });

    expect(result.text).toBe('FYF-TTT0103');
  });

  it('整图把唛头的常见 OCR 误识别前缀从编号中移除', () => {
    const result = processOcrLines([{
      text: '共 160件 EESLAREEN-21',
      bbox: { x0: 0, y0: 20, x1: 300, y1: 60 },
      words: [{ text: 'EESLAREEN-21', bbox: { x0: 140, y0: 20, x1: 300, y1: 60 } }],
    }], { left: 0, top: 0, width: 300, height: 80 }, { requireMarker: true });

    expect(result.text).toBe('AREEN-21');
  });

  it('手动框选保留真实以 EESL 开头的编号', () => {
    const result = processOcrLines([{
      text: 'EESLAREEN-21',
      bbox: { x0: 0, y0: 20, x1: 300, y1: 60 },
    }], { left: 0, top: 0, width: 300, height: 80 });

    expect(result.text).toBe('EESLAREEN-21');
  });

  it('没有唛头时保留框内全部英数行及相对位置', () => {
    const result = processOcrLines([
      { text: 'FY-01', bbox: { x0: 100, y0: 50, x1: 300, y1: 100 } },
      { text: 'MADE IN CHINA', bbox: { x0: 80, y0: 150, x1: 320, y1: 210 } },
    ], { left: 0, top: 0, width: 400, height: 250 });

    expect(result.lines).toEqual([
      { text: 'FY-01', xPercent: 50, yPercent: 30 },
      { text: 'MADE IN CHINA', xPercent: 50, yPercent: 72 },
    ]);
  });

  it('整图识别找不到唛头标记时不导入其他文字', () => {
    const result = processOcrLines([
      { text: 'INVOICE 2026', bbox: { x0: 10, y0: 10, x1: 190, y1: 40 } },
      { text: 'FYF-TTT0103', bbox: { x0: 10, y0: 50, x1: 190, y1: 80 } },
    ], { left: 0, top: 0, width: 200, height: 100 }, { requireMarker: true });

    expect(result).toEqual({ text: '', lines: [] });
  });

  it('整图 OCR 无结构化行时仍从唛头后开始并在逗号停止', async () => {
    tesseract.recognize.mockResolvedValueOnce({
      data: { text: '发货单\n唛头 FYF-TTT0103, 其他信息\nTOTAL 10', blocks: null },
    });

    const result = await recognizeImageLayout(
      {} as File,
      { left: 0, top: 0, width: 400, height: 250 },
      undefined,
      undefined,
      { requireMarker: true },
    );

    expect(result.text).toBe('FYF-TTT0103');
  });

  it('结构化 OCR 漏掉唛头时回退到包含唛头的全文结果', async () => {
    tesseract.recognize.mockResolvedValueOnce({
      data: {
        text: '发货单\n唛 头 FYF-TTT0103, 其他信息',
        blocks: [{ paragraphs: [{ lines: [
          { text: 'INVOICE', bbox: { x0: 0, y0: 0, x1: 100, y1: 20 }, words: [] },
          { text: 'FYF-TTT0103', bbox: { x0: 100, y0: 40, x1: 240, y1: 70 }, words: [] },
        ] }] }],
      },
    });

    const result = await recognizeImageLayout(
      {} as File,
      { left: 0, top: 0, width: 400, height: 250 },
      undefined,
      undefined,
      { requireMarker: true },
    );

    expect(result.text).toBe('FYF-TTT0103');
  });

  it('首次整图识别漏掉唛头时使用稀疏文字模式重试', async () => {
    tesseract.recognize
      .mockResolvedValueOnce({ data: { text: 'INVOICE 2026', blocks: null } })
      .mockResolvedValueOnce({ data: { text: '发货单\n唛头 FYF-TTT0103, 其他信息', blocks: null } });

    const result = await recognizeImageLayout(
      {} as File,
      { left: 0, top: 0, width: 400, height: 250 },
      undefined,
      undefined,
      { requireMarker: true },
    );

    expect(result.text).toBe('FYF-TTT0103');
  });

  it('整图两次识别都没有唛头时回退为全部英数内容', async () => {
    tesseract.recognize
      .mockResolvedValueOnce({ data: { text: 'INVOICE 2026\nFYF-TTT0103, TY', blocks: null } })
      .mockResolvedValueOnce({ data: { text: 'INVOICE 2026\nFYF-TTT0103, TY', blocks: null } });

    const result = await recognizeImageLayout(
      {} as File,
      { left: 0, top: 0, width: 400, height: 250 },
      undefined,
      undefined,
      { requireMarker: true },
    );

    expect(result.text).toBe('INVOICE 2026\nFYF-TTT0103');
  });

  it('OCR 返回可用于逐行排版的识别行', async () => {
    tesseract.recognize.mockResolvedValueOnce({
      data: {
        text: 'FY-01\nMADE IN CHINA',
        blocks: [{ paragraphs: [{ lines: [
          { text: 'FY-01', bbox: { x0: 100, y0: 50, x1: 300, y1: 100 } },
          { text: 'MADE IN CHINA', bbox: { x0: 80, y0: 150, x1: 320, y1: 210 } },
        ] }] }],
      },
    });

    const result = await recognizeImageLayout({} as File, { left: 0, top: 0, width: 400, height: 250 });

    expect(result.lines.map((line) => line.text)).toEqual(['FY-01', 'MADE IN CHINA']);
  });

  it('terminates the OCR worker when recognition is cancelled', async () => {
    const controller = new AbortController();
    const promise = recognizeImage({} as File, undefined, controller.signal);
    while (!tesseract.createWorker.mock.calls.length) await Promise.resolve();
    await Promise.resolve();
    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(tesseract.terminate).toHaveBeenCalledOnce();
  });
});
