import * as Select from '@radix-ui/react-select';
import { useRef, type CSSProperties } from 'react';
import type { FontSizeChoice } from '../domain/fontSizePreview';

const AUTO_VALUE = 'auto';
export const FONT_SIZE_OPTIONS = [12, 16, 20, 24, 28, 32, 36, 42, 48, 56, 64, 72, 96, 120] as const;

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
  const sizeOptions = value.fontMode === 'fixed' && !FONT_SIZE_OPTIONS.includes(value.fontSizePt as typeof FONT_SIZE_OPTIONS[number])
    ? [...FONT_SIZE_OPTIONS, value.fontSizePt].sort((first, second) => first - second)
    : FONT_SIZE_OPTIONS;
  const previewedValueRef = useRef<string | null>(null);
  const preview = (nextValue: string) => {
    if (previewedValueRef.current === nextValue) return;
    previewedValueRef.current = nextValue;
    onPreview(choiceFromValue(nextValue));
  };
  const clearPreview = () => {
    previewedValueRef.current = null;
    onPreview(null);
  };

  return (
    <Select.Root
      value={selectedValue}
      onValueChange={(nextValue) => {
        onCommit(choiceFromValue(nextValue));
        clearPreview();
      }}
      onOpenChange={(open) => {
        if (!open) clearPreview();
      }}
    >
      <Select.Trigger className="font-size-trigger" aria-label="全部字号">
        <Select.Value>{value.fontMode === 'auto' ? '自动适配' : `${value.fontSizePt} pt`}</Select.Value>
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
  );
}
