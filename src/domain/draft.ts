import {
  defaultSizePresets,
  defaultStyle,
  type LabelPurpose,
  type LabelRecord,
  type LabelStyle,
  type SizePreset,
  validateSizePreset,
} from './labels';
import { validateLabelForPrint } from './layout';
import { syncTextLines } from './textLines';
import {
  DEFAULT_WORKSPACE_LAYOUT,
  hydrateWorkspaceLayout,
  resizeWorkspacePanel,
  type WorkspaceLayout,
  type WorkspacePanelId,
  type WorkspacePanelSize,
} from './workspaceLayout';

export interface StylePreset {
  id: string;
  name: string;
  style: LabelStyle;
}

export interface DraftState {
  version: 1;
  business: string;
  purpose: LabelPurpose;
  labels: LabelRecord[];
  sizePresets: SizePreset[];
  stylePresets: StylePreset[];
  activeLabelId: string | null;
  selectedLabelIds: string[];
  recentSizes: SizePreset[];
  workspaceLayout: WorkspaceLayout;
}

export function createInitialDraft(): DraftState {
  return {
    version: 1,
    business: '',
    purpose: 'carton',
    labels: [],
    sizePresets: defaultSizePresets.map((preset) => ({ ...preset })),
    stylePresets: [{ id: 'default', name: '标准居中', style: { ...defaultStyle } }],
    activeLabelId: null,
    selectedLabelIds: [],
    recentSizes: [],
    workspaceLayout: {
      order: [...DEFAULT_WORKSPACE_LAYOUT.order],
      sizes: Object.fromEntries(Object.entries(DEFAULT_WORKSPACE_LAYOUT.sizes).map(([id, size]) => [id, { ...size }])) as WorkspaceLayout['sizes'],
    },
  };
}

export type DraftAction =
  | { type: 'add-label'; label: LabelRecord }
  | { type: 'update-label'; id: string; patch: Partial<LabelRecord> }
  | { type: 'import-labels'; labels: LabelRecord[] }
  | { type: 'set-business'; business: string }
  | { type: 'set-purpose'; purpose: LabelPurpose }
  | { type: 'set-active-label'; id: string }
  | { type: 'toggle-selected'; id: string }
  | { type: 'set-selected'; ids: string[] }
  | { type: 'apply-style-to-selected'; style: LabelStyle }
  | { type: 'delete-label'; id: string }
  | { type: 'duplicate-label'; id: string }
  | { type: 'mark-reviewed'; id: string }
  | { type: 'add-size-preset'; preset: SizePreset }
  | { type: 'update-size-preset'; id: string; patch: Partial<Omit<SizePreset, 'id'>> }
  | { type: 'remove-size-preset'; id: string }
  | { type: 'remember-size'; preset: SizePreset }
  | { type: 'set-panel-order'; order: WorkspacePanelId[] }
  | { type: 'resize-panel'; id: WorkspacePanelId; patch: Partial<WorkspacePanelSize> }
  | { type: 'clear-draft' };

