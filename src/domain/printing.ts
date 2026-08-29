import { getPrintCopies, validateSizePreset, type LabelRecord, type SizePreset } from './labels';
import { validateLabelForPrint } from './layout';

export interface PrintPage {
  label: LabelRecord;
  preset: SizePreset;
  copyNumber: number;
}

export interface PrintGroup {
  key: string;
  sizeLabel: string;
  widthMm: number;
  heightMm: number;
  pages: PrintPage[];
}

export interface PrintBlocker {
  labelId: string;
  labelNumber: number;
  contentSummary: string;
  reasons: string[];
}

export interface PrintPlan {
  groups: PrintGroup[];
  blockers: PrintBlocker[];
  totalCopies: number;
}

export function createPrintPlan(labels: LabelRecord[], presets: SizePreset[]): PrintPlan {
  const groupMap = new Map<string, PrintGroup>();
  const blockers: PrintBlocker[] = [];

  labels.forEach((label, index) => {
    const preset = presets.find((candidate) => candidate.id === label.sizePresetId);
    const reasons = preset
      ? [...validateSizePreset(preset), ...validateLabelForPrint(label, preset)]
      : ['找不到对应的尺寸预设'];

    if (reasons.length > 0 || !preset) {
      blockers.push({
        labelId: label.id,
        labelNumber: index + 1,
        contentSummary: label.content.trim().split(/\r?\n/)[0] || '未填写内容',
        reasons,
      });
      return;
    }

    const key = `${preset.widthMm}x${preset.heightMm}`;
    const group = groupMap.get(key) ?? {
      key,
      sizeLabel: `${preset.widthMm} × ${preset.heightMm} mm`,
      widthMm: preset.widthMm,
      heightMm: preset.heightMm,
      pages: [],
    };
    for (let copyNumber = 1; copyNumber <= getPrintCopies(label); copyNumber += 1) {
      group.pages.push({ label, preset, copyNumber });
    }
    groupMap.set(key, group);
  });

  const groups = Array.from(groupMap.values());
  return {
    groups,
    blockers,
    totalCopies: groups.reduce((total, group) => total + group.pages.length, 0),
  };
}
