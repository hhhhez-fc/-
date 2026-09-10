export interface PrintHelperInstallerManifest {
  schemaVersion: 1;
  helperVersion: string;
  protocolVersion: 1;
  platform: 'windows-x64';
  fileName: 'LabelPrintHelper-Setup.exe';
  downloadUrl: string;
  sha256: string;
  releaseNotesUrl: string;
  publishedAtUtc: string;
}

export type PrintHelperInstallerErrorCode = 'manifest-unavailable' | 'invalid-manifest';

export class PrintHelperInstallerError extends Error {
  constructor(public readonly code: PrintHelperInstallerErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PrintHelperInstallerError';
  }
}

interface LoadManifestOptions {
  fetcher?: typeof fetch;
  signal?: AbortSignal;
  manifestUrl?: string;
}

const DEFAULT_MANIFEST_URL = '/print-helper/latest.json';
const DOWNLOAD_FILE_NAME = 'LabelPrintHelper-Setup.exe';
const DOWNLOAD_SESSION_PREFIX = 'label-printing-local:helper-installer-download:v1:';
const SEMANTIC_VERSION = /^\d+\.\d+\.\d+$/;
const SHA256 = /^[a-f0-9]{64}$/;

export async function loadPrintHelperInstallerManifest(
  options: LoadManifestOptions = {},
): Promise<PrintHelperInstallerManifest> {
  const fetcher = options.fetcher ?? fetch;
  let response: Response;
  try {
    response = await fetcher(options.manifestUrl ?? DEFAULT_MANIFEST_URL, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      signal: options.signal,
    });
  } catch (error) {
    throw new PrintHelperInstallerError('manifest-unavailable', '暂时无法获取经过验证的打印助手安装包', { cause: error });
  }
  if (!response.ok) {
    throw new PrintHelperInstallerError('manifest-unavailable', '暂时无法获取经过验证的打印助手安装包');
  }
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.startsWith('application/json')) {
    throw new PrintHelperInstallerError('invalid-manifest', '打印助手安装清单格式不安全');
  }
  try {
    return validateManifest(await response.json());
  } catch (error) {
    if (error instanceof PrintHelperInstallerError) throw error;
    throw new PrintHelperInstallerError('invalid-manifest', '打印助手安装清单无法解析', { cause: error });
  }
}

export function requestPrintHelperDownload(
  manifest: PrintHelperInstallerManifest,
  documentRef: Document = document,
): void {
  const safeManifest = validateManifest(manifest);
  const anchor = documentRef.createElement('a');
  anchor.href = safeManifest.downloadUrl;
  anchor.download = safeManifest.fileName;
  anchor.hidden = true;
  anchor.rel = 'noopener noreferrer';
  documentRef.body.append(anchor);
  anchor.click();
  anchor.remove();
}

export function hasDownloadedInstallerThisSession(version: string, storage: Storage | null): boolean {
  if (!SEMANTIC_VERSION.test(version)) return false;
  try {
    return storage?.getItem(`${DOWNLOAD_SESSION_PREFIX}${version}`) === '1';
  } catch {
    return false;
  }
}

export function markInstallerDownloadedThisSession(version: string, storage: Storage | null): void {
  if (!SEMANTIC_VERSION.test(version)) return;
  try {
    storage?.setItem(`${DOWNLOAD_SESSION_PREFIX}${version}`, '1');
  } catch {
    // Session storage is optional; the visible manual download remains available.
  }
}

function validateManifest(value: unknown): PrintHelperInstallerManifest {
  if (!isObject(value)) {
    throw new PrintHelperInstallerError('invalid-manifest', '打印助手安装清单内容无效');
  }
  const helperVersion = readString(value.helperVersion);
  const sha256 = readString(value.sha256);
  const publishedAtUtc = readString(value.publishedAtUtc);
  if (value.schemaVersion !== 1
    || !SEMANTIC_VERSION.test(helperVersion)
    || value.protocolVersion !== 1
    || value.platform !== 'windows-x64'
    || value.fileName !== DOWNLOAD_FILE_NAME
    || !SHA256.test(sha256)
    || !isStrictUtcTimestamp(publishedAtUtc)) {
    throw new PrintHelperInstallerError('invalid-manifest', '打印助手安装清单内容无效');
  }

  const downloadUrl = parseSafeUrl(value.downloadUrl);
  const releaseNotesUrl = parseSafeUrl(value.releaseNotesUrl);
  const expectedAssetPath = `/hhhhez-fc/-/releases/download/print-helper-v${helperVersion}/${DOWNLOAD_FILE_NAME}`;
  const expectedNotesPath = `/hhhhez-fc/-/releases/tag/print-helper-v${helperVersion}`;
  if (!isExactGithubUrl(downloadUrl, expectedAssetPath) || !isExactGithubUrl(releaseNotesUrl, expectedNotesPath)) {
    throw new PrintHelperInstallerError('invalid-manifest', '打印助手安装清单包含未授权的下载地址');
  }

  return {
    schemaVersion: 1,
    helperVersion,
    protocolVersion: 1,
    platform: 'windows-x64',
    fileName: DOWNLOAD_FILE_NAME,
    downloadUrl: downloadUrl.href,
    sha256,
    releaseNotesUrl: releaseNotesUrl.href,
    publishedAtUtc,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isStrictUtcTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const date = new Date(value);
  return !Number.isNaN(date.valueOf()) && date.toISOString() === value;
}

function parseSafeUrl(value: unknown): URL {
  try {
    return new URL(readString(value));
  } catch (error) {
    throw new PrintHelperInstallerError('invalid-manifest', '打印助手安装清单包含无效地址', { cause: error });
  }
}

function isExactGithubUrl(url: URL, expectedPath: string): boolean {
  return url.protocol === 'https:'
    && url.hostname === 'github.com'
    && url.port === ''
    && url.username === ''
    && url.password === ''
    && url.pathname === expectedPath
    && url.search === ''
    && url.hash === '';
}
