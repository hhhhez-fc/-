import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { createInitialDraft, draftReducer, resolveDefaultNewLabelPreset, type DraftState } from './domain/draft';
import { createLabel, defaultSizeTypeForBusiness, type LabelPurpose } from './domain/labels';
import { recoverDraft, saveDraftSafely } from './domain/storage';
import LabelEditor from './features/LabelEditor';
import LabelList from './features/LabelList';
import SourceHistory from './features/SourceHistory';
import LabelPreview from './features/LabelPreview';
import SizeStylePanel from './features/SizeStylePanel';
import ExcelImporter from './features/ExcelImporter';
import ImageImporter from './features/ImageImporter';
import ConfirmDialog from './features/ConfirmDialog';
import PrintReviewDialog from './features/PrintReviewDialog';
import PrintPages from './features/PrintPages';
import { createPrintPlan, type PrintGroup } from './domain/printing';
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

interface AppProps {
  initialState?: DraftState;
}

export default function App({ initialState }: AppProps) {
  const [state, dispatch] = useReducer(draftReducer, initialState, (provided) => provided ?? (
    typeof window === 'undefined' ? createInitialDraft() : recoverDraft(() => window.localStorage)
  ));
  const [status, setStatus] = useState('草稿仅保存在这台电脑');
  const [confirmation, setConfirmation] = useState<null | {
    title: string;
    message: string;
    confirmLabel: string;
    action: () => void;
  }>(null);
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [activePrintGroup, setActivePrintGroup] = useState<PrintGroup | null>(null);
  const [printRotations, setPrintRotations] = useState<Record<string, PrintRotation>>({});
  const [activeLineId, setActiveLineId] = useState<string | null>(null);
  const [selectedLineIds, setSelectedLineIds] = useState<string[]>([]);
  const [fontSizePreview, setFontSizePreview] = useState<null | { labelId: string; choice: FontSizeChoice }>(null);
  const [panelDropTarget, setPanelDropTarget] = useState<WorkspacePanelDropTarget | null>(null);
  const saveFailureRef = useRef(false);
  const warnBeforeUnload = useCallback((event: BeforeUnloadEvent) => {
    event.preventDefault();
    event.returnValue = '';
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
      if (updateStatus) setStatus(saved ? '已保存在本机' : '无法保存草稿，请勿关闭页面');
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
    if (!activePrintGroup || typeof window === 'undefined') return;
    const handleAfterPrint = () => setActivePrintGroup(null);
    window.addEventListener('afterprint', handleAfterPrint, { once: true });
    const firstFrame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => window.print());
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.removeEventListener('afterprint', handleAfterPrint);
    };
  }, [activePrintGroup]);

  const addManualLabel = () => {
    const sizeType = defaultSizeTypeForBusiness(state.business);
    if (!state.sizePresets.some((preset) => preset.id === defaultNewLabelPreset.id)) {
      dispatch({ type: 'add-size-preset', preset: defaultNewLabelPreset });
    }
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
    dispatch({ type: 'add-label', label });
    setStatus('已新增一条手动唛头');
  };

  const closeConfirmation = useCallback(() => setConfirmation(null), []);
  const closePrintDialog = useCallback(() => {
    setPrintDialogOpen(false);
    setPrintRotations({});
  }, []);
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
    dispatch({ type: 'set-active-label', id });
  }, []);
  const duplicateLabel = useCallback((id: string) => {
    clearLineSelection();
    setActiveLineId(null);
    dispatch({ type: 'duplicate-label', id });
  }, [clearLineSelection]);
  const deleteLabel = (id: string) => {
    if (id === state.activeLabelId) clearLineSelection();
    dispatch({ type: 'delete-label', id });
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
    if (!presetMatchesSnapshot) {
      dispatch({ type: 'add-size-preset', preset: restored.preset });
    }
    clearLineSelection();
    setActiveLineId(null);
    dispatch({ type: 'add-label', label: restored.label });
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
      dispatch({ type: 'record-recent-labels', entries, previewedAt: Date.now() });
    }
  };
  const openActivePrintPreview = () => {
    if (!activeLabel || activeReviewErrors.length > 0) return;
    recordPrintableLabels([activeLabel.id]);
    setPrintDialogOpen(true);
  };
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
            onChange={(event) => dispatch({ type: 'set-business', business: event.target.value })}
            placeholder="例如：义乌铺、外贸"
          />
          <small>义乌铺默认大唛头，其他业务默认小唛头。</small>
        </label>

        <label className="field">
          <span>唛头用途</span>
          <select
            value={state.purpose}
            onChange={(event) => dispatch({ type: 'set-purpose', purpose: event.target.value as LabelPurpose })}
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
            if (!state.sizePresets.some((preset) => preset.id === defaultNewLabelPreset.id)) {
              dispatch({ type: 'add-size-preset', preset: defaultNewLabelPreset });
            }
            clearLineSelection();
            setActiveLineId(null);
            dispatch({ type: 'import-labels', labels });
          }}
          onStatus={setStatus}
        />
        <ImageImporter
          sizePresetId={defaultNewLabelPreset.id}
          purpose={state.purpose}
          onImport={(labels) => {
            if (!state.sizePresets.some((preset) => preset.id === defaultNewLabelPreset.id)) {
              dispatch({ type: 'add-size-preset', preset: defaultNewLabelPreset });
            }
            clearLineSelection();
            setActiveLineId(null);
            dispatch({ type: 'import-labels', labels });
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
      <LabelList
        labels={state.labels}
        activeLabelId={state.activeLabelId}
        selectedLabelIds={state.selectedLabelIds}
        onActivate={activateLabel}
        onToggleSelect={(id) => dispatch({ type: 'toggle-selected', id })}
        onQuantityChange={(id, quantity) => dispatch({ type: 'update-label', id, patch: { quantity } })}
        onDuplicate={duplicateLabel}
        onDelete={deleteLabel}
      />
      {state.labels.length > 0 && (
        <div className="bulk-toolbar" aria-label="批量操作">
          <span>{selectedCount ? `已选 ${selectedCount} 条` : '勾选后可批量应用样式'}</span>
          <div>
            <button type="button" onClick={() => dispatch({ type: 'set-selected', ids: allSelected ? [] : state.labels.map((label) => label.id) })}>
              {allSelected ? '取消全选' : '全选'}
            </button>
            <button
              type="button"
              disabled={!activeLabel || selectedCount === 0}
              onClick={() => activeLabel && dispatch({ type: 'apply-style-to-selected', style: activeLabel.style })}
            >
              应用当前样式
            </button>
            <button
              type="button"
              disabled={selectedCount === 0}
              onClick={() => setConfirmation({
                title: `删除选中的 ${selectedCount} 条唛头？`,
                message: '删除后无法撤销，未选中的记录不受影响。',
                confirmLabel: '批量删除',
                action: () => {
                  clearLineSelection();
                  setActiveLineId(null);
                  state.selectedLabelIds.forEach((id) => dispatch({ type: 'delete-label', id }));
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
          onChange={(patch) => dispatch({ type: 'update-label', id: activeLabel.id, patch })}
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
            onChange={(patch) => dispatch({ type: 'update-label', id: activeLabel.id, patch })}
            onPresetChange={(id, patch) => dispatch({ type: 'update-size-preset', id, patch })}
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
            onChange={(patch) => dispatch({ type: 'update-label', id: activeLabel.id, patch })}
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
    <div className="app-shell" inert={confirmation !== null || printDialogOpen}>
      <header className="app-header">
        <div>
          <p className="eyebrow">LOCAL PRINT DESK · 本地处理</p>
          <h1>唛头打印工作台</h1>
        </div>
        <div className="header-actions">
          <span className="app-status" role="status" aria-live="polite">{status}</span>
          {state.labels.length > 0 && (
            <button
              className="button button-quiet"
              type="button"
              onClick={() => setConfirmation({
                title: '清空当前草稿？',
                message: `将删除 ${state.labels.length} 条唛头并新建一条空白唛头；最近打印尺寸会保留。此操作无法撤销。`,
                confirmLabel: '清空草稿',
                action: () => {
                  clearLineSelection();
                  setActiveLineId(null);
                  dispatch({ type: 'clear-draft' });
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
              dispatch({ type: 'reset-workspace-layout' });
              setStatus('已恢复默认工作区布局');
            }}
          >恢复默认布局</button>
          <button className="button button-print" type="button" disabled={state.labels.length === 0} onClick={() => {
            recordPrintableLabels();
            setPrintDialogOpen(true);
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
            onDropAt={(sourceId, targetId, position) => dispatch({
              type: 'set-panel-order',
              order: placeWorkspacePanel(state.workspaceLayout, sourceId, targetId, position).order,
            })}
            onDragPreview={setPanelDropTarget}
            onMove={(panelId, delta) => dispatch({
              type: 'set-panel-order',
              order: moveWorkspacePanel(state.workspaceLayout, panelId, delta).order,
            })}
            onResize={(panelId, patch) => dispatch({ type: 'resize-panel', id: panelId, patch })}
            onToggleCollapse={(panelId) => dispatch({ type: 'toggle-panel-collapsed', id: panelId })}
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
      open={printDialogOpen}
      plan={printPlan}
      rotations={printRotations}
      onRotateLabel={rotatePrintedLabel}
      onClose={closePrintDialog}
      onEditLabel={(id) => {
        activateLabel(id);
        closePrintDialog();
      }}
      onPrintGroup={(group) => {
        dispatch({ type: 'remember-printed-size', widthMm: group.widthMm, heightMm: group.heightMm });
        setActivePrintGroup(group);
        setStatus(`正在打开 ${group.sizeLabel} 的打印设置；系统打印份数请保持 1`);
      }}
    />
    <PrintPages group={activePrintGroup} rotations={printRotations} />
    </>
  );
}
