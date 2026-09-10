import { useEffect, useRef, useState } from 'react';
import type { DirectPrintRange, DirectPrintThreshold } from '../domain/directPrinting';
import type { PrintGroup, PrintPlan } from '../domain/printing';
import {
  defaultPrintLayout,
  resolvePrintPageGeometry,
  type PrintLayout,
} from '../domain/printLayout';
import type { PrintRotation } from '../domain/printRotation';
import type { PrinterSummary } from '../services/printHelperClient';
import type { PrintHelperCalibrationState, PrintHelperConnectionState } from './usePrintHelper';
import type { PrintHelperBootstrapState } from './usePrintHelperBootstrap';
import PrintBitmapPreview from './PrintBitmapPreview';
import PrintLabelThumbnail from './PrintLabelThumbnail';

export type DirectPrintLifecycleState =
  | { kind: 'idle' | 'rendering' | 'uploading' | 'submitting' | 'submitted'; message?: string }
  | { kind: 'partial' | 'unknown'; message?: string; submittedOrdinals: number[]; nextOrdinal: number }
  | { kind: 'error'; message: string; phase?: 'rendering' | 'uploading' | 'submitting' };

export interface DirectPrintDialogSubmission {
  group: PrintGroup;
  printerId: string;
  printerName: string;
  range: DirectPrintRange;
  copies: number;
  collate: boolean;
  layout: PrintLayout;
  horizontalOffsetMm: number;
  verticalOffsetMm: number;
  threshold: DirectPrintThreshold;
}

interface PrintReviewDialogBaseProps {
  open: boolean;
  plan: PrintPlan;
  rotations: Record<string, PrintRotation>;
  layouts: Record<string, PrintLayout>;
  onClose: () => void;
  onEditLabel: (id: string) => void;
  onRotateLabel: (id: string) => void;
  onLayoutChange: (groupKey: string, layout: PrintLayout) => void;
  onPrintGroup: (group: PrintGroup, layout: PrintLayout) => void;
}

export type PrintReviewDialogModeProps =
  | { mode: 'legacy' }
  | {
    mode: 'direct';
    connectionState: PrintHelperConnectionState;
    calibrationState: PrintHelperCalibrationState;
    selectedPrinterId: string | null;
    onSelectedPrinterIdChange: (printerId: string | null) => void;
    onLaunchHelper: () => void;
    helperBootstrapState: PrintHelperBootstrapState;
    onDownloadInstaller: () => void;
    onRetryHelperBootstrap: () => void;
    onRefreshHelper: () => void;
    onPairHelper: () => void;
    onCalibratePrinter: (printer: PrinterSummary) => void;
    directPrintState: DirectPrintLifecycleState;
    onDirectPrint: (submission: DirectPrintDialogSubmission) => void;
    onCreateRemainingTask: (nextOrdinal: number) => void;
    onEmergencyBrowserPrint: (group: PrintGroup, layout: PrintLayout) => void;
  };

type DirectPrintReviewDialogProps = PrintReviewDialogBaseProps
  & Extract<PrintReviewDialogModeProps, { mode: 'direct' }>;
type LegacyPrintReviewDialogProps = PrintReviewDialogBaseProps
  & Extract<PrintReviewDialogModeProps, { mode: 'legacy' }>;
type PrintReviewDialogProps = PrintReviewDialogBaseProps & PrintReviewDialogModeProps;

function getUniquePages(group: PrintGroup) {
  return Array.from(new Map(group.pages.map((page) => [page.label.id, page])).values());
}

export async function copyPaperSizeToClipboard(
  sizeLabel: string,
  writer?: { writeText: (text: string) => Promise<void> },
): Promise<boolean> {
  const clipboardWriter = writer ?? (typeof navigator !== 'undefined' ? navigator.clipboard : undefined);
  if (!clipboardWriter?.writeText) return false;
  try {
    await clipboardWriter.writeText(sizeLabel);
    return true;
  } catch {
    return false;
  }
}

export default function PrintReviewDialog(props: PrintReviewDialogProps) {
  return props.mode === 'direct'
    ? <DirectPrintDialog {...props} />
    : <LegacyPrintReviewDialog {...props} />;
}

