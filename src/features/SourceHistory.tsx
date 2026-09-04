import type { RecentLabelEntry } from '../domain/history';

interface SourceHistoryProps {
  entries: RecentLabelEntry[];
  onRestore: (entry: RecentLabelEntry) => void;
}

export default function SourceHistory({ entries, onRestore }: SourceHistoryProps) {
  return (
    <section className="source-history" aria-labelledby="source-history-title">
      <div>
        <h3 id="source-history-title">使用过的唛头</h3>
        <p>进入打印预览后自动保存最近 20 条。</p>
      </div>
      {entries.length ? (
        <ol>
          {entries.map((entry) => (
            <li key={entry.id}>
              <div>
                <strong>{entry.label.content.trim().split(/\r?\n/)[0]}</strong>
                <span>{entry.preset.widthMm} × {entry.preset.heightMm} mm · {entry.label.quantity} 件</span>
              </div>
              <button type="button" onClick={() => onRestore(entry)}>再次使用</button>
            </li>
          ))}
        </ol>
      ) : (
        <div className="source-history-empty">
          <strong>暂时没有使用记录</strong>
          <span>进入打印预览后会显示在这里。</span>
        </div>
      )}
    </section>
  );
}
