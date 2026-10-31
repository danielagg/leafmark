import { openDB, type DBSchema } from 'idb';
import type { Book, ReadableBook, ReadingPosition } from '../types';
import { validateFile } from './file-validation';
import { validateTitle } from './book-title';
import { generateThumbnail } from './generate-thumbnail';

interface LibraryDatabase extends DBSchema {
  books: { key: string; value: Book };
}
const database = () =>
  openDB<LibraryDatabase>('leafmark-library', 1, {
    upgrade(db) {
      db.createObjectStore('books', { keyPath: 'id' });
    },
  });

export async function listBooks(): Promise<Book[]> {
  return (await database()).getAll('books');
}

export async function addBook(
  file: File,
  sample = false,
  onProgress?: (percent: number) => void,
): Promise<Book> {
  const format = await validateFile(file);
  onProgress?.(0);
  const book: Book = {
    id: crypto.randomUUID(),
    filename: file.name,
    thumbnail: await generateThumbnail(file, format),
    format,
    bytes: file.size,
    createdAt: Date.now(),
    lastReadAt: null,
    position: null,
    progress: 0,
    file: new Blob([file], { type: format === 'pdf' ? 'application/pdf' : 'application/epub+zip' }),
    sample,
  };
  await (await database()).add('books', book);
  onProgress?.(100);
  return book;
}

export async function openBook(id: string): Promise<ReadableBook | undefined> {
  const db = await database();
  const tx = db.transaction('books', 'readwrite');
  const book = await tx.store.get(id);
  if (book && !book.file) throw new Error('This local book has no file. Please import it again.');
  if (book) {
    book.lastReadAt = Date.now();
    await tx.store.put(book);
  }
  await tx.done;
  return book as ReadableBook | undefined;
}

export async function saveProgress(
  id: string,
  position: ReadingPosition,
  progress: number,
): Promise<void> {
  const db = await database();
  const tx = db.transaction('books', 'readwrite');
  const book = await tx.store.get(id);
  if (book) {
    book.position = position;
    book.progress = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
    book.lastReadAt = Date.now();
    await tx.store.put(book);
  }
  await tx.done;
}

export async function deleteBook(id: string): Promise<void> {
  await (await database()).delete('books', id);
}

export async function renameBook(id: string, value: string): Promise<void> {
  const title = validateTitle(value);
  const db = await database();
  const tx = db.transaction('books', 'readwrite');
  const book = await tx.store.get(id);
  if (book) await tx.store.put({ ...book, title });
  await tx.done;
  if (!book) throw new Error('This book is no longer in your library.');
}

export async function getBookFile(book: Book): Promise<Blob> {
  if (!book.file) throw new Error('This book has no local file.');
  return book.file;
}

export async function saveThumbnail(id: string, thumbnail: string): Promise<void> {
  const db = await database();
  const tx = db.transaction('books', 'readwrite');
  const book = await tx.store.get(id);
  if (book) await tx.store.put({ ...book, thumbnail });
  await tx.done;
}
