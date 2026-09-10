import {
  validateDirectPrintJobManifest,
  type DirectPrintAsset,
  type DirectPrintJobManifest,
} from '../domain/directPrinting';

export const PRINT_HELPER_BASE_URL = 'https://localhost:17653/v1';
export const PRINT_PROTOCOL_HEADER = 'X-Label-Print-Protocol-Version';
export const PRINT_REQUEST_ID_HEADER = 'X-Label-Print-Request-Id';

export type PrintHelperErrorCode =
  | 'unavailable'
  | 'timeout'
  | 'unauthorized'
  | 'version-mismatch'
  | 'http'
  | 'invalid-response'
  | 'busy'
  | 'uncertain';

export class PrintHelperError extends Error {
  constructor(
    public readonly code: PrintHelperErrorCode,
    message: string,
    public readonly status?: number,
    public readonly jobId?: string,
  ) {
    super(message);
    this.name = 'PrintHelperError';
  }
}

export interface HelperHealth {
  protocolVersion: number;
  helperVersion: string;
  status: string;
}

export interface PrinterSummary {
  id: string;
  displayName: string;
  isDefault: boolean;
  isCompatible: boolean;
  queueStatus: string;
  isAvailable: boolean;
}

export interface PrinterCalibrationProfile {
  printerId: string;
  printerName: string;
  profileId: 'xp420b-100x75-203dpi';
  version: 'xp420b-100x75-v1';
  profileRevision: string;
  widthMillimeters: 100;
  heightMillimeters: 75;
  widthDots: 800;
  heightDots: 600;
  mediaType: 'gap' | 'blackMark' | 'continuous';
  mediaHeightMillimeters: number;
  mediaOffsetMillimeters: number;
  referenceX: number;
  referenceY: number;
  sensorCommandDialect: 'tspl-xp420b-pending-hardware-verification' | 'tspl-xp420b-user-confirmed-v1';
  testAttemptId?: string;
  testPrintSubmittedAtUtc?: string;
  isVerified: boolean;
  updatedAtUtc: string;
  verifiedAtUtc?: string;
}

export interface PrintPageOutcome {
  ordinal: number;
  assetId: string;
  sha256: string;
  status: 'received' | 'submitting' | 'submitted' | 'failed' | 'unknown';
  windowsJobId?: number;
  failureStage?: 'openPrinter' | 'startDocPrinter' | 'startPagePrinter' | 'writePrinter' | 'endPagePrinter' | 'endDocPrinter' | 'abortPrinter' | 'closePrinter';
  certainty?: 'notSubmitted' | 'unknown' | 'submitted';
}

export interface PrintJobStatus {
  jobId: string;
  manifestFingerprint: string;
  status: 'received' | 'validating' | 'submitting' | 'submitted' | 'partial' | 'failed' | 'unknown';
  createdAtUtc: string;
  updatedAtUtc: string;
  pages: PrintPageOutcome[];
}

export interface PairingRequestResponse {
  requestId: string;
  status: 'pending';
  expiresAtUtc: string;
}

export type PairingStatusResponse =
  | { requestId: string; status: 'pending'; expiresAtUtc?: string }
  | { requestId: string; status: 'approved'; token: string }
  | { requestId: string; status: 'claimed' | 'denied' | 'expired' };

export type PrintSubmissionProgress =
  | { stage: 'creating'; completed: 0; total: number }
  | { stage: 'uploading'; completed: number; total: number; assetId: string }
  | { stage: 'committing'; completed: number; total: number }
  | { stage: 'complete'; completed: number; total: number; status: PrintJobStatus['status'] };

export interface PrintHelperClientOptions {
  baseUrl?: string;
  token?: string | null;
  timeoutMs?: number;
  mutationTimeoutMs?: number;
  commitTimeoutMs?: number;
  fetcher?: typeof fetch;
  requestIdFactory?: () => string;
}

type JsonMethod = 'POST' | 'PUT';

