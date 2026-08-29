import { useRef, useState, type PointerEvent } from 'react';
import type { CropSelection } from '../domain/images';

interface ImageCropSelectorProps {
  previewUrl: string;
  fileName: string;
  selection: CropSelection;
  onChange: (selection: CropSelection) => void;
  onImageSize: (width: number, height: number) => void;
}

function normalizeSelection(selection: CropSelection): CropSelection {
  const x2 = selection.xPercent + selection.widthPercent;
  const y2 = selection.yPercent + selection.heightPercent;
  const left = Math.max(0, Math.min(100, Math.min(selection.xPercent, x2)));
  const top = Math.max(0, Math.min(100, Math.min(selection.yPercent, y2)));
  const right = Math.max(0, Math.min(100, Math.max(selection.xPercent, x2)));
  const bottom = Math.max(0, Math.min(100, Math.max(selection.yPercent, y2)));
  return { xPercent: left, yPercent: top, widthPercent: right - left, heightPercent: bottom - top };
}

export default function ImageCropSelector({ previewUrl, fileName, selection, onChange, onImageSize }: ImageCropSelectorProps) {
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const dragSelectionRef = useRef<CropSelection | null>(null);
  const [dragging, setDragging] = useState(false);
  const normalized = normalizeSelection(selection);
  const pointFromEvent = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(100, ((event.clientX - bounds.left) / bounds.width) * 100)),
      y: Math.max(0, Math.min(100, ((event.clientY - bounds.top) / bounds.height) * 100)),
    };
  };
  const changeField = (field: keyof CropSelection, value: number) => {
    onChange(normalizeSelection({ ...normalized, [field]: value }));
  };

  return <fieldset className="crop-selector">
    <legend>选择识别区域</legend>
    <p>整图优先定位“唛头”同列下方或同行右侧的数据；找不到“唛头”时识别全部英数内容。结果保留连接号，自动去除其他标点与短噪声。</p>
    <div
      className={`crop-stage ${dragging ? 'is-selecting' : ''}`}
      aria-label={`为 ${fileName} 框选识别区域`}
      onPointerDown={(event) => {
        const point = pointFromEvent(event);
        event.currentTarget.setPointerCapture(event.pointerId);
        startRef.current = point;
        dragSelectionRef.current = { xPercent: point.x, yPercent: point.y, widthPercent: 0, heightPercent: 0 };
        setDragging(true);
        onChange(dragSelectionRef.current);
      }}
      onPointerMove={(event) => {
        if (!dragging || !startRef.current) return;
        const point = pointFromEvent(event);
        const nextSelection = {
          xPercent: startRef.current.x,
          yPercent: startRef.current.y,
          widthPercent: point.x - startRef.current.x,
          heightPercent: point.y - startRef.current.y,
        };
        dragSelectionRef.current = nextSelection;
        onChange(nextSelection);
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        const completed = normalizeSelection(dragSelectionRef.current ?? normalized);
        setDragging(false);
        startRef.current = null;
        dragSelectionRef.current = null;
        onChange(completed.widthPercent < 2 || completed.heightPercent < 2
          ? { xPercent: 0, yPercent: 0, widthPercent: 100, heightPercent: 100 }
          : completed);
      }}
      onPointerCancel={() => { setDragging(false); startRef.current = null; dragSelectionRef.current = null; }}
    >
      <img src={previewUrl} alt={`${fileName} 识别预览`} draggable={false} onLoad={(event) => onImageSize(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)} />
      <span className="crop-mask" aria-hidden="true" />
      <span className="crop-box" aria-hidden="true" style={{
        left: `${normalized.xPercent}%`, top: `${normalized.yPercent}%`,
        width: `${normalized.widthPercent}%`, height: `${normalized.heightPercent}%`,
      }} />
    </div>
    <div className="crop-fields">
      <label className="field"><span>左边（%）</span><input type="number" min="0" max="100" value={Math.round(normalized.xPercent)} onChange={(event) => changeField('xPercent', Number(event.target.value))} /></label>
      <label className="field"><span>上边（%）</span><input type="number" min="0" max="100" value={Math.round(normalized.yPercent)} onChange={(event) => changeField('yPercent', Number(event.target.value))} /></label>
      <label className="field"><span>框选宽度（%）</span><input type="number" min="2" max="100" value={Math.round(normalized.widthPercent)} onChange={(event) => changeField('widthPercent', Number(event.target.value))} /></label>
      <label className="field"><span>框选高度（%）</span><input type="number" min="2" max="100" value={Math.round(normalized.heightPercent)} onChange={(event) => changeField('heightPercent', Number(event.target.value))} /></label>
    </div>
    <button className="button button-quiet button-compact" type="button" onClick={() => onChange({ xPercent: 0, yPercent: 0, widthPercent: 100, heightPercent: 100 })}>
      重新选择整张图片
    </button>
  </fieldset>;
}
