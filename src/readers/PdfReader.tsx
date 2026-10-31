import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FileWarning, LoaderCircle } from 'lucide-react';
import ReaderToolbar from '../components/ReaderToolbar';
import ReaderFooter from '../components/ReaderFooter';
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { ReaderProps } from '../types';
import { Button } from '@/components/ui/button';

GlobalWorkerOptions.workerSrc = workerUrl;

const GAP = 20;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const finite = (value: number, fallback: number) => (Number.isFinite(value) ? value : fallback);
type Position = { page: number; offset: number };
type Size = { width: number; height: number };
type PageGeometry = Size & { top: number; scale: number };

function errorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'PasswordException')
    return 'This PDF is password protected. Open an unlocked copy to read it here.';
  if (name === 'InvalidPDFException' || name === 'FormatError')
    return 'This PDF is damaged or uses an unsupported format. Try another copy of the file.';
  return 'We could not open this PDF. The file may be damaged or use features this reader does not support.';
}

// Only mounted for pages close to the viewport. Unmounting cancels the task and
// releases its backing store, including when a document closes during rendering.
function PageCanvas({
  pdf,
  number,
  geometry,
  ratio,
}: {
  pdf: PDFDocumentProxy;
  number: number;
  geometry: PageGeometry;
  ratio: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let render: RenderTask | undefined;
    const canvas = canvasRef.current;
    if (!canvas) return;
    setError('');
    const timeout = setTimeout(() => {
      if (cancelled) return;
      cancelled = true;
      render?.cancel();
      setError('This page took too long to render.');
    }, 30_000);
    void (async () => {
      try {
        const page = await pdf.getPage(number);
        if (cancelled) return;
        const viewport = page.getViewport({ scale: geometry.scale });
        const density = Math.min(
          ratio,
          3,
          Math.sqrt(16_000_000 / (viewport.width * viewport.height)),
          16384 / viewport.width,
          16384 / viewport.height,
        );
        canvas.width = Math.max(1, Math.floor(viewport.width * density));
        canvas.height = Math.max(1, Math.floor(viewport.height * density));
        // Keep the sheet white while PDF.js prepares its first rendering chunk.
        const context = canvas.getContext('2d', { alpha: false });
        if (context) {
          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, canvas.width, canvas.height);
        }
        render = page.render({
          canvas,
          viewport,
          transform: [density, 0, 0, density, 0, 0],
          background: '#ffffff',
        });
        await render.promise;
      } catch (cause) {
        if (!cancelled) setError(errorMessage(cause));
      } finally {
        clearTimeout(timeout);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      render?.cancel();
      canvas.width = 0;
      canvas.height = 0;
      // A settled task no longer needs its decoded operators or image resources.
      void pdf
        .getPage(number)
        .then((page) => {
          page.cleanup();
        })
        .catch(() => {});
    };
  }, [pdf, number, geometry.scale, ratio, attempt]);
  return (
    <>
      <canvas
        className="pdf-canvas block size-full"
        ref={canvasRef}
        role="img"
        aria-label={`Page ${number} of ${pdf.numPages}`}
      />
      {error && (
        <div
          className="pdf-page-error absolute inset-0 flex flex-col items-center justify-center bg-white/95 p-4 text-center text-[13px] [&>p]:max-w-[340px] [&>p]:leading-[1.6]"
          role="alert"
        >
          <p>{error}</p>
          <Button
            type="button"
            className="pdf-retry-button"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Try again
          </Button>
        </div>
      )}
    </>
  );
}

export default function PdfReader(props: ReaderProps) {
  return (
    <PdfSession
      key={props.book.id}
      {...props}
    />
  );
}