function DirectPrintDialog({
  open,
  plan,
  rotations,
  layouts,
  onClose,
  connectionState,
  calibrationState,
  selectedPrinterId,
  onSelectedPrinterIdChange,
  onLaunchHelper,
  helperBootstrapState,
  onDownloadInstaller,
  onRetryHelperBootstrap,
  onRefreshHelper,
  onPairHelper,
  onCalibratePrinter,
  onRotateLabel,
  directPrintState,
  onDirectPrint,
  onCreateRemainingTask,
  onEmergencyBrowserPrint,
}: DirectPrintReviewDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [rangeMode, setRangeMode] = useState<'all' | 'custom'>('all');
  const [from, setFrom] = useState('1');
  const [to, setTo] = useState('1');
  const [copies, setCopies] = useState('1');
  const [collate, setCollate] = useState(false);
  const [layout, setLayout] = useState<PrintLayout | null>(null);
  const [horizontalOffsetMm, setHorizontalOffsetMm] = useState('0');
  const [verticalOffsetMm, setVerticalOffsetMm] = useState('0');
  const [thresholdMode, setThresholdMode] = useState<DirectPrintThreshold['mode']>('text');
  const [thresholdValue, setThresholdValue] = useState('128');
  const [previewIndex, setPreviewIndex] = useState(0);
  const [moreActions, setMoreActions] = useState(false);
  const [emergencyConfirm, setEmergencyConfirm] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [installerCopyStatus, setInstallerCopyStatus] = useState('');
  const actionPendingRef = useRef(false);
  const previousLifecycleKind = useRef(directPrintState.kind);

  const group = plan.groups.find((candidate) => candidate.widthMm === 100 && candidate.heightMm === 75) ?? null;
  const pages = group?.pages ?? [];
  const totalPages = pages.length;
  const selectedLayout = group ? layout ?? layouts[group.key] ?? defaultPrintLayout(group.widthMm, group.heightMm) : 'landscape';
  const parsedFrom = parseFieldNumber(from);
  const parsedTo = parseFieldNumber(to);
  const parsedCopies = parseFieldNumber(copies);
  const parsedHorizontalOffset = parseFieldNumber(horizontalOffsetMm);
  const parsedVerticalOffset = parseFieldNumber(verticalOffsetMm);
  const parsedThreshold = parseFieldNumber(thresholdValue);
  const range = rangeMode === 'all' ? { from: 1, to: totalPages } : { from: parsedFrom, to: parsedTo };
  const rangeValid = Number.isInteger(range.from) && Number.isInteger(range.to)
    && range.from >= 1 && range.to >= range.from && range.to <= totalPages;
  const copiesValid = Number.isInteger(parsedCopies) && parsedCopies >= 1 && parsedCopies <= 100;
  const offsetsValid = [parsedHorizontalOffset, parsedVerticalOffset].every((value) => Number.isFinite(value) && value >= -10 && value <= 10);
  const thresholdValid = thresholdMode !== 'custom' || (Number.isInteger(parsedThreshold) && parsedThreshold >= 0 && parsedThreshold <= 255);
  const compatiblePrinters = connectionState.kind === 'ready'
    ? connectionState.printers.filter((printer) => printer.isCompatible && printer.isAvailable)
    : [];
  const printer = compatiblePrinters.find((candidate) => candidate.id === selectedPrinterId) ?? null;
  const calibrationVerified = Boolean(printer)
    && calibrationState.kind === 'verified'
    && calibrationState.printerId === printer?.id;
  const busy = directPrintState.kind === 'rendering' || directPrintState.kind === 'uploading' || directPrintState.kind === 'submitting';
  const terminalLocked = directPrintState.kind === 'submitted' || directPrintState.kind === 'partial' || directPrintState.kind === 'unknown';
  const dialogBusy = busy || actionPending;
  const controlsLocked = dialogBusy || terminalLocked;
  const lifecycleAllowsSubmit = directPrintState.kind === 'idle'
    || (directPrintState.kind === 'error' && (directPrintState.phase === 'uploading' || directPrintState.phase === 'submitting'));
  const canSubmit = Boolean(group) && plan.blockers.length === 0 && connectionState.kind === 'ready' && Boolean(printer)
    && calibrationVerified
    && rangeValid && copiesValid && offsetsValid && thresholdValid && lifecycleAllowsSubmit && !actionPending;
  const page = pages[Math.min(previewIndex, Math.max(0, totalPages - 1))];
  const busyRef = useRef(dialogBusy);
  const onCloseRef = useRef(onClose);
  busyRef.current = dialogBusy;
  onCloseRef.current = onClose;

  const closeWhenAllowed = () => {
    if (!dialogBusy) onClose();
  };

  const runIrreversiblyOnce = (action: () => void) => {
    if (actionPendingRef.current || busy) return;
    actionPendingRef.current = true;
    setActionPending(true);
    try {
      action();
    } catch (error) {
      actionPendingRef.current = false;
      setActionPending(false);
      throw error;
    }
  };

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    (closeRef.current?.disabled ? dialogRef.current : closeRef.current)?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!busyRef.current) {
          event.preventDefault();
          onCloseRef.current();
        }
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled])',
      )).filter((element) => element.tabIndex >= 0 && !element.matches(':disabled'));
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialogRef.current.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [open]);

  useEffect(() => {
    setPreviewIndex((index) => Math.min(index, Math.max(0, totalPages - 1)));
  }, [totalPages]);

  useEffect(() => {
    if (previousLifecycleKind.current !== directPrintState.kind) {
      previousLifecycleKind.current = directPrintState.kind;
      actionPendingRef.current = false;
      setActionPending(false);
    }
  }, [directPrintState.kind]);

  useEffect(() => {
    if (!open) {
      actionPendingRef.current = false;
      setActionPending(false);
    }
  }, [open]);

  if (!open) return null;

  const helperMessage = describeHelperConnection(connectionState);
  const lifecycleMessage = describeDirectPrintState(directPrintState);
  const selectedCount = rangeValid ? range.to - range.from + 1 : 0;
  const finalCount = copiesValid ? selectedCount * parsedCopies : 0;
  const threshold: DirectPrintThreshold = thresholdMode === 'custom'
    ? { mode: 'custom', value: parsedThreshold }
    : { mode: thresholdMode };
  const submit = () => {
    if (!canSubmit || !group || !printer) return;
    runIrreversiblyOnce(() => onDirectPrint({
      group,
      printerId: printer.id,
      printerName: printer.displayName,
      range,
      copies: parsedCopies,
      collate: parsedCopies > 1 && collate,
      layout: selectedLayout,
      horizontalOffsetMm: parsedHorizontalOffset,
      verticalOffsetMm: parsedVerticalOffset,
      threshold,
    }));
  };
  const installerManifest = helperBootstrapState.kind === 'waiting-for-install'
    || helperBootstrapState.kind === 'timed-out'
    ? helperBootstrapState.manifest
    : null;
  const setupStage = resolveHelperSetupStage(connectionState, calibrationState, helperBootstrapState);
  const copyInstallerHash = async () => {
    if (!installerManifest) return;
    const copied = await copyPaperSizeToClipboard(installerManifest.sha256);
    setInstallerCopyStatus(copied ? 'SHA-256 已复制' : '无法访问剪贴板，请手动选择校验值');
  };

  return <div className="dialog-backdrop" onMouseDown={(event) => {
    if (event.target === event.currentTarget) closeWhenAllowed();
  }}>
    <div className="print-dialog direct-print-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="direct-print-dialog-title" tabIndex={-1}>
      <header className="print-dialog-header">
        <div>
          <span className="dialog-kicker">DIRECT PRINT · 直接打印</span>
          <h2 id="direct-print-dialog-title">直接打印标签</h2>
        </div>
        <button ref={closeRef} className="button button-quiet" type="button" onClick={closeWhenAllowed} disabled={dialogBusy}>关闭</button>
      </header>
      <p className="direct-print-live" role="status" aria-live="polite">{helperMessage}{lifecycleMessage ? `；${lifecycleMessage}` : ''}</p>
      <div className="direct-print-content">
        <section className="direct-print-settings" aria-label="直接打印设置">
          <ol className="helper-setup-progress" aria-label="打印助手设置进度">
            {['启动助手', '安装/连接', '网站配对', '打印机校准'].map((label, index) => {
              const stepState = setupStage > index ? 'complete' : setupStage === index ? 'current' : 'pending';
              return <li key={label} data-state={stepState} aria-current={stepState === 'current' ? 'step' : undefined}>
                <span aria-hidden="true">{setupStage > index ? '✓' : index + 1}</span>{label}
              </li>;
            })}
          </ol>
          {helperBootstrapState.kind === 'launching' ? <div className="helper-install-card" role="status">
            <strong>正在启动打印助手</strong>
            <p>网站正在检查本机助手；如果尚未安装，将自动安排下载安装包。</p>
          </div> : null}
          {helperBootstrapState.kind === 'loading-installer' ? <div className="helper-install-card" role="status">
            <strong>正在获取经过验证的安装包</strong>
            <p>正在核对版本、下载地址和 SHA-256。</p>
          </div> : null}
          {installerManifest ? <div className="helper-install-card" aria-label="打印助手安装">
            <strong>{helperBootstrapState.kind === 'timed-out'
              ? '等待安装超时'
              : helperBootstrapState.kind === 'waiting-for-install' && helperBootstrapState.downloadAttempted
                ? '已安排下载安装包'
                : '本次会话已安排过下载'}</strong>
            <dl className="helper-installer-meta">
              <div><dt>版本</dt><dd>版本 {installerManifest.helperVersion}</dd></div>
              <div><dt>文件</dt><dd>{installerManifest.fileName}</dd></div>
              <div><dt>SHA-256</dt><dd><code>{installerManifest.sha256}</code></dd></div>
            </dl>
            <p>仍需打开安装包并完成 Windows 安装。安装结束后本页面会继续检测。</p>
            <p className="direct-print-error">当前安装包尚未提供代码签名验证；若 Windows 无法验证来源，请停止安装。</p>
            <div className="helper-installer-actions">
              <button className="button button-quiet" type="button" disabled={controlsLocked} onClick={onDownloadInstaller}>下载安装包</button>
              <button className="button button-quiet" type="button" disabled={controlsLocked} onClick={() => { void copyInstallerHash(); }}>复制 SHA-256</button>
              <button className="button button-quiet" type="button" disabled={dialogBusy} onClick={onRetryHelperBootstrap}>已安装，立即检测</button>
            </div>
            <p className="direct-print-hint" role="status" aria-live="polite">{installerCopyStatus}</p>
          </div> : null}
          {helperBootstrapState.kind === 'error' ? <div className="helper-install-card">
            <p className="direct-print-error" role="alert">{helperBootstrapState.message}</p>
            <button className="button button-quiet" type="button" disabled={dialogBusy} onClick={onRetryHelperBootstrap}>重新检测打印助手</button>
          </div> : null}
          <div className="direct-print-connection">
            {connectionState.kind === 'ready' ? <label className="field">
              <span>打印机</span>
              <select aria-label="打印机" value={selectedPrinterId ?? ''} disabled={controlsLocked} onChange={(event) => onSelectedPrinterIdChange(event.target.value || null)}>
                <option value="">请选择可用的 XP-420B</option>
                {compatiblePrinters.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.displayName}</option>)}
              </select>
            </label> : null}
            {connectionState.kind === 'ready' && compatiblePrinters.length === 0 ? <p className="direct-print-error">未发现可用且兼容的 XP-420B 打印机。</p> : null}
            {connectionState.kind === 'not-installed' ? <button className="button button-quiet" type="button" disabled={controlsLocked} onClick={onLaunchHelper}>启动/打开打印助手</button> : null}
            {connectionState.kind === 'pairing-required' ? <button className="button button-quiet" type="button" disabled={controlsLocked} onClick={onPairHelper}>检查配对状态</button> : null}
            <button className="button button-quiet" type="button" disabled={dialogBusy} onClick={onRefreshHelper}>刷新连接</button>
          </div>

          <div className="direct-print-section">
            <strong>标签规格</strong>
            <output className="direct-print-paper">100 × 75 mm</output>
            {!group ? <p className="direct-print-error">当前打印计划中没有 100 × 75 mm 标签组。</p> : null}
            {plan.blockers.length > 0 ? <p className="direct-print-error">请先处理 {plan.blockers.length} 个排版问题后再打印。</p> : null}
          </div>

          <fieldset className="direct-print-section" disabled={controlsLocked}><legend>打印范围</legend>
            <label><input type="radio" name="direct-range" checked={rangeMode === 'all'} onChange={() => setRangeMode('all')} />全部</label>
            <label><input type="radio" name="direct-range" checked={rangeMode === 'custom'} onChange={() => setRangeMode('custom')} />自定义范围</label>
            <div className="direct-print-row">
              <label className="field"><span>起始页</span><input aria-label="起始页" type="number" min="1" max={totalPages || 1} value={rangeMode === 'all' ? 1 : from} disabled={rangeMode === 'all'} aria-invalid={!rangeValid} aria-describedby={!rangeValid ? 'direct-range-error' : undefined} onChange={(event) => setFrom(event.target.value)} /></label>
              <label className="field"><span>结束页</span><input aria-label="结束页" type="number" min="1" max={totalPages || 1} value={rangeMode === 'all' ? totalPages || 1 : to} disabled={rangeMode === 'all'} aria-invalid={!rangeValid} aria-describedby={!rangeValid ? 'direct-range-error' : undefined} onChange={(event) => setTo(event.target.value)} /></label>
            </div>
            {!rangeValid ? <p className="direct-print-error" id="direct-range-error">范围必须在 1 至 {totalPages} 页之间，且起始页不得大于结束页。</p> : null}
          </fieldset>

          <div className="direct-print-section">
            <label className="field"><span>打印份数</span><input aria-label="打印份数" type="number" min="1" max="100" value={copies} disabled={controlsLocked} aria-invalid={!copiesValid} aria-describedby={!copiesValid ? 'direct-copies-error' : undefined} onChange={(event) => setCopies(event.target.value)} /></label>
            {!copiesValid ? <p className="direct-print-error" id="direct-copies-error">打印份数必须在 1–100 之间。</p> : null}
            <label><input aria-label="逐份打印" type="checkbox" checked={collate} disabled={controlsLocked || !copiesValid || parsedCopies <= 1} onChange={(event) => setCollate(event.target.checked)} />逐份打印</label>
            <p className="direct-print-formula">所选 {selectedCount} 张 × {copiesValid ? parsedCopies : 0} 份 = 将发送 {finalCount} 张实体标签</p>
          </div>

          <fieldset className="direct-print-section" disabled={controlsLocked}><legend>方向</legend>
            <label><input type="radio" name="direct-layout" checked={selectedLayout === 'landscape'} onChange={() => setLayout('landscape')} />横向</label>
            <label><input type="radio" name="direct-layout" checked={selectedLayout === 'portrait'} onChange={() => setLayout('portrait')} />纵向</label>
            <span className="direct-print-hint">文字按当前设置旋转</span>
          </fieldset>

          <div className="direct-print-section">
            <div className="direct-print-row">
              <label className="field"><span>水平偏移</span><input aria-label="水平偏移" type="number" min="-10" max="10" step="0.1" value={horizontalOffsetMm} disabled={controlsLocked} aria-invalid={!offsetsValid} aria-describedby={!offsetsValid ? 'direct-offsets-error' : undefined} onChange={(event) => setHorizontalOffsetMm(event.target.value)} /></label>
              <label className="field"><span>垂直偏移</span><input aria-label="垂直偏移" type="number" min="-10" max="10" step="0.1" value={verticalOffsetMm} disabled={controlsLocked} aria-invalid={!offsetsValid} aria-describedby={!offsetsValid ? 'direct-offsets-error' : undefined} onChange={(event) => setVerticalOffsetMm(event.target.value)} /></label>
            </div>
            {!offsetsValid ? <p className="direct-print-error" id="direct-offsets-error">偏移必须在 -10 至 10 mm 之间。</p> : null}
          </div>

          <div className="direct-print-section">
            <label className="field"><span>黑白阈值</span>
              <select aria-label="黑白阈值" value={thresholdMode} disabled={controlsLocked} onChange={(event) => setThresholdMode(event.target.value as DirectPrintThreshold['mode'])}>
                <option value="text">文字</option><option value="auto">自动</option><option value="custom">自定义</option>
              </select>
            </label>
            {thresholdMode === 'custom' ? <label className="field"><span>自定义阈值</span><input aria-label="自定义阈值" type="number" min="0" max="255" value={thresholdValue} disabled={controlsLocked} aria-invalid={!thresholdValid} aria-describedby={!thresholdValid ? 'direct-threshold-error' : undefined} onChange={(event) => setThresholdValue(event.target.value)} /></label> : null}
            {!thresholdValid ? <p className="direct-print-error" id="direct-threshold-error">自定义阈值必须在 0–255 之间。</p> : null}
          </div>

          {printer && calibrationState.kind === 'checking' ? <p className="direct-print-hint">正在读取打印机校准状态。</p> : null}
          {printer && !calibrationVerified && calibrationState.kind !== 'checking' ? <p className="direct-print-error">校准未验证。请在打印助手中完成校准、边框测试和人工确认，再刷新连接。</p> : null}
          {printer ? <button className="button button-quiet" type="button" disabled={controlsLocked} onClick={() => onCalibratePrinter(printer)}>校准打印机</button> : null}
          {(directPrintState.kind === 'partial' || directPrintState.kind === 'unknown') ? <div className="direct-print-recovery">
            <p>{directPrintState.kind === 'partial' ? '部分提交完成。' : '提交结果未知。请先核对打印机实体输出和打印队列。'}已提交实体标签：{directPrintState.submittedOrdinals.join('、') || '无'}。</p>
            <button className="button button-quiet" type="button" disabled={actionPending} onClick={() => runIrreversiblyOnce(() => onCreateRemainingTask(directPrintState.nextOrdinal))}>从第 {directPrintState.nextOrdinal} 张创建新任务</button>
          </div> : null}
          {directPrintState.kind === 'error' ? <p className="direct-print-error">{directPrintState.message}</p> : null}
        </section>

        <section className="direct-print-preview" aria-label="标签预览">
          {page && group ? <>
            <PrintBitmapPreview page={page} layout={selectedLayout} rotation={page.label.contentType === 'text' ? rotations[page.label.id] ?? 0 : 0}
              horizontalOffsetMm={offsetsValid ? parsedHorizontalOffset : 0} verticalOffsetMm={offsetsValid ? parsedVerticalOffset : 0} />
            <div className="direct-print-rotation">
              {page.label.contentType === 'text' ? <>
                <button className="button button-quiet button-compact" type="button" aria-label="旋转当前文字标签 90°" disabled={controlsLocked} onClick={() => onRotateLabel(page.label.id)}>旋转 90°</button>
                <span>当前 {rotations[page.label.id] ?? 0}°</span>
              </> : <span>图片保持原方向</span>}
            </div>
            <div className="direct-print-preview-nav">
              <button className="button button-quiet button-compact" type="button" aria-label="上一张" disabled={controlsLocked || previewIndex === 0} onClick={() => setPreviewIndex((index) => index - 1)}>上一张</button>
              <span>第 {previewIndex + 1} / 共 {totalPages} 张</span>
              <button className="button button-quiet button-compact" type="button" aria-label="下一张" disabled={controlsLocked || previewIndex >= totalPages - 1} onClick={() => setPreviewIndex((index) => index + 1)}>下一张</button>
            </div>
          </> : <p>暂无可预览的 100 × 75 mm 标签。</p>}
        </section>
      </div>
      <footer className="direct-print-footer">
        <button className="button button-print" type="button" disabled={!canSubmit} aria-busy={dialogBusy} onClick={submit}>{actionPending ? '正在准备' : busy ? lifecycleButtonLabel(directPrintState.kind) : '直接打印'}</button>
        <button className="button button-quiet" type="button" disabled={controlsLocked} onClick={() => setMoreActions((value) => !value)}>更多操作</button>
        {moreActions ? <div className="direct-print-emergency">
          <button className="button button-quiet" type="button" disabled={controlsLocked} onClick={() => setEmergencyConfirm(true)}>浏览器打印（应急）</button>
          {emergencyConfirm ? <div className="direct-print-emergency-confirm" role="alert">
            <p>纸张设置不一致，内容可能再次被拆分到两张纸。请仅在直接打印不可用时使用。</p>
            <button className="button button-quiet" type="button" disabled={controlsLocked} onClick={() => setEmergencyConfirm(false)}>取消</button>
            <button className="button button-print" type="button" disabled={controlsLocked} onClick={() => group && runIrreversiblyOnce(() => onEmergencyBrowserPrint(group, selectedLayout))}>仍然打开浏览器打印</button>
          </div> : null}
        </div> : null}
      </footer>
    </div>
  </div>;
}

