import type { LabelRecord } from '../domain/labels';
import { MAX_LABEL_QUANTITY } from '../domain/quantity';
import QuantityStepper from './QuantityStepper';

export interface LabelListProps {
  labels: LabelRecord[];
  activeLabelId: string | null;
  selectedLabelIds: string[];
  onActivate: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onQuantityChange: (id: string, quantity: number) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}

export default function LabelList({ labels, activeLabelId, selectedLabelIds, onActivate, onToggleSelect, onQuantityChange, onDuplicate, onDelete }: LabelListProps) {
  if (labels.length === 0) {
    return (
      <div className="records-empty">
        <strong>还没有唛头</strong>
        <span>从左侧导入 Excel、图片，或手动新增第一条。</span>
      </div>
    );
  }

  return (
    <ol className="label-list" aria-label="唛头记录">
      {labels.map((label, index) => (
        <li className="label-list-item" key={label.id}>
          <label className="row-check" title="加入批量操作">
            <input
              type="checkbox"
              checked={selectedLabelIds.includes(label.id)}
              onChange={() => onToggleSelect(label.id)}
              aria-label={`选择第 ${index + 1} 条唛头`}
            />
          </label>
          <button
            className="label-row"
            type="button"
            aria-pressed={label.id === activeLabelId}
            onClick={() => onActivate(label.id)}
          >
            <span className="label-index">{String(index + 1).padStart(2, '0')}</span>
            <span className="label-row-copy">
              <strong>{label.content.trim() || '未填写内容'}</strong>
              <small>{label.quantity} 件 × {label.sides} 面 · {label.source === 'manual' ? '手动' : label.source}</small>
            </span>
          </button>
          <QuantityStepper
            value={label.quantity}
            max={MAX_LABEL_QUANTITY}
            label={`第 ${index + 1} 条唛头的打印数量`}
            onCommit={(quantity) => onQuantityChange(label.id, quantity)}
          />
          <div className="row-actions" aria-label={`第 ${index + 1} 条唛头操作`}>
            <button type="button" onClick={() => onDuplicate(label.id)}>复制</button>
            <button type="button" onClick={() => onDelete(label.id)}>删除</button>
          </div>
        </li>
      ))}
    </ol>
  );
}
