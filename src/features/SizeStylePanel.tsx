import { validateSizePreset, type LabelRecord, type LabelStyle, type SizePreset } from '../domain/labels';
import { resolvePrintArea } from '../domain/placement';
import { buildAllTextStylePatch, type AllTextStylePatch } from '../domain/richText';
import { alignTextLines, type TextLineAlignment } from '../domain/textLines';

interface SizeStylePanelProps {
  label: LabelRecord;
  presets: SizePreset[];
  onChange: (patch: Partial<LabelRecord>) => void;
  onPresetChange: (id: string, patch: Partial<Omit<SizePreset, 'id'>>) => void;
  onCreatePreset: (source: SizePreset) => void;
  recentSizes: SizePreset[];
  onUseRecent: (preset: SizePreset) => void;
  onRememberSize: (preset: SizePreset) => void;
}

export default function SizeStylePanel({ label, presets, onChange, onPresetChange, onCreatePreset, recentSizes, onUseRecent, onRememberSize }: SizeStylePanelProps) {
  const patchStyle = (patch: Partial<LabelStyle>) => onChange({ style: { ...label.style, ...patch } });
  const patchAllTextStyle = (patch: AllTextStylePatch) => onChange(buildAllTextStylePatch(label, patch));
  const activePreset = presets.find((preset) => preset.id === label.sizePresetId) ?? presets[0];
  const printArea = resolvePrintArea(label.printArea, activePreset);
  const sizeErrors = validateSizePreset(activePreset);
  const updatePreset = (patch: Partial<Omit<SizePreset, 'id'>>) => {
    const next = { ...activePreset, ...patch };
    onPresetChange(activePreset.id, patch);
    if (validateSizePreset(next).length === 0) onRememberSize(next);
  };
  const updatePrintArea = (patch: Partial<typeof printArea>) => {
    onChange({ printArea: resolvePrintArea({ ...printArea, ...patch }, activePreset) });
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
          <label className="field"><span>全部字号</span><select
            value={label.style.fontMode === 'auto' ? '' : String(label.style.fontSizePt)}
            onChange={(event) => patchAllTextStyle(event.target.value
              ? { fontMode: 'fixed', fontSizePt: Number(event.target.value) }
              : { fontMode: 'auto' })}
          >
            <option value="">自动适配</option>
            {[12, 16, 20, 24, 28, 32, 36, 42, 48, 56, 64, 72, 96, 120].map((size) => <option key={size} value={size}>{size} pt</option>)}
          </select></label>
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
      <details className="advanced-settings">
        <summary><span>尺寸与打印区域</span><strong>{activePreset.widthMm} × {activePreset.heightMm} mm</strong></summary>
        <div className="advanced-settings-content">
      <div className="recent-sizes">
        <div><strong>常用尺寸</strong><span>{recentSizes.length ? '最近使用，点击套用' : '使用过的尺寸会显示在这里'}</span></div>
        {recentSizes.length > 0 && <div className="recent-size-list">{recentSizes.map((preset) => (
          <button type="button" key={`${preset.widthMm}-${preset.heightMm}-${preset.paddingMm}`} onClick={() => onUseRecent(preset)}>
            {preset.widthMm} × {preset.heightMm} mm
          </button>
        ))}</div>}
      </div>
      <div className="field-grid two-columns">
        <label className="field">
          <span>尺寸预设</span>
          <select value={label.sizePresetId} onChange={(event) => {
            const preset = presets.find((item) => item.id === event.target.value);
            onChange({ sizePresetId: event.target.value });
            if (preset) onRememberSize(preset);
          }}>
            {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
          </select>
        </label>
        <button className="button button-quiet preset-copy" type="button" onClick={() => onCreatePreset(activePreset)}>
          复制为自定义尺寸
        </button>
      </div>
      <div className="size-editor" aria-label="编辑实际尺寸">
        <div className="field-grid three-columns">
          <label className="field">
            <span>宽度（mm）</span>
            <input type="number" min="20" max="300" step="1" value={activePreset.widthMm} onChange={(event) => updatePreset({ widthMm: Number(event.target.value) })} />
          </label>
          <label className="field">
            <span>高度（mm）</span>
            <input type="number" min="15" max="300" step="1" value={activePreset.heightMm} onChange={(event) => updatePreset({ heightMm: Number(event.target.value) })} />
          </label>
          <label className="field">
            <span>内边距（mm）</span>
            <input type="number" min="0" max="20" step="0.5" value={activePreset.paddingMm} onChange={(event) => updatePreset({ paddingMm: Number(event.target.value) })} />
          </label>
        </div>
        {sizeErrors.length > 0 && <p className="import-error">{sizeErrors.join('；')}</p>}
      </div>
      <section className="print-area-editor" aria-labelledby="print-area-title">
        <div className="print-area-editor-heading">
          <div>
            <strong id="print-area-title">内容打印区域（mm）</strong>
            <span>可在预览中拖动或缩放，也可精确输入</span>
          </div>
          <button className="button button-quiet button-compact" type="button" onClick={() => onChange({ printArea: undefined })}>
            恢复默认区域
          </button>
        </div>
        <div className="field-grid four-columns">
          <label className="field">
            <span>区域左边距</span>
            <input type="number" min="0" max={activePreset.widthMm - printArea.widthMm} step="0.5" value={printArea.leftMm} onChange={(event) => updatePrintArea({ leftMm: Number(event.target.value) })} />
          </label>
          <label className="field">
            <span>区域上边距</span>
            <input type="number" min="0" max={activePreset.heightMm - printArea.heightMm} step="0.5" value={printArea.topMm} onChange={(event) => updatePrintArea({ topMm: Number(event.target.value) })} />
          </label>
          <label className="field">
            <span>区域宽度</span>
            <input type="number" min="5" max={activePreset.widthMm} step="0.5" value={printArea.widthMm} onChange={(event) => updatePrintArea({ widthMm: Number(event.target.value) })} />
          </label>
          <label className="field">
            <span>区域高度</span>
            <input type="number" min="5" max={activePreset.heightMm} step="0.5" value={printArea.heightMm} onChange={(event) => updatePrintArea({ heightMm: Number(event.target.value) })} />
          </label>
        </div>
      </section>
        </div>
      </details>
    </div>
  );
}
