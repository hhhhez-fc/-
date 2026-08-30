import { useEffect, useState, type SyntheticEvent } from 'react';
import type { InlineTextStyle, LabelRecord } from '../domain/labels';
import { MAX_LABEL_QUANTITY } from '../domain/quantity';
import { buildImmediateTextStylePatch } from '../domain/richText';
import { updateTextLine } from '../domain/textLines';

interface LabelEditorProps {
  label: LabelRecord;
  activeLineId: string | null;
  onActiveLineChange: (id: string) => void;
  onChange: (patch: Partial<LabelRecord>) => void;
  onPrintPreview: () => void;
  reviewErrors: string[];
  onDuplicate: () => void;
  onDelete: () => void;
}

export default function LabelEditor({ label, activeLineId, onActiveLineChange, onChange, onPrintPreview, reviewErrors, onDuplicate, onDelete }: LabelEditorProps) {
  const contentError = !label.content.trim() ? '请输入需要打印的唛头内容。' : '';
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const activeLine = label.textLines.find((line) => line.id === activeLineId) ?? label.textLines[0];
  const activeLineIndex = Math.max(0, label.textLines.findIndex((line) => line.id === activeLine?.id));
  const [partialStyle, setPartialStyle] = useState<InlineTextStyle>({
    fontFamily: activeLine?.style.fontFamily ?? label.style.fontFamily,
    fontSizePt: activeLine?.style.fontSizePt ?? label.style.fontSizePt,
    fontWeight: activeLine?.style.fontWeight ?? 700,
    italic: activeLine?.style.italic,
    underline: activeLine?.style.underline,
  });
  const selectedCount = Math.max(0, selection.end - selection.start);
  useEffect(() => {
    setPartialStyle({
      fontFamily: activeLine?.style.fontFamily ?? label.style.fontFamily,
      fontSizePt: activeLine?.style.fontSizePt ?? label.style.fontSizePt,
      fontWeight: activeLine?.style.fontWeight ?? 700,
      italic: activeLine?.style.italic,
      underline: activeLine?.style.underline,
    });
  }, [
    activeLine?.id,
    activeLine?.style.fontFamily,
    activeLine?.style.fontSizePt,
    activeLine?.style.fontWeight,
    activeLine?.style.italic,
    activeLine?.style.underline,
    label.style.fontFamily,
    label.style.fontSizePt,
    label.style.fontWeight,
    label.style.italic,
    label.style.underline,
  ]);
  const captureSelection = (event: SyntheticEvent<HTMLTextAreaElement>) => {
    setSelection({ start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd });
    const lineIndex = event.currentTarget.value.slice(0, event.currentTarget.selectionStart).split('\n').length - 1;
    const line = label.textLines[lineIndex];
    if (line) onActiveLineChange(line.id);
  };
  const updatePartialStyle = (patch: InlineTextStyle) => {
    if (!activeLine) return;
    const next = { ...partialStyle, ...patch };
    setPartialStyle(next);
    onChange(buildImmediateTextStylePatch(label, activeLine.id, selection, next));
  };
  return (
    <form className="label-editor" noValidate onSubmit={(event) => event.preventDefault()}>
      <div className="editor-title-row">
        <h3>当前唛头</h3>
        <span>{label.purpose === 'envelope' ? '信封' : '外箱'}</span>
      </div>
      {label.reviewReason && <p className="review-reason">{label.reviewReason}</p>}
      {reviewErrors.length > 0 && <p className="review-errors">打印前请处理：{reviewErrors.join('；')}</p>}
      <label className="field">
        <span>唛头内容</span>
        <textarea
          className="resize-none"
          id={`content-${label.id}`}
          rows={6}
          value={label.content}
          aria-invalid={Boolean(contentError)}
          aria-describedby={contentError ? `content-error-${label.id}` : undefined}
          onChange={(event) => onChange({ content: event.target.value })}
          onSelect={captureSelection}
          onKeyUp={captureSelection}
          onMouseUp={captureSelection}
          placeholder={'例如：\nFY-01\nMADE IN CHINA'}
        />
        {contentError && <small className="field-error" id={`content-error-${label.id}`}>{contentError}</small>}
      </label>
      <div className="line-selector" aria-label="选择要设置的文字行">
        {label.textLines.map((line, index) => <button
          type="button"
          key={line.id}
          aria-pressed={line.id === activeLine?.id}
          onClick={() => onActiveLineChange(line.id)}
        ><b>{String(index + 1).padStart(2, '0')}</b><span>{line.text || '空行'}</span></button>)}
      </div>
      <fieldset className="partial-style-editor">
        <legend>第 {activeLineIndex + 1} 行 / 选中文字样式</legend>
        <p>{selectedCount ? `已选择 ${selectedCount} 个字符，修改后立即生效` : `未选择字符，将修改第 ${activeLineIndex + 1} 行整体；修改后立即生效`}</p>
        <div className="partial-style-controls">
          <label className="field"><span>字体</span><select value={partialStyle.fontFamily} onChange={(event) => updatePartialStyle({ fontFamily: event.target.value })}>
            <option value={'Arial, "Microsoft YaHei", sans-serif'}>黑体 / Arial</option>
            <option value={'"Microsoft YaHei", sans-serif'}>微软雅黑</option>
            <option value={'SimSun, serif'}>宋体</option>
            <option value={'Arial, sans-serif'}>Arial</option>
            <option value={'"Times New Roman", serif'}>Times New Roman</option>
            <option value={'Consolas, monospace'}>等宽字体</option>
          </select></label>
          <label className="field"><span>字号（pt）</span><input type="number" min="8" max="120" value={partialStyle.fontSizePt ?? 32} onChange={(event) => updatePartialStyle({ fontSizePt: Number(event.target.value) })} /></label>
        </div>
        {activeLine && <label className="field line-orientation"><span>本行方向</span><select
          value={activeLine.textOrientation}
          onChange={(event) => onChange({ textLines: updateTextLine(label.textLines, activeLine.id, { textOrientation: event.target.value as 'horizontal' | 'vertical' }) })}
        ><option value="horizontal">横排</option><option value="vertical">竖排</option></select></label>}
        <div className="partial-style-toggles">
          <label><input type="checkbox" checked={partialStyle.fontWeight === 700} onChange={(event) => updatePartialStyle({ fontWeight: event.target.checked ? 700 : 400 })} />粗体</label>
          <label><input type="checkbox" checked={Boolean(partialStyle.italic)} onChange={(event) => updatePartialStyle({ italic: event.target.checked })} />斜体</label>
          <label><input type="checkbox" checked={Boolean(partialStyle.underline)} onChange={(event) => updatePartialStyle({ underline: event.target.checked })} />下划线</label>
        </div>
        {label.textStyleRanges.length > 0 && <small>已应用 {label.textStyleRanges.length} 段局部样式；修改正文后会自动清除。</small>}
      </fieldset>
      <div className="field-grid two-columns">
        <label className="field">
          <span>基础数量</span>
          <input
            type="number"
            min="1"
            max={MAX_LABEL_QUANTITY}
            step="1"
            inputMode="numeric"
            value={label.quantity}
            onChange={(event) => onChange({ quantity: Number(event.target.value) })}
          />
        </label>
        <label className="field">
          <span>张贴面数</span>
          <input
            type="number"
            min="1"
            step="1"
            inputMode="numeric"
            value={label.sides}
            onChange={(event) => onChange({ sides: Number(event.target.value) })}
          />
        </label>
      </div>
      <p className="copies-summary">最终打印 <strong>{Math.max(0, label.quantity * label.sides)}</strong> 张</p>
      <div className="editor-actions">
        <button
          className="button button-primary"
          type="button"
          disabled={reviewErrors.length > 0}
          onClick={onPrintPreview}
        >
          打印预览
        </button>
        <button className="button button-quiet" type="button" onClick={onDuplicate}>复制</button>
        <button className="button button-quiet" type="button" onClick={onDelete}>删除</button>
      </div>
    </form>
  );
}
