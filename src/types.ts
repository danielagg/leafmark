export type EpubTheme = 'white' | 'sepia' | 'black';

export type ReadingPosition =
  | { type: 'pdf'; page: number; offset: number; layout?: 'continuous' }
  | { type: 'epub'; cfi: string; href?: string; offset?: number; flow?: 'vertical' | 'horizontal' };

export interface Book {
  id: string;
  filename: string;
  title?: string;
  format: 'pdf' | 'epub';
  bytes: number;
  createdAt: number;
  lastReadAt: number | null;
  position: ReadingPosition | null;
  progress: number;
  file: Blob | null;
  storagePath?: string;
  sample?: boolean;
}

export type ReadableBook = Book & { file: Blob };

export interface ReaderProps {
  book: ReadableBook;
  onProgress: (position: ReadingPosition, progress: number) => void;
  registerBeforeClose?: (flush: (() => void) | null) => void;
}

export interface LibraryProps {
  books: Book[];
  onOpen: (book: Book) => void;
  onUpload: (files: File[]) => void;
  onDelete: (book: Book) => void;
  onRename: (book: Book) => void;
  onSamples: () => void;
  busy: boolean;
  loading: boolean;
  cloud?: boolean;
  onLock?: () => void;
  uploadProgress?: { filename: string; percent: number } | null;
}
