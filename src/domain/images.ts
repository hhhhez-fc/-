export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

export interface ImageFileLike {
  name: string;
  type: string;
  size: number;
}

export interface OcrProgress {
  status: string;
  progress: number;
}

export interface CropSelection {
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  heightPercent: number;
}

export interface OcrCropPixels {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface OcrSourceLine {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  words?: OcrSourceWord[];
}

export interface OcrSourceWord {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  symbols?: OcrSourceSymbol[];
}

export interface OcrSourceSymbol {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface PositionedOcrLine {
  text: string;
  xPercent: number;
  yPercent: number;
}

export interface OcrLayoutResult {
  text: string;
  lines: PositionedOcrLine[];
}

export interface OcrRecognitionOptions {
  requireMarker?: boolean;
}

const SUPPORTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export function validateImageFile(file: ImageFileLike): string | null {
  if (!SUPPORTED_IMAGE_TYPES.has(file.type)) return '仅支持 PNG、JPEG 和 WebP 图片';
  if (file.size === 0) return '图片文件为空';
  if (file.size > MAX_IMAGE_BYTES) return '单张图片不能超过 15 MB';
  return null;
}

export function normalizeOcrText(rawText: string): string {
  return rawText
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim().replace(/[\t ]+/g, ' '))
    .filter(Boolean)
    .join('\n');
}

export function filterEnglishOcrText(rawText: string): string {
  return normalizeOcrText(rawText.replace(/[^A-Za-z0-9\s-]/g, ''));
}

export function cropSelectionToPixels(selection: CropSelection, imageWidth: number, imageHeight: number): OcrCropPixels {
  const x2 = selection.xPercent + selection.widthPercent;
  const y2 = selection.yPercent + selection.heightPercent;
  const leftPercent = Math.max(0, Math.min(100, Math.min(selection.xPercent, x2)));
  const topPercent = Math.max(0, Math.min(100, Math.min(selection.yPercent, y2)));
  const rightPercent = Math.max(0, Math.min(100, Math.max(selection.xPercent, x2)));
  const bottomPercent = Math.max(0, Math.min(100, Math.max(selection.yPercent, y2)));
  return {
    left: Math.round((leftPercent / 100) * imageWidth),
    top: Math.round((topPercent / 100) * imageHeight),
    width: Math.round(((rightPercent - leftPercent) / 100) * imageWidth),
    height: Math.round(((bottomPercent - topPercent) / 100) * imageHeight),
  };
}

const roundPercent = (value: number) => Math.round(value * 100) / 100;

const MARKER_PATTERN = /(?:唛\s*头|嘜\s*頭)/;
const OCR_MARKER_ALIAS_PATTERN = /EESL(?=[A-Za-z0-9]+-\d)/i;

function findMarkerMatch(text: string, includeOcrAliases = false): RegExpMatchArray | null {
  return text.match(MARKER_PATTERN) ?? (includeOcrAliases ? text.match(OCR_MARKER_ALIAS_PATTERN) : null);
}

function isStrongMarkToken(text: string): boolean {
  return text.length >= 5 && text.includes('-') && /[A-Za-z]/.test(text) && /\d/.test(text);
}

function cleanOcrLine(text: string): string {
  const tokens = text.split(/\s+/).map(filterEnglishOcrText).filter(Boolean);
  const markTokens = tokens.filter(isStrongMarkToken);
  return (markTokens.length ? markTokens : tokens).join(' ');
}

function lineFromWords(words: OcrSourceWord[]): { text: string; stopped: boolean } {
  const raw = words.map((word) => word.text).join(' ');
  const commaIndex = raw.search(/[,，]/);
  return {
    text: cleanOcrLine(commaIndex >= 0 ? raw.slice(0, commaIndex) : raw),
    stopped: commaIndex >= 0,
  };
}

function wordBounds(words: Array<{ bbox: OcrSourceLine['bbox'] }>): OcrSourceLine['bbox'] {
  return {
    x0: Math.min(...words.map((word) => word.bbox.x0)),
    y0: Math.min(...words.map((word) => word.bbox.y0)),
    x1: Math.max(...words.map((word) => word.bbox.x1)),
    y1: Math.max(...words.map((word) => word.bbox.y1)),
  };
}

function clipWordToColumn(word: OcrSourceWord, left: number, right: number): OcrSourceWord | null {
  if (word.symbols?.length) {
    const symbols = word.symbols.filter((symbol) => {
      const center = (symbol.bbox.x0 + symbol.bbox.x1) / 2;
      return center >= left && center <= right;
    });
    if (!symbols.length) return null;
    return { ...word, text: symbols.map((symbol) => symbol.text).join(''), bbox: wordBounds(symbols), symbols };
  }
  const center = (word.bbox.x0 + word.bbox.x1) / 2;
  return center >= left && center <= right ? word : null;
}

function findMarkerWordSpan(words: OcrSourceWord[], includeOcrAliases: boolean): { startIndex: number; endIndex: number; bbox: OcrSourceLine['bbox'] } | null {
  for (let index = 0; index < words.length; index += 1) {
    if (findMarkerMatch(words[index].text, includeOcrAliases)) {
      return { startIndex: index, endIndex: index, bbox: words[index].bbox };
    }
  }
  for (let index = 0; index + 1 < words.length; index += 1) {
    if (index + 1 < words.length && findMarkerMatch(`${words[index].text}${words[index + 1].text}`, includeOcrAliases)) {
      return { startIndex: index, endIndex: index + 1, bbox: wordBounds(words.slice(index, index + 2)) };
    }
  }
  return null;
}

function extractMarkerColumn(sourceLines: OcrSourceLine[], markerIndex: number, includeOcrAliases: boolean): OcrSourceLine[] {
  const markerLine = sourceLines[markerIndex];
  const words = markerLine.words ?? [];
  const markerSpan = findMarkerWordSpan(words, includeOcrAliases);
  if (!markerSpan) return [];

  const previousHeader = words.slice(0, markerSpan.startIndex).reverse()
    .find((word) => !filterEnglishOcrText(word.text));
  const nextHeader = words.slice(markerSpan.endIndex + 1)
    .find((word) => !filterEnglishOcrText(word.text));
  const left = previousHeader
    ? (previousHeader.bbox.x1 + markerSpan.bbox.x0) / 2
    : markerSpan.bbox.x0 - Math.max(markerSpan.bbox.x1 - markerSpan.bbox.x0, 20);
  const right = nextHeader
    ? (markerSpan.bbox.x1 + nextHeader.bbox.x0) / 2
    : markerSpan.bbox.x1 + Math.max((markerSpan.bbox.x1 - markerSpan.bbox.x0) * 3, 80);

  const candidates: OcrSourceLine[] = [];
  const sameLineWords = words.slice(markerSpan.endIndex + 1)
    .map((word) => clipWordToColumn(word, left, right))
    .filter((word): word is OcrSourceWord => Boolean(word));
  if (sameLineWords.length) {
    const sameLine = lineFromWords(sameLineWords);
    if (sameLine.text) candidates.push({ text: sameLine.text, bbox: wordBounds(sameLineWords), words: sameLineWords });
    if (sameLine.stopped) return candidates;
  }

  for (const line of sourceLines.slice(markerIndex + 1)) {
    const selectedWords = (line.words ?? [])
      .map((word) => clipWordToColumn(word, left, right))
      .filter((word): word is OcrSourceWord => Boolean(word));
    if (!selectedWords.length) continue;
    const selected = lineFromWords(selectedWords);
    if (selected.text) candidates.push({ text: selected.text, bbox: wordBounds(selectedWords), words: selectedWords });
    if (selected.stopped) break;
  }
  return candidates;
}

export function processOcrLines(sourceLines: OcrSourceLine[], crop: OcrCropPixels, options: OcrRecognitionOptions = {}): OcrLayoutResult {
  const includeOcrAliases = Boolean(options.requireMarker);
  const markerIndex = sourceLines.findIndex((line) => Boolean(findMarkerMatch(line.text, includeOcrAliases)));
  if (options.requireMarker && markerIndex < 0) return { text: '', lines: [] };
  const candidates: OcrSourceLine[] = [];
  let stopped = false;
  const columnCandidates = markerIndex >= 0 ? extractMarkerColumn(sourceLines, markerIndex, includeOcrAliases) : [];
  const candidateSource = columnCandidates.length
    ? columnCandidates
    : sourceLines.slice(markerIndex >= 0 ? markerIndex : 0);
  candidateSource.forEach((line, index) => {
    if (stopped) return;
    const markerMatch = markerIndex >= 0 && !columnCandidates.length && index === 0
      ? findMarkerMatch(line.text, includeOcrAliases)
      : null;
    let text = markerMatch?.index !== undefined
      ? line.text.slice(markerMatch.index + markerMatch[0].length)
      : line.text;
    const commaIndex = text.search(/[,，]/);
    if (markerIndex >= 0 && commaIndex >= 0) {
      text = text.slice(0, commaIndex);
      stopped = true;
    }
    const filtered = line.words?.length && !columnCandidates.length && !markerMatch
      ? lineFromWords(line.words).text
      : cleanOcrLine(text);
    if (filtered) candidates.push({ ...line, text: filtered });
  });
  const lines = candidates.map((line) => ({
    text: line.text,
    xPercent: roundPercent((((line.bbox.x0 + line.bbox.x1) / 2) - crop.left) / crop.width * 100),
    yPercent: roundPercent((((line.bbox.y0 + line.bbox.y1) / 2) - crop.top) / crop.height * 100),
  }));
  return { text: lines.map((line) => line.text).join('\n'), lines };
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('无法读取图片'));
    });
    reader.addEventListener('error', () => reject(reader.error ?? new Error('无法读取图片')));
    reader.readAsDataURL(file);
  });
}

