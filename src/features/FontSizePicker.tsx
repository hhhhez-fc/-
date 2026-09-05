import * as Select from '@radix-ui/react-select';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { FontSizeChoice } from '../domain/fontSizePreview';
import { clampFontSizePt, MAX_FONT_SIZE_PT, MIN_FONT_SIZE_PT } from '../domain/labels';

const AUTO_VALUE = 'auto';
export const FONT_SIZE_OPTIONS = [12, 16, 20, 24, 28, 32, 36, 42, 48, 56, 64, 72, 96, 120, 144, 160, 180, 200, 240, 300] as const;

interface FontSizePickerProps {
  value: FontSizeChoice;
  onCommit: (choice: FontSizeChoice) => void;
  onPreview: (choice: FontSizeChoice | null) => void;
}

function choiceFromValue(value: string): FontSizeChoice {
  return value === AUTO_VALUE
    ? { fontMode: 'auto' }
    : { fontMode: 'fixed', fontSizePt: Number(value) };
}

export default function FontSizePicker({ value, onCommit, onPreview }: FontSizePickerProps) {
  const selectedValue = value.fontMode === 'auto' ? AUTO_VALUE : String(value.fontSizePt);
  const committedInputValue = value.fontMode === 'auto' ? '' : String(value.fontSizePt);
  const [inputValue, setInputValue] = useState(committedInputValue);
  const sizeOptions = value.fontMode === 'fixed' && !FONT_SIZE_OPTIONS.includes(value.fontSizePt as typeof FONT_SIZE_OPTIONS[number])
    ? [...FONT_SIZE_OPTIONS, value.fontSizePt].sort((first, second) => first - second)
    : FONT_SIZE_OPTIONS;
  const previewedValueRef = useRef<string | null>(null);
  useEffect(() => setInputValue(committedInputValue), [committedInputValue]);
  const preview = (nextValue: string) => {
    if (previewedValueRef.current === nextValue) return;
    previewedValueRef.current = nextValue;
    onPreview(choiceFromValue(nextValue));
  };
  const clearPreview = () => {
    previewedValueRef.current = null;
    onPreview(null);
  };
  const normalizeInput = () => {
    if (!inputValue.trim()) {
      setInputValue(committedInputValue);
      return;
    }
    const fontSizePt = clampFontSizePt(Number(inputValue));
    setInputValue(String(fontSizePt));
    onCommit({ fontMode: 'fixed', fontSizePt });
    clearPreview();
  };

  return (
    <div className="font-size-picker-control">
      <div className="font-size-input-wrap">
        <input
          className="font-size-input"
          type="number"
          min={MIN_FONT_SIZE_PT}
          max={MAX_FONT_SIZE_PT}
          step="0.5"
          inputMode="decimal"
          aria-label="全部字号"
          placeholder="自动"
          value={inputValue}
          onChange={(event) => {
            const raw = event.target.value;
            setInputValue(raw);
            const fontSizePt = Number(raw);
            if (raw.trim() && Number.isFinite(fontSizePt) && fontSizePt >= MIN_FONT_SIZE_PT && fontSizePt <= MAX_FONT_SIZE_PT) {
              onCommit({ fontMode: 'fixed', fontSizePt });
              clearPreview();
            }
          }}
          onBlur={normalizeInput}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault();
              normalizeInput();
              event.currentTarget.blur();
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              setInputValue(committedInputValue);
            }
          }}
        />
        <span aria-hidden="true">pt</span>
      </div>
      <Select.Root
        value={selectedValue}
        onValueChange={(nextValue) => {
          const choice = choiceFromValue(nextValue);
          setInputValue(choice.fontMode === 'auto' ? '' : String(choice.fontSizePt));
          onCommit(choice);
          clearPreview();
        }}
        onOpenChange={(open) => {
          if (!open) clearPreview();
        }}
      >
        <Select.Trigger className="font-size-trigger" aria-label="选择常用字号">
          <Select.Value>常用</Select.Value>
          <Select.Icon className="font-size-trigger-icon" aria-hidden="true">▾</Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content
            className="font-size-content"
            position="popper"
            sideOffset={4}
            collisionPadding={8}
          >
            <Select.ScrollUpButton className="font-size-scroll-button" aria-label="向上滚动字号">▲</Select.ScrollUpButton>
            <Select.Viewport className="font-size-viewport">
              <Select.Item
                className="font-size-option"
                value={AUTO_VALUE}
                onFocus={() => preview(AUTO_VALUE)}
                onPointerMove={() => preview(AUTO_VALUE)}
              >
                <Select.ItemText>自动适配</Select.ItemText>
                <Select.ItemIndicator className="font-size-option-check" aria-hidden="true">✓</Select.ItemIndicator>
              </Select.Item>
              {sizeOptions.map((size) => (
                <Select.Item
                  className="font-size-option"
                  key={size}
                  value={String(size)}
                  textValue={`${size} pt`}
                  onFocus={() => preview(String(size))}
                  onPointerMove={() => preview(String(size))}
                  style={{ '--font-size-option': `${Math.min(23, 10 + size * 0.14)}px` } as CSSProperties}
                >
                  <Select.ItemText>
                    <span className="font-size-option-sample" aria-hidden="true">Aa</span>
                    <span>{size} pt</span>
                  </Select.ItemText>
                  <Select.ItemIndicator className="font-size-option-check" aria-hidden="true">✓</Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.Viewport>
            <Select.ScrollDownButton className="font-size-scroll-button" aria-label="向下滚动字号">▼</Select.ScrollDownButton>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}
