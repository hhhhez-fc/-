import { useEffect, useState } from 'react';

export interface QuantityStepperProps {
  value: number;
  max: number;
  label: string;
  onCommit: (value: number) => void;
}

const clampQuantity = (raw: string, fallback: number, max: number) => {
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? Math.max(1, Math.min(max, parsed)) : fallback;
};

export default function QuantityStepper({ value, max, label, onCommit }: QuantityStepperProps) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const next = clampQuantity(draft, value, max);
    setDraft(String(next));
    onCommit(next);
  };

  return (
    <div className="quantity-stepper" onClick={(event) => event.stopPropagation()}>
      <button type="button" aria-label={`减少${label}`} disabled={value <= 1} onClick={() => onCommit(value - 1)}>−</button>
      <input
        aria-label={label}
        type="number"
        min="1"
        max={max}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
        }}
      />
      <button type="button" aria-label={`增加${label}`} disabled={value >= max} onClick={() => onCommit(value + 1)}>+</button>
    </div>
  );
}
