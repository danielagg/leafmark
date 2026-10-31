import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';

export default function ReaderFooter({
  percentage,
  label,
  title,
  className,
}: {
  percentage: number;
  label: string;
  title?: string;
  className: string;
}) {
  const percent = Math.round(
    Math.min(100, Math.max(0, Number.isFinite(percentage) ? percentage : 0)),
  );
  return (
    <footer
      className={cn(
        'reader-footer relative flex w-full shrink-0 items-center justify-between gap-4 bg-[var(--reader-footer)] px-6 pt-2 pb-[max(8px,env(safe-area-inset-bottom))] text-[11px] leading-[normal] text-muted-foreground',
        'max-[600px]:px-4 max-[600px]:text-[10px] [@media(max-height:500px)]:pt-1.5 [@media(max-height:500px)]:pb-[max(6px,env(safe-area-inset-bottom))]',
        className,
      )}
    >
      <Progress
        className="reader-progress-track absolute inset-x-0 top-0 h-[3px] rounded-none bg-[#d6dfd5] dark:bg-border"
        indicatorClassName="reader-progress-fill"
        value={percent}
        aria-label="Reading progress"
        getValueLabel={() => `${percent}% read`}
      />
      <span
        className="reader-footer-label min-w-0 truncate"
        title={title}
      >
        {label}
      </span>
      <span className="reader-progress-value shrink-0 rounded-[5px] bg-secondary px-[9px] py-0.75 font-semibold text-primary tabular-nums">
        {percent}% read
      </span>
    </footer>
  );
}