function describeHelperConnection(state: PrintHelperConnectionState): string {
  switch (state.kind) {
    case 'checking': return '正在检查打印助手';
    case 'not-installed': return '未检测到打印助手';
    case 'pairing-required': return '需要在打印助手中完成配对';
    case 'version-mismatch': return `打印助手版本不兼容（${state.helperVersion}）`;
    case 'ready': return '打印助手已连接';
    case 'error': return `打印助手连接错误：${state.message}`;
  }
}

function resolveHelperSetupStage(
  connectionState: PrintHelperConnectionState,
  calibrationState: PrintHelperCalibrationState,
  bootstrapState: PrintHelperBootstrapState,
): number {
  if (connectionState.kind === 'ready') return calibrationState.kind === 'verified' ? 4 : 3;
  if (connectionState.kind === 'pairing-required') return 2;
  if (connectionState.kind === 'version-mismatch'
    || bootstrapState.kind === 'loading-installer'
    || bootstrapState.kind === 'waiting-for-install'
    || bootstrapState.kind === 'timed-out'
    || bootstrapState.kind === 'error') return 1;
  return 0;
}

function describeDirectPrintState(state: DirectPrintLifecycleState): string {
  switch (state.kind) {
    case 'idle': return '';
    case 'rendering': return state.message ?? '正在生成打印位图';
    case 'uploading': return state.message ?? '正在上传打印任务';
    case 'submitting': return state.message ?? '正在提交打印任务';
    case 'submitted': return state.message ?? '打印任务已提交';
    case 'partial': return state.message ?? '部分标签已提交';
    case 'unknown': return state.message ?? '提交结果未知';
    case 'error': return state.message;
  }
}

