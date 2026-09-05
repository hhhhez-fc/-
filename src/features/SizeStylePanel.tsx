import { validateSizePreset, type LabelRecord, type LabelStyle, type SizePreset } from '../domain/labels';
import { buildAllTextStylePatch, type AllTextStylePatch } from '../domain/richText';
import { alignTextLines, type TextLineAlignment } from '../domain/textLines';
import type { FontSizeChoice } from '../domain/fontSizePreview';
import FontSizePicker from './FontSizePicker';

interface SizeStylePanelProps {
  label: LabelRecord;
  presets: SizePreset[];
  onChange: (patch: Partial<LabelRecord>) => void;
  onPresetChange: (id: string, patch: Partial<Omit<SizePreset, 'id'>>) => void;
  onFontSizePreview?: (choice: FontSizeChoice | null) => void;
}

export default function SizeStylePanel({ label, presets, onChange, onPresetChange, onFontSizePreview = () => undefined }: SizeStylePanelProps) {
  const patchStyle = (patch: Partial<LabelStyle>) => onChange({ style: { ...label.style, ...patch } });
  const patchAllTextStyle = (patch: AllTextStylePatch) => onChange(buildAllTextStylePatch(label, patch));
  const activePreset = presets.find((preset) => preset.id === label.sizePresetId) ?? presets[0];
  const sizeErrors = validateSizePreset(activePreset);
  const updatePreset = (patch: Partial<Omit<SizePreset, 'id'>>) => {
    onPresetChange(activePreset.id, patch);
  };
  return (
    <div className="style-panel">
      <section className="all-text-style" aria-label="全部文字样式">
        <div className="field-grid all-text-style-fields">
          <label className="field"><span>全部字体</span><select value={label.style.fontFamily} onChange={(event) => patchAllTextStyle({ fontFamily: event.target.value })}>
            <option value={'Arial, "Microsoft YaHei", sans-serif'}>黑体 / Arial</option>
            <option value={'"Microsoft YaHei", sans-serif'}>微软雅黑</option>
            <option value={'SimSun, serif'}>宋体</option>
            <option value={'Arial, sans-serif'}>Arial</option>
            <option value={'"Times New Roman", serif'}>Times New Roman</option>
            <option value={'Consolas, monospace'}>等宽字体</option>
          </select></label>
          <div className="field"><span>全部字号</span><FontSizePicker
            value={label.style.fontMode === 'auto'
              ? { fontMode: 'auto' }
              : { fontMode: 'fixed', fontSizePt: label.style.fontSizePt }}
            onPreview={onFontSizePreview}
            onCommit={(choice) => patchAllTextStyle(choice)}
          /></div>
          <label className="field"><span>行距</span><select value={label.style.lineHeight} onChange={(event) => patchStyle({ lineHeight: Number(event.target.value) as LabelStyle['lineHeight'] })}>
            <option value="1.05">紧凑</option>
            <option value="1.2">标准</option>
            <option value="1.4">宽松</option>
          </select></label>
          <label className="field"><span>自动排列方式</span><select
            value=""
            onChange={(event) => {
              if (!event.target.value) return;
              onChange({ textLines: alignTextLines(label.textLines, event.target.value as TextLineAlignment) });
            }}
          >
            <option value="">选择即应用</option>
            <option value="center">水平居中</option>
            <option value="left">左对齐</option>
            <option value="right">右对齐</option>
            <option value="keep">保持当前左右位置</option>
          </select></label>
        </div>
        <fieldset className="toggle-group all-text-toggles">
          <legend>全部文字强调</legend>
          <label><input type="checkbox" checked={label.style.fontWeight === 700} onChange={(event) => patchAllTextStyle({ fontWeight: event.target.checked ? 700 : 400 })} />粗体</label>
          <label><input type="checkbox" checked={label.style.italic} onChange={(event) => patchAllTextStyle({ italic: event.target.checked })} />斜体</label>
          <label><input type="checkbox" checked={label.style.underline} onChange={(event) => patchAllTextStyle({ underline: event.target.checked })} />下划线</label>
        </fieldset>
      </section>
      <section className="dimension-editor" aria-label="编辑标签尺寸">
        <div className="field-grid two-columns">
          <label className="field">
            <span>宽度（mm）</span>
            <input type="number" min="20" max="300" step="1" value={activePreset.widthMm} onChange={(event) => updatePreset({ widthMm: Number(event.target.value) })} />
          </label>
          <label className="field">
            <span>高度（mm）</span>
            <input type="number" min="15" max="300" step="1" value={activePreset.heightMm} onChange={(event) => updatePreset({ heightMm: Number(event.target.value) })} />
          </label>
        </div>
        {sizeErrors.length > 0 && <p className="import-error">{sizeErrors.join('；')}</p>}
      </section>
    </div>
  );
}
