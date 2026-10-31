import type { Book } from '../types';

export const MAX_TITLE_LENGTH = 1024;

export function bookTitle(book: Book): string {
  return book.title || book.filename;
}

export function validateTitle(value: string): string {
  const title = value.trim();
  if (!title) throw new Error('Enter a title for this book.');
  if (title.length > MAX_TITLE_LENGTH)
    throw new Error(`Keep the title under ${MAX_TITLE_LENGTH + 1} characters.`);
  return title;
}
