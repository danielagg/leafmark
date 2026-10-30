import { isCloudMode } from './supabase';
import * as local from './local-storage';
import * as cloud from './cloud-storage';

export { MAX_FILE_BYTES, validateFile } from './file-validation';

// Local persistence must be explicitly enabled in a development build.
const storage = isCloudMode ? cloud : local;
export const listBooks = storage.listBooks;
export const addBook = storage.addBook;
export const openBook = storage.openBook;
export const saveProgress = storage.saveProgress;
export const deleteBook = storage.deleteBook;
