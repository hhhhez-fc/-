// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DirectPrintAsset, DirectPrintJobManifest } from '../src/domain/directPrinting';
import {
  PRINT_PROTOCOL_HEADER,
  PRINT_REQUEST_ID_HEADER,
  PrintHelperClient,
  PrintHelperError,
  type PairingStatusResponse,
} from '../src/services/printHelperClient';
import {
  PAIRING_TOKEN_STORAGE_KEY,
  SELECTED_PRINTER_STORAGE_KEY,
  usePrintHelper,
} from '../src/features/usePrintHelper';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlHSj8AAAAASUVORK5CYII=';

function asset(id: string): DirectPrintAsset {
  return {
    assetId: id,
    labelId: `label-${id}`,
    widthDots: 800,
    heightDots: 600,
    rotation: 0,
    pngBase64: PNG,
    sha256: 'a'.repeat(64),
  };
}

function manifest(assets: DirectPrintAsset[]): DirectPrintJobManifest {
  return {
    protocolVersion: 1,
    jobId: 'job / 一',
    createdAtUtc: '2026-09-08T00:00:00.000Z',
    websiteVersion: '1.0.0',
    printerId: 'printer-1',
    printerName: 'Xprinter XP-420B',
    profileId: 'xp420b-100x75-203dpi',
    printerProfileVersion: '1.0.0',
    widthMm: 100,
    heightMm: 75,
    widthDots: 800,
    heightDots: 600,
    layout: 'landscape',
    range: { from: 1, to: assets.length },
    copies: 1,
    collate: true,
    horizontalOffsetMm: 0,
    verticalOffsetMm: 0,
    threshold: { mode: 'auto' },
    expectedLabels: assets.length,
    assets,
    sequence: assets.map((item, index) => ({
      ordinal: index + 1,
      assetId: item.assetId,
      labelId: item.labelId,
      sourcePageNumber: index + 1,
      copyNumber: 1,
    })),
  };
}

