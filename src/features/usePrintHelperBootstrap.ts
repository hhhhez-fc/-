import { useCallback, useEffect, useRef, useState } from 'react';
import type { PrintHelperConnectionState } from './usePrintHelper';
import {
  hasDownloadedInstallerThisSession,
  loadPrintHelperInstallerManifest,
  markInstallerDownloadedThisSession,
  requestPrintHelperDownload,
  type PrintHelperInstallerManifest,
} from '../services/printHelperInstaller';
import { launchPrintHelper } from '../services/printHelperLaunch';

export type PrintHelperBootstrapState =
  | { kind: 'idle' }
  | { kind: 'launching' }
  | { kind: 'loading-installer' }
  | { kind: 'waiting-for-install'; manifest: PrintHelperInstallerManifest; downloadAttempted: boolean }
  | { kind: 'timed-out'; manifest: PrintHelperInstallerManifest }
  | { kind: 'error'; message: string };

interface UsePrintHelperBootstrapOptions {
  open: boolean;
  connectionState: PrintHelperConnectionState;
  refresh: () => Promise<void>;
  launch?: () => void;
  loadManifest?: (signal?: AbortSignal) => Promise<PrintHelperInstallerManifest>;
  requestDownload?: (manifest: PrintHelperInstallerManifest) => void;
  sessionStorage?: Storage | null;
}

export interface UsePrintHelperBootstrapResult {
  state: PrintHelperBootstrapState;
  start: () => void;
  retryConnection: () => Promise<void>;
  downloadInstaller: () => Promise<void>;
}

const LAUNCH_PROBE_DELAYS_MS = [0, 1500, 1500, 2000] as const;
const INSTALL_POLL_INTERVAL_MS = 2000;
const INSTALL_POLL_TIMEOUT_MS = 120000;

export function usePrintHelperBootstrap({
  open,
  connectionState,
  refresh,
  launch = () => launchPrintHelper('start'),
  loadManifest = (signal) => loadPrintHelperInstallerManifest({ signal }),
  requestDownload = requestPrintHelperDownload,
  sessionStorage = getBrowserSessionStorage(),
}: UsePrintHelperBootstrapOptions): UsePrintHelperBootstrapResult {
  const [state, setState] = useState<PrintHelperBootstrapState>({ kind: 'idle' });
  const [startVersion, setStartVersion] = useState(0);
  const requested = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const connectionRef = useRef(connectionState);
  const refreshRef = useRef(refresh);
  const launchRef = useRef(launch);
  const loadManifestRef = useRef(loadManifest);
  const requestDownloadRef = useRef(requestDownload);
  connectionRef.current = connectionState;
  refreshRef.current = refresh;
  launchRef.current = launch;
  loadManifestRef.current = loadManifest;
  requestDownloadRef.current = requestDownload;

  const cancelActiveRun = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
  }, []);

  const beginInstallerFlow = useCallback(async (active: AbortController) => {
    if (active.signal.aborted) return;
    setState({ kind: 'loading-installer' });
    try {
      const manifest = await loadManifestRef.current(active.signal);
      if (active.signal.aborted) return;
      const alreadyDownloaded = hasDownloadedInstallerThisSession(manifest.helperVersion, sessionStorage);
      if (!alreadyDownloaded) {
        markInstallerDownloadedThisSession(manifest.helperVersion, sessionStorage);
        requestDownloadRef.current(manifest);
      }
      setState({ kind: 'waiting-for-install', manifest, downloadAttempted: !alreadyDownloaded });

      const polls = INSTALL_POLL_TIMEOUT_MS / INSTALL_POLL_INTERVAL_MS;
      for (let index = 0; index < polls; index += 1) {
        await cancellableDelay(INSTALL_POLL_INTERVAL_MS, active.signal);
        if (active.signal.aborted) return;
        await refreshRef.current();
        if (active.signal.aborted || isConnected(connectionRef.current)) return;
      }
      if (!active.signal.aborted) setState({ kind: 'timed-out', manifest });
    } catch (error) {
      if (!active.signal.aborted) {
        setState({ kind: 'error', message: '暂时无法获取经过验证的打印助手安装包' });
      }
    }
  }, [sessionStorage]);

  const beginLaunchFlow = useCallback(async (active: AbortController) => {
    setState({ kind: 'launching' });
    launchRef.current();
    try {
      for (const delayMs of LAUNCH_PROBE_DELAYS_MS) {
        if (delayMs > 0) await cancellableDelay(delayMs, active.signal);
        if (active.signal.aborted) return;
        await refreshRef.current();
        if (active.signal.aborted || isConnected(connectionRef.current)) return;
      }
      await beginInstallerFlow(active);
    } catch {
      if (!active.signal.aborted) await beginInstallerFlow(active);
    }
  }, [beginInstallerFlow]);

  const start = useCallback(() => {
    requested.current = true;
    setStartVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    if (!open) {
      requested.current = false;
      cancelActiveRun();
      setState({ kind: 'idle' });
    }
  }, [cancelActiveRun, open]);

  useEffect(() => {
    if (isConnected(connectionState)) {
      cancelActiveRun();
      setState({ kind: 'idle' });
    }
  }, [cancelActiveRun, connectionState]);

  useEffect(() => {
    if (!open || !requested.current || controller.current) return;
    if (connectionState.kind !== 'not-installed' && connectionState.kind !== 'version-mismatch') return;
    const active = new AbortController();
    controller.current = active;
    if (connectionState.kind === 'version-mismatch') void beginInstallerFlow(active);
    else void beginLaunchFlow(active);
  }, [beginInstallerFlow, beginLaunchFlow, connectionState.kind, open, startVersion]);

  useEffect(() => () => cancelActiveRun(), [cancelActiveRun]);

  const retryConnection = useCallback(async () => {
    await refreshRef.current();
  }, []);

  const downloadInstaller = useCallback(async () => {
    let manifest: PrintHelperInstallerManifest;
    if (state.kind === 'waiting-for-install' || state.kind === 'timed-out') {
      manifest = state.manifest;
    } else {
      setState({ kind: 'loading-installer' });
      try {
        manifest = await loadManifestRef.current();
      } catch {
        setState({ kind: 'error', message: '暂时无法获取经过验证的打印助手安装包' });
        return;
      }
    }
    markInstallerDownloadedThisSession(manifest.helperVersion, sessionStorage);
    requestDownloadRef.current(manifest);
    setState({ kind: 'waiting-for-install', manifest, downloadAttempted: true });
  }, [sessionStorage, state]);

  return { state, start, retryConnection, downloadInstaller };
}

function isConnected(state: PrintHelperConnectionState): boolean {
  return state.kind === 'ready' || state.kind === 'pairing-required';
}

function cancellableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(resolve, milliseconds);
    signal.addEventListener('abort', () => {
      window.clearTimeout(timeout);
      reject(signal.reason);
    }, { once: true });
  });
}

function getBrowserSessionStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}
