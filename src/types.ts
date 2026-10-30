export type ReadingPosition =
  | { type: 'pdf'; page: number; offset: number; layout?: 'continuous' }
  | { type: 'epub'; cfi: string; href?: string; offset?: number; flow?: 'vertical' | 'horizontal' };

export interface Book {
  id: string;
  filename: string;
  format: 'pdf' | 'epub';
  bytes: number;
  createdAt: number;
  lastReadAt: number | null;
  position: ReadingPosition | null;
  progress: number;
  file: Blob;
  sample?: boolean;
}

export interface ReaderProps {
  book: Book;
  onProgress: (position: ReadingPosition, progress: number) => void;
  registerBeforeClose?: (flush: (() => void) | null) => void;
}

export interface LibraryProps {
  books: Book[];
  onOpen: (book: Book) => void;
  onUpload: (files: File[]) => void;
  onDelete: (book: Book) => void;
  onSamples: () => void;
  busy: boolean;
  loading: boolean;
}
