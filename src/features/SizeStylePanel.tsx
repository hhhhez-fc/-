import { validateSizePreset, type LabelRecord, type LabelStyle, type LabelTextLine, type SizePreset } from '../domain/labels';
import { describePlacement, resolvePrintArea } from '../domain/placement';

interface SizeStylePanelProps {
  label: LabelRecord;
  presets: SizePreset[];
  onChange: (patch: Partial<LabelRecord>) => void;
  onPresetChange: (id: string, patch: Partial<Omit<SizePreset, 'id'>>) => void;
  onCreatePreset: (source: SizePreset) => void;
  recentSizes: SizePreset[];
  onUseRecent: (preset: SizePreset) => void;
  onRememberSize: (preset: SizePreset) => void;
  activeLine: LabelTextLine | null;
  onLineChange: (lineId: string, patch: Partial<LabelTextLine>) => void;
}

export default function SizeStylePanel({ label, presets, onChange, onPresetChange, onCreatePreset, recentSizes, onUseRecent, onRememberSize, activeLine, onLineChange }: SizeStylePanelProps) {
  const patchStyle = (patch: Partial<LabelStyle>) => onChange({ style: { ...label.style, ...patch } });
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
      <h3>尺寸与文字样式</h3>
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
      <div className="field-grid style-fields">
        <label className="field">
          <span>行距</span>
          <select value={label.style.lineHeight} onChange={(event) => patchStyle({ lineHeight: Number(event.target.value) as LabelStyle['lineHeight'] })}>
            <option value="1.05">紧凑</option>
            <option value="1.2">标准</option>
            <option value="1.4">宽松</option>
          </select>
        </label>
      </div>
      <fieldset className="toggle-group">
        <legend>文字强调</legend>
        <label><input type="checkbox" checked={label.style.fontWeight === 700} onChange={(event) => patchStyle({ fontWeight: event.target.checked ? 700 : 400 })} />粗体</label>
        <label><input type="checkbox" checked={label.style.italic} onChange={(event) => patchStyle({ italic: event.target.checked })} />斜体</label>
        <label><input type="checkbox" checked={label.style.underline} onChange={(event) => patchStyle({ underline: event.target.checked })} />下划线</label>
      </fieldset>
      <div className="placement-control">
        <div><strong>当前行位置</strong><span>{activeLine ? describePlacement(activeLine.placement) : '未选择文字行'}</span></div>
        <button className="button button-quiet button-compact" type="button" disabled={!activeLine} onClick={() => activeLine && onLineChange(activeLine.id, { placement: { xPercent: 50, yPercent: 50, horizontalSnap: 'center', verticalSnap: 'middle' } })}>本行恢复正中</button>
      </div>
    </div>
  );
}
