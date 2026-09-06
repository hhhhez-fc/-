import type { RefObject } from 'react';

interface RecordSearchProps {
  query: string;
  resultCount: number;
  totalCount: number;
  inputRef: RefObject<HTMLInputElement | null>;
  onChange: (query: string) => void;
  onClear: () => void;
}

export default function RecordSearch({ query, resultCount, totalCount, inputRef, onChange, onClear }: RecordSearchProps) {
  return (
    <div className="record-search" role="search">
      <label className="record-search-field">
        <span>搜索唛头</span>
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => onChange(event.target.value)}
          placeholder="按内容搜索"
        />
      </label>
      <span className="record-search-count" aria-live="polite">{resultCount} / {totalCount} 条</span>
      {query && <button className="button button-quiet button-compact" type="button" aria-label="清空搜索" onClick={onClear}>清空</button>}
    </div>
  );
}
