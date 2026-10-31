import { useRef, useState } from 'react';
import type { DragEvent } from 'react';
import {
  ArrowRight,
  BookOpen,
  Check,
  Leaf,
  LoaderCircle,
  LockKeyhole,
  Pencil,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import type { Book, LibraryProps } from '@/types';
import { cn } from '@/lib/utils';
import { bookTitle } from '@/lib/book-title';
import Brand from '@/components/Brand';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

function readableBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function percentage(book: Book) {
  return Math.round(Math.min(1, Math.max(0, book.progress || 0)) * 100);
}

export default function Library({
  books,
  onOpen,
  onUpload,
  onDelete,
  onRename,
  onSamples,
  busy,
  loading,
  cloud = false,
  onLock,
  uploadProgress,
}: LibraryProps) {
  const input = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const sorted = [...books].sort((a, b) =>
    bookTitle(a).localeCompare(bookTitle(b), undefined, { sensitivity: 'base', numeric: true }),
  );
  const recent = [...books]
    .filter((book) => book.lastReadAt !== null)
    .sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0))[0];
  const unavailable = loading || busy;
  const uploadPercent =
    uploadProgress && Number.isFinite(uploadProgress.percent)
      ? Math.round(Math.min(100, Math.max(0, uploadProgress.percent)))
      : 0;

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
    if (!unavailable && event.dataTransfer.files.length)
      onUpload(Array.from(event.dataTransfer.files));
  }

  const addButton = (className?: string) => (
    <Button
      className={className}
      disabled={unavailable}
      onClick={() => input.current?.click()}
    >
      {busy ? (
        <LoaderCircle
          className="animate-spin"
          size={17}
          aria-hidden="true"
        />
      ) : (
        <Plus
          size={18}
          aria-hidden="true"
        />
      )}
      {busy ? 'Adding books…' : 'Add books'}
    </Button>
  );

  return (
    <div
      className="library-shell flex min-h-dvh flex-col"
      onDragEnter={dragEnter}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault();
          event.dataTransfer.dropEffect = unavailable ? 'none' : 'copy';
        }
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragging(false);
      }}
      onDrop={drop}
    >
      <input
        ref={input}
        className="sr-only"
        type="file"
        accept=".pdf,.epub"
        multiple
        disabled={unavailable}
        tabIndex={-1}
        aria-label="Choose PDF or EPUB books"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length) onUpload(files);
          event.target.value = '';
        }}
      />
      <header className="mx-auto flex min-h-[104px] w-[min(1200px,calc(100%-96px))] items-center justify-between gap-5 border-b max-[760px]:min-h-[84px] max-[760px]:w-[calc(100%-48px)] max-[520px]:w-[calc(100%-40px)]">
        <Brand />
        {onLock && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onLock}
            aria-label="Lock library"
            title="Lock library on this device"
            className="text-muted-foreground"
          >
            <LockKeyhole
              size={16}
              strokeWidth={1.6}
              aria-hidden="true"
            />
          </Button>
        )}
      </header>

      <main
        id="main-content"
        className={cn(
          'mx-auto w-[min(960px,calc(100%-96px))] flex-1 pt-[72px] pb-16 min-[1500px]:pt-[88px]',
          'max-[760px]:w-[calc(100%-48px)] max-[760px]:pt-[46px] max-[760px]:pb-11 max-[520px]:w-[calc(100%-40px)] max-[520px]:pt-9',
        )}
      >
        <div className="mb-[52px] flex items-center justify-between gap-8 max-[760px]:mb-[38px] max-[760px]:items-start max-[760px]:gap-5 max-[520px]:block">
          <h1 className="mb-[17px] font-serif text-[clamp(42px,5vw,57px)] leading-[1.15] font-normal tracking-[-2.2px] max-[520px]:text-[45px]">
            Your library<span className="text-primary">.</span>
          </h1>
          {addButton('max-[760px]:mt-[30px] max-[520px]:mt-[23px]')}
        </div>

        {uploadProgress && (
          <div className="-mt-6 mb-8 rounded-md border bg-[#fafbf8] px-4 py-3.5">
            <div className="mb-2.5 flex items-baseline justify-between gap-4 text-[11px] text-muted-foreground">
              <span className="min-w-0 [overflow-wrap:anywhere]">{uploadProgress.filename}</span>
              <span className="shrink-0">{uploadPercent}%</span>
            </div>
            <Progress
              value={uploadPercent}
              aria-label={`Uploading ${uploadProgress.filename}`}
              className="h-[3px]"
            />
          </div>
        )}

        {loading ? (
          <section
            className="pt-2.5"
            aria-label="Loading your library"
            aria-busy="true"
          >
            <p
              className="mb-5 text-[11px] font-medium text-muted-foreground"
              role="status"
            >
              Opening your library…
            </p>
            {[0, 1, 2].map((index) => (
              <div
                className="flex min-h-[94px] items-center gap-6 border-t"
                key={index}
              >
                <span className="block h-[52px] w-11 animate-breathe rounded bg-border" />
                <span className="block h-[13px] w-[45%] animate-breathe rounded bg-border" />
                <span className="ml-auto block h-2.5 w-[70px] animate-breathe rounded bg-border" />
              </div>
            ))}
          </section>
        ) : books.length === 0 ? (
          <section
            className="rounded-[10px] border border-dashed bg-[#fafbf8] px-6 pt-[42px] pb-12 text-center max-[520px]:px-4 max-[520px]:pt-[30px] max-[520px]:pb-[35px]"
            aria-labelledby="empty-title"
            aria-busy={busy}
          >
            <div
              className="relative mx-auto mb-[25px] grid h-[120px] w-[126px] place-items-center text-[#658266]"
              aria-hidden="true"
            >
              <span className="absolute size-[108px] rounded-full bg-[#edf2e7]" />
              <BookOpen
                className="relative"
                size={66}
                strokeWidth={1}
              />
              <Leaf
                className="absolute top-4 right-[9px] rotate-20 rounded-full bg-[#fafbf8]"
                size={27}
                strokeWidth={1.25}
              />
            </div>
            <p className="mb-3.5 text-[10px] font-semibold tracking-[1.8px] text-[#6c7c6d] uppercase">
              Make yourself at home
            </p>
            <h2
              id="empty-title"
              className="mb-[15px] font-serif text-[clamp(24px,3vw,31px)] leading-[1.35] font-normal tracking-[-.8px]"
            >
              Your next chapter starts here.
            </h2>
            <p className="mb-6 text-[13px] leading-[1.85] text-muted-foreground">
              Add a PDF or EPUB to begin.
              <br />
              You can drop your books right here, too.
            </p>
            <div className="flex flex-col items-center gap-1.5">
              {addButton('max-[520px]:w-[min(100%,210px)]')}
              <Button
                variant="link"
                onClick={onSamples}
                disabled={unavailable}
                className="text-xs font-normal"
              >
                Try sample books
                <ArrowRight
                  size={15}
                  aria-hidden="true"
                />
              </Button>
            </div>
            <span className="mt-[23px] block text-[10px] text-muted-foreground">
              PDF & EPUB · {cloud ? 'Cloud library' : 'Stored on this device'}
            </span>
          </section>
        ) : (
          <>
            {recent && (
              <section
                className="mb-11 max-[760px]:mb-[34px]"
                aria-labelledby="continue-title"
              >
                <h2
                  className="mb-[15px] text-[11px] font-medium text-muted-foreground"
                  id="continue-title"
                >
                  Continue reading
                </h2>
                <Card
                  className={cn(
                    'flex-row items-center gap-[23px] rounded-lg bg-secondary px-7 py-[27px] shadow-none',
                    'max-[760px]:flex-wrap max-[760px]:gap-4 max-[760px]:p-[22px] max-[520px]:gap-[13px] max-[520px]:p-[18px]',
                  )}
                >
                  <div
                    className="grid min-h-[82px] w-[67px] shrink-0 place-items-center self-stretch rounded-[5px] border-[#d4decd] bg-[#e6ecdf] text-[#56765a] max-[760px]:min-h-[76px] max-[760px]:w-[55px] max-[520px]:w-[43px]"
                    aria-hidden="true"
                  >
                    <BookOpen
                      size={29}
                      strokeWidth={1.35}
                    />
                  </div>
                  <div className="min-w-0 flex-1 max-[760px]:basis-[calc(100%-80px)] max-[520px]:basis-[calc(100%-62px)]">
                    <span className="text-[9px] font-semibold tracking-[1.4px] text-[#77836e]">
                      {recent.format.toUpperCase()}
                    </span>
                    <h3 className="mt-2 mb-3.5 text-[17px] leading-[1.45] font-medium [overflow-wrap:anywhere] max-[520px]:text-sm">
                      {bookTitle(recent)}
                    </h3>
                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                      <Progress
                        value={percentage(recent)}
                        aria-label={`Reading progress for ${bookTitle(recent)}`}
                        className="h-[3px] w-[132px] max-w-1/2"
                      />
                      <span>{percentage(recent)}% read</span>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => onOpen(recent)}
                    className="max-[760px]:ml-[71px] max-[520px]:ml-14"
                  >
                    Continue
                    <ArrowRight
                      size={17}
                      aria-hidden="true"
                    />
                  </Button>
                </Card>
              </section>
            )}
            <section
              aria-labelledby="books-title"
              aria-busy={busy}
            >
              <div className="flex items-center justify-between gap-4 pb-[18px]">
                <h2
                  className="flex items-center gap-2.5 text-[11px] font-medium text-muted-foreground"
                  id="books-title"
                >
                  All books
                  <span className="inline-grid h-[21px] min-w-[21px] place-items-center rounded bg-[#e9eee4] px-1.5 text-[10px] text-[#71816c]">
                    {books.length}
                  </span>
                </h2>
              </div>
              <ul className="m-0 list-none border-t p-0">
                {sorted.map((book) => (
                  <li
                    className="flex items-center gap-2 border-b pr-[5px] hover:bg-[#f0f3ed] max-[520px]:gap-[3px] max-[520px]:pr-0"
                    key={book.id}
                  >
                    <Button
                      variant="ghost"
                      className={cn(
                        'h-auto min-h-[94px] min-w-0 flex-1 shrink gap-[21px] rounded-none border-0 bg-transparent py-5 pr-2.5 pl-0.5 text-left whitespace-normal hover:bg-transparent',
                        'max-[760px]:gap-3.5 max-[520px]:grid max-[520px]:grid-cols-[37px_minmax(0,1fr)] max-[520px]:gap-x-3 max-[520px]:gap-y-px max-[520px]:px-0 max-[520px]:py-[17px]',
                      )}
                      onClick={() => onOpen(book)}
                      aria-label={`Open ${bookTitle(book)}`}
                    >
                      <span
                        className={cn(
                          'grid h-[52px] w-11 shrink-0 place-items-center rounded-[4px_9px_4px_4px] border bg-card text-[9px] font-semibold tracking-[.6px] text-[#7d7c6c]',
                          'max-[520px]:row-span-2 max-[520px]:h-[47px] max-[520px]:w-[37px] max-[520px]:text-[8px]',
                          book.format === 'epub' && 'border-[#dbe4d5] bg-[#eff3eb] text-[#52735c]',
                        )}
                      >
                        {book.format.toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] leading-[1.6] font-medium [overflow-wrap:anywhere] max-[520px]:text-xs">
                          {bookTitle(book)}
                        </span>
                        <span className="mt-[5px] block text-[11px] font-normal text-muted-foreground max-[520px]:mt-0.5 max-[520px]:text-[10px]">
                          {readableBytes(book.bytes)}
                        </span>
                      </span>
                      <span
                        className={cn(
                          'inline-flex min-w-[82px] shrink-0 items-center gap-[5px] text-[11px] font-normal text-muted-foreground',
                          'max-[760px]:min-w-[68px] max-[760px]:text-[10px] max-[520px]:col-start-2 max-[520px]:mt-1',
                          percentage(book) === 100 && 'text-primary',
                        )}
                      >
                        {percentage(book) === 100 && (
                          <Check
                            size={13}
                            aria-hidden="true"
                          />
                        )}
                        {book.lastReadAt !== null || book.progress > 0
                          ? `${percentage(book)}% read`
                          : 'Not started'}
                      </span>
                      <ArrowRight
                        className="ml-3 shrink-0 text-[#879181] max-[760px]:hidden"
                        size={18}
                        aria-hidden="true"
                      />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-[#8c9386] hover:text-primary"
                      onClick={() => onRename(book)}
                      disabled={busy}
                      aria-label={`Rename ${bookTitle(book)}`}
                      title={`Rename ${bookTitle(book)}`}
                    >
                      <Pencil
                        size={16}
                        strokeWidth={1.6}
                        aria-hidden="true"
                      />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-[#8c9386] hover:bg-[#f5e9e4] hover:text-destructive"
                      onClick={() => onDelete(book)}
                      disabled={busy}
                      aria-label={`Delete ${bookTitle(book)}`}
                      title={`Delete ${bookTitle(book)}`}
                    >
                      <Trash2
                        size={17}
                        strokeWidth={1.6}
                        aria-hidden="true"
                      />
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
        <div
          className="sr-only"
          role="status"
          aria-live="polite"
        >
          {busy ? 'Adding books to your library. Please wait.' : ''}
        </div>
      </main>

      {dragging && (
        <div
          className="pointer-events-none fixed inset-4 z-100 grid place-items-center rounded-xl border-2 border-dashed border-[#88a483] bg-[#f1f6ec]/95 p-6 text-center text-primary"
          aria-hidden="true"
        >
          <div>
            <Upload
              size={32}
              strokeWidth={1.4}
              className="mx-auto"
            />
            <h2 className="mt-[22px] mb-3 font-serif text-4xl font-normal">A new chapter.</h2>
            <p className="text-sm">Drop your PDF or EPUB books to add them.</p>
          </div>
        </div>
      )}
    </div>
  );
}
