import { openDB, type DBSchema } from 'idb';
import type { Book, ReadingPosition } from '../types';

interface LibraryDatabase extends DBSchema {
  books: { key: string; value: Book };
}
const database = () => openDB<LibraryDatabase>('leafmark-library', 1, {
  upgrade(db) { db.createObjectStore('books', { keyPath: 'id' }); },
});

export const MAX_FILE_BYTES = 50 * 1024 * 1024;

export async function validateFile(file: File): Promise<'pdf' | 'epub'> {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension !== 'pdf' && extension !== 'epub') throw new Error(`“${file.name}” isn't a PDF or EPUB. Choose a .pdf or .epub file.`);
  if (!file.size) throw new Error(`“${file.name}” is empty.`);
  if (file.size > MAX_FILE_BYTES) throw new Error(`“${file.name}” is too large. Choose a file under 50 MB.`);
  const header = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  if (extension === 'pdf' && !new TextDecoder('latin1').decode(header).includes('%PDF-')) {
    throw new Error(`“${file.name}” doesn't appear to be a PDF. Try another file.`);
  }
  if (extension === 'epub' && !(header[0] === 0x50 && header[1] === 0x4b && header[2] === 0x03 && header[3] === 0x04)) {
    throw new Error(`“${file.name}” doesn't appear to be an EPUB. Try another file.`);
  }
  return extension;
}

export async function listBooks(): Promise<Book[]> {
  return (await database()).getAll('books');
}

export async function addBook(file: File, sample = false): Promise<Book> {
  const format = await validateFile(file);
  const book: Book = {
    id: crypto.randomUUID(), filename: file.name, format, bytes: file.size,
    createdAt: Date.now(), lastReadAt: null, position: null, progress: 0,
    file: new Blob([file], { type: format === 'pdf' ? 'application/pdf' : 'application/epub+zip' }), sample,
  };
  await (await database()).add('books', book);
  return book;
}

export async function openBook(id: string): Promise<Book | undefined> {
  const db = await database();
  const tx = db.transaction('books', 'readwrite');
  const book = await tx.store.get(id);
  if (book) { book.lastReadAt = Date.now(); await tx.store.put(book); }
  await tx.done;
  return book;
}

export async function saveProgress(id: string, position: ReadingPosition, progress: number): Promise<void> {
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
