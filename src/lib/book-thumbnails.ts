import type { Book } from '../types';
import { getBookFile, saveThumbnail } from './storage';
import { generateThumbnail } from './generate-thumbnail';

const pending = new Map<string, Promise<string>>();
let queue: Promise<unknown> = Promise.resolve();

export function bookThumbnail(book: Book): Promise<string> {
  if (book.thumbnail !== undefined) return Promise.resolve(book.thumbnail);
  const existing = pending.get(book.id);
  if (existing) return existing;
  const work = queue
    .catch(() => {})
    .then(async () => {
      const thumbnail = await generateThumbnail(await getBookFile(book), book.format);
      // Preview failures must never prevent a book from opening.
      await saveThumbnail(book.id, thumbnail).catch(() => {});
      return thumbnail;
    });
  pending.set(book.id, work);
  queue = work;
  void work.catch(() => pending.delete(book.id));
  return work;
}
