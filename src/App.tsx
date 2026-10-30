import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, Leaf, LoaderCircle, X } from 'lucide-react';
import Library from './components/Library';
import { addBook, deleteBook, listBooks, openBook, saveProgress } from './lib/storage';
import type { Book, ReadingPosition } from './types';

const PdfReader = lazy(() => import('./readers/PdfReader'));
const EpubReader = lazy(() => import('./readers/EpubReader'));

const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';

export default function App() {
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [activeBook, setActiveBook] = useState<Book | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Book | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const beforeReaderClose = useRef<(() => void) | null>(null);
  const registerBeforeClose = useCallback((flush: (() => void) | null) => { beforeReaderClose.current = flush; }, []);
  const importLock = useRef(false);
  const cancelButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let disposed = false;
    listBooks().then(items => { if (!disposed) setBooks(items); })
      .catch(() => { if (!disposed) setToast('Your library could not be opened. Allow browser storage and try refreshing.'); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    document.title = activeBook ? `${activeBook.filename} · Leafmark` : 'Leafmark · Your library';
  }, [activeBook]);

  useEffect(() => {
    if (!pendingDelete) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    cancelButton.current?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPendingDelete(null);
      if (event.key === 'Tab') {
        const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.dialog button:not(:disabled)'));
        const first = buttons[0], last = buttons.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('keydown', keyboard); previouslyFocused?.focus(); };
  }, [pendingDelete]);

  const uploadFiles = useCallback(async (files: File[]) => {
    if (importLock.current || !files.length) return;
    importLock.current = true;
    setBusy(true);
    const failures: string[] = [];
    for (const file of files) {
      try {
        const book = await addBook(file);
        setBooks(previous => [...previous, book]);
      } catch (error) { failures.push(errorMessage(error)); }
    }
    if (failures.length) setToast(failures.join(' '));
    importLock.current = false;
    setBusy(false);
  }, []);

  const loadSamples = useCallback(async () => {
    if (importLock.current) return;
    importLock.current = true;
    setBusy(true);
    try {
      const existing = await listBooks();
      const samples = ['The art of noticing.pdf', 'A little room to read.epub'];
      for (const filename of samples) {
        if (existing.some(book => book.sample && book.filename === filename)) continue;
        const response = await fetch(`/samples/${encodeURIComponent(filename)}`);
        if (!response.ok) throw new Error('Sample books could not be loaded. Please try again.');
        const book = await addBook(new File([await response.blob()], filename), true);
        setBooks(previous => [...previous, book]);
      }
    } catch (error) { setToast(errorMessage(error)); }
    finally { importLock.current = false; setBusy(false); }
  }, []);

  const handleOpen = useCallback(async (book: Book) => {
    try {
      await saveQueue.current.catch(() => {});
      const latest = await openBook(book.id);
      if (!latest) throw new Error('This book is no longer in your library.');
      setBooks(previous => previous.map(item => item.id === latest.id ? latest : item));
      setSaveState('saved');
      setActiveBook(latest);
    } catch (error) { setToast(errorMessage(error)); }
  }, []);

  const handleProgress = useCallback((position: ReadingPosition, progress: number) => {
    // Readers gate saves on actual movement and flush the last position on exit,
    // including when the document has just become hidden.
    if (!activeBook) return;
    const id = activeBook.id;
    const safeProgress = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
    setSaveState('saving');
    saveQueue.current = saveQueue.current.catch(() => {}).then(async () => {
      await saveProgress(id, position, safeProgress);
      setBooks(previous => previous.map(book => book.id === id ? { ...book, position, progress: safeProgress, lastReadAt: Date.now() } : book));
      setSaveState('saved');
    }).catch(() => {
      setSaveState('error');
      setToast('Your reading position could not be saved. Check that browser storage is available.');
    });
  }, [activeBook]);

  const confirmDelete = async () => {
    if (!pendingDelete || busy) return;
    setBusy(true);
    try {
      await saveQueue.current.catch(() => {});
      await deleteBook(pendingDelete.id);
      setBooks(previous => previous.filter(book => book.id !== pendingDelete.id));
      setPendingDelete(null);
    } catch (error) { setToast(errorMessage(error)); }
    finally { setBusy(false); }
  };

  return <>
    {activeBook ? <main className="reader-shell">
      <header className="reader-header">
        <button className="reader-back icon-button" aria-label="Back to library" title="Back to library" onClick={() => { beforeReaderClose.current?.(); setActiveBook(null); }}><ArrowLeft size={20} /></button>
        <Leaf className="reader-brand-icon" size={21} aria-hidden="true" />
        <div className="reader-heading" title={activeBook.filename}>{activeBook.filename}</div>
        <span className={`reader-status ${saveState === 'error' ? 'save-error' : ''}`} role="status">
          {saveState === 'saving' ? <LoaderCircle size={14} className="spin" /> : saveState === 'saved' ? <Check size={14} /> : null}
          {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved on this device' : 'Not saved'}
        </span>
      </header>
      <Suspense fallback={<div className="reader-loading" role="status"><LoaderCircle className="spin" size={24} /> Opening your book…</div>}>
        {activeBook.format === 'pdf' ? <PdfReader key={activeBook.id} book={activeBook} onProgress={handleProgress} registerBeforeClose={registerBeforeClose} /> : <EpubReader key={activeBook.id} book={activeBook} onProgress={handleProgress} registerBeforeClose={registerBeforeClose} />}
      </Suspense>
    </main> : <Library books={books} loading={loading} busy={busy} onOpen={handleOpen} onUpload={uploadFiles} onDelete={setPendingDelete} onSamples={loadSamples} />}
    {pendingDelete && <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget && !busy) setPendingDelete(null); }}>
      <section className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-description">
        <h2 id="delete-title">Remove this book?</h2>
        <p id="delete-description"><strong>{pendingDelete.filename}</strong> and its saved reading position will be removed from this library. Your original file stays untouched.</p>
        <div className="dialog-actions"><button className="button button-secondary" ref={cancelButton} disabled={busy} onClick={() => setPendingDelete(null)}>Keep book</button><button className="button button-danger" disabled={busy} onClick={confirmDelete}>{busy ? 'Removing…' : 'Remove book'}</button></div>
      </section>
    </div>}
    {toast && <div className="app-toast" role="alert"><span>{toast}</span><button className="icon-button" aria-label="Dismiss message" onClick={() => setToast(null)}><X size={18} /></button></div>}
  </>;
}
