import { useCallback, useEffect, useMemo, useReducer, useState, type ReactNode } from 'react';
import { createInitialDraft, draftReducer, type DraftState } from './domain/draft';
import { createLabel, defaultSizeTypeForBusiness, type LabelPurpose } from './domain/labels';
import { loadDraft, saveDraft } from './domain/storage';
import LabelEditor from './features/LabelEditor';
import LabelList from './features/LabelList';
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
import { reorderWorkspacePanels, type WorkspacePanelId } from './domain/workspaceLayout';
import WorkspacePanel from './features/WorkspacePanel';

interface AppProps {
  initialState?: DraftState;
}

function recoverDraft(): DraftState {
  if (typeof window === 'undefined') return createInitialDraft();
  return loadDraft(window.localStorage) ?? createInitialDraft();
}

export default function App({ initialState }: AppProps) {
  const [state, dispatch] = useReducer(draftReducer, initialState ?? undefined, recoverDraft);
  const [status, setStatus] = useState('草稿仅保存在这台电脑');
  const [confirmation, setConfirmation] = useState<null | {
    title: string;
    message: string;
    confirmLabel: string;
    action: () => void;
  }>(null);
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [activePrintGroup, setActivePrintGroup] = useState<PrintGroup | null>(null);
  const [activeLineId, setActiveLineId] = useState<string | null>(null);
  const activeLabel = state.labels.find((label) => label.id === state.activeLabelId) ?? null;
  const activePreset = useMemo(
    () => state.sizePresets.find((preset) => preset.id === activeLabel?.sizePresetId) ?? state.sizePresets[0],
    [activeLabel?.sizePresetId, state.sizePresets],
  );
  const printPlan = useMemo(() => createPrintPlan(state.labels, state.sizePresets), [state.labels, state.sizePresets]);
  const activeReviewErrors = activeLabel && activePreset
    ? [...validateSizePreset(activePreset), ...validateLabelForPrint({ ...activeLabel, needsReview: false }, activePreset)]
    : [];
  const resolvedActiveLineId = activeLabel?.textLines.some((line) => line.id === activeLineId)
    ? activeLineId
    : activeLabel?.textLines[0]?.id ?? null;

  useEffect(() => {
    document.title = '唛头打印工作台';
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const timer = window.setTimeout(() => {
      setStatus(saveDraft(window.localStorage, state) ? '已保存在本机' : '无法保存草稿，请勿关闭页面');
    }, 180);
    return () => window.clearTimeout(timer);
  }, [state]);

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
    const label = createLabel({
      content: '',
      quantity: 1,
      sides: 1,
      source: 'manual',
      purpose: state.purpose,
      contentType: 'text',
      sizeType,
      sizePresetId: sizeType,
      needsReview: true,
      reviewReason: '请填写唛头内容并完成校对',
    });
    dispatch({ type: 'add-label', label });
    setStatus('已新增一条手动唛头');
  };

  const closeConfirmation = useCallback(() => setConfirmation(null), []);
  const closePrintDialog = useCallback(() => setPrintDialogOpen(false), []);
  const deleteLabel = (id: string) => {
    dispatch({ type: 'delete-label', id });
    setStatus('已删除一条唛头');
  };

  const createCustomPreset = (source: NonNullable<typeof activePreset>) => {
    if (!activeLabel) return;
    const id = `custom-${crypto.randomUUID()}`;
    dispatch({
      type: 'add-size-preset',
      preset: { ...source, id, name: `自定义尺寸 ${state.sizePresets.filter((preset) => preset.id.startsWith('custom-')).length + 1}` },
    });
    dispatch({ type: 'update-label', id: activeLabel.id, patch: { sizePresetId: id } });
    dispatch({ type: 'remember-size', preset: source });
    setStatus('已复制为自定义尺寸，可直接修改毫米数值');
  };

  const useRecentSize = (source: NonNullable<typeof activePreset>) => {
    if (!activeLabel) return;
    const existing = state.sizePresets.find((preset) => preset.widthMm === source.widthMm
      && preset.heightMm === source.heightMm && preset.paddingMm === source.paddingMm);
    if (existing) {
      dispatch({ type: 'update-label', id: activeLabel.id, patch: { sizePresetId: existing.id } });
      dispatch({ type: 'remember-size', preset: existing });
      setStatus(`已套用 ${existing.widthMm} × ${existing.heightMm} mm`);
      return;
    }
    const preset = { ...source, id: `custom-${crypto.randomUUID()}`, name: `常用尺寸 ${source.widthMm}×${source.heightMm}` };
    dispatch({ type: 'add-size-preset', preset });
    dispatch({ type: 'update-label', id: activeLabel.id, patch: { sizePresetId: preset.id } });
    dispatch({ type: 'remember-size', preset });
    setStatus(`已恢复 ${preset.widthMm} × ${preset.heightMm} mm`);
  };

  const selectedCount = state.selectedLabelIds.length;
  const allSelected = state.labels.length > 0 && selectedCount === state.labels.length;
  const panelContents: Record<WorkspacePanelId, ReactNode> = {
    intake: <>
      <div className="panel-heading" data-testid="panel-drag-handle" data-panel-drag-handle draggable aria-label="拖动录入来源板块">
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
          sizePresetId={defaultSizeTypeForBusiness(state.business)}
          purpose={state.purpose}
          onImport={(labels) => dispatch({ type: 'import-labels', labels })}
          onStatus={setStatus}
        />
        <ImageImporter
          sizePresetId={defaultSizeTypeForBusiness(state.business)}
          purpose={state.purpose}
          onImport={(labels) => dispatch({ type: 'import-labels', labels })}
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
    </>,
    records: <>
      <div className="panel-heading records-heading" data-testid="panel-drag-handle" data-panel-drag-handle draggable aria-label="拖动校对清单板块">
        <span className="step-number">02</span>
        <div>
          <h2 id="records-title">校对清单</h2>
          <p>{state.labels.length} 条记录 · {state.labels.filter((label) => label.needsReview).length} 条待校对</p>
        </div>
      </div>
      <LabelList
        labels={state.labels}
        activeLabelId={state.activeLabelId}
        selectedLabelIds={state.selectedLabelIds}
        onActivate={(id) => dispatch({ type: 'set-active-label', id })}
        onToggleSelect={(id) => dispatch({ type: 'toggle-selected', id })}
        onDuplicate={(id) => dispatch({ type: 'duplicate-label', id })}
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
          onActiveLineChange={setActiveLineId}
          onChange={(patch) => dispatch({ type: 'update-label', id: activeLabel.id, patch })}
          onReview={() => dispatch({ type: 'mark-reviewed', id: activeLabel.id })}
          reviewErrors={activeReviewErrors}
          onDuplicate={() => dispatch({ type: 'duplicate-label', id: activeLabel.id })}
          onDelete={() => deleteLabel(activeLabel.id)}
        />
      )}
    </>,
    preview: <>
      <div className="panel-heading" data-testid="panel-drag-handle" data-panel-drag-handle draggable aria-label="拖动尺寸与预览板块">
        <span className="step-number">03</span>
        <div>
          <h2 id="preview-title">尺寸与预览</h2>
          <p>毫米尺寸与最终打印效果同步。</p>
        </div>
      </div>
      {activeLabel && activePreset ? (
        <>
          <LabelPreview
            label={activeLabel}
            preset={activePreset}
            activeLineId={resolvedActiveLineId}
            onActiveLineChange={setActiveLineId}
            onChange={(patch) => dispatch({ type: 'update-label', id: activeLabel.id, patch })}
          />
          <SizeStylePanel
            label={activeLabel}
            activeLine={activeLabel.textLines.find((line) => line.id === resolvedActiveLineId) ?? activeLabel.textLines[0] ?? null}
            presets={state.sizePresets}
            onChange={(patch) => dispatch({ type: 'update-label', id: activeLabel.id, patch })}
            onPresetChange={(id, patch) => dispatch({ type: 'update-size-preset', id, patch })}
            onCreatePreset={createCustomPreset}
            recentSizes={state.recentSizes}
            onUseRecent={useRecentSize}
            onRememberSize={(preset) => dispatch({ type: 'remember-size', preset })}
            onLineChange={(lineId, patch) => dispatch({
              type: 'update-label',
              id: activeLabel.id,
              patch: { textLines: activeLabel.textLines.map((line) => line.id === lineId ? { ...line, ...patch } : line) },
            })}
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
    history: <>
      <div className="panel-heading" data-testid="panel-drag-handle" data-panel-drag-handle draggable aria-label="拖动使用过的唛头板块">
        <span className="step-number">04</span>
        <div>
          <h2 id="history-title">使用过的唛头</h2>
          <p>最近使用的唛头会显示在这里。</p>
        </div>
      </div>
      <div className="history-empty">
        <strong>暂时没有使用记录</strong>
        <span>完成打印后，历史唛头会保存在这个板块。</span>
      </div>
    </>,
  };
  const panelTitleIds: Record<WorkspacePanelId, string> = {
    intake: 'intake-title',
    records: 'records-title',
    preview: 'preview-title',
    history: 'history-title',
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
                message: `将删除 ${state.labels.length} 条唛头并恢复默认尺寸，此操作无法撤销。`,
                confirmLabel: '清空草稿',
                action: () => {
                  dispatch({ type: 'clear-draft' });
                  setStatus('草稿已清空');
                },
              })}
            >
              清空草稿
            </button>
          )}
          <button className="button button-print" type="button" disabled={state.labels.length === 0} onClick={() => setPrintDialogOpen(true)}>
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
            onDropBefore={(sourceId, targetId) => dispatch({
              type: 'set-panel-order',
              order: reorderWorkspacePanels(state.workspaceLayout, sourceId, targetId).order,
            })}
            onResize={(panelId, patch) => dispatch({ type: 'resize-panel', id: panelId, patch })}
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
      onClose={closePrintDialog}
      onEditLabel={(id) => {
        dispatch({ type: 'set-active-label', id });
        closePrintDialog();
      }}
      onPrintGroup={(group) => {
        setActivePrintGroup(group);
        setStatus(`正在打开 ${group.sizeLabel} 的打印设置；系统打印份数请保持 1`);
      }}
    />
    <PrintPages group={activePrintGroup} />
    </>
  );
}
