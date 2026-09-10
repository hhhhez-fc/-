import { useCallback, useEffect, useRef, useState } from 'react';
import type { DirectPrintAsset, DirectPrintJobManifest } from '../domain/directPrinting';
import {
  PrintHelperClient,
  PrintHelperError,
  type PrinterCalibrationProfile,
  type PrinterSummary,
  type PrintJobStatus,
  type PrintSubmissionProgress,
} from '../services/printHelperClient';

export const PAIRING_TOKEN_STORAGE_KEY = 'label-printing-local:print-helper-token:v1';
export const SELECTED_PRINTER_STORAGE_KEY = 'label-printing-local:selected-printer:v1';

export type PrintHelperConnectionState =
  | { kind: 'checking' }
  | { kind: 'not-installed' }
  | { kind: 'pairing-required'; requestId: string }
  | { kind: 'version-mismatch'; helperVersion: string }
  | { kind: 'ready'; printers: PrinterSummary[] }
  | { kind: 'error'; message: string };

export type PrintHelperCalibrationState =
  | { kind: 'not-selected' }
  | { kind: 'checking'; printerId: string }
  | { kind: 'verified'; printerId: string; profileRevision: string }
  | { kind: 'unverified'; printerId: string }
  | { kind: 'error'; printerId: string; message: string };

interface StoredValue {
  version: 1;
  value: string;
}

interface UsePrintHelperOptions {
  client?: PrintHelperClient;
  storage?: Storage | null;
  origin?: string;
}

export interface UsePrintHelperResult {
  connection: PrintHelperConnectionState;
  calibrationState: PrintHelperCalibrationState;
  selectedPrinterId: string | null;
  setSelectedPrinterId: (printerId: string | null) => void;
  refresh: () => Promise<void>;
  refreshPairingStatus: () => Promise<void>;
  submitJob: (
    manifest: DirectPrintJobManifest,
    assets: readonly DirectPrintAsset[],
    onProgress?: (progress: PrintSubmissionProgress) => void,
  ) => Promise<PrintJobStatus>;
  jobStatus: (jobId: string) => Promise<PrintJobStatus>;
  cancelSubmission: () => void;
}

