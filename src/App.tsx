import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { createInitialDraft, resolveDefaultNewLabelPreset, type DraftAction, type DraftState } from './domain/draft';
import {
  canRedo,
  canUndo,
  createDraftHistory,
  draftHistoryReducer,
} from './domain/draftHistory';
import { createLabel, defaultSizeTypeForBusiness, type LabelPurpose } from './domain/labels';
import { recoverDraft, saveDraftSafely } from './domain/storage';
import LabelEditor from './features/LabelEditor';
import LabelList from './features/LabelList';
import RecordSearch from './features/RecordSearch';
import SourceHistory from './features/SourceHistory';
import LabelPreview from './features/LabelPreview';
import SizeStylePanel from './features/SizeStylePanel';
import ExcelImporter from './features/ExcelImporter';
import ImageImporter from './features/ImageImporter';
import ConfirmDialog from './features/ConfirmDialog';
import PrintReviewDialog, {
  type DirectPrintDialogSubmission,
  type DirectPrintLifecycleState,
  type PrintReviewDialogModeProps,
} from './features/PrintReviewDialog';
import ShortcutHelpDialog from './features/ShortcutHelpDialog';
import PrintPages from './features/PrintPages';
import { createPrintPlan, type PrintGroup, type PrintPlan } from './domain/printing';
import { validateLabelForPrint } from './domain/layout';
import { validateSizePreset } from './domain/labels';
import {
  moveWorkspacePanel,
  placeWorkspacePanel,
  type WorkspacePanelDropTarget,
  type WorkspacePanelId,
} from './domain/workspaceLayout';
import WorkspacePanel from './features/WorkspacePanel';
import { buildFontSizePreviewLabel, type FontSizeChoice } from './domain/fontSizePreview';
import { hasSameSizePresetSnapshot, restoreRecentLabel, type RecentLabelEntry } from './domain/history';
import { nextPrintRotation, type PrintRotation } from './domain/printRotation';
import { resolvePrintPageGeometry, type PrintLayout } from './domain/printLayout';
import { filterLabelsByQuery } from './domain/labelSearch';
import {
  buildPasteAction,
  createWorkspaceClipboard,
  type ClipboardMode,
  type WorkspaceClipboard,
} from './domain/workspaceClipboard';
import { isTextEditingTarget, resolveWorkspaceShortcut } from './domain/shortcutKeys';
import { createPrintJobManifest } from './domain/directPrinting';
import { renderPrintAsset } from './services/printBitmapRenderer';
import { PrintHelperError, type PrintJobStatus } from './services/printHelperClient';
import { usePrintHelper } from './features/usePrintHelper';
import { launchPrintHelper } from './services/printHelperLaunch';

interface ActiveDirectPrintTask {
  jobId: string;
  submission: DirectPrintDialogSubmission;
  physicalPages: PrintGroup['pages'];
  submittedOrdinals: number[];
}

interface AppProps {
  initialState?: DraftState;
}

