import { useEffect, useRef, useState } from 'react';
import {
  cropSelectionToPixels,
  readFileAsDataUrl,
  recognizeImageLayout,
  validateImageFile,
  type CropSelection,
} from '../domain/images';
import { createLabel, type LabelPurpose, type LabelRecord } from '../domain/labels';
import ImageCropSelector from './ImageCropSelector';

interface ImageImporterProps {
  sizePresetId: string;
  purpose: LabelPurpose;
  onImport: (labels: LabelRecord[]) => void;
  onStatus: (message: string) => void;
}

interface PendingImage {
  id: string;
  file: File;
  previewUrl: string;
  progress: number;
  progressLabel: string;
  busy: boolean;
  error: string | null;
  selection: CropSelection;
  imageWidth: number;
  imageHeight: number;
}

export default function ImageImporter({ sizePresetId, purpose, onImport, onStatus }: ImageImporterProps) {
  const [images, setImages] = useState<PendingImage[]>([]);
  const controllers = useRef(new Map<string, AbortController>());
  const allControllers = useRef(new Set<AbortController>());
  const legacySizeType = sizePresetId === 'large' ? 'large' : 'small';

  useEffect(() => () => {
    allControllers.current.forEach((controller) => controller.abort());
    controllers.current.clear();
    allControllers.current.clear();
  }, []);

  const updateImage = (id: string, patch: Partial<PendingImage>) => {
    setImages((current) => current.map((image) => image.id === id ? { ...image, ...patch } : image));
  };

  const chooseFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const accepted: PendingImage[] = [];
    const errors: string[] = [];

    for (const file of Array.from(files)) {
      const validationError = validateImageFile(file);
      if (validationError) {
        errors.push(`${file.name}：${validationError}`);
        continue;
      }
      try {
        accepted.push({
          id: crypto.randomUUID(),
          file,
          previewUrl: await readFileAsDataUrl(file),
          progress: 0,
          progressLabel: '等待处理',
          busy: false,
          error: null,
          selection: { xPercent: 0, yPercent: 0, widthPercent: 100, heightPercent: 100 },
          imageWidth: 0,
          imageHeight: 0,
        });
      } catch {
        errors.push(`${file.name}：无法读取图片`);
      }
    }

    setImages((current) => [...current, ...accepted]);
    if (errors.length) onStatus(errors.join('；'));
    else onStatus(`已载入 ${accepted.length} 张图片，请选择识别文字或使用原图`);
  };

  const importOriginal = (image: PendingImage) => {
    onImport([createLabel({
      content: image.file.name.replace(/\.[^.]+$/, ''),
      quantity: 1,
      source: 'image',
      purpose,
      contentType: 'image',
      sizePresetId,
      sizeType: legacySizeType,
      sides: 1,
      imageFallback: image.previewUrl,
      needsReview: false,
    })]);
    setImages((current) => current.filter((item) => item.id !== image.id));
    onStatus(`已按原图加入：${image.file.name}`);
  };

  const runOcr = async (image: PendingImage) => {
    if (!image.imageWidth || !image.imageHeight) {
      updateImage(image.id, { error: '图片预览尚未准备完成，请稍后重试' });
      return;
    }
    const crop = cropSelectionToPixels(image.selection, image.imageWidth, image.imageHeight);
    if (crop.width < 2 || crop.height < 2) {
      updateImage(image.id, { error: '框选区域太小，请重新框选后再识别' });
      return;
    }
    const controller = new AbortController();
    controllers.current.set(image.id, controller);
    allControllers.current.add(controller);
    updateImage(image.id, { busy: true, error: null, progress: 0, progressLabel: '正在准备识别' });
    try {
      const isWholeImage = image.selection.xPercent <= 0
        && image.selection.yPercent <= 0
        && image.selection.widthPercent >= 100
        && image.selection.heightPercent >= 100;
      const result = await recognizeImageLayout(image.file, crop, ({ status, progress }) => {
        if (controllers.current.get(image.id) === controller) {
          updateImage(image.id, { progress, progressLabel: status });
        }
      }, controller.signal, { requireMarker: isWholeImage });
      if (controllers.current.get(image.id) !== controller) return;
      if (!result.text) throw new Error(isWholeImage
        ? '整图中未识别到可用的英文或数字，请框选数据区域后重试'
        : '框选区域内未识别到文字，请重新框选或使用原图');
      onImport([createLabel({
        content: result.text,
        quantity: 1,
        source: 'image',
        purpose,
        contentType: 'text',
        sizePresetId,
        sizeType: legacySizeType,
        sides: 1,
        imageFallback: image.previewUrl,
        textLines: result.lines.map((line) => ({
          id: crypto.randomUUID(),
          text: line.text,
          placement: {
            xPercent: Math.max(0, Math.min(100, line.xPercent)),
            yPercent: Math.max(0, Math.min(100, line.yPercent)),
            horizontalSnap: 'free',
            verticalSnap: 'free',
          },
          style: {},
          textOrientation: 'horizontal',
        })),
        needsReview: true,
        reviewReason: 'OCR 结果需要人工校对',
      })]);
      setImages((current) => current.filter((item) => item.id !== image.id));
      onStatus(`图片文字已识别，请校对：${image.file.name}`);
    } catch (error) {
      if (controllers.current.get(image.id) !== controller) return;
      if (error instanceof DOMException && error.name === 'AbortError') {
        updateImage(image.id, { busy: false, error: null, progressLabel: '识别已取消' });
        onStatus(`已取消识别：${image.file.name}`);
        return;
      }
      updateImage(image.id, {
        busy: false,
        error: error instanceof Error ? error.message : '识别失败，可选择直接使用原图',
        progressLabel: '识别失败',
      });
    } finally {
      allControllers.current.delete(controller);
      if (controllers.current.get(image.id) === controller) controllers.current.delete(image.id);
    }
  };

  const cancelOcr = (image: PendingImage) => {
    controllers.current.get(image.id)?.abort();
    controllers.current.delete(image.id);
    updateImage(image.id, { busy: false, error: null, progressLabel: '识别已取消' });
    onStatus(`已取消识别：${image.file.name}`);
  };

  return (
    <div className="image-importer">
      <label className="upload-button">
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          onChange={(event) => {
            void chooseFiles(event.target.files);
            event.target.value = '';
          }}
        />
        <span>导入图片</span>
        <small>PNG、JPEG 或 WebP</small>
      </label>

      {images.length > 0 && (
        <ul className="image-queue" aria-label="待处理图片">
          {images.map((image) => (
            <li key={image.id}>
              <div className="image-queue-copy">
                <strong title={image.file.name}>{image.file.name}</strong>
                <span>{image.busy ? `${image.progressLabel} · ${Math.round(image.progress * 100)}%` : image.progressLabel}</span>
                {image.error && <small className="field-error">{image.error}</small>}
              </div>
              <ImageCropSelector
                previewUrl={image.previewUrl}
                fileName={image.file.name}
                selection={image.selection}
                onChange={(selection) => updateImage(image.id, { selection })}
                onImageSize={(imageWidth, imageHeight) => updateImage(image.id, { imageWidth, imageHeight })}
              />
              <div className="image-queue-actions">
                <button className="button button-compact" type="button" onClick={() => image.busy ? cancelOcr(image) : void runOcr(image)}>
                  {image.busy ? '取消识别' : '识别文字'}
                </button>
                <button className="button button-compact button-quiet" type="button" disabled={image.busy} onClick={() => importOriginal(image)}>
                  使用原图
                </button>
                <button className="button button-compact button-quiet" type="button" disabled={image.busy} onClick={() => setImages((current) => current.filter((item) => item.id !== image.id))}>
                  移除
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
