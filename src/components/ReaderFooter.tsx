import './reader-footer.css';

export default function ReaderFooter({ percentage, label, title, className }: {
  percentage: number; label: string; title?: string; className: string;
}) {
  const percent = Math.round(Math.min(100, Math.max(0, Number.isFinite(percentage) ? percentage : 0)));
  return <footer className={`reader-footer ${className}`}>
    <div className="reader-progress-track" role="progressbar" aria-label="Reading progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`${percent}% read`}>
      <span className="reader-progress-fill" style={{ width: `${percent}%` }} />
    </div>
    <span className="reader-footer-label" title={title}>{label}</span>
    <span className="reader-progress-value">{percent}% read</span>
  </footer>;
}