export default function App({ initialState }: AppProps) {
  const [history, historyDispatch] = useReducer(draftHistoryReducer, initialState, (provided) => (
    createDraftHistory(provided ?? (
      typeof window === 'undefined' ? createInitialDraft() : recoverDraft(() => window.localStorage)
    ))
  ));
  const state = history.present;
  const [status, setStatus] = useState('草稿仅保存在这台电脑');
  const [confirmation, setConfirmation] = useState<null | {
    title: string;
    message: string;
    confirmLabel: string;
    action: () => void;
  }>(null);
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [printPreviewLabelId, setPrintPreviewLabelId] = useState<string | null>(null);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [emergencyBrowserPrintJob, setEmergencyBrowserPrintJob] = useState<null | { group: PrintGroup; layout: PrintLayout }>(null);
  const [directPrintState, setDirectPrintState] = useState<DirectPrintLifecycleState>({ kind: 'idle' });
  const [retainedPrintDialogPlan, setRetainedPrintDialogPlan] = useState<PrintPlan | null>(null);
  const [printRotations, setPrintRotations] = useState<Record<string, PrintRotation>>({});
  const [printLayouts, setPrintLayouts] = useState<Record<string, PrintLayout>>({});
  const [activeLineId, setActiveLineId] = useState<string | null>(null);
  const [selectedLineIds, setSelectedLineIds] = useState<string[]>([]);
  const [fontSizePreview, setFontSizePreview] = useState<null | { labelId: string; choice: FontSizeChoice }>(null);
  const [panelDropTarget, setPanelDropTarget] = useState<WorkspacePanelDropTarget | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [clipboard, setClipboard] = useState<WorkspaceClipboard | null>(null);
  const saveFailureRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const pendingSearchFocusRef = useRef(false);
  const activeDirectPrintTaskRef = useRef<ActiveDirectPrintTask | null>(null);
  const printHelper = usePrintHelper();
  const mountedRef = useRef(true);
  const recoveryTaskRef = useRef<ActiveDirectPrintTask | null>(null);
  const cancelSubmissionRef = useRef(printHelper.cancelSubmission);
  cancelSubmissionRef.current = printHelper.cancelSubmission;
  const warnBeforeUnload = useCallback((event: BeforeUnloadEvent) => {
    event.preventDefault();
    event.returnValue = '';
  }, []);
  const applyDraft = useCallback((
    actions: DraftAction | DraftAction[],
    description: string,
    record = true,
  ) => {
    historyDispatch({
      type: 'apply',
      actions: Array.isArray(actions) ? actions : [actions],
      description,
      record,
    });
  }, []);
  const activeLabel = state.labels.find((label) => label.id === state.activeLabelId) ?? null;
  const activePreset = useMemo(
    () => state.sizePresets.find((preset) => preset.id === activeLabel?.sizePresetId) ?? state.sizePresets[0],
    [activeLabel?.sizePresetId, state.sizePresets],
  );
  const defaultNewLabelPreset = resolveDefaultNewLabelPreset(state);
  const previewLabel = activeLabel && fontSizePreview?.labelId === activeLabel.id
    ? buildFontSizePreviewLabel(activeLabel, fontSizePreview.choice)
    : activeLabel;
  const printPlan = useMemo(() => createPrintPlan(state.labels, state.sizePresets), [state.labels, state.sizePresets]);
  const printDialogPlan = useMemo(() => (
    printPreviewLabelId === null
      ? printPlan
      : createPrintPlan(
        state.labels.filter((label) => label.id === printPreviewLabelId),
        state.sizePresets,
      )
  ), [printPlan, printPreviewLabelId, state.labels, state.sizePresets]);
  const presentedPrintDialogPlan = retainedPrintDialogPlan ?? printDialogPlan;
  const directPrintEligible = presentedPrintDialogPlan.groups.length === 1
    && presentedPrintDialogPlan.groups[0].widthMm === 100
    && presentedPrintDialogPlan.groups[0].heightMm === 75;
  const visibleLabels = useMemo(
    () => filterLabelsByQuery(state.labels, searchQuery),
    [searchQuery, state.labels],
  );
  const activeReviewErrors = activeLabel && activePreset
    ? [...validateSizePreset(activePreset), ...validateLabelForPrint(activeLabel, activePreset)]
    : [];
  const resolvedActiveLineId = activeLabel?.textLines.some((line) => line.id === activeLineId)
    ? activeLineId
    : activeLabel?.textLines[0]?.id ?? null;
  const activeTextLineIds = activeLabel?.textLines.map((line) => line.id).join(',') ?? '';

  useEffect(() => {
    const availableIds = new Set(activeLabel?.textLines.map((line) => line.id) ?? []);
    setSelectedLineIds((current) => {
      const next = current.filter((id) => availableIds.has(id));
      return next.length === current.length ? current : next;
    });
  }, [activeLabel?.id, activeTextLineIds]);

  useEffect(() => {
    document.title = '唛头打印工作台';
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const persistDraft = (updateStatus: boolean) => {
      const saved = saveDraftSafely(() => window.localStorage, state);
      if (updateStatus) {
        setStatus((current) => {
          if (!saved) return '无法保存草稿，请勿关闭页面';
          return current === '草稿仅保存在这台电脑'
            || current === '已保存在本机'
            || current === '无法保存草稿，请勿关闭页面'
            ? '已保存在本机'
            : current;
        });
      }
      if (!saved && !saveFailureRef.current) window.addEventListener('beforeunload', warnBeforeUnload);
      if (saved && saveFailureRef.current) window.removeEventListener('beforeunload', warnBeforeUnload);
      saveFailureRef.current = !saved;
    };
    const handlePageHide = () => persistDraft(false);
    const timer = window.setTimeout(() => persistDraft(true), 180);
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [state, warnBeforeUnload]);

  useEffect(() => () => {
    if (typeof window !== 'undefined') window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [warnBeforeUnload]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      activeDirectPrintTaskRef.current = null;
      recoveryTaskRef.current = null;
      cancelSubmissionRef.current();
    };
  }, []);

  useEffect(() => {
    if (!emergencyBrowserPrintJob || typeof window === 'undefined') return;
    const handleAfterPrint = () => setEmergencyBrowserPrintJob(null);
    window.addEventListener('afterprint', handleAfterPrint, { once: true });
    const firstFrame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => window.print());
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.removeEventListener('afterprint', handleAfterPrint);
    };
  }, [emergencyBrowserPrintJob]);

  useEffect(() => {
    if (printHelper.connection.kind !== 'ready') return;
    const available = printHelper.connection.printers.filter((printer) => printer.isCompatible && printer.isAvailable);
    if (available.some((printer) => printer.id === printHelper.selectedPrinterId)) return;
    const preferred = available.find((printer) => /XP[- ]?420B/i.test(printer.displayName))
      ?? available.find((printer) => printer.isDefault) ?? available[0];
    printHelper.setSelectedPrinterId(preferred?.id ?? null);
  }, [printHelper.connection, printHelper.selectedPrinterId, printHelper.setSelectedPrinterId]);

  const addManualLabel = () => {
    const sizeType = defaultSizeTypeForBusiness(state.business);
    const label = createLabel({
      content: '',
      quantity: 1,
      sides: 1,
      source: 'manual',
      purpose: state.purpose,
      contentType: 'text',
      sizeType,
      sizePresetId: defaultNewLabelPreset.id,
      needsReview: false,
    });
    clearLineSelection();
    setActiveLineId(null);
    applyDraft([
      ...(!state.sizePresets.some((preset) => preset.id === defaultNewLabelPreset.id)
        ? [{ type: 'add-size-preset' as const, preset: defaultNewLabelPreset }]
        : []),
      { type: 'add-label', label },
    ], '新增手动唛头');
    setStatus('已新增一条手动唛头');
  };

  const closeConfirmation = useCallback(() => setConfirmation(null), []);
  const closePrintDialog = useCallback(() => {
    setPrintDialogOpen(false);
    if (activeDirectPrintTaskRef.current
      && (directPrintState.kind === 'partial' || directPrintState.kind === 'unknown')) return;
    setPrintPreviewLabelId(null);
    setRetainedPrintDialogPlan(null);
    setPrintRotations({});
    setPrintLayouts({});
    activeDirectPrintTaskRef.current = null;
    recoveryTaskRef.current = null;
    setDirectPrintState({ kind: 'idle' });
  }, [directPrintState.kind]);
  const closeShortcutHelp = useCallback(() => setShortcutHelpOpen(false), []);
  const rotatePrintedLabel = useCallback((id: string) => {
    setPrintRotations((current) => ({
      ...current,
      [id]: nextPrintRotation(current[id] ?? 0),
    }));
  }, []);
  const selectLine = useCallback((id: string) => {
    setActiveLineId(id);
    setSelectedLineIds((current) => current.includes(id) ? current : [...current, id]);
  }, []);
  const activateLine = useCallback((id: string) => setActiveLineId(id), []);
  const clearLineSelection = useCallback(() => setSelectedLineIds([]), []);
  const activateLabel = useCallback((id: string) => {
    setSelectedLineIds([]);
    setActiveLineId(null);
    applyDraft({ type: 'set-active-label', id }, '切换当前唛头', false);
  }, [applyDraft]);
  const duplicateLabel = useCallback((id: string) => {
    clearLineSelection();
    setActiveLineId(null);
    applyDraft({ type: 'duplicate-label', id }, '复制唛头');
  }, [applyDraft, clearLineSelection]);
  const deleteLabel = (id: string) => {
    if (id === state.activeLabelId) clearLineSelection();
    applyDraft({ type: 'delete-label', id }, '删除唛头');
    setStatus('已删除一条唛头');
  };

  const restoreHistoryEntry = (entry: RecentLabelEntry) => {
    const restored = restoreRecentLabel(entry);
    const existingPreset = state.sizePresets.find((candidate) => candidate.id === restored.preset.id);
    const presetMatchesSnapshot = Boolean(
      existingPreset && hasSameSizePresetSnapshot(existingPreset, restored.preset),
    );
    if (existingPreset && !presetMatchesSnapshot) {
      restored.preset.id = crypto.randomUUID();
      restored.label.sizePresetId = restored.preset.id;
    }
    clearLineSelection();
    setActiveLineId(null);
    applyDraft([
      ...(!presetMatchesSnapshot
        ? [{ type: 'add-size-preset' as const, preset: restored.preset }]
        : []),
      { type: 'add-label', label: restored.label },
    ], '从使用记录新增唛头');
    setStatus('已从使用记录新增一条唛头');
  };

  const selectedCount = state.selectedLabelIds.length;
  const allSelected = state.labels.length > 0 && selectedCount === state.labels.length;
  const recordPrintableLabels = (ids?: string[]) => {
    const requestedIds = ids ? new Set(ids) : null;
    const recordedIds = new Set<string>();
    const entries = printPlan.groups.flatMap((group) => group.pages).flatMap(({ label, preset }) => {
      if (recordedIds.has(label.id) || (requestedIds && !requestedIds.has(label.id))) return [];
      recordedIds.add(label.id);
      return [{ label, preset }];
    });
    if (entries.length > 0) {
      applyDraft(
        { type: 'record-recent-labels', entries, previewedAt: Date.now() },
        '记录最近使用的唛头',
        false,
      );
    }
  };
  const openPrintDialog = (labelId: string | null) => {
    if (activeDirectPrintTaskRef.current
      && (directPrintState.kind === 'partial' || directPrintState.kind === 'unknown')) {
      setPrintDialogOpen(true);
      return;
    }
    activeDirectPrintTaskRef.current = null;
    recoveryTaskRef.current = null;
    setDirectPrintState({ kind: 'idle' });
    setPrintPreviewLabelId(labelId);
    setRetainedPrintDialogPlan(labelId === null
      ? printPlan
      : createPrintPlan(state.labels.filter((label) => label.id === labelId), state.sizePresets));
    setPrintDialogOpen(true);
  };
  const openActivePrintPreview = () => {
    if (!activeLabel || activeReviewErrors.length > 0) return;
    recordPrintableLabels([activeLabel.id]);
    openPrintDialog(activeLabel.id);
  };

  const rememberAcceptedDirectPrint = () => {
    applyDraft(
      { type: 'remember-printed-size', widthMm: 100, heightMm: 75 },
      '记录上次打印尺寸',
      false,
    );
  };

  const applyHelperJobStatus = (task: ActiveDirectPrintTask, helperStatus: PrintJobStatus) => {
    if (!mountedRef.current || activeDirectPrintTaskRef.current !== task) return;
    const submittedOrdinals = helperStatus.pages
      .filter((page) => page.status === 'submitted')
      .map((page) => page.ordinal)
      .sort((left, right) => left - right);
    task.submittedOrdinals = [...submittedOrdinals];
    const nextOrdinal = Array.from({ length: task.physicalPages.length }, (_, index) => index + 1)
      .find((ordinal) => !submittedOrdinals.includes(ordinal)) ?? task.physicalPages.length + 1;
    if (helperStatus.status === 'submitted') {
      setDirectPrintState({ kind: 'submitted', message: `已向打印队列提交 ${task.physicalPages.length} 张` });
      setStatus(`已向打印队列提交 ${task.physicalPages.length} 张`);
    } else if (helperStatus.status === 'partial') {
      setDirectPrintState({ kind: 'partial', message: '部分提交', submittedOrdinals, nextOrdinal });
      setStatus(`部分提交：已确认 ${submittedOrdinals.length} / ${task.physicalPages.length} 张`);
    } else if (helperStatus.status === 'failed') {
      activeDirectPrintTaskRef.current = null;
      setDirectPrintState({ kind: 'error', phase: 'submitting', message: '打印助手未提交任务，请检查打印机后重试' });
      setStatus('打印任务未提交');
    } else {
      setDirectPrintState({ kind: 'unknown', message: '状态不明', submittedOrdinals, nextOrdinal });
      setStatus('状态不明：请核对打印机实体输出和打印队列');
    }
  };

  const executeDirectPrintTask = async (task: ActiveDirectPrintTask, sourcePages: PrintGroup['pages']) => {
    let phase: 'rendering' | 'uploading' | 'submitting' = 'rendering';
    try {
      const renderedAssets = [];
      for (let index = 0; index < sourcePages.length; index += 1) {
        if (!mountedRef.current || activeDirectPrintTaskRef.current !== task) return;
        const message = `正在生成 ${index + 1} / ${sourcePages.length}`;
        setDirectPrintState({ kind: 'rendering', message });
        setStatus(message);
        const page = sourcePages[index];
        const renderedAsset = await renderPrintAsset({
          page,
          layout: task.submission.layout,
          rotation: page.label.contentType === 'text' ? printRotations[page.label.id] ?? 0 : 0,
          horizontalOffsetMm: task.submission.horizontalOffsetMm,
          verticalOffsetMm: task.submission.verticalOffsetMm,
          threshold: task.submission.threshold,
        });
        if (!mountedRef.current || activeDirectPrintTaskRef.current !== task) return;
        renderedAssets.push(renderedAsset);
      }
      const manifest = createPrintJobManifest({
        jobId: task.jobId,
        createdAtUtc: new Date().toISOString(),
        websiteVersion: '0.0.0',
        printerId: task.submission.printerId,
        printerName: task.submission.printerName,
        printerProfileVersion: 'xp420b-100x75-v1',
        group: task.submission.group,
        layout: task.submission.layout,
        range: task.submission.range,
        copies: task.submission.copies,
        collate: task.submission.collate,
        horizontalOffsetMm: task.submission.horizontalOffsetMm,
        verticalOffsetMm: task.submission.verticalOffsetMm,
        threshold: task.submission.threshold,
        expectedLabels: task.physicalPages.length,
        assets: renderedAssets,
      });
      if (!mountedRef.current || activeDirectPrintTaskRef.current !== task) return;
      const result = await printHelper.submitJob(manifest, manifest.assets, (progress) => {
        if (!mountedRef.current || activeDirectPrintTaskRef.current !== task) return;
        if (progress.stage === 'creating') {
          phase = 'uploading';
          const message = `正在上传 0 / ${progress.total}`;
          setDirectPrintState({ kind: 'uploading', message });
          setStatus(message);
        } else if (progress.stage === 'uploading') {
          phase = 'uploading';
          const message = `正在上传 ${progress.completed} / ${progress.total}`;
          setDirectPrintState({ kind: 'uploading', message });
          setStatus(message);
        } else if (progress.stage === 'committing') {
          phase = 'submitting';
          const message = `正在提交 ${task.physicalPages.length} 张`;
          setDirectPrintState({ kind: 'submitting', message });
          setStatus(message);
        }
      });
      if (!mountedRef.current || activeDirectPrintTaskRef.current !== task) return;
      rememberAcceptedDirectPrint();
      applyHelperJobStatus(task, result);
    } catch (error) {
      if (!mountedRef.current || activeDirectPrintTaskRef.current !== task) return;
      const message = error instanceof Error ? error.message : '打印任务失败';
      if (error instanceof PrintHelperError && error.code === 'uncertain') {
        setDirectPrintState({ kind: 'unknown', message: '提交结果未知', submittedOrdinals: [], nextOrdinal: 1 });
        setStatus('状态不明：请核对打印机实体输出和打印队列');
        return;
      }
      activeDirectPrintTaskRef.current = null;
      setDirectPrintState({ kind: 'error', phase, message });
      setStatus(phase === 'rendering' ? `生成失败：${message}` : `打印失败：${message}`);
    }
  };

  const startDirectPrint = (submission: DirectPrintDialogSubmission, sourcePages?: PrintGroup['pages']) => {
    if (activeDirectPrintTaskRef.current) return;
    const selectedPages = sourcePages ?? submission.group.pages.slice(submission.range.from - 1, submission.range.to);
    const physicalPages = sourcePages ? selectedPages : submission.collate
      ? Array.from({ length: submission.copies }, () => selectedPages).flat()
      : selectedPages.flatMap((page) => Array.from({ length: submission.copies }, () => page));
    const normalizedSubmission = sourcePages ? {
      ...submission,
      group: { ...submission.group, pages: selectedPages },
      range: { from: 1, to: selectedPages.length },
      copies: 1,
      collate: true,
    } : submission;
    const task = { jobId: crypto.randomUUID(), submission: normalizedSubmission, physicalPages, submittedOrdinals: [] };
    activeDirectPrintTaskRef.current = task;
    setDirectPrintState({ kind: 'rendering', message: `正在生成 1 / ${selectedPages.length}` });
    setStatus(`正在生成 1 / ${selectedPages.length}`);
    void executeDirectPrintTask(task, selectedPages);
  };

  const createRemainingDirectPrintTask = (nextOrdinal: number) => {
    const previous = activeDirectPrintTaskRef.current;
    if (!previous || nextOrdinal < 1 || nextOrdinal > previous.physicalPages.length) return;
    const submittedOrdinals = new Set(previous.submittedOrdinals);
    const remainingPages = previous.physicalPages.filter((_page, index) => !submittedOrdinals.has(index + 1));
    if (remainingPages.length === 0) return;
    recoveryTaskRef.current = null;
    activeDirectPrintTaskRef.current = null;
    startDirectPrint(previous.submission, remainingPages);
  };

  const refreshHelperAndOriginalJob = async () => {
    const task = activeDirectPrintTaskRef.current;
    const needsOriginalJobRecovery = Boolean(task)
      && (directPrintState.kind === 'partial' || directPrintState.kind === 'unknown');
    if (!needsOriginalJobRecovery) {
      await printHelper.refresh();
      return;
    }
    if (!task || recoveryTaskRef.current === task) return;
    recoveryTaskRef.current = task;
    try {
      await printHelper.refresh();
      if (!mountedRef.current || activeDirectPrintTaskRef.current !== task) return;
      const helperStatus = await printHelper.jobStatus(task.jobId);
      if (!mountedRef.current || activeDirectPrintTaskRef.current !== task) return;
      applyHelperJobStatus(task, helperStatus);
    } catch {
      if (!mountedRef.current || activeDirectPrintTaskRef.current !== task) return;
      setStatus('仍无法确认原打印任务状态，请先核对打印机和队列');
    } finally {
      if (recoveryTaskRef.current === task) recoveryTaskRef.current = null;
    }
  };

  const printReviewDialogModeProps: PrintReviewDialogModeProps = directPrintEligible ? {
    mode: 'direct',
    connectionState: printHelper.connection,
    calibrationState: printHelper.calibrationState,
    selectedPrinterId: printHelper.selectedPrinterId,
    onSelectedPrinterIdChange: printHelper.setSelectedPrinterId,
    onLaunchHelper: () => launchPrintHelper('start'),
    onRefreshHelper: () => { void refreshHelperAndOriginalJob(); },
    onPairHelper: () => { void printHelper.refreshPairingStatus(); },
    onCalibratePrinter: () => {
      launchPrintHelper('calibrate');
      setStatus('已请求打开打印助手校准页；浏览器无法确认助手是否已完成校准，完成边框确认后请刷新连接');
    },
    directPrintState,
    onDirectPrint: startDirectPrint,
    onCreateRemainingTask: createRemainingDirectPrintTask,
    onEmergencyBrowserPrint: (group: PrintGroup, layout: PrintLayout) => {
      closePrintDialog();
      setEmergencyBrowserPrintJob({ group, layout });
      setStatus('正在打开浏览器应急打印；系统打印份数请保持 1');
    },
  } : { mode: 'legacy' };
  const undoDraft = () => {
    const description = history.past.at(-1)?.description;
    if (!description) return;
    historyDispatch({ type: 'undo' });
    setStatus(`已撤销：${description}`);
  };
  const redoDraft = () => {
    const description = history.future.at(-1)?.description;
    if (!description) return;
    historyDispatch({ type: 'redo' });
    setStatus(`已重做：${description}`);
  };
  const clipboardTargetIds = () => state.selectedLabelIds.length > 0
    ? state.selectedLabelIds
    : state.activeLabelId ? [state.activeLabelId] : [];
  const copyOrCut = (mode: ClipboardMode) => {
    const nextClipboard = createWorkspaceClipboard(state, clipboardTargetIds(), mode);
    if (!nextClipboard) return;
    setClipboard(nextClipboard);
    setStatus(mode === 'copy'
      ? `已复制 ${nextClipboard.sourceIds.length} 条唛头`
      : `已剪切 ${nextClipboard.sourceIds.length} 条唛头，选择目标后粘贴`);
  };
  const paste = () => {
    const result = buildPasteAction(state, clipboard, () => crypto.randomUUID());
    if (!result || !clipboard) return;
    const isCut = clipboard.mode === 'cut';
    applyDraft(
      result.action,
      isCut ? `移动 ${result.pastedIds.length} 条唛头` : `粘贴 ${result.pastedIds.length} 条唛头`,
    );
    if (isCut) setClipboard(null);
    setStatus(isCut
      ? `已移动 ${result.pastedIds.length} 条唛头`
      : `已粘贴 ${result.pastedIds.length} 条唛头`);
  };

  useEffect(() => {
    if (pendingSearchFocusRef.current && !state.workspaceLayout.sizes.records.collapsed) {
      searchInputRef.current?.focus();
      pendingSearchFocusRef.current = false;
    }
  }, [state.workspaceLayout.sizes.records.collapsed]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      // Radix owns keyboard semantics until its popup closes. The event target
      // still identifies the popup if Escape unmounts it before this listener.
      if (event.defaultPrevented || target?.closest('[role="listbox"]')
        || document.querySelector('.font-size-content')) return;
      const shortcut = resolveWorkspaceShortcut({
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        textEditing: isTextEditingTarget(target),
        isComposing: event.isComposing,
        modalOpen: confirmation !== null || printDialogOpen || shortcutHelpOpen,
      });
      if (!shortcut) return;

      event.preventDefault();
      if (shortcut === 'copy') copyOrCut('copy');
      else if (shortcut === 'cut') copyOrCut('cut');
      else if (shortcut === 'paste') paste();
      else if (shortcut === 'undo') undoDraft();
      else if (shortcut === 'redo') redoDraft();
      else if (shortcut === 'find') {
        if (state.workspaceLayout.sizes.records.collapsed) {
          pendingSearchFocusRef.current = true;
          applyDraft({ type: 'toggle-panel-collapsed', id: 'records' }, '展开唛头清单');
        } else searchInputRef.current?.focus();
      }
      else if (shortcut === 'help') setShortcutHelpOpen(true);
      else if (clipboard?.mode === 'cut') {
        setClipboard(null);
        setStatus('已取消剪切');
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [clipboard, confirmation, history, printDialogOpen, shortcutHelpOpen, state]);

  const panelContents: Record<WorkspacePanelId, ReactNode> = {
    intake: <>
      <div className="panel-heading panel-drag-handle" role="group" aria-roledescription="可拖动板块" tabIndex={0} data-panel-drag-handle data-testid="panel-drag-handle" aria-label="拖动录入来源板块；左右方向键换位">
        <span className="step-number">01</span>
        <div>
          <h2 id="intake-title">录入来源</h2>
          <p>先选择业务，再导入或新增。</p>
        </div>
      </div>

      <div className="field-stack">
        <label className="field">
          <span>业务类型</span>
          <input
            value={state.business}
            onChange={(event) => applyDraft(
              { type: 'set-business', business: event.target.value },
              '修改业务类型',
            )}
            placeholder="例如：义乌铺、外贸"
          />
          <small>义乌铺默认大唛头，其他业务默认小唛头。</small>
        </label>

        <label className="field">
          <span>唛头用途</span>
          <select
            value={state.purpose}
            onChange={(event) => applyDraft(
              { type: 'set-purpose', purpose: event.target.value as LabelPurpose },
              '修改唛头用途',
            )}
          >
            <option value="carton">外箱唛头</option>
            <option value="envelope">信封唛头</option>
          </select>
        </label>
      </div>

      <div className="source-actions" aria-label="选择录入方式">
        <ExcelImporter
          sizePresetId={defaultNewLabelPreset.id}
          purpose={state.purpose}
          onImport={(labels) => {
            clearLineSelection();
            setActiveLineId(null);
            applyDraft([
              ...(!state.sizePresets.some((preset) => preset.id === defaultNewLabelPreset.id)
                ? [{ type: 'add-size-preset' as const, preset: defaultNewLabelPreset }]
                : []),
              { type: 'import-labels', labels },
            ], '导入 Excel 唛头');
          }}
          onStatus={setStatus}
        />
        <ImageImporter
          sizePresetId={defaultNewLabelPreset.id}
          purpose={state.purpose}
          onImport={(labels) => {
            clearLineSelection();
            setActiveLineId(null);
            applyDraft([
              ...(!state.sizePresets.some((preset) => preset.id === defaultNewLabelPreset.id)
                ? [{ type: 'add-size-preset' as const, preset: defaultNewLabelPreset }]
                : []),
              { type: 'import-labels', labels },
            ], '导入图片唛头');
          }}
          onStatus={setStatus}
        />
        <button className="button button-primary manual-add" type="button" onClick={addManualLabel}>
          手动新增
        </button>
      </div>

      <aside className="privacy-note">
        <strong>文件不会上传</strong>
        <span>Excel、图片识别和草稿保存都在当前浏览器中完成。</span>
      </aside>

      <SourceHistory entries={state.recentLabels} onRestore={restoreHistoryEntry} />
    </>,
    records: <>
      <div className="panel-heading panel-drag-handle records-heading" role="group" aria-roledescription="可拖动板块" tabIndex={0} data-panel-drag-handle data-testid="panel-drag-handle" aria-label="拖动唛头清单板块；左右方向键换位">
        <span className="step-number">02</span>
        <div>
          <h2 id="records-title">唛头清单</h2>
          <p>{state.labels.length} 条记录</p>
        </div>
      </div>
      <RecordSearch
        query={searchQuery}
        resultCount={visibleLabels.length}
        totalCount={state.labels.length}
        inputRef={searchInputRef}
        onChange={setSearchQuery}
        onClear={() => {
          setSearchQuery('');
          searchInputRef.current?.focus();
        }}
      />
      {visibleLabels.length > 0 || state.labels.length === 0 ? (
        <LabelList
          labels={visibleLabels}
          activeLabelId={state.activeLabelId}
          selectedLabelIds={state.selectedLabelIds}
          cutLabelIds={clipboard?.mode === 'cut' ? clipboard.sourceIds : []}
          onActivate={activateLabel}
          onToggleSelect={(id) => applyDraft({ type: 'toggle-selected', id }, '选择唛头', false)}
          onQuantityChange={(id, quantity) => applyDraft(
            { type: 'update-label', id, patch: { quantity } },
            '修改打印数量',
          )}
          onDuplicate={duplicateLabel}
          onDelete={deleteLabel}
        />
      ) : <div className="records-search-empty" role="status">没有匹配的唛头</div>}
      {(state.labels.length > 0 || clipboard !== null) && (
        <div className="bulk-toolbar" aria-label="批量操作">
          <span>{selectedCount ? `已选 ${selectedCount} 条` : '勾选后可批量应用样式'}</span>
          <div>
            <button
              type="button"
              disabled={clipboardTargetIds().length === 0}
              onClick={() => copyOrCut('copy')}
            >
              复制所选
            </button>
            <button
              type="button"
              disabled={clipboardTargetIds().length === 0}
              onClick={() => copyOrCut('cut')}
            >
              剪切所选
            </button>
            <button type="button" disabled={!clipboard} onClick={paste}>粘贴</button>
            <button type="button" disabled={state.labels.length === 0} onClick={() => applyDraft(
              { type: 'set-selected', ids: allSelected ? [] : state.labels.map((label) => label.id) },
              allSelected ? '取消全选唛头' : '全选唛头',
              false,
            )}>
              {allSelected ? '取消全选' : '全选'}
            </button>
            <button
              type="button"
              disabled={!activeLabel || selectedCount === 0}
              onClick={() => activeLabel && applyDraft(
                { type: 'apply-style-to-selected', style: activeLabel.style },
                '批量应用当前样式',
              )}
            >
              应用当前样式
            </button>
            <button
              type="button"
              disabled={selectedCount === 0}
              onClick={() => setConfirmation({
                title: `删除选中的 ${selectedCount} 条唛头？`,
                message: '删除后可使用撤销恢复，未选中的记录不受影响。',
                confirmLabel: '批量删除',
                action: () => {
                  clearLineSelection();
                  setActiveLineId(null);
                  applyDraft(
                    { type: 'delete-labels', ids: state.selectedLabelIds },
                    '批量删除唛头',
                  );
                  setStatus(`已删除 ${selectedCount} 条唛头`);
                },
              })}
            >
              删除所选
            </button>
          </div>
        </div>
      )}
      {activeLabel && (
        <LabelEditor
          label={activeLabel}
          activeLineId={resolvedActiveLineId}
          selectedLineIds={selectedLineIds}
          onActiveLineChange={activateLine}
          onSelectLine={selectLine}
          onChange={(patch) => applyDraft(
            { type: 'update-label', id: activeLabel.id, patch },
            '编辑唛头',
          )}
          onPrintPreview={openActivePrintPreview}
          reviewErrors={activeReviewErrors}
          onDuplicate={() => duplicateLabel(activeLabel.id)}
          onDelete={() => deleteLabel(activeLabel.id)}
        />
      )}
    </>,
    preview: <>
      <div className="panel-heading panel-drag-handle" role="group" aria-roledescription="可拖动板块" tabIndex={0} data-panel-drag-handle data-testid="panel-drag-handle" aria-label="拖动尺寸与预览板块；左右方向键换位">
        <span className="step-number">03</span>
        <div>
          <h2 id="preview-title">尺寸与预览</h2>
          <p>毫米尺寸与最终打印效果同步。</p>
        </div>
        <button
          className="button button-quiet button-compact preview-add-label"
          type="button"
          aria-label="在尺寸与预览中新增唛头"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={addManualLabel}
        >新增唛头</button>
      </div>
      {activeLabel && activePreset ? (
        <>
          <SizeStylePanel
            label={activeLabel}
            presets={state.sizePresets}
            onChange={(patch) => applyDraft(
              { type: 'update-label', id: activeLabel.id, patch },
              '修改唛头样式',
            )}
            onPresetChange={(id, patch) => applyDraft(
              { type: 'update-size-preset', id, patch },
              '修改唛头尺寸',
            )}
            onFontSizePreview={(choice) => setFontSizePreview(choice ? { labelId: activeLabel.id, choice } : null)}
          />
          <LabelPreview
            label={previewLabel ?? activeLabel}
            preset={activePreset}
            activeLineId={resolvedActiveLineId}
            selectedLineIds={selectedLineIds}
            onActiveLineChange={activateLine}
            onSelectLine={selectLine}
            onClearLineSelection={clearLineSelection}
            onChange={(patch) => applyDraft(
              { type: 'update-label', id: activeLabel.id, patch },
              '调整唛头布局',
            )}
          />
        </>
      ) : (
        <div className="preview-empty">
          <div className="empty-sheet" aria-hidden="true">+</div>
          <strong>选择一条唛头后显示预览</strong>
          <span>尺寸、字体和溢出状态会在这里实时更新。</span>
        </div>
      )}
    </>,
  };
  const panelTitleIds: Record<WorkspacePanelId, string> = {
    intake: 'intake-title',
    records: 'records-title',
    preview: 'preview-title',
  };

  return (
    <>
    <div className="app-shell" inert={confirmation !== null || printDialogOpen || shortcutHelpOpen}>
      <header className="app-header">
        <div>
          <p className="eyebrow">LOCAL PRINT DESK · 本地处理</p>
          <h1>唛头打印工作台</h1>
        </div>
        <div className="header-actions">
          <span className="app-status" role="status" aria-live="polite">{status}</span>
          <button
            className="button button-quiet"
            type="button"
            aria-label="快捷键帮助，F1"
            onClick={() => setShortcutHelpOpen(true)}
          >快捷键</button>
          <button
            className="button button-quiet"
            type="button"
            aria-label="撤销上一步，Ctrl+Z"
            disabled={!canUndo(history)}
            onClick={undoDraft}
          >撤销</button>
          <button
            className="button button-quiet"
            type="button"
            aria-label="重做上一步，Ctrl+Y"
            disabled={!canRedo(history)}
            onClick={redoDraft}
          >重做</button>
          {state.labels.length > 0 && (
            <button
              className="button button-quiet"
              type="button"
              onClick={() => setConfirmation({
                title: '清空当前草稿？',
                message: `将删除 ${state.labels.length} 条唛头并新建一条空白唛头；最近打印尺寸会保留。清空后可使用撤销恢复。`,
                confirmLabel: '清空草稿',
                action: () => {
                  clearLineSelection();
                  setActiveLineId(null);
                  applyDraft({ type: 'clear-draft' }, '清空草稿');
                  setStatus('草稿已清空');
                },
              })}
            >
              清空草稿
            </button>
          )}
          <button
            className="button button-quiet"
            type="button"
            onClick={() => {
              applyDraft({ type: 'reset-workspace-layout' }, '恢复默认工作区布局');
              setStatus('已恢复默认工作区布局');
            }}
          >恢复默认布局</button>
          <button className="button button-print" type="button" disabled={state.labels.length === 0} onClick={() => {
            recordPrintableLabels();
            openPrintDialog(null);
          }}>
            检查并打印
          </button>
        </div>
      </header>

      <main className="workspace" aria-label="唛头打印工作区">
        {state.workspaceLayout.order.map((id) => (
          <WorkspacePanel
            key={id}
            id={id}
            titleId={panelTitleIds[id]}
            size={state.workspaceLayout.sizes[id]}
            className={`${id}-panel`}
            dropPosition={panelDropTarget?.targetId === id ? panelDropTarget.position : undefined}
            onDropAt={(sourceId, targetId, position) => applyDraft(
              {
                type: 'set-panel-order',
                order: placeWorkspacePanel(state.workspaceLayout, sourceId, targetId, position).order,
              },
              '调整工作区顺序',
            )}
            onDragPreview={setPanelDropTarget}
            onMove={(panelId, delta) => applyDraft(
              {
                type: 'set-panel-order',
                order: moveWorkspacePanel(state.workspaceLayout, panelId, delta).order,
              },
              '调整工作区顺序',
            )}
            onResize={(panelId, patch) => applyDraft(
              { type: 'resize-panel', id: panelId, patch },
              '调整工作区板块大小',
            )}
            onToggleCollapse={(panelId) => applyDraft(
              { type: 'toggle-panel-collapsed', id: panelId },
              '切换工作区板块',
            )}
          >
            {panelContents[id]}
          </WorkspacePanel>
        ))}
      </main>
    </div>
    <ConfirmDialog
      open={confirmation !== null}
      title={confirmation?.title ?? ''}
      message={confirmation?.message ?? ''}
      confirmLabel={confirmation?.confirmLabel}
      onCancel={closeConfirmation}
      onConfirm={() => {
        confirmation?.action();
        closeConfirmation();
      }}
    />
    <PrintReviewDialog
      {...printReviewDialogModeProps}
      open={printDialogOpen}
      plan={presentedPrintDialogPlan}
      rotations={printRotations}
      layouts={printLayouts}
      onRotateLabel={rotatePrintedLabel}
      onLayoutChange={(groupKey, layout) => setPrintLayouts((current) => ({
        ...current,
        [groupKey]: layout,
      }))}
      onClose={closePrintDialog}
      onEditLabel={(id) => {
        activateLabel(id);
        closePrintDialog();
      }}
      onPrintGroup={(group, layout) => {
        if (group.widthMm === 100 && group.heightMm === 75) {
          setRetainedPrintDialogPlan({
            groups: [group],
            blockers: [],
            totalCopies: group.pages.length,
          });
          return;
        }
        const pageGeometry = resolvePrintPageGeometry(group.widthMm, group.heightMm, layout);
        applyDraft(
          { type: 'remember-printed-size', widthMm: pageGeometry.widthMm, heightMm: pageGeometry.heightMm },
          '记录上次打印尺寸',
          false,
        );
        setEmergencyBrowserPrintJob({ group, layout });
        setStatus(`正在打开 ${pageGeometry.sizeLabel} 的打印设置；系统打印份数请保持 1`);
      }}
    />
    <ShortcutHelpDialog open={shortcutHelpOpen} onClose={closeShortcutHelp} />
    <PrintPages
      group={emergencyBrowserPrintJob?.group ?? null}
      layout={emergencyBrowserPrintJob?.layout}
      rotations={printRotations}
    />
    </>
  );
}
