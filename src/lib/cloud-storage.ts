import { Upload } from 'tus-js-client';
import type { Book, ReadableBook, ReadingPosition } from '../types';
import { ownerId, supabase, supabaseUrl } from './supabase';
import { validateFile } from './file-validation';

const BUCKET = 'books';
const CHUNK_BYTES = 6 * 1024 * 1024;
const COLUMNS =
  'id,owner_id,filename,format,storage_path,byte_size,reading_position,progress,last_read_at,created_at';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type BookRow = {
  id: string;
  owner_id: string;
  filename: string;
  format: 'pdf' | 'epub';
  storage_path: string;
  byte_size: number;
  reading_position: ReadingPosition | null;
  progress: number;
  last_read_at: string | null;
  created_at: string;
};

function failure(action: string, error: { message: string }): Error {
  return new Error(`${action}: ${error.message}`);
}

async function authenticated() {
  if (!supabase || !uuid.test(ownerId)) throw new Error('Cloud storage is not configured.');
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user || user.id !== ownerId)
    throw new Error('Sign in as the library owner to access books.');
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();
  if (sessionError || !session || session.user.id !== ownerId)
    throw new Error('Your session has expired. Please sign in again.');
  return supabase;
}

function metadata(row: BookRow): Book {
  if (
    !uuid.test(row.id) ||
    row.owner_id !== ownerId ||
    !['pdf', 'epub'].includes(row.format) ||
    row.storage_path !== `${ownerId}/${row.id}.${row.format}`
  ) {
    throw new Error('This book has an invalid storage location.');
  }
  return {
    id: row.id,
    filename: row.filename,
    format: row.format,
    bytes: Number(row.byte_size),
    storagePath: row.storage_path,
    createdAt: Date.parse(row.created_at),
    lastReadAt: row.last_read_at ? Date.parse(row.last_read_at) : null,
    position: row.reading_position,
    progress: row.progress,
    file: null,
  };
}

function checkId(id: string) {
  if (!uuid.test(id)) throw new Error('Invalid book identifier.');
}

function checkPosition(position: ReadingPosition) {
  if (position.type === 'pdf') {
    if (
      !Number.isInteger(position.page) ||
      position.page < 1 ||
      !Number.isFinite(position.offset) ||
      position.offset < 0 ||
      position.offset > 1 ||
      (position.layout !== undefined && position.layout !== 'continuous')
    ) {
      throw new Error('Invalid PDF reading position.');
    }
  } else if (position.type === 'epub') {
    if (
      typeof position.cfi !== 'string' ||
      !position.cfi.startsWith('epubcfi(') ||
      !position.cfi.endsWith(')') ||
      position.cfi.length > 8192 ||
      (position.href !== undefined &&
        (typeof position.href !== 'string' || position.href.length > 8192)) ||
      (position.offset !== undefined && !Number.isFinite(position.offset)) ||
      (position.flow !== undefined &&
        position.flow !== 'vertical' &&
        position.flow !== 'horizontal')
    ) {
      throw new Error('Invalid EPUB reading position.');
    }
  } else throw new Error('Invalid reading position.');
}

export async function listBooks(): Promise<Book[]> {
  const client = await authenticated();
  const { data, error } = await client
    .from('books')
    .select(COLUMNS)
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false });
  if (error) throw failure('Could not load your library', error);
  return (data as BookRow[]).map(metadata);
}

function resumableEndpoint() {
  const url = new URL(supabaseUrl);
  if (url.hostname.endsWith('.supabase.co') && !url.hostname.endsWith('.storage.supabase.co')) {
    url.hostname = url.hostname.replace('.supabase.co', '.storage.supabase.co');
  }
  url.pathname = '/storage/v1/upload/resumable';
  url.search = '';
  url.hash = '';
  return url.toString();
}

async function resumableUpload(
  file: Blob,
  path: string,
  contentType: string,
  onProgress?: (percent: number) => void,
) {
  const client = await authenticated();
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let refreshRequired = false;
    const cleanup = () => {
      clearTimeout(deadline);
      window.removeEventListener('pagehide', cancel);
      subscription.unsubscribe();
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      // abort() alone does not settle tus callbacks. Reject explicitly first.
      reject(error);
      void upload.abort().catch(() => undefined);
    };
    const cancel = () => fail(new Error('Upload cancelled. Please try again.'));
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, session) => {
      if (!session || session.user.id !== ownerId) cancel();
    });
    const deadline = setTimeout(
      () => fail(new Error('Upload timed out. Please try again.')),
      10 * 60 * 1000,
    );
    const upload = new Upload(file, {
      endpoint: resumableEndpoint(),
      chunkSize: CHUNK_BYTES,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      uploadDataDuringCreation: true,
      // Never persist upload URLs or credentials in another local cache.
      storeFingerprintForResuming: false,
      removeFingerprintOnSuccess: true,
      metadata: { bucketName: BUCKET, objectName: path, contentType, cacheControl: '3600' },
      onBeforeRequest: async (request) => {
        try {
          if (settled) throw new Error('Upload cancelled.');
          if (refreshRequired) {
            refreshRequired = false;
            const { error } = await client.auth.refreshSession();
            if (error) throw new Error('Your session has expired. Please sign in again.');
          }
          const {
            data: { session },
            error,
          } = await client.auth.getSession();
          if (error || !session || session.user.id !== ownerId)
            throw new Error('Your session has expired. Please sign in again.');
          if (settled) throw new Error('Upload cancelled.');
          request.setHeader('authorization', `Bearer ${session.access_token}`);
          const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
          if (key) request.setHeader('apikey', key);
          // tus uses XHR in the browser. Bound stalled requests as well as retries.
          const xhr = request.getUnderlyingObject();
          if (xhr instanceof XMLHttpRequest) xhr.timeout = 60_000;
        } catch (error) {
          fail(error instanceof Error ? error : new Error('Upload authentication failed.'));
          throw error;
        }
      },
      onAfterResponse: (_request, response) => {
        if (response.getStatus() === 401) refreshRequired = true;
      },
      onShouldRetry: (error) => {
        const status = error.originalResponse?.getStatus() ?? 0;
        return (
          !settled &&
          (status === 0 ||
            status === 401 ||
            status === 408 ||
            status === 423 ||
            status === 429 ||
            status >= 500)
        );
      },
      onProgress: (sent, total) => {
        if (!settled) onProgress?.(Math.min(99, total ? (sent / total) * 100 : 0));
      },
      onError: () =>
        fail(new Error('Could not upload the book. Check your connection and try again.')),
      onSuccess: () => {
        if (!settled) {
          settled = true;
          cleanup();
          resolve();
        }
      },
    });
    window.addEventListener('pagehide', cancel);
    try {
      upload.start();
    } catch (error) {
      fail(error instanceof Error ? error : new Error('Could not start upload.'));
    }
  });
}

