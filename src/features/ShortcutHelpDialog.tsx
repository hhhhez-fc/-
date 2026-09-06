import { useEffect, useRef } from 'react';

interface ShortcutHelpDialogProps {
  open: boolean;
  onClose: () => void;
}

export default function ShortcutHelpDialog({ open, onClose }: ShortcutHelpDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

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
      if (event.key === 'Tab') {
        event.preventDefault();
        closeRef.current?.focus();
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

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="shortcut-dialog" role="dialog" aria-modal="true" aria-labelledby="shortcut-help-title">
        <header className="shortcut-dialog-header">
          <div>
            <span className="dialog-kicker">SHORTCUTS · 快捷键</span>
            <h2 id="shortcut-help-title">快捷键帮助</h2>
          </div>
        </header>

        <div className="shortcut-dialog-content">
          <dl className="shortcut-list">
            <div>
              <dt>复制当前或所选唛头</dt>
              <dd><kbd>Ctrl / ⌘ + C</kbd></dd>
            </div>
            <div>
              <dt>剪切当前或所选唛头</dt>
              <dd><kbd>Ctrl / ⌘ + X</kbd></dd>
            </div>
            <div>
              <dt>粘贴或移动唛头</dt>
              <dd><kbd>Ctrl / ⌘ + V</kbd></dd>
            </div>
            <div>
              <dt>撤销</dt>
              <dd><kbd>Ctrl / ⌘ + Z</kbd></dd>
            </div>
            <div>
              <dt>重做</dt>
              <dd><kbd>Ctrl + Y</kbd><span>或</span><kbd>Ctrl / ⌘ + Shift + Z</kbd></dd>
            </div>
            <div>
              <dt>查找唛头</dt>
              <dd><kbd>Ctrl / ⌘ + F</kbd></dd>
            </div>
            <div>
              <dt>打开快捷键帮助</dt>
              <dd><kbd>F1</kbd></dd>
            </div>
            <div>
              <dt>关闭帮助或取消待剪切</dt>
              <dd><kbd>Esc</kbd></dd>
            </div>
          </dl>
        </div>

        <footer className="shortcut-dialog-footer">
          <button
            ref={closeRef}
            className="button button-primary"
            type="button"
            aria-label="关闭快捷键帮助"
            onClick={onClose}
          >关闭</button>
        </footer>
      </div>
    </div>
  );
}
