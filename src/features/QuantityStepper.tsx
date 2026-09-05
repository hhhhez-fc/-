import { useEffect, useId, useState } from 'react';

export interface QuantityStepperProps {
  value: number;
  max: number;
  label: string;
  onCommit: (value: number) => void;
}

const clampQuantity = (raw: string, fallback: number, max: number) => {
  if (raw.trim() === '') return 1;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? Math.max(1, Math.min(max, parsed)) : fallback;
};

const getQuantityIssue = (raw: string, max: number) => {
  if (raw.trim() === '') return 'empty';
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) return 'integer';
  if (parsed < 1 || parsed > max) return 'range';
  return null;
};

export default function QuantityStepper({ value, max, label, onCommit }: QuantityStepperProps) {
  const [draft, setDraft] = useState(String(value));
  const [correction, setCorrection] = useState('');
  const feedbackId = useId();
  const issue = getQuantityIssue(draft, max);
  const issueMessage = issue === 'range'
    ? `打印数量必须在 1 至 ${max} 之间。`
    : issue ? `请输入 1 至 ${max} 的整数。` : '';
  const feedback = issueMessage || correction;

  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const next = clampQuantity(draft, value, max);
    setCorrection(issue === 'empty'
      ? `打印数量为空，已调整为 ${next}。`
      : issue === 'integer'
        ? `打印数量必须为整数，已恢复为 ${next}。`
        : issue === 'range'
          ? `打印数量超出范围，已调整为 ${next}。`
          : '');
    setDraft(String(next));
    onCommit(next);
  };

  const step = (next: number) => {
    setCorrection('');
    onCommit(next);
  };

  return (
    <div className="quantity-stepper-field" onClick={(event) => event.stopPropagation()}>
      <div className="quantity-stepper">
        <button type="button" aria-label={`减少${label}`} disabled={value <= 1} onClick={() => step(value - 1)}>−</button>
        <input
          aria-label={label}
          aria-invalid={issue ? 'true' : 'false'}
          aria-describedby={feedback ? feedbackId : undefined}
          type="number"
          min="1"
          max={max}
          step="1"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setCorrection('');
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault();
              commit();
            }
          }}
        />
        <button type="button" aria-label={`增加${label}`} disabled={value >= max} onClick={() => step(value + 1)}>+</button>
      </div>
      {feedback && <small
        className={`quantity-stepper-feedback ${issue ? 'is-error' : ''}`}
        id={feedbackId}
        role={issue ? 'alert' : 'status'}
        aria-live="polite"
      >{feedback}</small>}
    </div>
  );
}