export function draftReducer(state: DraftState, action: DraftAction): DraftState {
  switch (action.type) {
    case 'add-label':
      return {
        ...state,
        labels: [...state.labels, action.label],
        activeLabelId: action.label.id,
      };
    case 'update-label': {
      const requiresReview = ['content', 'quantity', 'sides', 'contentType']
        .some((field) => Object.prototype.hasOwnProperty.call(action.patch, field));
      return {
        ...state,
        labels: state.labels.map((label) => {
          if (label.id !== action.id) return label;
          const contentChanged = Object.prototype.hasOwnProperty.call(action.patch, 'content')
            && action.patch.content !== label.content;
          return {
              ...label,
              ...action.patch,
              ...(contentChanged
                ? { textStyleRanges: [], textLines: syncTextLines(label.textLines, action.patch.content ?? '') }
                : {}),
              ...(requiresReview ? { needsReview: true, reviewReason: '内容或数量已修改，请重新校对' } : {}),
              id: label.id,
            };
        }),
      };
    }
    case 'import-labels':
      if (action.labels.length === 0) return state;
      return {
        ...state,
        labels: [...state.labels, ...action.labels],
        activeLabelId: action.labels[0].id,
      };
    case 'set-business':
      return { ...state, business: action.business };
    case 'set-purpose':
      return { ...state, purpose: action.purpose };
    case 'set-active-label':
      return state.labels.some((label) => label.id === action.id)
        ? { ...state, activeLabelId: action.id }
        : state;
    case 'toggle-selected':
      if (!state.labels.some((label) => label.id === action.id)) return state;
      return {
        ...state,
        selectedLabelIds: state.selectedLabelIds.includes(action.id)
          ? state.selectedLabelIds.filter((id) => id !== action.id)
          : [...state.selectedLabelIds, action.id],
      };
    case 'set-selected': {
      const validIds = new Set(state.labels.map((label) => label.id));
      return { ...state, selectedLabelIds: action.ids.filter((id) => validIds.has(id)) };
    }
    case 'apply-style-to-selected': {
      const selected = new Set(state.selectedLabelIds);
      return {
        ...state,
        labels: state.labels.map((label) => selected.has(label.id)
          ? { ...label, style: { ...action.style } }
          : label),
      };
    }
    case 'delete-label': {
      const removedIndex = state.labels.findIndex((label) => label.id === action.id);
      if (removedIndex < 0) return state;
      const labels = state.labels.filter((label) => label.id !== action.id);
      const nextActive = state.activeLabelId === action.id
        ? labels[Math.min(removedIndex, labels.length - 1)]?.id ?? null
        : state.activeLabelId;
      return {
        ...state,
        labels,
        activeLabelId: nextActive,
        selectedLabelIds: state.selectedLabelIds.filter((id) => id !== action.id),
      };
    }
    case 'duplicate-label': {
      const sourceIndex = state.labels.findIndex((label) => label.id === action.id);
      if (sourceIndex < 0) return state;
      const source = state.labels[sourceIndex];
      const duplicate: LabelRecord = {
        ...source,
        id: crypto.randomUUID(),
        style: { ...source.style },
        textStyleRanges: source.textStyleRanges.map((range) => ({ ...range, style: { ...range.style } })),
        placement: { ...source.placement },
        printArea: source.printArea ? { ...source.printArea } : undefined,
        textLines: source.textLines.map((line) => ({ ...line, placement: { ...line.placement }, style: { ...line.style } })),
        needsReview: true,
        reviewReason: '复制后请确认内容和数量',
      };
      const labels = [...state.labels];
      labels.splice(sourceIndex + 1, 0, duplicate);
      return { ...state, labels, activeLabelId: duplicate.id };
    }
    case 'mark-reviewed': {
      const label = state.labels.find((candidate) => candidate.id === action.id);
      const preset = state.sizePresets.find((candidate) => candidate.id === label?.sizePresetId);
      if (!label || !preset) return state;
      const reviewed = { ...label, needsReview: false, reviewReason: undefined };
      if (validateSizePreset(preset).length || validateLabelForPrint(reviewed, preset).length) return state;
      return {
        ...state,
        labels: state.labels.map((candidate) => candidate.id === action.id ? reviewed : candidate),
      };
    }
    case 'add-size-preset':
      if (state.sizePresets.some((preset) => preset.id === action.preset.id)) return state;
      return { ...state, sizePresets: [...state.sizePresets, { ...action.preset }] };
    case 'update-size-preset':
      return {
        ...state,
        sizePresets: state.sizePresets.map((preset) => preset.id === action.id
          ? { ...preset, ...action.patch, id: preset.id }
          : preset),
      };
    case 'remove-size-preset':
      if (state.labels.some((label) => label.sizePresetId === action.id)) return state;
      if (state.sizePresets.length <= 1) return state;
      return { ...state, sizePresets: state.sizePresets.filter((preset) => preset.id !== action.id) };
    case 'remember-size': {
      const key = `${action.preset.widthMm}:${action.preset.heightMm}:${action.preset.paddingMm}`;
      const recentSizes = [
        { ...action.preset },
        ...state.recentSizes.filter((preset) => `${preset.widthMm}:${preset.heightMm}:${preset.paddingMm}` !== key),
      ].slice(0, 8);
      return { ...state, recentSizes };
    }
    case 'set-panel-order':
      return {
        ...state,
        workspaceLayout: hydrateWorkspaceLayout({ ...state.workspaceLayout, order: action.order }),
      };
    case 'resize-panel':
      return {
        ...state,
        workspaceLayout: resizeWorkspacePanel(state.workspaceLayout, action.id, action.patch),
      };
    case 'clear-draft':
      return createInitialDraft();
  }
}