function json(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

const stagedStatus = {
  jobId: 'job / 一',
  manifestFingerprint: 'f'.repeat(64),
  status: 'received',
  createdAtUtc: '2026-09-08T00:00:00Z',
  updatedAtUtc: '2026-09-08T00:00:00Z',
  pages: [],
};

function calibrationProfile(overrides: Record<string, unknown> = {}) {
  return {
    printerId: 'printer / 一', printerName: 'Xprinter XP-420B',
    profileId: 'xp420b-100x75-203dpi', version: 'xp420b-100x75-v1',
    profileRevision: '11111111111111111111111111111111',
    widthMillimeters: 100, heightMillimeters: 75, widthDots: 800, heightDots: 600,
    mediaType: 'gap', mediaHeightMillimeters: 2, mediaOffsetMillimeters: 0,
    referenceX: 0, referenceY: 0,
    sensorCommandDialect: 'tspl-xp420b-user-confirmed-v1',
    testAttemptId: '22222222222222222222222222222222',
    testPrintSubmittedAtUtc: '2026-09-10T00:00:00.000Z', isVerified: true,
    updatedAtUtc: '2026-09-10T00:01:00.000Z', verifiedAtUtc: '2026-09-10T00:01:00.000Z',
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  window.localStorage.clear();
});

describe('PrintHelperClient', () => {
  it('读取选中打印机的完整校准状态并使用唯一编码查询参数', async () => {
    const profile = calibrationProfile();
    const fetcher = vi.fn().mockResolvedValue(json(profile));
    const client = new PrintHelperClient({ fetcher, token: 'pair-token' });
    const calibrationStatus = (client as PrintHelperClient & {
      calibrationStatus?: (printerId: string) => Promise<unknown>;
    }).calibrationStatus;

    expect(calibrationStatus).toBeTypeOf('function');
    if (!calibrationStatus) return;
    await expect(calibrationStatus.call(client, 'printer / 一')).resolves.toEqual(profile);
    expect(fetcher.mock.calls[0][0]).toBe('https://localhost:17653/v1/calibration?printerId=printer%20%2F%20%E4%B8%80');
  });

  it('接受 helper DateTimeOffset 的零偏移校准时间并保留原字符串', async () => {
    const profile = calibrationProfile({
      testPrintSubmittedAtUtc: '2026-09-10T00:00:00+00:00',
      updatedAtUtc: '2026-09-10T00:01:00.1234567+00:00',
      verifiedAtUtc: '2026-09-10T00:01:00.1234567+00:00',
    });
    const client = new PrintHelperClient({ fetcher: vi.fn().mockResolvedValue(json(profile)), token: 'pair-token' });

    await expect(client.calibrationStatus('printer / 一')).resolves.toEqual(profile);
  });

  it.each([
    '2026-09-10T08:01:00+08:00',
    '2026-09-10T00:01:00',
    '2026-02-31T00:01:00+00:00',
  ])('拒绝非零偏移、无时区或非法日期的校准时间：%s', async (updatedAtUtc) => {
    const client = new PrintHelperClient({
      fetcher: vi.fn().mockResolvedValue(json(calibrationProfile({ updatedAtUtc }))),
      token: 'pair-token',
    });

    await expect(client.calibrationStatus('printer / 一')).rejects.toMatchObject({ code: 'invalid-response' });
  });
  it('discovers the exact loopback health endpoint and validates the response', async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ protocolVersion: 1, helperVersion: '0.1.0', status: 'ready' }));
    const client = new PrintHelperClient({ fetcher });

    await expect(client.health()).resolves.toEqual({ protocolVersion: 1, helperVersion: '0.1.0', status: 'ready' });
    expect(fetcher).toHaveBeenCalledWith('https://localhost:17653/v1/health', expect.objectContaining({ method: 'GET' }));
  });

  it('uses the opaque pairing request id as the bearer capability while polling approval', async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ requestId: 'pair-capability-1', status: 'denied' }));
    const client = new PrintHelperClient({ fetcher, token: 'unrelated-stored-token' });

    await client.pairingStatus('pair-capability-1');

    const headers = new Headers(fetcher.mock.calls[0][1]?.headers);
    expect(headers.get('Authorization')).toBe('Bearer pair-capability-1');
  });

  it('accepts the stable claimed pairing terminal state without requiring a second token', async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ requestId: 'pair-capability-1', status: 'claimed' }));
    const client = new PrintHelperClient({ fetcher });

    await expect(client.pairingStatus('pair-capability-1')).resolves.toEqual({
      requestId: 'pair-capability-1',
      status: 'claimed',
    });
  });

  it.each([
    [new TypeError('Failed to fetch'), 'unavailable'],
  ] as const)('classifies discovery failures without exposing response bodies', async (failure, code) => {
    const client = new PrintHelperClient({ fetcher: vi.fn().mockRejectedValue(failure) });
    await expect(client.health()).rejects.toMatchObject({ code });
  });

  it('classifies timeouts and aborts the underlying fetch', async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    const fetcher = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      requestSignal = init?.signal ?? undefined;
      requestSignal?.addEventListener('abort', () => reject(requestSignal?.reason), { once: true });
    }));
    const client = new PrintHelperClient({ fetcher, timeoutMs: 25 });
    const promise = client.health();
    const rejection = expect(promise).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(25);

    await rejection;
    expect(requestSignal?.aborted).toBe(true);
  });

  it('rejects malformed JSON shapes and never includes a raw error body', async () => {
    const malformed = new PrintHelperClient({ fetcher: vi.fn().mockResolvedValue(json({ protocolVersion: '1', secret: 'do-not-leak' })) });
    await expect(malformed.health()).rejects.toMatchObject({ code: 'invalid-response' });

    const http = new PrintHelperClient({ fetcher: vi.fn().mockResolvedValue(new Response('private helper details', { status: 500 })) });
    const error = await http.health().catch((caught: unknown) => caught) as PrintHelperError;
    expect(error.code).toBe('http');
    expect(error.message).not.toContain('private helper details');
  });

  it('accepts the validating status exposed while the helper performs commit preflight', async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ ...stagedStatus, status: 'validating' }));
    const client = new PrintHelperClient({ fetcher, token: 'pair-token' });

    await expect(client.jobStatus(stagedStatus.jobId)).resolves.toMatchObject({ status: 'validating' });
  });

  it('accepts helper DateTimeOffset zero-offset job timestamps and preserves them', async () => {
    const status = {
      ...stagedStatus,
      createdAtUtc: '2026-09-08T00:00:00+00:00',
      updatedAtUtc: '2026-09-08T00:00:01.1234567+00:00',
    };
    const client = new PrintHelperClient({ token: 'token', fetcher: vi.fn().mockResolvedValue(json(status)) });

    await expect(client.jobStatus(stagedStatus.jobId)).resolves.toEqual(status);
  });

  it('rejects non-zero-offset job timestamps', async () => {
    const client = new PrintHelperClient({
      token: 'token',
      fetcher: vi.fn().mockResolvedValue(json({ ...stagedStatus, updatedAtUtc: '2026-09-08T08:00:00+08:00' })),
    });

    await expect(client.jobStatus(stagedStatus.jobId)).rejects.toMatchObject({ code: 'invalid-response' });
  });

  it('uses bearer auth, encoded routes, one create, N uploads, and exactly one commit', async () => {
    const assets = [asset('asset / 1'), asset('资产-2')];
    const job = manifest(assets);
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json(stagedStatus))
      .mockResolvedValueOnce(json(stagedStatus))
      .mockResolvedValueOnce(json(stagedStatus))
      .mockResolvedValueOnce(json({ ...stagedStatus, status: 'submitted' }));
    const progress = vi.fn();
    const client = new PrintHelperClient({ fetcher, token: 'pair-token' });

    await expect(client.submitJob(job, assets, undefined, progress)).resolves.toMatchObject({ status: 'submitted' });
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'https://localhost:17653/v1/jobs',
      'https://localhost:17653/v1/jobs/job%20%2F%20%E4%B8%80/assets/asset%20%2F%201',
      'https://localhost:17653/v1/jobs/job%20%2F%20%E4%B8%80/assets/%E8%B5%84%E4%BA%A7-2',
      'https://localhost:17653/v1/jobs/job%20%2F%20%E4%B8%80/commit',
    ]);
    for (const [, init] of fetcher.mock.calls) {
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer pair-token');
      expect(headers.get(PRINT_PROTOCOL_HEADER)).toBe('1');
    }
    const requestIds = fetcher.mock.calls.map(([, init]) => new Headers(init?.headers).get(PRINT_REQUEST_ID_HEADER));
    expect(requestIds.every((requestId) => requestId && /^[0-9a-f-]{36}$/i.test(requestId))).toBe(true);
    expect(new Set(requestIds).size).toBe(4);
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('Content-Type')).toBe('application/json');
    expect(new Headers(fetcher.mock.calls[1][1]?.headers).get('Content-Type')).toBe('application/json');
    expect(progress.mock.calls.map(([event]) => event.stage)).toEqual(['creating', 'uploading', 'uploading', 'committing', 'complete']);
  });

  it.each(['failed', 'timed-out'] as const)('surfaces a %s commit exactly once and never retries it', async (failureKind) => {
    vi.useFakeTimers();
    const item = asset('asset-1');
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json(stagedStatus))
      .mockResolvedValueOnce(json(stagedStatus));
    if (failureKind === 'failed') {
      fetcher.mockResolvedValueOnce(new Response('secret', { status: 503 }));
    } else {
      fetcher.mockImplementationOnce((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      }));
    }
    const client = new PrintHelperClient({ fetcher, timeoutMs: 20 });
    const pending = client.submitJob(manifest([item]), [item]);
    const rejection = expect(pending).rejects.toMatchObject({ code: 'uncertain', jobId: 'job / 一' });
    if (failureKind === 'timed-out') await vi.advanceTimersByTimeAsync(20);

    await rejection;
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/commit'))).toHaveLength(1);
  });

  it('composes caller cancellation into the request without making another attempt', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    }));
    const client = new PrintHelperClient({ fetcher });
    const pending = client.health(controller.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: 'unavailable' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('uses a separate commit timeout and marks network loss or cancellation after commit starts as uncertain', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    }));
    const client = new PrintHelperClient({ fetcher, timeoutMs: 10, commitTimeoutMs: 50 });
    const pending = client.commitJob('job-uncertain');
    await vi.advanceTimersByTimeAsync(10);
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(false);
    const rejection = expect(pending).rejects.toMatchObject({ code: 'uncertain', jobId: 'job-uncertain' });
    await vi.advanceTimersByTimeAsync(40);
    await rejection;
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects finite-enum violations and responses bound to another job or pairing request', async () => {
    const badPage = { ordinal: 1, assetId: 'asset-1', sha256: 'a'.repeat(64), status: 'mystery' };
    const invalidPage = new PrintHelperClient({ token: 'token', fetcher: vi.fn().mockResolvedValue(json({ ...stagedStatus, pages: [badPage] })) });
    await expect(invalidPage.jobStatus(stagedStatus.jobId)).rejects.toMatchObject({ code: 'invalid-response' });

    const wrongJob = new PrintHelperClient({ token: 'token', fetcher: vi.fn().mockResolvedValue(json({ ...stagedStatus, jobId: 'other-job' })) });
    await expect(wrongJob.jobStatus(stagedStatus.jobId)).rejects.toMatchObject({ code: 'invalid-response' });

    const wrongPairing = new PrintHelperClient({ fetcher: vi.fn().mockResolvedValue(json({ requestId: 'other', status: 'denied' })) });
    await expect(wrongPairing.pairingStatus('expected')).rejects.toMatchObject({ code: 'invalid-response' });
  });

  it('strictly rejects normalized calendar dates in jobs and pairing expiry timestamps', async () => {
    const badJobDate = new PrintHelperClient({
      token: 'token',
      fetcher: vi.fn().mockResolvedValue(json({ ...stagedStatus, updatedAtUtc: '2026-02-31T00:00:00Z' })),
    });
    await expect(badJobDate.jobStatus(stagedStatus.jobId)).rejects.toMatchObject({ code: 'invalid-response' });

    const badPairingDate = new PrintHelperClient({
      fetcher: vi.fn().mockResolvedValue(json({ requestId: 'pair-1', status: 'pending', expiresAtUtc: '2026-02-31T00:00:00Z' })),
    });
    await expect(badPairingDate.pairingStatus('pair-1')).rejects.toMatchObject({ code: 'invalid-response' });
  });
});

