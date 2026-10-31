import { useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { ArrowRight, BookOpen, Check, Leaf, LoaderCircle, LockKeyhole, Plus, Trash2, Upload } from 'lucide-react';
import type { Book, LibraryProps } from '../types';
import './auth-gate.css';

function readableBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function percentage(book: Book) {
  return Math.round(Math.min(1, Math.max(0, book.progress || 0)) * 100);
}

export default function Library({ books, onOpen, onUpload, onDelete, onSamples, busy, loading, cloud = false, onLock, uploadProgress }: LibraryProps) {
  const input = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const sorted = [...books].sort((a, b) => a.filename.localeCompare(b.filename, undefined, { sensitivity: 'base', numeric: true }));
  const recent = [...books].filter(book => book.lastReadAt !== null).sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0))[0];
  const unavailable = loading || busy;
  const uploadPercent = uploadProgress && Number.isFinite(uploadProgress.percent) ? Math.round(Math.min(100, Math.max(0, uploadProgress.percent))) : 0;

  function dragEnter(event: DragEvent<HTMLElement>) {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    dragDepth.current += 1;
    if (!unavailable) setDragging(true);
  }

  function drop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (!unavailable && event.dataTransfer.files.length) onUpload(Array.from(event.dataTransfer.files));
  }

  const addButton = (className = '') => (
    <button className={`button button-primary ${className}`} disabled={unavailable} onClick={() => input.current?.click()}>
      {busy ? <LoaderCircle className="spin" size={17} aria-hidden="true" /> : <Plus size={18} aria-hidden="true" />}
      {busy ? 'Adding books…' : 'Add books'}
    </button>
  );

  return (
    <div className={`library-shell${dragging ? ' is-dragging' : ''}`}
      onDragEnter={dragEnter}
      onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = unavailable ? 'none' : 'copy'; } }}
      onDragLeave={event => { event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); }}
      onDrop={drop}>
      <input ref={input} className="visually-hidden" type="file" accept=".pdf,.epub" multiple disabled={unavailable} tabIndex={-1} aria-label="Choose PDF or EPUB books"
        onChange={event => { const files = Array.from(event.target.files ?? []); if (files.length) onUpload(files); event.target.value = ''; }} />
      <header className="library-header">
        <a className="wordmark" href="./" aria-label="Leafmark home"><span className="brand-icon"><Leaf size={23} strokeWidth={1.7} aria-hidden="true" /></span>Leafmark</a>
        <div className="library-header-actions">{onLock && <button className="icon-button" onClick={onLock} aria-label="Lock library" title="Lock library on this device"><LockKeyhole size={16} strokeWidth={1.6} aria-hidden="true" /></button>}</div>
      </header>

      <main className="library-main" id="main-content">
        <div className="library-intro">
          <div><h1>Your library<span className="heading-period">.</span></h1></div>
          {addButton('intro-add')}
        </div>

        {uploadProgress && <div className="library-upload-progress"><div className="library-upload-label"><span>{uploadProgress.filename}</span><span>{uploadPercent}%</span></div><div className="progress-track" role="progressbar" aria-label={`Uploading ${uploadProgress.filename}`} aria-valuenow={uploadPercent} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${uploadPercent}%` }} /></div></div>}

        {loading ? (
          <section className="library-loading" aria-label="Loading your library" aria-busy="true"><p className="section-label" role="status">Opening your library…</p>{[0, 1, 2].map(index => <div className="skeleton-row" key={index}><span className="skeleton skeleton-badge" /><span className="skeleton skeleton-line" /><span className="skeleton skeleton-short" /></div>)}</section>
        ) : books.length === 0 ? (
          <section className="empty-library" aria-labelledby="empty-title" aria-busy={busy}>
            <div className="empty-art" aria-hidden="true"><span className="art-orbit" /><BookOpen size={66} strokeWidth={1} /><Leaf className="art-leaf" size={27} strokeWidth={1.25} /></div>
            <p className="eyebrow">Make yourself at home</p><h2 id="empty-title">Your next chapter starts here.</h2>
            <p>Add a PDF or EPUB to begin.<br />You can drop your books right here, too.</p>
            <div className="empty-actions">{addButton()}<button className="text-button" onClick={onSamples} disabled={unavailable}>Try sample books <ArrowRight size={15} aria-hidden="true" /></button></div>
            <span className="empty-file-note">PDF & EPUB · {cloud ? 'Cloud library' : 'Stored on this device'}</span>
          </section>
        ) : (
          <>
            {recent && <section className="continue-section" aria-labelledby="continue-title">
              <h2 className="section-label" id="continue-title">Continue reading</h2>
              <div className="continue-card"><div className="continue-icon" aria-hidden="true"><BookOpen size={29} strokeWidth={1.35} /></div>
                <div className="continue-details"><span className="format-caption">{recent.format.toUpperCase()}</span><h3>{recent.filename}</h3><div className="continue-progress"><div className="progress-track" role="progressbar" aria-label={`Reading progress for ${recent.filename}`} aria-valuenow={percentage(recent)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${percentage(recent)}%` }} /></div><span>{percentage(recent)}% read</span></div></div>
                <button className="button button-secondary continue-button" onClick={() => onOpen(recent)}>Continue <ArrowRight size={17} aria-hidden="true" /></button>
              </div>
            </section>}
            <section className="book-section" aria-labelledby="books-title" aria-busy={busy}>
              <div className="list-heading"><h2 className="section-label" id="books-title">All books <span className="book-count">{books.length}</span></h2></div>
              <ul className="book-list">{sorted.map(book => <li className="book-row" key={book.id}>
                <button className="book-open" onClick={() => onOpen(book)} aria-label={`Open ${book.filename}`}>
                  <span className={`format-badge format-${book.format}`}>{book.format.toUpperCase()}</span>
                  <span className="book-info"><span className="book-name">{book.filename}</span><span className="book-size">{readableBytes(book.bytes)}</span></span>
                  <span className={`book-progress${percentage(book) === 100 ? ' is-complete' : ''}`}>{percentage(book) === 100 && <Check size={13} aria-hidden="true" />}{book.lastReadAt !== null || book.progress > 0 ? `${percentage(book)}% read` : 'Not started'}</span>
                  <ArrowRight className="book-open-arrow" size={18} aria-hidden="true" />
                </button>
                <button className="icon-button book-delete" onClick={() => onDelete(book)} disabled={busy} aria-label={`Delete ${book.filename}`} title={`Delete ${book.filename}`}><Trash2 size={17} strokeWidth={1.6} aria-hidden="true" /></button>
              </li>)}</ul>
            </section>
          </>
        )}
        <div className="busy-announcement visually-hidden" role="status" aria-live="polite">{busy ? 'Adding books to your library. Please wait.' : ''}</div>
      </main>
     
      {dragging && <div className="drop-overlay" aria-hidden="true"><div><Upload size={32} strokeWidth={1.4} /><h2>A new chapter.</h2><p>Drop your PDF or EPUB books to add them.</p></div></div>}
    </div>
  );
}