export class PrintHelperClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly mutationTimeoutMs: number;
  private readonly commitTimeoutMs: number;
  private readonly fetcher: typeof fetch;
  private readonly requestIdFactory: () => string;
  private token: string | null;

  constructor(options: PrintHelperClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? PRINT_HELPER_BASE_URL).replace(/\/$/, '');
    const legacyTimeout = options.timeoutMs === undefined ? undefined : positiveTimeout(options.timeoutMs, 3_000);
    this.timeoutMs = legacyTimeout ?? 3_000;
    this.mutationTimeoutMs = positiveTimeout(options.mutationTimeoutMs, legacyTimeout ?? 15_000);
    this.commitTimeoutMs = positiveTimeout(options.commitTimeoutMs, legacyTimeout ?? 120_000);
    this.token = options.token?.trim() || null;
    this.fetcher = options.fetcher ?? ((input, init) => globalThis.fetch(input, init));
    this.requestIdFactory = options.requestIdFactory ?? createRequestId;
  }

  setToken(token: string | null): void {
    this.token = token?.trim() || null;
  }

  async health(signal?: AbortSignal): Promise<HelperHealth> {
    return parseHealth(await this.request('/health', { method: 'GET', signal, authenticated: false }));
  }

  async printers(signal?: AbortSignal): Promise<PrinterSummary[]> {
    const value = await this.request('/printers', { method: 'GET', signal, authenticated: true });
    const record = requireObject(value, '打印机列表');
    requireExactKeys(record, ['printers'], '打印机列表');
    if (!Array.isArray(record.printers)) invalid('打印机列表格式无效');
    return record.printers.map(parsePrinter);
  }

  async calibrationStatus(printerId: string, signal?: AbortSignal): Promise<PrinterCalibrationProfile | null> {
    const normalizedPrinterId = printerId.trim();
    if (!normalizedPrinterId) throw new PrintHelperError('invalid-response', '打印机标识不能为空');
    const value = await this.request(`/calibration?printerId=${encodeURIComponent(normalizedPrinterId)}`, {
      method: 'GET', signal, authenticated: true,
    });
    return value === null ? null : parseCalibrationProfile(value);
  }

  async createJob(manifest: DirectPrintJobManifest, signal?: AbortSignal): Promise<PrintJobStatus> {
    validateDirectPrintJobManifest(manifest);
    return requireMatchingJob(parseJobStatus(await this.jsonRequest('/jobs', 'POST', manifest, signal)), manifest.jobId);
  }

  async uploadAsset(jobId: string, asset: DirectPrintAsset, signal?: AbortSignal): Promise<PrintJobStatus> {
    return requireMatchingJob(parseJobStatus(await this.jsonRequest(
      `/jobs/${encodeURIComponent(jobId)}/assets/${encodeURIComponent(asset.assetId)}`,
      'PUT',
      asset,
      signal,
    )), jobId);
  }

  async commitJob(jobId: string, signal?: AbortSignal): Promise<PrintJobStatus> {
    return requireMatchingJob(parseJobStatus(await this.request(`/jobs/${encodeURIComponent(jobId)}/commit`, {
      method: 'POST',
      signal,
      authenticated: true,
      timeoutMs: this.commitTimeoutMs,
      uncertainJobId: jobId,
    })), jobId);
  }

  async jobStatus(jobId: string, signal?: AbortSignal): Promise<PrintJobStatus> {
    return requireMatchingJob(parseJobStatus(await this.request(`/jobs/${encodeURIComponent(jobId)}`, {
      method: 'GET',
      signal,
      authenticated: true,
    })), jobId);
  }

  async createPairingRequest(origin: string, signal?: AbortSignal): Promise<PairingRequestResponse> {
    if (!isOrigin(origin)) throw new PrintHelperError('invalid-response', '网站来源格式无效');
    return parsePairingRequest(await this.jsonRequest('/pairing-requests', 'POST', { origin }, signal, false));
  }

  async pairingStatus(requestId: string, signal?: AbortSignal): Promise<PairingStatusResponse> {
    return requireMatchingPairing(parsePairingStatus(await this.request(`/pairing-requests/${encodeURIComponent(requestId)}`, {
      method: 'GET',
      signal,
      authenticated: false,
      authorizationToken: requestId,
    })), requestId);
  }

  async submitJob(
    manifest: DirectPrintJobManifest,
    assets: readonly DirectPrintAsset[],
    signal?: AbortSignal,
    onProgress?: (progress: PrintSubmissionProgress) => void,
  ): Promise<PrintJobStatus> {
    validateDirectPrintJobManifest(manifest);
    assertSubmissionAssets(manifest, assets);
    const total = assets.length;
    onProgress?.({ stage: 'creating', completed: 0, total });
    await this.createJob(manifest, signal);
    for (let index = 0; index < assets.length; index += 1) {
      const item = assets[index];
      await this.uploadAsset(manifest.jobId, item, signal);
      onProgress?.({ stage: 'uploading', completed: index + 1, total, assetId: item.assetId });
    }
    onProgress?.({ stage: 'committing', completed: total, total });
    const result = await this.commitJob(manifest.jobId, signal);
    onProgress?.({ stage: 'complete', completed: total, total, status: result.status });
    return result;
  }

  private jsonRequest(
    path: string,
    method: JsonMethod,
    body: unknown,
    signal?: AbortSignal,
    authenticated = true,
  ): Promise<unknown> {
    return this.request(path, {
      method, body: JSON.stringify(body), signal, authenticated, json: true,
      timeoutMs: this.mutationTimeoutMs,
    });
  }

  private async request(path: string, options: {
    method: 'GET' | 'POST' | 'PUT';
    body?: string;
    signal?: AbortSignal;
    authenticated: boolean;
    authorizationToken?: string;
    json?: boolean;
    timeoutMs?: number;
    uncertainJobId?: string;
  }): Promise<unknown> {
    const requestId = this.requestIdFactory();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      throw new PrintHelperError('unavailable', '无法生成有效的打印请求标识');
    }
    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) abortFromCaller();
    else options.signal?.addEventListener('abort', abortFromCaller, { once: true });
    const timeout = globalThis.setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException('Timed out', 'TimeoutError'));
    }, options.timeoutMs ?? this.timeoutMs);

    const headers = new Headers({ Accept: 'application/json' });
    headers.set(PRINT_PROTOCOL_HEADER, '1');
    headers.set(PRINT_REQUEST_ID_HEADER, requestId);
    if (options.json) headers.set('Content-Type', 'application/json');
    const authorizationToken = options.authorizationToken ?? (options.authenticated ? this.token : null);
    if (authorizationToken) headers.set('Authorization', `Bearer ${authorizationToken}`);

    try {
      const response = await this.fetcher(`${this.baseUrl}${path}`, {
        method: options.method,
        headers,
        body: options.body,
        signal: controller.signal,
      });
      if (!response.ok) {
        if (options.uncertainJobId && response.status >= 500) {
          throw new PrintHelperError(
            'uncertain',
            '打印提交结果暂不明确，请查询原任务状态',
            response.status,
            options.uncertainJobId,
          );
        }
        throw classifyHttp(response.status);
      }
      const contentType = response.headers.get('Content-Type') ?? '';
      if (!contentType.toLowerCase().includes('application/json')) invalid('打印助手返回了无效响应');
      try {
        return await response.json() as unknown;
      } catch {
        invalid('打印助手返回了无效响应');
      }
    } catch (error) {
      if (error instanceof PrintHelperError) throw error;
      if (options.uncertainJobId) {
        throw new PrintHelperError('uncertain', '打印提交结果暂不明确，请查询原任务状态', undefined, options.uncertainJobId);
      }
      if (timedOut) throw new PrintHelperError('timeout', '连接打印助手超时');
      if (options.signal?.aborted) throw new PrintHelperError('unavailable', '打印助手请求已取消');
      throw new PrintHelperError('unavailable', '无法连接打印助手');
    } finally {
      globalThis.clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abortFromCaller);
    }
  }
}