export async function addBook(
  file: File,
  _sample = false,
  onProgress?: (percent: number) => void,
): Promise<Book> {
  const format = await validateFile(file);
  const client = await authenticated();
  const id = crypto.randomUUID();
  const path = `${ownerId}/${id}.${format}`;
  const contentType = format === 'pdf' ? 'application/pdf' : 'application/epub+zip';
  const body = new Blob([file], { type: contentType });
  onProgress?.(0);
  if (body.size > CHUNK_BYTES) await resumableUpload(body, path, contentType, onProgress);
  else {
    const { error } = await client.storage
      .from(BUCKET)
      .upload(path, body, { contentType, upsert: false });
    if (error) throw failure('Could not upload the book', error);
  }
  let book: Book;
  try {
    await authenticated();
    const { data, error } = await client
      .from('books')
      .insert({
        id,
        owner_id: ownerId,
        filename: file.name,
        format,
        storage_path: path,
        byte_size: file.size,
        reading_position: null,
        progress: 0,
        last_read_at: null,
      })
      .select(COLUMNS)
      .single();
    if (error) throw failure('Could not save the uploaded book', error);
    book = metadata(data as BookRow);
  } catch (error) {
    const { error: cleanupError } = await client.storage.from(BUCKET).remove([path]);
    if (cleanupError)
      throw new Error(
        'Could not save the book or remove its uploaded file. Please retry after signing in.',
      );
    throw error;
  }
  onProgress?.(100);
  return book;
}

export async function openBook(id: string): Promise<ReadableBook | undefined> {
  checkId(id);
  const client = await authenticated();
  const { data, error } = await client
    .from('books')
    .select(COLUMNS)
    .eq('id', id)
    .eq('owner_id', ownerId)
    .maybeSingle();
  if (error) throw failure('Could not load the book', error);
  if (!data) return undefined;
  const book = metadata(data as BookRow);
  const { data: file, error: downloadError } = await client.storage
    .from(BUCKET)
    .download(book.storagePath!);
  if (downloadError) throw failure('Could not download the book', downloadError);
  const lastReadAt = Date.now();
  const { data: touched, error: touchError } = await client
    .from('books')
    .update({ last_read_at: new Date(lastReadAt).toISOString() })
    .eq('id', id)
    .eq('owner_id', ownerId)
    .select('id')
    .maybeSingle();
  if (touchError) throw failure('Could not record when the book was opened', touchError);
  if (!touched) throw new Error('This book was removed while it was opening.');
  return { ...book, file, lastReadAt };
}

export async function saveProgress(
  id: string,
  position: ReadingPosition,
  progress: number,
): Promise<void> {
  checkId(id);
  checkPosition(position);
  const client = await authenticated();
  const { data, error } = await client
    .from('books')
    .update({
      reading_position: position,
      progress: Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0)),
      last_read_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('owner_id', ownerId)
    .select('id')
    .maybeSingle();
  if (error) throw failure('Could not save reading progress', error);
  if (!data)
    throw new Error(
      'Could not save reading progress because this book is no longer in your library.',
    );
}

export async function deleteBook(id: string): Promise<void> {
  checkId(id);
  const client = await authenticated();
  const { data, error } = await client
    .from('books')
    .select(COLUMNS)
    .eq('id', id)
    .eq('owner_id', ownerId)
    .maybeSingle();
  if (error) throw failure('Could not find the book to delete', error);
  if (!data) return;
  const book = metadata(data as BookRow);
  const { error: storageError } = await client.storage.from(BUCKET).remove([book.storagePath!]);
  // Storage normally treats removal of an absent object as success.
  if (
    storageError &&
    !['404', 'NoSuchKey', 'NoSuchObject', 'not_found'].includes(String(storageError.statusCode))
  ) {
    throw failure('Could not delete the book file', storageError);
  }
  const { error: deleteError } = await client
    .from('books')
    .delete()
    .eq('id', id)
    .eq('owner_id', ownerId);
  if (deleteError)
    throw failure(
      'The file was removed, but its library entry could not be deleted. Please retry',
      deleteError,
    );
}
