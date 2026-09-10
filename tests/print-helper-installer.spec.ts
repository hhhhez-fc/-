// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  hasDownloadedInstallerThisSession,
  loadPrintHelperInstallerManifest,
  markInstallerDownloadedThisSession,
  requestPrintHelperDownload,
  type PrintHelperInstallerManifest,
} from '../src/services/printHelperInstaller';

const validManifest: PrintHelperInstallerManifest = {
  schemaVersion: 1,
  helperVersion: '0.1.0',
  protocolVersion: 1,
  platform: 'windows-x64',
  fileName: 'LabelPrintHelper-Setup.exe',
  downloadUrl: 'https://github.com/hhhhez-fc/-/releases/download/print-helper-v0.1.0/LabelPrintHelper-Setup.exe',
  sha256: 'a'.repeat(64),
  releaseNotesUrl: 'https://github.com/hhhhez-fc/-/releases/tag/print-helper-v0.1.0',
  publishedAtUtc: '2026-09-10T00:00:00.000Z',
};

function jsonResponse(value: unknown, contentType = 'application/json'): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': contentType },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
  document.body.replaceChildren();
});

describe('print helper installer manifest', () => {
  it('loads a complete, immutable installer manifest without browser cache', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(validManifest));

    const result = await loadPrintHelperInstallerManifest({ fetcher });

    expect(result).toEqual(validManifest);
    expect(fetcher).toHaveBeenCalledWith('/print-helper/latest.json', expect.objectContaining({
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    }));
  });

  it.each([
    ['foreign host', { downloadUrl: 'https://attacker.example/LabelPrintHelper-Setup.exe' }],
    ['moving latest URL', { downloadUrl: 'https://github.com/hhhhez-fc/-/releases/latest/download/LabelPrintHelper-Setup.exe' }],
    ['wrong release version', { downloadUrl: 'https://github.com/hhhhez-fc/-/releases/download/print-helper-v0.2.0/LabelPrintHelper-Setup.exe' }],
    ['query-bearing URL', { downloadUrl: `${validManifest.downloadUrl}?source=labels` }],
    ['invalid checksum', { sha256: 'ABC123' }],
    ['unsupported protocol', { protocolVersion: 2 }],
    ['unsupported platform', { platform: 'windows-arm64' }],
    ['invalid publication date', { publishedAtUtc: '2026-02-31T00:00:00.000Z' }],
    ['HTML response', validManifest, 'text/html'],
  ])('rejects %s instead of offering an unverified download', async (_name, override, contentType = 'application/json') => {
    const payload = override === validManifest ? validManifest : { ...validManifest, ...override };
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(payload, contentType));

    await expect(loadPrintHelperInstallerManifest({ fetcher })).rejects.toMatchObject({
      code: 'invalid-manifest',
    });
  });

  it('reports HTTP failures without attempting to parse an error page', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('<h1>not found</h1>', {
      status: 404,
      headers: { 'content-type': 'text/html' },
    }));

    await expect(loadPrintHelperInstallerManifest({ fetcher })).rejects.toMatchObject({
      code: 'manifest-unavailable',
    });
  });
});

describe('print helper installer download', () => {
  it('clicks one temporary download link containing only validated release metadata', () => {
    let clicked: { href: string; download: string; rel: string } | null = null;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function capture(this: HTMLAnchorElement) {
      clicked = { href: this.href, download: this.download, rel: this.rel };
    });

    requestPrintHelperDownload(validManifest, document);

    expect(clicked).toEqual({
      href: validManifest.downloadUrl,
      download: 'LabelPrintHelper-Setup.exe',
      rel: 'noopener noreferrer',
    });
    expect(document.body.querySelectorAll('a')).toHaveLength(0);
  });

  it('deduplicates automatic downloads by helper version for one browser session', () => {
    expect(hasDownloadedInstallerThisSession('0.1.0', window.sessionStorage)).toBe(false);

    markInstallerDownloadedThisSession('0.1.0', window.sessionStorage);

    expect(hasDownloadedInstallerThisSession('0.1.0', window.sessionStorage)).toBe(true);
    expect(hasDownloadedInstallerThisSession('0.2.0', window.sessionStorage)).toBe(false);
    expect(Object.keys(window.sessionStorage)).toEqual([
      'label-printing-local:helper-installer-download:v1:0.1.0',
    ]);
  });
});