function parseHealth(value: unknown): HelperHealth {
  const record = requireObject(value, '打印助手状态');
  requireExactKeys(record, ['protocolVersion', 'helperVersion', 'status'], '打印助手状态');
  if (!Number.isInteger(record.protocolVersion) || typeof record.helperVersion !== 'string' || !record.helperVersion || typeof record.status !== 'string' || !record.status) {
    invalid('打印助手状态格式无效');
  }
  return { protocolVersion: record.protocolVersion as number, helperVersion: record.helperVersion, status: record.status };
}

function parsePrinter(value: unknown): PrinterSummary {
  const record = requireObject(value, '打印机');
  requireExactKeys(record, ['id', 'displayName', 'isDefault', 'isCompatible', 'queueStatus', 'isAvailable'], '打印机');
  if (![record.id, record.displayName, record.queueStatus].every((item) => typeof item === 'string' && item.length > 0)
    || ![record.isDefault, record.isCompatible, record.isAvailable].every((item) => typeof item === 'boolean')) {
    invalid('打印机信息格式无效');
  }
  return record as unknown as PrinterSummary;
}

function parseCalibrationProfile(value: unknown): PrinterCalibrationProfile {
  const record = requireObject(value, '打印机校准状态');
  const required = [
    'printerId', 'printerName', 'profileId', 'version', 'profileRevision',
    'widthMillimeters', 'heightMillimeters', 'widthDots', 'heightDots',
    'mediaType', 'mediaHeightMillimeters', 'mediaOffsetMillimeters', 'referenceX', 'referenceY',
    'sensorCommandDialect', 'isVerified', 'updatedAtUtc',
  ];
  const optional = ['testAttemptId', 'testPrintSubmittedAtUtc', 'verifiedAtUtc'];
  requireAllowedKeys(record, [...required, ...optional], '打印机校准状态');
  const mediaTypes = ['gap', 'blackMark', 'continuous'];
  const sensorDialects = ['tspl-xp420b-pending-hardware-verification', 'tspl-xp420b-user-confirmed-v1'];
  const canonicalId = (item: unknown) => typeof item === 'string' && /^[0-9a-f]{32}$/i.test(item);
  if (required.some((key) => !(key in record))
    || typeof record.printerId !== 'string' || !record.printerId
    || typeof record.printerName !== 'string' || !record.printerName
    || record.profileId !== 'xp420b-100x75-203dpi' || record.version !== 'xp420b-100x75-v1'
    || !canonicalId(record.profileRevision)
    || record.widthMillimeters !== 100 || record.heightMillimeters !== 75
    || record.widthDots !== 800 || record.heightDots !== 600
    || typeof record.mediaType !== 'string' || !mediaTypes.includes(record.mediaType)
    || !Number.isFinite(record.mediaHeightMillimeters) || !Number.isFinite(record.mediaOffsetMillimeters)
    || !Number.isInteger(record.referenceX) || !Number.isInteger(record.referenceY)
    || typeof record.sensorCommandDialect !== 'string' || !sensorDialects.includes(record.sensorCommandDialect)
    || typeof record.isVerified !== 'boolean' || !isUtcTimestamp(record.updatedAtUtc)
    || (record.testAttemptId !== undefined && !canonicalId(record.testAttemptId))
    || (record.testPrintSubmittedAtUtc !== undefined && !isUtcTimestamp(record.testPrintSubmittedAtUtc))
    || (record.verifiedAtUtc !== undefined && !isUtcTimestamp(record.verifiedAtUtc))
    || (record.isVerified !== (record.verifiedAtUtc !== undefined))
    || ((record.testAttemptId !== undefined) !== (record.testPrintSubmittedAtUtc !== undefined))
    || (record.isVerified && record.sensorCommandDialect !== 'tspl-xp420b-user-confirmed-v1')
    || (!record.isVerified && record.sensorCommandDialect !== 'tspl-xp420b-pending-hardware-verification')) {
    invalid('打印机校准状态格式无效');
  }
  return record as unknown as PrinterCalibrationProfile;
}