function lifecycleButtonLabel(kind: DirectPrintLifecycleState['kind']): string {
  if (kind === 'rendering') return '正在生成';
  if (kind === 'uploading') return '正在上传';
  return '正在提交';
}

function parseFieldNumber(value: string): number {
  return value.trim() === '' ? Number.NaN : Number(value);
}

function LegacyPrintReviewDialog({
  open,
  plan,
  rotations,
  layouts,
  onClose,
  onEditLabel,
  onRotateLabel,
  onLayoutChange,
  onPrintGroup,
}: LegacyPrintReviewDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [copyStatus, setCopyStatus] = useState('');
  const [emergencyGroupKey, setEmergencyGroupKey] = useState<string | null>(null);

  const copyPaperSize = async (sizeLabel: string) => {
    const copied = await copyPaperSizeToClipboard(sizeLabel);
    setCopyStatus(copied
      ? `已复制 ${sizeLabel}，请粘贴到打印机的自定义纸张尺寸设置中。`
      : `复制失败，请手动输入 ${sizeLabel}。`);
  };

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), select:not([disabled])',
      ));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [onClose, open]);

  useEffect(() => {
    if (!open) setEmergencyGroupKey(null);
  }, [open]);

  if (!open) return null;
  const blocked = plan.blockers.length > 0;
  const groupPreviews = plan.groups.map((group) => ({
    group,
    uniquePages: getUniquePages(group),
  }));
  const title = blocked
    ? '还有内容需要处理'
    : `共 ${plan.totalCopies} 张，可以打印`;
  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="print-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="print-dialog-title">
        <div className="print-dialog-header">
          <div>
            <span className="dialog-kicker">PRINT CHECK · 打印检查</span>
            <h2 id="print-dialog-title">{title}</h2>
          </div>
          <button ref={closeRef} className="button button-quiet" type="button" onClick={onClose}>关闭</button>
        </div>

        {blocked ? (
          <div className="print-blockers">
            <p>请先修正以下记录。为避免漏印，所有问题解决前不会启动打印。</p>
            <ol>
              {plan.blockers.map((blocker) => (
                <li key={blocker.labelId}>
                  <div>
                    <strong>第 {blocker.labelNumber} 条 · {blocker.contentSummary}</strong>
                    <span>{blocker.reasons.join('；')}</span>
                  </div>
                  <button className="button button-quiet button-compact" type="button" onClick={() => onEditLabel(blocker.labelId)}>去修改</button>
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <div className="print-groups">
            <p>不同实际尺寸会分开打印。请按下方顺序，在打印机中换好对应规格的纸张。</p>
            <aside className="print-copy-rule" aria-label="打印份数规则">
              <strong>系统打印份数保持 1</strong>
              <span>程序已经按录入数量生成打印页，请勿在系统窗口重复增加份数。</span>
            </aside>
            <aside className="print-paper-guide" aria-labelledby="print-paper-guide-title">
              <strong id="print-paper-guide-title">系统打印使用自定义纸张</strong>
              <ol>
                <li>打开“打印机首选项”，创建与下方完全相同的用户自定义纸张。</li>
                <li>先在下方选择页面布局；系统打印窗口保持相同方向，缩放保持 100%，边距选择“无”。</li>
                <li>这里会把整块唛头文字旋转；换行、字号和纸张尺寸保持不变。</li>
                <li>不要选择 A4 或信纸代替，否则内容会缩放或产生大片留白。</li>
              </ol>
            </aside>
            <p className="print-copy-feedback" role="status" aria-live="polite">{copyStatus}</p>
            {groupPreviews.map(({ group, uniquePages }, index) => {
              const layout = layouts[group.key] ?? defaultPrintLayout(group.widthMm, group.heightMm);
              const pageGeometry = resolvePrintPageGeometry(group.widthMm, group.heightMm, layout);
              const landscapeGeometry = resolvePrintPageGeometry(group.widthMm, group.heightMm, 'landscape');
              const portraitGeometry = resolvePrintPageGeometry(group.widthMm, group.heightMm, 'portrait');
              const supportsDirectPrint = group.widthMm === 100 && group.heightMm === 75;
              const awaitingEmergencyConfirmation = emergencyGroupKey === group.key;
              return (
                <article key={group.key}>
                  <span className="print-group-index">{String(index + 1).padStart(2, '0')}</span>
                  <div className="print-group-summary">
                    <h3>{group.sizeLabel}</h3>
                    <p>{`1 × 程序生成 ${group.pages.length} 张 = 实际打印 ${group.pages.length} 张`}</p>
                  </div>
                  <div className="print-group-actions">
                    <label className="print-layout-field">
                      <span>页面布局</span>
                      <select
                        aria-label={`${group.sizeLabel} 页面布局`}
                        value={layout}
                        onChange={(event) => onLayoutChange(group.key, event.target.value as PrintLayout)}
                      >
                        <option value="landscape">横向（{landscapeGeometry.sizeLabel}）</option>
                        <option value="portrait">纵向（{portraitGeometry.sizeLabel}）</option>
                      </select>
                    </label>
                    <button
                      className="button button-quiet button-compact"
                      type="button"
                      aria-label={`复制 ${pageGeometry.sizeLabel}`}
                      onClick={() => void copyPaperSize(pageGeometry.sizeLabel)}
                    >
                      复制尺寸
                    </button>
                    <button
                      className="button button-print"
                      type="button"
                      onClick={() => supportsDirectPrint
                        ? onPrintGroup(group, layout)
                        : setEmergencyGroupKey(group.key)}
                    >
                      {supportsDirectPrint ? '直接打印标签' : '浏览器打印（应急）'}
                    </button>
                    {awaitingEmergencyConfirmation ? <div className="direct-print-emergency-confirm" role="alert">
                      <p>纸张设置不一致，内容可能再次被拆分到两张纸。请仅在直接打印不可用时使用。</p>
                      <button className="button button-quiet" type="button" onClick={() => setEmergencyGroupKey(null)}>取消</button>
                      <button className="button button-print" type="button" onClick={() => {
                        setEmergencyGroupKey(null);
                        onPrintGroup(group, layout);
                      }}>仍然打开浏览器打印</button>
                    </div> : null}
                  </div>
                  <div className="print-label-previews">
                    {uniquePages.map(({ label, preset }, labelIndex) => {
                      const rotation = label.contentType === 'text' ? rotations[label.id] ?? 0 : 0;
                      const summary = label.content.trim().split(/\r?\n/)[0] || '未填写内容';
                      return (
                        <div className="print-label-preview-row" key={label.id}>
                          <PrintLabelThumbnail label={label} preset={preset} rotation={rotation} />
                          <div className="print-label-preview-copy">
                            <strong>{summary}</strong>
                            {label.contentType === 'text' ? (
                              <div className="print-rotation-control">
                                <button
                                  className="button button-quiet button-compact"
                                  type="button"
                                  aria-label={`旋转 ${group.sizeLabel} 第 ${labelIndex + 1} 个文字唛头 ${summary} 90°`}
                                  onClick={() => onRotateLabel(label.id)}
                                >旋转 90°</button>
                                <span>当前 {rotation}°</span>
                              </div>
                            ) : <span>图片保持原方向</span>}
                            <span>输出纸张 {pageGeometry.sizeLabel}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
