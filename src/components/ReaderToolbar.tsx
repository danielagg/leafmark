import { useEffect, useId, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Minus,
  Moon,
  Plus,
  Sun,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export interface ReaderToolbarProps {
  page: number;
  totalPages: number;
  zoom: number;
  disabled?: boolean;
  minZoom?: number;
  maxZoom?: number;
  onPageChange: (page: number) => void;
  onZoomChange: (zoom: number) => void;
  readingMode?: 'vertical' | 'horizontal';
  onReadingModeChange?: (mode: 'vertical' | 'horizontal') => void;
  theme?: 'light' | 'dark';
  onThemeChange?: (theme: 'light' | 'dark') => void;
}

export default function ReaderToolbar({
  page,
  totalPages,
  zoom,
  disabled = false,
  minZoom = 0.25,
  maxZoom = 3,
  onPageChange,
  onZoomChange,
  readingMode,
  onReadingModeChange,
  theme,
  onThemeChange,
}: ReaderToolbarProps) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const requested = useRef<number | null>(null);
  const edited = useRef(false);
  const [draft, setDraft] = useState(String(page));
  const unavailable = disabled || totalPages < 1;
  const percent = Math.round(zoom * 100);

  useEffect(() => {
    if (!edited.current) setDraft(String(page));
    if (requested.current === page) requested.current = null;
  }, [page]);

  function commit() {
    if (!edited.current) {
      setDraft(String(page));
      return;
    }
    edited.current = false;
    const number = Number(draft);
    if (!draft.trim() || !Number.isFinite(number)) {
      setDraft(String(page));
      return;
    }
    const next = Math.max(1, Math.min(totalPages, Math.trunc(number)));
    setDraft(String(next));
    if (unavailable || next === page || next === requested.current) return;
    requested.current = next;
    onPageChange(next);
  }
  function changeZoom(delta: number) {
    const next = Math.max(minZoom, Math.min(maxZoom, Math.round((zoom + delta) * 100) / 100));
    onZoomChange(next);
  }

  const controlClassName =
    'reader-control-button size-10 min-h-10 min-w-10 touch-manipulation p-0 font-normal text-primary disabled:opacity-35 max-[600px]:h-11 max-[600px]:min-h-11 max-[600px]:w-9 max-[600px]:min-w-9 max-[340px]:w-8 max-[340px]:min-w-8';
  const modeClassName =
    'reader-control-button reader-mode-button h-8 min-h-8 w-8 min-w-8 p-0 text-muted-foreground aria-pressed:bg-secondary aria-pressed:text-primary max-[600px]:h-[38px] max-[600px]:min-h-[38px] max-[600px]:w-[27px] max-[600px]:min-w-[27px]';

  return (
    <div
      className={cn(
        'reader-toolbar flex min-h-[60px] w-full shrink-0 items-center justify-between gap-4 border-b bg-[var(--reader-chrome)] px-6 py-2 text-[13px] leading-[normal] text-primary',
        'max-[600px]:min-h-14 max-[600px]:gap-1.5 max-[600px]:px-2 max-[600px]:py-1.5 max-[340px]:gap-0.5 max-[340px]:px-1.5 max-[340px]:text-xs',
        readingMode && 'has-reading-mode max-[600px]:gap-1',
        theme && 'has-theme max-[600px]:flex-wrap max-[600px]:gap-y-0.5',
      )}
      role="toolbar"
      aria-label="Reading controls"
    >
      <div className="reader-page-controls flex items-center gap-2.5 max-[600px]:gap-1 max-[340px]:gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className={controlClassName}
          aria-label="Previous page"
          title="Previous page"
          disabled={unavailable || page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft
            size={18}
            aria-hidden="true"
          />
        </Button>
        <form
          className="reader-page-form flex items-center gap-2.5 max-[600px]:gap-1 max-[340px]:gap-0.5"
          onSubmit={(event) => {
            event.preventDefault();
            commit();
          }}
        >
          <label
            htmlFor={id}
            className={cn(theme && 'max-[600px]:hidden', readingMode && 'max-[380px]:hidden')}
          >
            Page
          </label>
          <Input
            ref={input}
            id={id}
            aria-label="Page number"
            type="number"
            inputMode="numeric"
            min={1}
            max={Math.max(1, totalPages)}
            value={draft}
            disabled={unavailable}
            onChange={(event) => {
              edited.current = true;
              requested.current = null;
              setDraft(event.target.value);
            }}
            onBlur={commit}
            className={cn(
              'h-8 w-[54px] [appearance:textfield] rounded-md bg-background px-1 py-1 text-center text-[13px] leading-[normal] text-primary shadow-none md:text-[13px] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
              'max-[600px]:w-[42px] max-[340px]:w-9',
              theme && 'max-[600px]:w-9',
            )}
          />
          <span className="reader-page-count whitespace-nowrap text-muted-foreground tabular-nums">
            of {totalPages > 0 ? totalPages : '…'}
          </span>
        </form>
        <Button
          variant="ghost"
          size="icon"
          className={controlClassName}
          aria-label="Next page"
          title="Next page"
          disabled={unavailable || page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight
            size={18}
            aria-hidden="true"
          />
        </Button>
      </div>
      <div
        className={cn(
          'reader-toolbar-options flex items-center gap-[18px] max-[600px]:gap-1.5',
          theme && 'max-[600px]:ml-auto max-[600px]:gap-1',
        )}
      >
        {readingMode && onReadingModeChange && (
          <div
            className="reader-mode-controls flex items-center gap-0.5 rounded-md border bg-background p-0.5 max-[600px]:gap-px max-[600px]:p-px"
            role="group"
            aria-label="Scroll direction"
          >
            <Button
              variant="ghost"
              size="icon"
              className={modeClassName}
              aria-label="Vertical scrolling"
              title="Vertical scrolling"
              aria-pressed={readingMode === 'vertical'}
              disabled={disabled}
              onClick={() => onReadingModeChange('vertical')}
            >
              <ArrowUpDown
                size={16}
                aria-hidden="true"
              />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={modeClassName}
              aria-label="Horizontal scrolling"
              title="Horizontal scrolling"
              aria-pressed={readingMode === 'horizontal'}
              disabled={disabled}
              onClick={() => onReadingModeChange('horizontal')}
            >
              <ArrowLeftRight
                size={16}
                aria-hidden="true"
              />
            </Button>
          </div>
        )}
        {theme && onThemeChange && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              controlClassName,
              'reader-theme-button max-[600px]:w-8 max-[600px]:min-w-8',
            )}
            aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
            title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
            onClick={() => onThemeChange(theme === 'light' ? 'dark' : 'light')}
          >
            {theme === 'light' ? (
              <Moon
                size={17}
                aria-hidden="true"
              />
            ) : (
              <Sun
                size={17}
                aria-hidden="true"
              />
            )}
          </Button>
        )}
        <div className="reader-zoom-controls flex items-center gap-2.5 max-[600px]:gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className={cn(controlClassName, theme && 'max-[600px]:w-8 max-[600px]:min-w-8')}
            aria-label="Zoom out"
            title="Zoom out"
            disabled={disabled || zoom <= minZoom + 0.001}
            onClick={() => changeZoom(-0.1)}
          >
            <Minus
              size={17}
              aria-hidden="true"
            />
          </Button>
          {percent !== 100 && (
            <span
              className="reader-zoom-value min-w-10 text-center text-xs text-muted-foreground tabular-nums max-[600px]:min-w-[34px] max-[600px]:text-[11px]"
              aria-label={`Zoom ${percent}%`}
            >
              {percent}%
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            className={cn(controlClassName, theme && 'max-[600px]:w-8 max-[600px]:min-w-8')}
            aria-label="Zoom in"
            title="Zoom in"
            disabled={disabled || zoom >= maxZoom - 0.001}
            onClick={() => changeZoom(0.1)}
          >
            <Plus
              size={17}
              aria-hidden="true"
            />
          </Button>
        </div>
      </div>
    </div>
  );
}
