import { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeftRight, ArrowUpDown, ChevronLeft, ChevronRight, Minus, Moon, Plus, Sun } from 'lucide-react';
import './reader-toolbar.css';

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

export default function ReaderToolbar({ page, totalPages, zoom, disabled = false, minZoom = .25, maxZoom = 3, onPageChange, onZoomChange, readingMode, onReadingModeChange, theme, onThemeChange }: ReaderToolbarProps) {
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
    if (!edited.current) { setDraft(String(page)); return; }
    edited.current = false;
    const number = Number(draft);
    if (!draft.trim() || !Number.isFinite(number)) { setDraft(String(page)); return; }
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

  return <div className={`reader-toolbar${readingMode ? ' has-reading-mode' : ''}${theme ? ' has-theme' : ''}`} role="toolbar" aria-label="Reading controls">
    <div className="reader-page-controls">
      <button type="button" className="reader-control-button" aria-label="Previous page" title="Previous page" disabled={unavailable || page <= 1} onClick={() => onPageChange(page - 1)}><ChevronLeft size={18} aria-hidden="true" /></button>
      <form className="reader-page-form" onSubmit={event => { event.preventDefault(); commit(); }}>
        <label htmlFor={id}>Page</label>
        <input ref={input} id={id} aria-label="Page number" type="number" inputMode="numeric" min={1} max={Math.max(1, totalPages)} value={draft} disabled={unavailable} onChange={event => { edited.current = true; requested.current = null; setDraft(event.target.value); }} onBlur={commit} />
        <span className="reader-page-count">of {totalPages > 0 ? totalPages : '…'}</span>
      </form>
      <button type="button" className="reader-control-button" aria-label="Next page" title="Next page" disabled={unavailable || page >= totalPages} onClick={() => onPageChange(page + 1)}><ChevronRight size={18} aria-hidden="true" /></button>
    </div>
    <div className="reader-toolbar-options">
      {readingMode && onReadingModeChange && <div className="reader-mode-controls" role="group" aria-label="Scroll direction">
        <button type="button" className="reader-control-button reader-mode-button" aria-label="Vertical scrolling" title="Vertical scrolling" aria-pressed={readingMode === 'vertical'} disabled={disabled} onClick={() => onReadingModeChange('vertical')}><ArrowUpDown size={16} aria-hidden="true" /></button>
        <button type="button" className="reader-control-button reader-mode-button" aria-label="Horizontal scrolling" title="Horizontal scrolling" aria-pressed={readingMode === 'horizontal'} disabled={disabled} onClick={() => onReadingModeChange('horizontal')}><ArrowLeftRight size={16} aria-hidden="true" /></button>
      </div>}
      {theme && onThemeChange && <button type="button" className="reader-control-button reader-theme-button" aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'} title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'} onClick={() => onThemeChange(theme === 'light' ? 'dark' : 'light')}>
        {theme === 'light' ? <Moon size={17} aria-hidden="true" /> : <Sun size={17} aria-hidden="true" />}
      </button>}
      <div className="reader-zoom-controls">
      <button type="button" className="reader-control-button" aria-label="Zoom out" title="Zoom out" disabled={disabled || zoom <= minZoom + .001} onClick={() => changeZoom(-.1)}><Minus size={17} aria-hidden="true" /></button>
      {percent !== 100 && <span className="reader-zoom-value" aria-label={`Zoom ${percent}%`}>{percent}%</span>}
      <button type="button" className="reader-control-button" aria-label="Zoom in" title="Zoom in" disabled={disabled || zoom >= maxZoom - .001} onClick={() => changeZoom(.1)}><Plus size={17} aria-hidden="true" /></button>
      </div>
    </div>
  </div>;
}