export function usePrintHelper(options: UsePrintHelperOptions = {}): UsePrintHelperResult {
  const ownedClient = useRef<PrintHelperClient | null>(null);
  if (!ownedClient.current) ownedClient.current = new PrintHelperClient();
  const client = options.client ?? ownedClient.current;
  const storage = options.storage === undefined ? getBrowserStorage() : options.storage;
  const origin = options.origin ?? getBrowserOrigin();
  const [connection, setConnection] = useState<PrintHelperConnectionState>({ kind: 'checking' });
  const [calibrationState, setCalibrationState] = useState<PrintHelperCalibrationState>({ kind: 'not-selected' });
  const [selectedPrinterId, setSelectedPrinterState] = useState<string | null>(() => readStoredValue(storage, SELECTED_PRINTER_STORAGE_KEY));
  const request = useRef<{ generation: number; controller: AbortController }>({ generation: 0, controller: new AbortController() });
  const submissionController = useRef<AbortController | null>(null);
  const statusController = useRef<AbortController | null>(null);
  const calibrationRequest = useRef<{ generation: number; controller: AbortController }>({ generation: 0, controller: new AbortController() });
  const mounted = useRef(true);

  const isCurrent = useCallback((generation: number) => mounted.current && request.current.generation === generation, []);

  const beginRequest = useCallback(() => {
    request.current.controller.abort();
    const next = { generation: request.current.generation + 1, controller: new AbortController() };
    request.current = next;
    return next;
  }, []);

  const requestPairing = useCallback(async (generation: number, signal: AbortSignal) => {
    const pairing = await client.createPairingRequest(origin, signal);
    if (isCurrent(generation)) setConnection({ kind: 'pairing-required', requestId: pairing.requestId });
  }, [client, isCurrent, origin]);

  const clearAuthorization = useCallback(() => {
    removeStoredValue(storage, PAIRING_TOKEN_STORAGE_KEY);
    removeStoredValue(storage, SELECTED_PRINTER_STORAGE_KEY);
    client.setToken(null);
    if (mounted.current) {
      setSelectedPrinterState(null);
      setCalibrationState({ kind: 'not-selected' });
    }
  }, [client, storage]);

  const refresh = useCallback(async (sessionToken?: string) => {
    const active = beginRequest();
    if (mounted.current) setConnection({ kind: 'checking' });
    try {
      const health = await client.health(active.controller.signal);
      if (!isCurrent(active.generation)) return;
      if (health.protocolVersion !== 1) {
        setConnection({ kind: 'version-mismatch', helperVersion: health.helperVersion });
        return;
      }
      const token = sessionToken ?? readStoredValue(storage, PAIRING_TOKEN_STORAGE_KEY);
      client.setToken(token);
      if (!token) {
        await requestPairing(active.generation, active.controller.signal);
        return;
      }
      try {
        const printers = await client.printers(active.controller.signal);
        if (isCurrent(active.generation)) setConnection({ kind: 'ready', printers });
      } catch (error) {
        if (error instanceof PrintHelperError && error.code === 'unauthorized' && isCurrent(active.generation)) {
          clearAuthorization();
          await requestPairing(active.generation, active.controller.signal);
          return;
        }
        throw error;
      }
    } catch (error) {
      if (!isCurrent(active.generation)) return;
      if (error instanceof PrintHelperError && (error.code === 'unavailable' || error.code === 'timeout')) {
        setConnection({ kind: 'not-installed' });
      } else if (error instanceof PrintHelperError && error.code === 'version-mismatch') {
        setConnection({ kind: 'version-mismatch', helperVersion: 'unknown' });
      } else {
        setConnection({ kind: 'error', message: safeMessage(error) });
      }
    }
  }, [beginRequest, clearAuthorization, client, isCurrent, requestPairing, storage]);

  const refreshPairingStatus = useCallback(async () => {
    if (connection.kind !== 'pairing-required') return;
    const requestId = connection.requestId;
    const active = beginRequest();
    try {
      const status = await client.pairingStatus(requestId, active.controller.signal);
      if (!isCurrent(active.generation)) return;
      if (status.status === 'pending') {
        setConnection({ kind: 'pairing-required', requestId });
        return;
      }
      if (status.status === 'approved') {
        writeStoredValue(storage, PAIRING_TOKEN_STORAGE_KEY, status.token);
        client.setToken(status.token);
        await refresh(status.token);
        return;
      }
      const message = status.status === 'denied'
        ? '打印助手配对已拒绝'
        : status.status === 'claimed'
          ? '本次配对授权已领取，请刷新连接后重新配对'
          : '打印助手配对已过期';
      setConnection({ kind: 'error', message });
    } catch (error) {
      if (!isCurrent(active.generation)) return;
      setConnection({ kind: 'error', message: safeMessage(error) });
    }
  }, [beginRequest, client, connection, isCurrent, refresh, storage]);

  const setSelectedPrinterId = useCallback((printerId: string | null) => {
    const normalized = printerId?.trim() || null;
    setSelectedPrinterState(normalized);
    if (normalized) writeStoredValue(storage, SELECTED_PRINTER_STORAGE_KEY, normalized);
    else removeStoredValue(storage, SELECTED_PRINTER_STORAGE_KEY);
  }, [storage]);

  const submitJob = useCallback(async (
    manifest: DirectPrintJobManifest,
    assets: readonly DirectPrintAsset[],
    onProgress?: (progress: PrintSubmissionProgress) => void,
  ) => {
    if (submissionController.current) {
      throw new PrintHelperError('busy', '已有打印任务正在提交，请等待状态明确后再操作');
    }
    const controller = new AbortController();
    submissionController.current = controller;
    try {
      return await client.submitJob(manifest, assets, controller.signal, onProgress);
    } catch (error) {
      if (error instanceof PrintHelperError && error.code === 'unauthorized') clearAuthorization();
      throw error;
    } finally {
      if (submissionController.current === controller) submissionController.current = null;
    }
  }, [clearAuthorization, client]);

  const jobStatus = useCallback(async (jobId: string) => {
    statusController.current?.abort();
    const controller = new AbortController();
    statusController.current = controller;
    try {
      return await client.jobStatus(jobId, controller.signal);
    } catch (error) {
      if (error instanceof PrintHelperError && error.code === 'unauthorized') clearAuthorization();
      throw error;
    } finally {
      if (statusController.current === controller) statusController.current = null;
    }
  }, [clearAuthorization, client]);

  const cancelSubmission = useCallback(() => submissionController.current?.abort(), []);

  useEffect(() => {
    calibrationRequest.current.controller.abort();
    const active = {
      generation: calibrationRequest.current.generation + 1,
      controller: new AbortController(),
    };
    calibrationRequest.current = active;
    const selectedPrinter = connection.kind === 'ready'
      ? connection.printers.find((printer) => printer.id === selectedPrinterId && printer.isCompatible && printer.isAvailable)
      : undefined;
    if (!selectedPrinterId || !selectedPrinter) {
      setCalibrationState({ kind: 'not-selected' });
      return () => active.controller.abort();
    }
    setCalibrationState({ kind: 'checking', printerId: selectedPrinterId });
    void (async () => {
      try {
        const profile: PrinterCalibrationProfile | null = await client.calibrationStatus(selectedPrinterId, active.controller.signal);
        if (!mounted.current || calibrationRequest.current.generation !== active.generation) return;
        setCalibrationState(profile?.isVerified
          ? { kind: 'verified', printerId: selectedPrinterId, profileRevision: profile.profileRevision }
          : { kind: 'unverified', printerId: selectedPrinterId });
      } catch (error) {
        if (!mounted.current || calibrationRequest.current.generation !== active.generation) return;
        setCalibrationState({ kind: 'error', printerId: selectedPrinterId, message: safeMessage(error) });
      }
    })();
    return () => active.controller.abort();
  }, [client, connection, selectedPrinterId]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
      request.current.controller.abort();
      submissionController.current?.abort();
      statusController.current?.abort();
      calibrationRequest.current.controller.abort();
    };
  }, [refresh]);

  return {
    connection,
    calibrationState,
    selectedPrinterId,
    setSelectedPrinterId,
    refresh,
    refreshPairingStatus,
    submitJob,
    jobStatus,
    cancelSubmission,
  };
}

function getBrowserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function getBrowserOrigin(): string {
  try {
    return typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
  } catch {
    return 'http://localhost';
  }
}

function readStoredValue(storage: Storage | null, key: string): string | null {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredValue> | null;
    return parsed?.version === 1 && typeof parsed.value === 'string' && parsed.value.trim() ? parsed.value : null;
  } catch {
    return null;
  }
}

function writeStoredValue(storage: Storage | null, key: string, value: string): void {
  try {
    storage?.setItem(key, JSON.stringify({ version: 1, value } satisfies StoredValue));
  } catch {
    // Storage is optional; the active session can still continue.
  }
}

function removeStoredValue(storage: Storage | null, key: string): void {
  try {
    storage?.removeItem(key);
  } catch {
    // Storage is optional; the active session can still continue.
  }
}

function safeMessage(error: unknown): string {
  if (error instanceof PrintHelperError) return error.message;
  return '打印助手连接失败，请手动重试';
}