describe('usePrintHelper', () => {
  const health = { protocolVersion: 1 as const, helperVersion: '0.1.0', status: 'ready' };
  const printers = [{ id: 'p1', displayName: 'Xprinter XP-420B', isDefault: true, isCompatible: true, queueStatus: 'ready', isAvailable: true }];

  it('装载并在刷新后重新读取所选打印机的校准验证状态', async () => {
    window.localStorage.setItem(PAIRING_TOKEN_STORAGE_KEY, JSON.stringify({ version: 1, value: 'token' }));
    window.localStorage.setItem(SELECTED_PRINTER_STORAGE_KEY, JSON.stringify({ version: 1, value: 'p1' }));
    const verified = {
      printerId: 'p1', printerName: 'Xprinter XP-420B', profileId: 'xp420b-100x75-203dpi',
      version: 'xp420b-100x75-v1', profileRevision: '11111111111111111111111111111111',
      widthMillimeters: 100, heightMillimeters: 75, widthDots: 800, heightDots: 600,
      mediaType: 'gap', mediaHeightMillimeters: 2, mediaOffsetMillimeters: 0,
      referenceX: 0, referenceY: 0, sensorCommandDialect: 'tspl-xp420b-user-confirmed-v1',
      testAttemptId: '22222222222222222222222222222222', testPrintSubmittedAtUtc: '2026-09-10T00:00:00.000Z',
      isVerified: true, updatedAtUtc: '2026-09-10T00:01:00.000Z', verifiedAtUtc: '2026-09-10T00:01:00.000Z',
    };
    const client = {
      health: vi.fn().mockResolvedValue(health), setToken: vi.fn(), printers: vi.fn().mockResolvedValue(printers),
      calibrationStatus: vi.fn().mockResolvedValueOnce(verified).mockResolvedValueOnce({ ...verified, isVerified: false, verifiedAtUtc: undefined }),
      createPairingRequest: vi.fn(), pairingStatus: vi.fn(), submitJob: vi.fn(), jobStatus: vi.fn(),
    } as unknown as PrintHelperClient;
    const { result } = renderHook(() => usePrintHelper({ client, storage: window.localStorage, origin: 'https://labels.example' }));

    await waitFor(() => expect((result.current as typeof result.current & { calibrationState?: unknown }).calibrationState)
      .toEqual({ kind: 'verified', printerId: 'p1', profileRevision: verified.profileRevision }));
    await act(async () => result.current.refresh());
    await waitFor(() => expect((result.current as typeof result.current & { calibrationState?: unknown }).calibrationState)
      .toEqual({ kind: 'unverified', printerId: 'p1' }));
    expect(client.calibrationStatus).toHaveBeenCalledTimes(2);
  });

  it('clears credentials on 401, creates one exact-origin pairing request, and stores no other data', async () => {
    window.localStorage.setItem(PAIRING_TOKEN_STORAGE_KEY, JSON.stringify({ version: 1, value: 'old' }));
    window.localStorage.setItem(SELECTED_PRINTER_STORAGE_KEY, JSON.stringify({ version: 1, value: 'p1' }));
    const client = {
      health: vi.fn().mockResolvedValue(health),
      setToken: vi.fn(),
      printers: vi.fn().mockRejectedValue(new PrintHelperError('unauthorized', '需要重新配对')),
      createPairingRequest: vi.fn().mockResolvedValue({ requestId: 'pair-1', status: 'pending', expiresAtUtc: '2026-09-08T00:05:00Z' }),
      pairingStatus: vi.fn(),
      submitJob: vi.fn(),
    } as unknown as PrintHelperClient;

    const { result } = renderHook(() => usePrintHelper({ client, storage: window.localStorage, origin: 'https://labels.example' }));
    await waitFor(() => expect(result.current.connection).toEqual({ kind: 'pairing-required', requestId: 'pair-1' }));

    expect(client.createPairingRequest).toHaveBeenCalledTimes(1);
    expect(client.createPairingRequest).toHaveBeenCalledWith('https://labels.example', expect.any(AbortSignal));
    expect(window.localStorage.getItem(PAIRING_TOKEN_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(SELECTED_PRINTER_STORAGE_KEY)).toBeNull();
    expect(Object.keys(window.localStorage)).toEqual([]);
  });

  it('stores an approved token, reconnects, and persists only deliberate printer selection', async () => {
    const client = {
      health: vi.fn().mockResolvedValue(health),
      setToken: vi.fn(),
      printers: vi.fn().mockResolvedValue(printers),
      createPairingRequest: vi.fn().mockResolvedValue({ requestId: 'pair-1', status: 'pending', expiresAtUtc: '2026-09-08T00:05:00Z' }),
      pairingStatus: vi.fn().mockResolvedValue({ requestId: 'pair-1', status: 'approved', token: 'new-token' } satisfies PairingStatusResponse),
      submitJob: vi.fn(),
    } as unknown as PrintHelperClient;
    const { result } = renderHook(() => usePrintHelper({ client, storage: window.localStorage, origin: 'https://labels.example' }));
    await waitFor(() => expect(result.current.connection.kind).toBe('pairing-required'));

    await act(async () => result.current.refreshPairingStatus());
    await waitFor(() => expect(result.current.connection).toEqual({ kind: 'ready', printers }));
    expect(JSON.parse(window.localStorage.getItem(PAIRING_TOKEN_STORAGE_KEY)!)).toEqual({ version: 1, value: 'new-token' });
    act(() => result.current.setSelectedPrinterId('p1'));
    expect(JSON.parse(window.localStorage.getItem(SELECTED_PRINTER_STORAGE_KEY)!)).toEqual({ version: 1, value: 'p1' });
    expect(Object.keys(window.localStorage).sort()).toEqual([PAIRING_TOKEN_STORAGE_KEY, SELECTED_PRINTER_STORAGE_KEY].sort());
  });

  it('reconnects through the full health path after approval and starts one new pairing request if that token is rejected', async () => {
    const client = {
      health: vi.fn().mockResolvedValue(health),
      setToken: vi.fn(),
      printers: vi.fn().mockRejectedValue(new PrintHelperError('unauthorized', '需要重新配对')),
      createPairingRequest: vi.fn()
        .mockResolvedValueOnce({ requestId: 'pair-1', status: 'pending', expiresAtUtc: '2026-09-08T00:05:00Z' })
        .mockResolvedValueOnce({ requestId: 'pair-2', status: 'pending', expiresAtUtc: '2026-09-08T00:06:00Z' }),
      pairingStatus: vi.fn().mockResolvedValue({ requestId: 'pair-1', status: 'approved', token: 'rejected-token' } satisfies PairingStatusResponse),
      submitJob: vi.fn(),
    } as unknown as PrintHelperClient;
    const { result } = renderHook(() => usePrintHelper({ client, storage: window.localStorage, origin: 'https://labels.example' }));
    await waitFor(() => expect(result.current.connection).toEqual({ kind: 'pairing-required', requestId: 'pair-1' }));

    await act(async () => result.current.refreshPairingStatus());
    await waitFor(() => expect(result.current.connection).toEqual({ kind: 'pairing-required', requestId: 'pair-2' }));

    expect(client.health).toHaveBeenCalledTimes(2);
    expect(client.createPairingRequest).toHaveBeenCalledTimes(2);
    expect(window.localStorage.getItem(PAIRING_TOKEN_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(SELECTED_PRINTER_STORAGE_KEY)).toBeNull();
  });

  it('reports helper absence and protocol mismatch as distinct connection states', async () => {
    const absent = new PrintHelperClient({ fetcher: vi.fn().mockRejectedValue(new TypeError('offline')) });
    const first = renderHook(() => usePrintHelper({ client: absent, storage: window.localStorage, origin: 'https://labels.example' }));
    await waitFor(() => expect(first.result.current.connection.kind).toBe('not-installed'));
    first.unmount();

    const mismatch = new PrintHelperClient({ fetcher: vi.fn().mockResolvedValue(json({ protocolVersion: 2, helperVersion: '9.0.0', status: 'ready' })) });
    const second = renderHook(() => usePrintHelper({ client: mismatch, storage: window.localStorage, origin: 'https://labels.example' }));
    await waitFor(() => expect(second.result.current.connection).toEqual({ kind: 'version-mismatch', helperVersion: '9.0.0' }));
  });

  it('ignores stale completion after refresh and completion after unmount', async () => {
    let resolveFirst!: (value: typeof health) => void;
    let resolveSecond!: (value: typeof health) => void;
    const client = {
      health: vi.fn()
        .mockImplementationOnce(() => new Promise<typeof health>((resolve) => { resolveFirst = resolve; }))
        .mockImplementationOnce(() => new Promise<typeof health>((resolve) => { resolveSecond = resolve; })),
      setToken: vi.fn(), printers: vi.fn(), createPairingRequest: vi.fn(), pairingStatus: vi.fn(), submitJob: vi.fn(),
    } as unknown as PrintHelperClient;
    const { result, unmount } = renderHook(() => usePrintHelper({ client, storage: window.localStorage, origin: 'https://labels.example' }));
    act(() => { void result.current.refresh(); });
    resolveFirst(health);
    await Promise.resolve();
    expect(client.createPairingRequest).not.toHaveBeenCalled();
    unmount();
    resolveSecond(health);
    await Promise.resolve();
    expect(client.createPairingRequest).not.toHaveBeenCalled();
  });

  it('refuses a second in-flight submission instead of aborting and starting another job', async () => {
    let finish!: (value: typeof stagedStatus) => void;
    const client = {
      health: vi.fn().mockResolvedValue(health), setToken: vi.fn(), printers: vi.fn(),
      createPairingRequest: vi.fn(), pairingStatus: vi.fn(), jobStatus: vi.fn(),
      submitJob: vi.fn().mockImplementation(() => new Promise<typeof stagedStatus>((resolve) => { finish = resolve; })),
    } as unknown as PrintHelperClient;
    const { result } = renderHook(() => usePrintHelper({ client, storage: window.localStorage, origin: 'https://labels.example' }));
    const item = asset('asset-1');
    const first = result.current.submitJob(manifest([item]), [item]);
    await expect(result.current.submitJob(manifest([item]), [item])).rejects.toMatchObject({ code: 'busy' });
    expect(client.submitJob).toHaveBeenCalledTimes(1);
    finish({ ...stagedStatus, status: 'submitted' });
    await expect(first).resolves.toMatchObject({ status: 'submitted' });
  });

  it('clears authorization on a print 401 and exposes deliberate status recovery by original job id', async () => {
    window.localStorage.setItem(PAIRING_TOKEN_STORAGE_KEY, JSON.stringify({ version: 1, value: 'old' }));
    window.localStorage.setItem(SELECTED_PRINTER_STORAGE_KEY, JSON.stringify({ version: 1, value: 'p1' }));
    const client = {
      health: vi.fn().mockResolvedValue(health), setToken: vi.fn(), printers: vi.fn().mockResolvedValue(printers),
      createPairingRequest: vi.fn(), pairingStatus: vi.fn(),
      submitJob: vi.fn().mockRejectedValue(new PrintHelperError('unauthorized', '需要重新配对')),
      jobStatus: vi.fn().mockResolvedValue({ ...stagedStatus, status: 'submitting' }),
    } as unknown as PrintHelperClient;
    const { result } = renderHook(() => usePrintHelper({ client, storage: window.localStorage, origin: 'https://labels.example' }));
    await waitFor(() => expect(result.current.connection.kind).toBe('ready'));
    const item = asset('asset-1');
    await expect(result.current.submitJob(manifest([item]), [item])).rejects.toMatchObject({ code: 'unauthorized' });
    expect(window.localStorage.getItem(PAIRING_TOKEN_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(SELECTED_PRINTER_STORAGE_KEY)).toBeNull();
    await expect(result.current.jobStatus('job / 一')).resolves.toMatchObject({ status: 'submitting' });
    expect(client.jobStatus).toHaveBeenCalledWith('job / 一', expect.any(AbortSignal));
  });
});