export async function recognizeImage(
  image: File,
  onProgress?: (progress: OcrProgress) => void,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) throw new DOMException('图片识别已取消', 'AbortError');
  const { createWorker, OEM } = await import('tesseract.js');
  if (signal?.aborted) throw new DOMException('图片识别已取消', 'AbortError');
  const worker = await createWorker(['eng', 'chi_sim'], OEM.LSTM_ONLY, {
    logger: ({ status, progress }) => onProgress?.({ status, progress }),
  });

  if (signal?.aborted) {
    await worker.terminate();
    throw new DOMException('图片识别已取消', 'AbortError');
  }

  let rejectAbort: ((reason: DOMException) => void) | undefined;
  const abortPromise = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const handleAbort = () => rejectAbort?.(new DOMException('图片识别已取消', 'AbortError'));
  signal?.addEventListener('abort', handleAbort, { once: true });
  try {
    const recognition = worker.recognize(image);
    const result = signal ? await Promise.race([recognition, abortPromise]) : await recognition;
    return filterEnglishOcrText(result.data.text);
  } finally {
    signal?.removeEventListener('abort', handleAbort);
    await worker.terminate();
  }
}

export async function recognizeImageLayout(
  image: File,
  crop: OcrCropPixels,
  onProgress?: (progress: OcrProgress) => void,
  signal?: AbortSignal,
  options: OcrRecognitionOptions = {},
): Promise<OcrLayoutResult> {
  if (signal?.aborted) throw new DOMException('图片识别已取消', 'AbortError');
  const { createWorker, OEM, PSM } = await import('tesseract.js');
  if (signal?.aborted) throw new DOMException('图片识别已取消', 'AbortError');
  const worker = await createWorker(['eng', 'chi_sim'], OEM.LSTM_ONLY, {
    logger: ({ status, progress }) => onProgress?.({ status, progress }),
  });
  if (signal?.aborted) {
    await worker.terminate();
    throw new DOMException('图片识别已取消', 'AbortError');
  }
  let rejectAbort: ((reason: DOMException) => void) | undefined;
  const abortPromise = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const handleAbort = () => rejectAbort?.(new DOMException('图片识别已取消', 'AbortError'));
  signal?.addEventListener('abort', handleAbort, { once: true });
  try {
    const processRecognition = (
      data: Awaited<ReturnType<typeof worker.recognize>>['data'],
      recognitionOptions: OcrRecognitionOptions = options,
    ): OcrLayoutResult => {
      const sourceLines: OcrSourceLine[] = data.blocks?.flatMap((block) => (
        block.paragraphs.flatMap((paragraph) => paragraph.lines.map((line) => ({
          text: line.text,
          bbox: line.bbox,
          words: line.words?.map((word) => ({
            text: word.text,
            bbox: word.bbox,
            symbols: word.symbols?.map((symbol) => ({ text: symbol.text, bbox: symbol.bbox })) ?? [],
          })) ?? [],
        })))
      )) ?? [];
      if (sourceLines.length) {
        const structured = processOcrLines(sourceLines, crop, recognitionOptions);
        if (structured.text || !recognitionOptions.requireMarker) return structured;
      }
      const rawValues = normalizeOcrText(data.text).split('\n').filter(Boolean);
      return processOcrLines(rawValues.map((text, index) => ({
        text,
        bbox: {
          x0: crop.left,
          x1: crop.left + crop.width,
          y0: crop.top + (index * crop.height) / Math.max(1, rawValues.length),
          y1: crop.top + ((index + 1) * crop.height) / Math.max(1, rawValues.length),
        },
      })), crop, recognitionOptions);
    };
    const recognizeOnce = async () => {
      const recognition = worker.recognize(image, { rectangle: crop }, { text: true, blocks: true });
      return signal ? Promise.race([recognition, abortPromise]) : recognition;
    };

    const firstData = (await recognizeOnce()).data;
    const firstResult = processRecognition(firstData);
    if (firstResult.text || !options.requireMarker) return firstResult;
    if (signal?.aborted) throw new DOMException('图片识别已取消', 'AbortError');

    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      preserve_interword_spaces: '1',
    });
    const secondData = (await recognizeOnce()).data;
    const secondResult = processRecognition(secondData);
    if (secondResult.text || !options.requireMarker) return secondResult;

    const fallbackOptions = { ...options, requireMarker: false };
    const firstFallback = processRecognition(firstData, fallbackOptions);
    const secondFallback = processRecognition(secondData, fallbackOptions);
    return secondFallback.text.length > firstFallback.text.length ? secondFallback : firstFallback;
  } finally {
    signal?.removeEventListener('abort', handleAbort);
    await worker.terminate();
  }
}