function PdfSession({ book, onProgress, registerBeforeClose }: ReaderProps) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<Size[]>([]);
  const [error, setError] = useState('');
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pixelRatio, setPixelRatio] = useState(() => window.devicePixelRatio || 1);
  const [page, setPage] = useState(1);
  const [progress, setProgress] = useState(() => clamp(finite(book.progress, 0), 0, 1));
  const [visible, setVisible] = useState({ top: 0, height: 800 });
  const viewportRef = useRef<HTMLDivElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  const callbackRef = useRef(onProgress);
  callbackRef.current = onProgress;
  const saved = book.position?.type === 'pdf' ? book.position : null;
  const anchorRef = useRef<Position>({
    page: Math.max(1, Math.trunc(finite(saved?.page ?? 1, 1))),
    offset: clamp(finite(saved?.offset ?? 0, 0), 0, 1),
  });
  const legacyOffsetRef = useRef(
    saved && saved.layout !== 'continuous' ? clamp(finite(saved.offset, 0), 0, 1) : null,
  );
  const geometryRef = useRef<PageGeometry[]>([]);
  const readyRef = useRef(false);
  const expectedTopRef = useRef(0);
  const dirtyRef = useRef(false);
  const lastSavedRef = useRef<Position | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const geometry = useMemo(() => {
    let top = 0;
    return sizes.map((size) => {
      const scale = width > 0 ? (width * zoom) / size.width : 0;
      const result = { width: size.width * scale, height: size.height * scale, top, scale };
      top += result.height + GAP;
      return result;
    });
  }, [sizes, width, zoom]);

  // Read DOM geometry synchronously so scrollTop changes followed immediately by
  // Home are captured even before the browser delivers a scroll event.
  const readPosition = (): Position | null => {
    const viewport = viewportRef.current;
    const stack = stackRef.current;
    const pages = geometryRef.current;
    if (!viewport || !stack || !readyRef.current || !pages.length) return null;
    const y =
      viewport.getBoundingClientRect().top + viewport.clientTop - stack.getBoundingClientRect().top;
    let low = 0;
    let high = pages.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (pages[middle].top <= y + 0.5) low = middle;
      else high = middle - 1;
    }
    // The gap belongs to the next page, rather than reporting a completed page.
    if (low < pages.length - 1 && y >= pages[low].top + pages[low].height) low += 1;
    return {
      page: low + 1,
      offset: clamp((y - pages[low].top) / Math.max(1, pages[low].height), 0, 1),
    };
  };
  const readingProgress = (position: Position) => {
    const viewport = viewportRef.current;
    const count = geometryRef.current.length;
    if (!count) return 0;
    if (viewport && viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 1)
      return 1;
    return clamp((position.page - 1 + position.offset) / count, 0, 1);
  };
  const observePosition = () => {
    const position = readPosition();
    const viewport = viewportRef.current;
    if (!position || !viewport) return;
    if (Math.abs(viewport.scrollTop - expectedTopRef.current) > 0.5) dirtyRef.current = true;
    expectedTopRef.current = viewport.scrollTop;
    anchorRef.current = position;
    setPage(position.page);
    setProgress(readingProgress(position));
    setVisible({ top: viewport.scrollTop, height: viewport.clientHeight });
  };
  const flush = () => {
    clearTimeout(timerRef.current);
    observePosition();
    if (!readyRef.current || !dirtyRef.current || !geometryRef.current.length) return;
    const position = anchorRef.current;
    const previous = lastSavedRef.current;
    dirtyRef.current = false;
    if (
      previous &&
      previous.page === position.page &&
      Math.abs(previous.offset - position.offset) < 0.00001
    )
      return;
    lastSavedRef.current = { ...position };
    callbackRef.current(
      { type: 'pdf', ...position, layout: 'continuous' },
      readingProgress(position),
    );
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;

  useEffect(() => {
    let cancelled = false;
    let task: ReturnType<typeof getDocument> | undefined;
    const fail = (message: string) => {
      if (cancelled) return;
      cancelled = true;
      setError(message);
      void task?.destroy().catch(() => {});
    };
    const timeout = setTimeout(
      () => fail('This PDF is taking too long to open. Try a smaller file or another copy.'),
      30_000,
    );
    void (async () => {
      try {
        const data = new Uint8Array(await book.file.arrayBuffer());
        if (cancelled) return;
        if (!new TextDecoder('latin1').decode(data.subarray(0, 1024)).includes('%PDF-')) {
          fail('This file does not appear to be a PDF. Choose a valid PDF file.');
          return;
        }
        task = getDocument({ data });
        task.onPassword = () =>
          fail('This PDF is password protected. Open an unlocked copy to read it here.');
        const document = await task.promise;
        if (cancelled) return;
        if (!document.numPages) throw new Error('No pages');
        // Gather exact geometry before restoring. Four workers bound PDF.js
        // requests even for books with thousands of differently sized pages.
        const dimensions = new Array<Size>(document.numPages);
        let next = 1;
        await Promise.all(
          Array.from({ length: Math.min(4, document.numPages) }, async () => {
            while (!cancelled) {
              const number = next++;
              if (number > document.numPages) return;
              const page = await document.getPage(number);
              if (cancelled) return;
              const view = page.getViewport({ scale: 1 });
              if (!(view.width > 0 && view.height > 0)) throw new Error('Invalid page size');
              dimensions[number - 1] = { width: view.width, height: view.height };
              page.cleanup();
            }
          }),
        );
        if (cancelled) return;
        clearTimeout(timeout);
        anchorRef.current.page = clamp(anchorRef.current.page, 1, document.numPages);
        setSizes(dimensions);
        setPdf(document);
      } catch (cause) {
        fail(errorMessage(cause));
      } finally {
        clearTimeout(timeout);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      void task?.destroy().catch(() => {});
    };
  }, [book.file]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const measure = () => {
      // Capture against the previous layout before React changes page heights.
      const position = readPosition();
      if (position) anchorRef.current = position;
      const style = getComputedStyle(viewport);
      setWidth(
        Math.max(
          1,
          viewport.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        ),
      );
      setVisible({ top: viewport.scrollTop, height: viewport.clientHeight });
      setPixelRatio(window.devicePixelRatio || 1);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    window.addEventListener('resize', measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const stack = stackRef.current;
    geometryRef.current = geometry;
    if (!viewport || !stack || !geometry.length || !width) return;
    const anchor = anchorRef.current;
    const current = geometry[clamp(anchor.page - 1, 0, geometry.length - 1)];
    if (legacyOffsetRef.current !== null) {
      const styles = getComputedStyle(viewport);
      const paddingTop = parseFloat(styles.paddingTop);
      const oldRange = Math.max(
        0,
        current.height + paddingTop + parseFloat(styles.paddingBottom) - viewport.clientHeight,
      );
      anchor.offset = clamp(
        (legacyOffsetRef.current * oldRange - paddingTop) / current.height,
        0,
        1,
      );
      legacyOffsetRef.current = null;
    }
    // Include the viewport's padding in the scroll coordinate.
    const stackTop =
      stack.getBoundingClientRect().top -
      viewport.getBoundingClientRect().top -
      viewport.clientTop +
      viewport.scrollTop;
    viewport.scrollTop = stackTop + current.top + current.height * anchor.offset;
    expectedTopRef.current = viewport.scrollTop;
    readyRef.current = true;
    setPage(anchor.page);
    setProgress(readingProgress(anchor));
    setVisible({ top: viewport.scrollTop, height: viewport.clientHeight });
  }, [geometry, width]);

  useEffect(() => {
    const beforeClose = () => flushRef.current();
    registerBeforeClose?.(beforeClose);
    const visibility = () => {
      if (window.document.visibilityState === 'hidden') beforeClose();
    };
    window.document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', beforeClose);
    return () => {
      beforeClose();
      registerBeforeClose?.(null);
      clearTimeout(timerRef.current);
      window.document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', beforeClose);
    };
  }, [registerBeforeClose]);

  const navigate = (number: number) => {
    if (!pdf || !readyRef.current) return;
    const target = clamp(Math.trunc(number), 1, pdf.numPages);
    const viewport = viewportRef.current;
    const stack = stackRef.current;
    if (!viewport || !stack) return;
    const stackTop =
      stack.getBoundingClientRect().top -
      viewport.getBoundingClientRect().top -
      viewport.clientTop +
      viewport.scrollTop;
    viewport.scrollTop = stackTop + geometryRef.current[target - 1].top;
    observePosition();
    // A jump is an explicit navigation, including a jump immediately before Home.
    dirtyRef.current = true;
    flushRef.current();
  };
  const changeZoom = (value: number) => {
    flushRef.current();
    setZoom(clamp(value, 0.25, 3));
  };
  // A hard cap also bounds canvas memory for documents containing tiny pages.
  const nearPages = useMemo(() => {
    if (!geometry.length) return new Set<number>();
    const first = Math.max(0, page - 2);
    const result = new Set<number>();
    for (let index = first; index < geometry.length && result.size < 8; index++) {
      if (geometry[index].top > visible.top + visible.height * 2 && index > page) break;
      result.add(index);
    }
    return result;
  }, [geometry, page, visible]);

  return (
    <section
      className="pdf-reader flex size-full min-h-0 flex-1 flex-col overflow-hidden bg-[#edf1ec] font-sans text-[#29453a]"
      aria-label="PDF reader"
    >
      <ReaderToolbar
        page={page}
        totalPages={pdf?.numPages ?? 0}
        zoom={zoom}
        disabled={!pdf}
        onPageChange={navigate}
        onZoomChange={changeZoom}
      />
      <div className="pdf-stage relative flex min-h-0 flex-1 overflow-hidden">
        <div
          className="pdf-viewport min-w-0 flex-1 [touch-action:pan-x_pan-y_pinch-zoom] [scrollbar-color:#bdcbbf_transparent] overflow-auto overscroll-contain px-[clamp(14px,4vw,64px)] pt-[30px] pb-10 [overflow-anchor:none] max-[600px]:px-3 max-[600px]:pt-4 max-[600px]:pb-6"
          ref={viewportRef}
          tabIndex={0}
          aria-label={`PDF document, page ${page}`}
          onScroll={() => {
            observePosition();
            if (dirtyRef.current) {
              clearTimeout(timerRef.current);
              timerRef.current = setTimeout(() => flushRef.current(), 300);
            }
          }}
        >
          <div
            className="pdf-pages flex min-w-0 flex-col items-center gap-5"
            ref={stackRef}
            style={zoom > 1 ? { width: width * zoom } : undefined}
          >
            {pdf &&
              geometry.map((size, index) => (
                <div
                  className="pdf-page relative shrink-0 bg-white shadow-[0_4px_24px_#233b2c12,0_0_0_1px_#233b2c08]"
                  data-page-number={index + 1}
                  key={index}
                  style={{ width: size.width, height: size.height }}
                >
                  {nearPages.has(index) && (
                    <PageCanvas
                      pdf={pdf}
                      number={index + 1}
                      geometry={size}
                      ratio={pixelRatio}
                    />
                  )}
                </div>
              ))}
          </div>
        </div>
        {!pdf && !error && (
          <div
            className="pdf-status absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#edf1ec]/95 p-8 text-center text-sm text-[#536c5b]"
            role="status"
          >
            <LoaderCircle
              className="animate-spin"
              size={25}
              aria-hidden="true"
            />
            Opening your PDF…
          </div>
        )}
        {error && (
          <div
            className="pdf-status pdf-error absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#edf1ec]/95 p-8 text-center text-sm text-[#536c5b] [&>h2]:text-lg [&>h2]:font-medium [&>h2]:text-primary [&>p]:max-w-[380px] [&>p]:leading-[1.7]"
            role="alert"
          >
            <FileWarning
              size={30}
              strokeWidth={1.5}
            />
            <h2>Unable to display this PDF</h2>
            <p>{error}</p>
          </div>
        )}
      </div>
      <ReaderFooter
        className="pdf-footer"
        label={pdf ? `Page ${page} of ${pdf.numPages}` : 'Preparing your book'}
        percentage={progress * 100}
      />
    </section>
  );
}
