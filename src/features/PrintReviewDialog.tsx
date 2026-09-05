import { useEffect, useRef, useState } from 'react';
import type { PrintGroup, PrintPlan } from '../domain/printing';
import type { PrintRotation } from '../domain/printRotation';
import PrintLabelThumbnail from './PrintLabelThumbnail';

interface PrintReviewDialogProps {
  open: boolean;
  plan: PrintPlan;
  rotations: Record<string, PrintRotation>;
  onClose: () => void;
  onEditLabel: (id: string) => void;
  onRotateLabel: (id: string) => void;
  onPrintGroup: (group: PrintGroup) => void;
}

function getUniquePages(group: PrintGroup) {
  return Array.from(new Map(group.pages.map((page) => [page.label.id, page])).values());
}

export async function copyPaperSizeToClipboard(
  sizeLabel: string,
  writer?: { writeText: (text: string) => Promise<void> },
): Promise<boolean> {
  const clipboardWriter = writer ?? (typeof navigator !== 'undefined' ? navigator.clipboard : undefined);
  if (!clipboardWriter?.writeText) return false;
  try {
    await clipboardWriter.writeText(sizeLabel);
    return true;
  } catch {
    return false;
  }
}

export default function PrintReviewDialog({
  open,
  plan,
  rotations,
  onClose,
  onEditLabel,
  onRotateLabel,
  onPrintGroup,
}: PrintReviewDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [copyStatus, setCopyStatus] = useState('');

  const copyPaperSize = async (group: PrintGroup) => {
    const copied = await copyPaperSizeToClipboard(group.sizeLabel);
    setCopyStatus(copied
      ? `已复制 ${group.sizeLabel}，请粘贴到打印机的自定义纸张尺寸设置中。`
      : `复制失败，请手动输入 ${group.sizeLabel}。`);
  };

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled])'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [onClose, open]);

  if (!open) return null;
  const blocked = plan.blockers.length > 0;
  const groupPreviews = plan.groups.map((group) => ({
    group,
    uniquePages: getUniquePages(group),
  }));
  const title = blocked
    ? '还有内容需要处理'
    : `共 ${plan.totalCopies} 张，可以打印`;
  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="print-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="print-dialog-title">
        <div className="print-dialog-header">
          <div>
            <span className="dialog-kicker">PRINT CHECK · 打印检查</span>
            <h2 id="print-dialog-title">{title}</h2>
          </div>
          <button ref={closeRef} className="button button-quiet" type="button" onClick={onClose}>关闭</button>
        </div>

        {blocked ? (
          <div className="print-blockers">
            <p>请先修正以下记录。为避免漏印，所有问题解决前不会启动打印。</p>
            <ol>
              {plan.blockers.map((blocker) => (
                <li key={blocker.labelId}>
                  <div>
                    <strong>第 {blocker.labelNumber} 条 · {blocker.contentSummary}</strong>
                    <span>{blocker.reasons.join('；')}</span>
                  </div>
                  <button className="button button-quiet button-compact" type="button" onClick={() => onEditLabel(blocker.labelId)}>去修改</button>
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <div className="print-groups">
            <p>不同实际尺寸会分开打印。请按下方顺序，在打印机中换好对应规格的纸张。</p>
            <aside className="print-copy-rule" aria-label="打印份数规则">
              <strong>系统打印份数保持 1</strong>
              <span>程序已经按录入数量生成打印页，请勿在系统窗口重复增加份数。</span>
            </aside>
            <aside className="print-paper-guide" aria-labelledby="print-paper-guide-title">
              <strong id="print-paper-guide-title">系统打印使用自定义纸张</strong>
              <ol>
                <li>打开“打印机首选项”，创建与下方完全相同的用户自定义纸张。</li>
                <li>在系统打印窗口选择该纸张，缩放保持 100%，边距选择“无”。</li>
                <li>这里的旋转只改变文字方向；纸张尺寸、文字坐标和字号保持不变。</li>
                <li>不要选择 A4 或信纸代替，否则内容会缩放或产生大片留白。</li>
              </ol>
            </aside>
            <p className="print-copy-feedback" role="status" aria-live="polite">{copyStatus}</p>
            {groupPreviews.map(({ group, uniquePages }, index) => {
              return (
                <article key={group.key}>
                  <span className="print-group-index">{String(index + 1).padStart(2, '0')}</span>
                  <div className="print-group-summary">
                    <h3>{group.sizeLabel}</h3>
                    <p>{`1 × 程序生成 ${group.pages.length} 张 = 实际打印 ${group.pages.length} 张`}</p>
                  </div>
                  <div className="print-group-actions">
                    <button
                      className="button button-quiet button-compact"
                      type="button"
                      aria-label={`复制 ${group.sizeLabel}`}
                      onClick={() => void copyPaperSize(group)}
                    >
                      复制尺寸
                    </button>
                    <button
                      className="button button-print"
                      type="button"
                      onClick={() => onPrintGroup(group)}
                    >
                      打印这一组
                    </button>
                  </div>
                  <div className="print-label-previews">
                    {uniquePages.map(({ label, preset }, labelIndex) => {
                      const rotation = label.contentType === 'text' ? rotations[label.id] ?? 0 : 0;
                      const summary = label.content.trim().split(/\r?\n/)[0] || '未填写内容';
                      return (
                        <div className="print-label-preview-row" key={label.id}>
                          <PrintLabelThumbnail label={label} preset={preset} rotation={rotation} />
                          <div className="print-label-preview-copy">
                            <strong>{summary}</strong>
                            {label.contentType === 'text' ? (
                              <div className="print-rotation-control">
                                <button
                                  className="button button-quiet button-compact"
                                  type="button"
                                  aria-label={`旋转 ${group.sizeLabel} 第 ${labelIndex + 1} 个文字唛头 ${summary} 90°`}
                                  onClick={() => onRotateLabel(label.id)}
                                >旋转 90°</button>
                                <span>当前 {rotation}°</span>
                              </div>
                            ) : <span>图片保持原方向</span>}
                            <span>输出纸张 {preset.widthMm} × {preset.heightMm} mm</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
