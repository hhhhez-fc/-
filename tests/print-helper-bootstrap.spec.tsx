// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrintHelperInstallerManifest } from '../src/services/printHelperInstaller';
import { usePrintHelperBootstrap } from '../src/features/usePrintHelperBootstrap';
import type { PrintHelperConnectionState } from '../src/features/usePrintHelper';

const manifest: PrintHelperInstallerManifest = {
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

interface HookProps {
  open: boolean;
  connectionState: PrintHelperConnectionState;
}

afterEach(() => {
  vi.useRealTimers();
  window.sessionStorage.clear();
});

describe('usePrintHelperBootstrap', () => {
  it('does nothing until direct printing is deliberately started', async () => {
    const launch = vi.fn();
    const refresh = vi.fn().mockResolvedValue(undefined);
    const loadManifest = vi.fn().mockResolvedValue(manifest);
    const requestDownload = vi.fn();
    const { result } = renderHook(() => usePrintHelperBootstrap({
      open: true,
      connectionState: { kind: 'not-installed' },
      launch,
      refresh,
      loadManifest,
      requestDownload,
      sessionStorage: window.sessionStorage,
    }));

    await act(async () => Promise.resolve());

    expect(result.current.state).toEqual({ kind: 'idle' });
    expect(launch).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(loadManifest).not.toHaveBeenCalled();
    expect(requestDownload).not.toHaveBeenCalled();
  });

  it('launches once, probes through five seconds, and arranges one download', async () => {
    vi.useFakeTimers();
    const launch = vi.fn();
    const refresh = vi.fn().mockResolvedValue(undefined);
    const loadManifest = vi.fn().mockResolvedValue(manifest);
    const requestDownload = vi.fn();
    const { result } = renderHook(() => usePrintHelperBootstrap({
      open: true,
      connectionState: { kind: 'not-installed' },
      launch,
      refresh,
      loadManifest,
      requestDownload,
      sessionStorage: window.sessionStorage,
    }));

    act(() => result.current.start());
    await act(async () => vi.advanceTimersByTimeAsync(5000));

    expect(launch).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(4);
    expect(loadManifest).toHaveBeenCalledTimes(1);
    expect(requestDownload).toHaveBeenCalledTimes(1);
    expect(result.current.state).toEqual({
      kind: 'waiting-for-install',
      manifest,
      downloadAttempted: true,
    });
  });

  it('cancels pending download as soon as the helper becomes reachable', async () => {
    vi.useFakeTimers();
    const launch = vi.fn();
    const refresh = vi.fn().mockResolvedValue(undefined);
    const loadManifest = vi.fn().mockResolvedValue(manifest);
    const requestDownload = vi.fn();
    const { result, rerender } = renderHook(
      ({ open, connectionState }: HookProps) => usePrintHelperBootstrap({
        open,
        connectionState,
        launch,
        refresh,
        loadManifest,
        requestDownload,
        sessionStorage: window.sessionStorage,
      }),
      { initialProps: { open: true, connectionState: { kind: 'not-installed' } as PrintHelperConnectionState } },
    );

    act(() => result.current.start());
    await act(async () => vi.advanceTimersByTimeAsync(1500));
    rerender({ open: true, connectionState: { kind: 'pairing-required', requestId: 'pair-1' } });
    await act(async () => vi.advanceTimersByTimeAsync(10000));

    expect(launch).toHaveBeenCalledTimes(1);
    expect(loadManifest).not.toHaveBeenCalled();
    expect(requestDownload).not.toHaveBeenCalled();
    expect(result.current.state).toEqual({ kind: 'idle' });
  });

  it('does not automatically download the same helper version twice in one session', async () => {
    vi.useFakeTimers();
    const requestDownload = vi.fn();
    const common = {
      open: true,
      connectionState: { kind: 'version-mismatch', helperVersion: '0.0.9' } as PrintHelperConnectionState,
      launch: vi.fn(),
      refresh: vi.fn().mockResolvedValue(undefined),
      loadManifest: vi.fn().mockResolvedValue(manifest),
      requestDownload,
      sessionStorage: window.sessionStorage,
    };
    const first = renderHook(() => usePrintHelperBootstrap(common));
    act(() => first.result.current.start());
    await act(async () => Promise.resolve());
    first.unmount();

    const second = renderHook(() => usePrintHelperBootstrap(common));
    act(() => second.result.current.start());
    await act(async () => Promise.resolve());

    expect(common.launch).not.toHaveBeenCalled();
    expect(requestDownload).toHaveBeenCalledTimes(1);
    expect(second.result.current.state).toEqual({
      kind: 'waiting-for-install',
      manifest,
      downloadAttempted: false,
    });
  });

  it('manual download remains available after automatic download deduplication', async () => {
    const requestDownload = vi.fn();
    const { result } = renderHook(() => usePrintHelperBootstrap({
      open: true,
      connectionState: { kind: 'version-mismatch', helperVersion: '0.0.9' },
      launch: vi.fn(),
      refresh: vi.fn().mockResolvedValue(undefined),
      loadManifest: vi.fn().mockResolvedValue(manifest),
      requestDownload,
      sessionStorage: window.sessionStorage,
    }));
    act(() => result.current.start());
    await act(async () => Promise.resolve());

    await act(async () => result.current.downloadInstaller());

    expect(requestDownload).toHaveBeenCalledTimes(2);
  });

  it('closing the dialog aborts all later probes and state updates', async () => {
    vi.useFakeTimers();
    const refresh = vi.fn().mockResolvedValue(undefined);
    const loadManifest = vi.fn().mockResolvedValue(manifest);
    const { result, rerender } = renderHook(
      ({ open, connectionState }: HookProps) => usePrintHelperBootstrap({
        open,
        connectionState,
        launch: vi.fn(),
        refresh,
        loadManifest,
        requestDownload: vi.fn(),
        sessionStorage: window.sessionStorage,
      }),
      { initialProps: { open: true, connectionState: { kind: 'not-installed' } as PrintHelperConnectionState } },
    );
    act(() => result.current.start());
    const probesBeforeClose = refresh.mock.calls.length;
    rerender({ open: false, connectionState: { kind: 'not-installed' } });

    await act(async () => vi.advanceTimersByTimeAsync(130000));

    expect(refresh).toHaveBeenCalledTimes(probesBeforeClose);
    expect(loadManifest).not.toHaveBeenCalled();
    expect(result.current.state).toEqual({ kind: 'idle' });
  });

  it('surfaces manifest failures without navigating to an unknown download', async () => {
    const requestDownload = vi.fn();
    const { result } = renderHook(() => usePrintHelperBootstrap({
      open: true,
      connectionState: { kind: 'version-mismatch', helperVersion: '0.0.9' },
      launch: vi.fn(),
      refresh: vi.fn().mockResolvedValue(undefined),
      loadManifest: vi.fn().mockRejectedValue(new Error('bad manifest')),
      requestDownload,
      sessionStorage: window.sessionStorage,
    }));
    act(() => result.current.start());
    await act(async () => Promise.resolve());

    expect(result.current.state).toEqual({
      kind: 'error',
      message: '暂时无法获取经过验证的打印助手安装包',
    });
    expect(requestDownload).not.toHaveBeenCalled();
  });
});
