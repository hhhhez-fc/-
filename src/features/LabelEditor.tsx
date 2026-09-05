import { useEffect, useState, type SyntheticEvent } from 'react';
import { clampFontSizePt, type InlineTextStyle, type LabelRecord } from '../domain/labels';
import { buildImmediateTextStylePatch } from '../domain/richText';
import { updateSelectedTextLines, type TextLinePatch } from '../domain/textLines';

interface LabelEditorProps {
  label: LabelRecord;
  activeLineId: string | null;
  selectedLineIds: string[];
  onActiveLineChange: (id: string) => void;
  onSelectLine: (id: string) => void;
  onChange: (patch: Partial<LabelRecord>) => void;
  onPrintPreview: () => void;
  reviewErrors: string[];
  onDuplicate: () => void;
  onDelete: () => void;
}

export default function LabelEditor({ label, activeLineId, selectedLineIds, onActiveLineChange, onSelectLine, onChange, onPrintPreview, reviewErrors, onDuplicate, onDelete }: LabelEditorProps) {
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
  const targetIds = selectedLineIds.length ? selectedLineIds : activeLine ? [activeLine.id] : [];
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
  const updateTargetLines = (patch: TextLinePatch) => {
    if (!targetIds.length) return;
    onChange({ textLines: updateSelectedTextLines(label.textLines, targetIds, patch) });
  };
  const updatePartialStyle = (patch: InlineTextStyle) => {
    if (!activeLine) return;
    const next = { ...partialStyle, ...patch };
    setPartialStyle(next);
    if (selectedLineIds.length) {
      updateTargetLines({ style: patch });
      return;
    }
    onChange(buildImmediateTextStylePatch(label, activeLine.id, selection, next));
  };
  return (
    <form className="label-editor" noValidate onSubmit={(event) => event.preventDefault()}>
      <div className="editor-title-row">
        <h3>当前唛头</h3>
        <span>{label.purpose === 'envelope' ? '信封' : '外箱'}</span>
      </div>
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
          aria-pressed={selectedLineIds.includes(line.id)}
          onClick={() => onSelectLine(line.id)}
        ><b>{String(index + 1).padStart(2, '0')}</b><span>{line.text || '空行'}</span></button>)}
      </div>
      <fieldset className="partial-style-editor">
        <legend>{selectedLineIds.length ? `已选 ${selectedLineIds.length} 行` : `第 ${activeLineIndex + 1} 行 / 选中文字样式`}</legend>
        <p>{selectedLineIds.length
          ? '修改会立即应用到所选文字行；修改后立即生效'
          : selectedCount ? `已选择 ${selectedCount} 个字符，修改后立即生效` : `未选择字符，将修改第 ${activeLineIndex + 1} 行整体；修改后立即生效`}</p>
        <div className="partial-style-controls">
          <label className="field"><span>字体</span><select value={partialStyle.fontFamily} onChange={(event) => updatePartialStyle({ fontFamily: event.target.value })}>
            <option value={'Arial, "Microsoft YaHei", sans-serif'}>黑体 / Arial</option>
            <option value={'"Microsoft YaHei", sans-serif'}>微软雅黑</option>
            <option value={'SimSun, serif'}>宋体</option>
            <option value={'Arial, sans-serif'}>Arial</option>
            <option value={'"Times New Roman", serif'}>Times New Roman</option>
            <option value={'Consolas, monospace'}>等宽字体</option>
          </select></label>
          <label className="field"><span>字号（pt）</span><input type="number" min="8" max="120" value={partialStyle.fontSizePt ?? 32} onChange={(event) => updatePartialStyle({ fontSizePt: clampFontSizePt(Number(event.target.value)) })} /></label>
        </div>
        {activeLine && <label className="field line-orientation"><span>{selectedLineIds.length ? '所选行方向' : '本行方向'}</span><select
          aria-label={selectedLineIds.length ? '所选行方向' : '本行方向'}
          value={activeLine.textOrientation}
          onChange={(event) => updateTargetLines({ textOrientation: event.target.value as 'horizontal' | 'vertical' })}
        ><option value="horizontal">横排</option><option value="vertical">竖排</option></select></label>}
        <div className="partial-style-toggles">
          <button type="button" aria-label="粗体" aria-pressed={partialStyle.fontWeight === 700} onClick={() => updatePartialStyle({ fontWeight: partialStyle.fontWeight === 700 ? 400 : 700 })}>粗体</button>
          <button type="button" aria-label="斜体" aria-pressed={Boolean(partialStyle.italic)} onClick={() => updatePartialStyle({ italic: !partialStyle.italic })}>斜体</button>
          <button type="button" aria-label="下划线" aria-pressed={Boolean(partialStyle.underline)} onClick={() => updatePartialStyle({ underline: !partialStyle.underline })}>下划线</button>
        </div>
        {label.textStyleRanges.length > 0 && <small>已应用 {label.textStyleRanges.length} 段局部样式；修改正文后会自动清除。</small>}
      </fieldset>
      <div className="field-grid two-columns">
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
