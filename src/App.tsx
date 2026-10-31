import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, Leaf, LoaderCircle, X } from 'lucide-react';
import Library from './components/Library';
import { useLibraryAuth } from './components/AuthGate';
import { isCloudMode } from './lib/supabase';
import { addBook, deleteBook, listBooks, openBook, saveProgress } from './lib/storage';
import type { Book, ReadableBook, ReadingPosition } from './types';

const PdfReader = lazy(() => import('./readers/PdfReader'));
const EpubReader = lazy(() => import('./readers/EpubReader'));

const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';
const CLOUD_SAVE_ERROR = 'Your position could not be saved. We’ll retry while this book is open.';
type PendingSave = { id: string; position: ReadingPosition; progress: number };

export default function App() {
  const { authEnabled, lockLibrary } = useLibraryAuth();
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [activeBook, setActiveBook] = useState<ReadableBook | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ filename: string; percent: number } | null>(null);
  const [openingBook, setOpeningBook] = useState<string | null>(null);
  const openingLock = useRef(false);
  const [pendingDelete, setPendingDelete] = useState<Book | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const pendingSave = useRef<PendingSave | null>(null);
  const saveFailed = useRef(false);
  const retryQueued = useRef(false);
  const activeBookId = useRef<string | null>(null);
  activeBookId.current = activeBook?.id ?? null;
  const beforeReaderClose = useRef<(() => void) | null>(null);
  const registerBeforeClose = useCallback((flush: (() => void) | null) => { beforeReaderClose.current = flush; }, []);
  const importLock = useRef(false);
  const cancelButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let disposed = false;
    listBooks().then(items => { if (!disposed) setBooks(items); })
      .catch(error => { if (!disposed) setToast(errorMessage(error)); })
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
        setUploadProgress({ filename: file.name, percent: 0 });
        const book = await addBook(file, false, percent => setUploadProgress({ filename: file.name, percent }));
        setBooks(previous => [...previous, book]);
      } catch (error) { failures.push(errorMessage(error)); }
    }
    if (failures.length) setToast(failures.join(' '));
    setUploadProgress(null);
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
        setUploadProgress({ filename, percent: 0 });
        const book = await addBook(new File([await response.blob()], filename), true, percent => setUploadProgress({ filename, percent }));
        setBooks(previous => [...previous, book]);
      }
    } catch (error) { setToast(errorMessage(error)); }
    finally { importLock.current = false; setBusy(false); setUploadProgress(null); }
  }, []);

  const handleOpen = useCallback(async (book: Book) => {
    if (openingLock.current) return;
    openingLock.current = true;
    setOpeningBook(book.filename);
    try {
      await saveQueue.current.catch(() => {});
      // A failed save from a previously closed reader must never replace a
      // newer position fetched from another device when this book reopens.
      pendingSave.current = null;
      saveFailed.current = false;
      const latest = await openBook(book.id);
      if (!latest) throw new Error('This book is no longer in your library.');
      setBooks(previous => previous.map(item => item.id === latest.id ? { ...latest, file: isCloudMode ? null : latest.file } : item));
      setSaveState('saved');
      setActiveBook(latest);
    } catch (error) { setToast(errorMessage(error)); }
    finally { openingLock.current = false; setOpeningBook(null); }
  }, []);

  const enqueueSave = useCallback((request: PendingSave, retry = false) => {
    saveFailed.current = false;
    setSaveState('saving');
    saveQueue.current = saveQueue.current.catch(() => {}).then(async () => {
      if (retry && (pendingSave.current !== request || activeBookId.current !== request.id || document.visibilityState === 'hidden')) return;
      await saveProgress(request.id, request.position, request.progress);
      setBooks(previous => previous.map(book => book.id === request.id ? { ...book, position: request.position, progress: request.progress, lastReadAt: Date.now() } : book));
      if (pendingSave.current === request) {
        pendingSave.current = null;
        setSaveState('saved');
        setToast(current => current === CLOUD_SAVE_ERROR ? null : current);
      }
    }).catch(() => {
      if (pendingSave.current === request) {
        saveFailed.current = true;
        setSaveState('error');
        setToast(isCloudMode ? CLOUD_SAVE_ERROR : 'Your reading position could not be saved. Check that browser storage is available.');
      }
    });
    return saveQueue.current;
  }, []);

  const handleProgress = useCallback((position: ReadingPosition, progress: number) => {
    // Readers emit only actual reading movement, including their final flush.
    if (!activeBook) return;
    const request = { id: activeBook.id, position, progress: Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0)) };
    pendingSave.current = request;
    void enqueueSave(request);
  }, [activeBook, enqueueSave]);

  useEffect(() => {
    if (!isCloudMode || !activeBook) return;
    const retry = () => {
      const request = pendingSave.current;
      if (!saveFailed.current || !request || request.id !== activeBook.id || retryQueued.current || !navigator.onLine || document.visibilityState === 'hidden') return;
      retryQueued.current = true;
      void enqueueSave(request, true).finally(() => { retryQueued.current = false; });
    };
    const timer = window.setInterval(retry, 5000);
    window.addEventListener('online', retry);
    document.addEventListener('visibilitychange', retry);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', retry);
      document.removeEventListener('visibilitychange', retry);
    };
  }, [activeBook, enqueueSave]);

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

  const handleLock = async () => {
    beforeReaderClose.current?.();
    await saveQueue.current.catch(() => {});
    try { await lockLibrary(); }
    catch (error) { setToast(errorMessage(error)); }
  };

  return <>
    {activeBook ? <main className="reader-shell">
      <header className="reader-header">
        <button className="reader-back icon-button" aria-label="Back to library" title="Back to library" onClick={() => { beforeReaderClose.current?.(); setActiveBook(null); }}><ArrowLeft size={20} /></button>
        <div className="reader-heading" title={activeBook.filename}>{activeBook.filename}</div>
        <span className={`reader-status ${saveState === 'error' ? 'save-error' : ''}`} role="status">
          {saveState === 'saving' ? <LoaderCircle size={14} className="spin" /> : null}
          {saveState === 'saving' ? 'Saving…' : ''}
        </span>
      </header>
      <Suspense fallback={<div className="reader-loading" role="status"><LoaderCircle className="spin" size={24} /> Opening your book…</div>}>
        {activeBook.format === 'pdf' ? <PdfReader key={activeBook.id} book={activeBook} onProgress={handleProgress} registerBeforeClose={registerBeforeClose} /> : <EpubReader key={activeBook.id} book={activeBook} onProgress={handleProgress} registerBeforeClose={registerBeforeClose} />}
      </Suspense>
    </main> : <Library books={books} loading={loading} busy={busy} onOpen={handleOpen} onUpload={uploadFiles} onDelete={setPendingDelete} onSamples={loadSamples} cloud={isCloudMode} onLock={authEnabled ? handleLock : undefined} uploadProgress={uploadProgress} />}
    {openingBook && !toast && <div className="app-toast" role="status"><LoaderCircle className="spin" size={18} /><span>Opening {openingBook}…</span></div>}
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