function parseJobStatus(value: unknown): PrintJobStatus {
  const record = requireObject(value, '打印任务状态');
  requireExactKeys(record, ['jobId', 'manifestFingerprint', 'status', 'createdAtUtc', 'updatedAtUtc', 'pages'], '打印任务状态');
  const statuses = ['received', 'validating', 'submitting', 'submitted', 'partial', 'failed', 'unknown'];
  if (typeof record.jobId !== 'string' || !record.jobId
    || typeof record.manifestFingerprint !== 'string' || !/^[a-f0-9]{64}$/i.test(record.manifestFingerprint)
    || !isUtcTimestamp(record.createdAtUtc) || !isUtcTimestamp(record.updatedAtUtc)
    || typeof record.status !== 'string' || !statuses.includes(record.status) || !Array.isArray(record.pages)) {
    invalid('打印任务状态格式无效');
  }
  const pages = record.pages.map(parsePageOutcome);
  return { ...record, status: record.status, pages } as PrintJobStatus;
}

function parsePageOutcome(value: unknown): PrintPageOutcome {
  const record = requireObject(value, '打印页状态');
  const required = ['ordinal', 'assetId', 'sha256', 'status'];
  const optional = ['windowsJobId', 'failureStage', 'certainty'];
  requireAllowedKeys(record, [...required, ...optional], '打印页状态');
  const statuses = ['received', 'submitting', 'submitted', 'failed', 'unknown'];
  const failureStages = ['openPrinter', 'startDocPrinter', 'startPagePrinter', 'writePrinter', 'endPagePrinter', 'endDocPrinter', 'abortPrinter', 'closePrinter'];
  const certainties = ['notSubmitted', 'unknown', 'submitted'];
  if (required.some((key) => !(key in record)) || !Number.isInteger(record.ordinal) || (record.ordinal as number) < 1
    || typeof record.assetId !== 'string' || !record.assetId
    || typeof record.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(record.sha256)
    || typeof record.status !== 'string' || !statuses.includes(record.status)
    || (record.windowsJobId !== undefined && (!Number.isInteger(record.windowsJobId) || (record.windowsJobId as number) < 0 || (record.windowsJobId as number) > 0xffff_ffff))
    || (record.failureStage !== undefined && (typeof record.failureStage !== 'string' || !failureStages.includes(record.failureStage)))
    || (record.certainty !== undefined && (typeof record.certainty !== 'string' || !certainties.includes(record.certainty)))) {
    invalid('打印页状态格式无效');
  }
  return record as unknown as PrintPageOutcome;
}

function parsePairingRequest(value: unknown): PairingRequestResponse {
  const record = requireObject(value, '配对请求');
  requireExactKeys(record, ['requestId', 'status', 'expiresAtUtc'], '配对请求');
  if (typeof record.requestId !== 'string' || !record.requestId || record.status !== 'pending' || !isUtcTimestamp(record.expiresAtUtc)) {
    invalid('配对请求格式无效');
  }
  return record as unknown as PairingRequestResponse;
}

function parsePairingStatus(value: unknown): PairingStatusResponse {
  const record = requireObject(value, '配对状态');
  if (typeof record.requestId !== 'string' || !record.requestId || typeof record.status !== 'string') invalid('配对状态格式无效');
  if (record.status === 'approved') {
    requireExactKeys(record, ['requestId', 'status', 'token'], '配对状态');
    if (typeof record.token !== 'string' || !record.token) invalid('配对状态格式无效');
  } else if (record.status === 'pending') {
    requireAllowedKeys(record, ['requestId', 'status', 'expiresAtUtc'], '配对状态');
    if (record.expiresAtUtc !== undefined && !isUtcTimestamp(record.expiresAtUtc)) invalid('配对状态格式无效');
  } else if (record.status === 'claimed' || record.status === 'denied' || record.status === 'expired') {
    requireExactKeys(record, ['requestId', 'status'], '配对状态');
  } else {
    invalid('配对状态格式无效');
  }
  return record as unknown as PairingStatusResponse;
}

function requireObject(value: unknown, subject: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${subject}格式无效`);
  return value as Record<string, unknown>;
}

function requireExactKeys(record: Record<string, unknown>, keys: string[], subject: string): void {
  requireAllowedKeys(record, keys, subject);
  if (keys.some((key) => !(key in record))) invalid(`${subject}格式无效`);
}

function requireAllowedKeys(record: Record<string, unknown>, keys: string[], subject: string): void {
  if (Object.keys(record).some((key) => !keys.includes(key))) invalid(`${subject}包含不支持的字段`);
}

function invalid(message: string): never {
  throw new PrintHelperError('invalid-response', message);
}

function classifyHttp(status: number): PrintHelperError {
  if (status === 401) return new PrintHelperError('unauthorized', '打印助手需要重新配对', status);
  if (status === 426) return new PrintHelperError('version-mismatch', '打印助手版本不兼容', status);
  return new PrintHelperError('http', `打印助手请求失败（HTTP ${status}）`, status);
}

function requireMatchingJob(status: PrintJobStatus, expectedJobId: string): PrintJobStatus {
  if (status.jobId !== expectedJobId) invalid('打印助手返回了其他任务的状态');
  return status;
}

function requireMatchingPairing(status: PairingStatusResponse, expectedRequestId: string): PairingStatusResponse {
  if (status.requestId !== expectedRequestId) invalid('打印助手返回了其他配对请求的状态');
  return status;
}

function isUtcTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|\+00:00)$/.exec(value);
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime())
    && parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() + 1 === month
    && parsed.getUTCDate() === day
    && parsed.getUTCHours() === hour
    && parsed.getUTCMinutes() === minute
    && parsed.getUTCSeconds() === second;
}

function positiveTimeout(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value! > 0 ? value! : fallback;
}

function createRequestId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (!globalThis.crypto?.getRandomValues) throw new PrintHelperError('unavailable', '当前浏览器无法生成安全请求标识');
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === value && (url.protocol === 'https:' || url.protocol === 'http:');
  } catch {
    return false;
  }
}

function assertSubmissionAssets(manifest: DirectPrintJobManifest, assets: readonly DirectPrintAsset[]): void {
  if (assets.length !== manifest.assets.length || assets.some((item, index) => {
    const expected = manifest.assets[index];
    return !expected || item.assetId !== expected.assetId || item.sha256 !== expected.sha256 || item.pngBase64 !== expected.pngBase64;
  })) {
    throw new PrintHelperError('invalid-response', '待上传资产与打印任务不一致');
  }
}
