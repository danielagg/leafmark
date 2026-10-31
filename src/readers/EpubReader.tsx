import { useEffect, useRef, useState } from 'react';
import ePub from 'epubjs';
import type { Book as EpubBook, Contents, Location, NavItem, Rendition } from 'epubjs';
import { BookOpen, RotateCcw } from 'lucide-react';
import loraFont from '@fontsource/lora/files/lora-latin-400-normal.woff2?url';
import loraBoldFont from '@fontsource/lora/files/lora-latin-700-normal.woff2?url';
import loraItalicFont from '@fontsource/lora/files/lora-latin-400-italic.woff2?url';
import type { EpubTheme, ReaderProps } from '../types';
import ReaderToolbar from '../components/ReaderToolbar';
import ReaderFooter from '../components/ReaderFooter';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import './epub-reader.css';
import epubContentStyles from './epub-content.css?inline';

function bounded<T>(promise: PromiseLike<T>, milliseconds = 15000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error('This EPUB took too long to open.')),
      milliseconds,
    );
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
type ReadingMode = 'vertical' | 'horizontal';
const modePreference = 'leafmark-epub-reading-mode';
const themePreference = 'leafmark-epub-theme';

function applyTheme(doc: Document, theme: EpubTheme) {
  doc.documentElement.dataset.leafmarkTheme = theme;
}
const clamp = (value: number) => Math.max(0, Math.min(1, value));
function flatten(items: NavItem[]): NavItem[] {
  return items.flatMap((item) => [item, ...flatten(item.subitems || [])]);
}

// epubjs's declaration incorrectly describes currentLocation as a single endpoint.
// The default and continuous managers return the complete Location synchronously.
function currentLocation(rendition: Rendition): Location | undefined {
  const location = rendition.currentLocation() as unknown as Location | undefined;
  return location?.start?.cfi ? location : undefined;
}

export default function EpubReader({ book, onProgress, registerBeforeClose }: ReaderProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const progressCallback = useRef(onProgress);
  progressCallback.current = onProgress;
  const savedPosition = useRef(book.position);
  const [mode, setMode] = useState<ReadingMode>(() => {
    try {
      if (localStorage.getItem(modePreference) === 'horizontal') return 'horizontal';
    } catch {
      /* Storage can be unavailable. */
    }
    return 'vertical';
  });
  const modeRef = useRef(mode);
  const [theme, setTheme] = useState<EpubTheme>(() => {
    try {
      const saved = localStorage.getItem(themePreference);
      if (saved === 'white' || saved === 'sepia' || saved === 'black') return saved;
      if (saved === 'dark') return 'black';
    } catch {
      /* Optional device preference. */
    }
    return 'white';
  });
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const [pageFrames, setPageFrames] = useState<{ left: number; width: number }[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [chapter, setChapter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [transitioning, setTransitioning] = useState(false);
  const controls = useRef<{
    page: (page: number) => void;
    zoom: (zoom: number) => void;
    mode: (mode: ReadingMode) => void;
  } | null>(null);
  const [sectionLabel, setSectionLabel] = useState('');
  const [percentage, setPercentage] = useState(Math.round(book.progress * 100));

  useEffect(() => {
    try {
      localStorage.setItem(themePreference, theme);
    } catch {
      /* Reading still works without local storage. */
    }
    viewport.current?.querySelectorAll('iframe').forEach((iframe) => {
      if (iframe.contentDocument) applyTheme(iframe.contentDocument, theme);
    });
  }, [theme]);

  useEffect(() => {
    const host = viewport.current;
    if (!host) return;
    let cancelled = false;
    let restored = false;
    let navigating = false;
    let turningSpread = false;
    let dirty = false;
    let baselineScroll = 0;
    let fingerprint = '';
    let publication: EpubBook | undefined;
    let rendition: Rendition | undefined;
    let scroller: HTMLElement | null = null;
    let opening: Promise<unknown> | undefined;
    let generation: Promise<unknown> | undefined;
    let stopGenerating: (() => void) | undefined;
    let locationsReady = false;
    let currentZoom = 1;
    let currentMode = modeRef.current;
    let verticalAnchor: { cfi: string; offset: number } | undefined;
    let horizontalMoved = false;
    let wheelTotal = 0;
    let lastWheel = 0;
    let wheelDirection = 0;
    let wheelGestureConsumed = false;
    let touchStart: { x: number; y: number } | undefined;
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let resizeFrame = 0;
    let spineCount = 1;
    let toc: NavItem[] = [];
    const documents = new Map<
      Document,
      { cleanup: () => void; ready: Promise<unknown>; contents: Contents }
    >();
    const textSize = () =>
      (currentMode === 'vertical'
        ? 18
        : host.clientWidth >= 1500
          ? 23
          : host.clientWidth >= 1100
            ? 22
            : host.clientWidth >= 600
              ? 21
              : 19) * currentZoom;
    function applyTextSize(doc: Document) {
      doc.documentElement.style.setProperty('font-size', `${textSize()}px`, 'important');
      doc.body.style.setProperty('font-size', `${textSize()}px`, 'important');
    }
    setLoading(true);
    setError('');
    setChapter('');
    setSectionLabel('');
    setPage(1);
    setTotalPages(0);
    setZoom(1);
    setTransitioning(false);

    // Pair the text anchor with its distance from the top of the reading viewport.
    // CFI alone can round to a different line, especially after fonts have loaded.
    function anchorOffset(cfi: string): number | undefined {
      if (!rendition || !scroller) return;
      const range = rendition.getRange(cfi)?.cloneRange();
      if (!range) return;
      range.collapse(true);
      const node = range.startContainer;
      if (node.nodeType === Node.TEXT_NODE && range.startOffset < (node.textContent?.length ?? 0)) {
        range.setEnd(node, range.startOffset + 1);
      }
      const rect =
        node.nodeType === Node.ELEMENT_NODE
          ? (node as Element).getBoundingClientRect()
          : range.getBoundingClientRect();
      const iframe = node.ownerDocument?.defaultView?.frameElement;
      if (!iframe) return;
      return iframe.getBoundingClientRect().top + rect.top - scroller.getBoundingClientRect().top;
    }

    function horizontalAnchor(fallback: string): string {
      if (currentMode !== 'horizontal' || !scroller) return fallback;
      const viewport = scroller.getBoundingClientRect();
      // Mapping can put a boundary CFI on the previous column. Save a character
      // inside the first visible word so display() restores the intended spread.
      for (const [doc, { contents }] of documents) {
        const iframe = doc.defaultView?.frameElement;
        if (!iframe?.isConnected) continue;
        const bounds = iframe.getBoundingClientRect();
        const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = walker.nextNode())) {
          if (node.parentElement?.closest('style, script')) continue;
          const range = doc.createRange();
          range.selectNodeContents(node);
          if (
            !Array.from(range.getClientRects()).some(
              (rect) =>
                rect.width > 0 &&
                bounds.left + rect.right > viewport.left + 12 &&
                bounds.left + rect.left < viewport.right - 12 &&
                bounds.top + rect.bottom > viewport.top + 12 &&
                bounds.top + rect.top < viewport.bottom - 12,
            )
          )
            continue;
          for (const match of (node.textContent || '').matchAll(/\S+/g)) {
            const offset = match.index! + Math.min(1, match[0].length - 1);
            range.setStart(node, offset);
            range.setEnd(node, offset + 1);
            const rect = range.getBoundingClientRect();
            const left = bounds.left + rect.left,
              top = bounds.top + rect.top;
            if (
              !rect.width ||
              left < viewport.left + 12 ||
              left + rect.width > viewport.right - 12 ||
              top < viewport.top + 12 ||
              top + rect.height > viewport.bottom - 12
            )
              continue;
            range.collapse(true);
            return contents.cfiFromRange(range);
          }
        }
      }
      return fallback;
    }

    function updateLocation(location: Location) {
      const start = location.start;
      if (locationsReady && publication) {
        const index = Number(publication.locations.locationFromCfi(start.cfi));
        if (Number.isFinite(index))
          setPage(Math.max(1, Math.min(publication.locations.length(), index + 1)));
      }
      const href = start.href.split('#')[0];
      const entry = toc.find(
        (item) => item.href.split('#')[0] === href || item.href.split('#')[0].endsWith('/' + href),
      );
      setChapter(entry?.label.trim() || `Chapter ${start.index + 1}`);
      setSectionLabel(`Chapter ${start.index + 1} of ${spineCount}`);
      const iframe = Array.from(host!.querySelectorAll('iframe')).find((iframe) => {
        const rect = iframe.getBoundingClientRect();
        const top = scroller?.getBoundingClientRect().top ?? 0;
        return rect.top <= top + 1 && rect.bottom > top;
      });
      const rect = iframe?.getBoundingClientRect();
      const within = rect
        ? clamp(
            ((scroller?.getBoundingClientRect().top ?? 0) - rect.top) / Math.max(1, rect.height),
          )
        : 0;
      const progress = location.atEnd
        ? 1
        : locationsReady && publication
          ? clamp(publication.locations.percentageFromCfi(start.cfi))
          : clamp((start.index + within) / spineCount);
      setPercentage(Math.round(progress * 100));
      return progress;
    }

    const scrollPosition = () =>
      currentMode === 'horizontal' ? scroller!.scrollLeft : scroller!.scrollTop;

    function syncFrames() {
      if (cancelled) return;
      const layout = (
        rendition as unknown as { _layout?: { columnWidth: number; gap: number; divisor: number } }
      )?._layout;
      setPageFrames(
        currentMode === 'horizontal' && layout
          ? Array.from({ length: layout.divisor }, (_, index) => ({
              left: index * (layout.columnWidth + layout.gap) + 8,
              width:
                (layout.divisor === 2 ? layout.columnWidth + layout.gap : host!.clientWidth) - 16,
            }))
          : [],
      );
    }

    function persist() {
      clearTimeout(saveTimer);
      if (cancelled || !restored || (navigating && !turningSpread) || !rendition || !scroller)
        return;
      if (!dirty && Math.abs(scrollPosition() - baselineScroll) < 0.5) return;
      try {
        // Read the current DOM now, rather than the last debounced relocated event.
        const location = currentLocation(rendition);
        if (!location) return;
        const offset = currentMode === 'vertical' ? anchorOffset(location.start.cfi) : 0;
        if (offset === undefined || !Number.isFinite(offset)) return;
        const position = {
          type: 'epub' as const,
          cfi: horizontalAnchor(location.start.cfi),
          href: location.start.href,
          offset,
          flow: currentMode,
        };
        const nextFingerprint = `${currentMode}:${position.cfi}:${Math.round(offset * 2)}`;
        baselineScroll = scrollPosition();
        dirty = false;
        const progress = updateLocation(location);
        if (nextFingerprint === fingerprint) return;
        fingerprint = nextFingerprint;
        savedPosition.current = position;
        progressCallback.current(position, progress);
      } catch {
        /* A continuous view being replaced will report its next stable location. */
      }
    }

    function onScroll() {
      if (!restored || cancelled || navigating || document.visibilityState === 'hidden') return;
      if (!dirty && Math.abs(scrollPosition() - baselineScroll) < 0.5) return;
      dirty = true;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(persist, 120);
    }
    function onHidden() {
      if (document.visibilityState === 'hidden') persist();
    }
    function relocated(location: Location) {
      if (cancelled) return;
      documents.forEach((entry, doc) => {
        if (!doc.defaultView?.frameElement?.isConnected) {
          entry.cleanup();
          documents.delete(doc);
        }
      });
      syncFrames();
      if (location.start?.cfi) {
        updateLocation(location);
        if (currentMode === 'horizontal' && restored && !navigating) {
          dirty = true;
          persist();
        }
      }
    }

    function disposeRendition() {
      clearTimeout(saveTimer);
      scroller?.removeEventListener('scroll', onScroll);
      scroller = null;
      documents.forEach((entry) => entry.cleanup());
      documents.clear();
      if (rendition) {
        // continuous's debounced scroll work otherwise survives manager.destroy().
        const manager = (
          rendition as unknown as {
            manager?: {
              _scrolled?: { cancel: () => void };
              scrollTimeout?: number;
              trimTimeout?: number;
            };
          }
        ).manager;
        manager?._scrolled?.cancel();
        clearTimeout(manager?.scrollTimeout);
        clearTimeout(manager?.trimTimeout);
        rendition.q.clear();
        try {
          rendition.destroy();
        } catch {
          /* Partial archives may have no manager yet. */
        }
        rendition = undefined;
      }
      host!.replaceChildren();
    }
    function fail() {
      if (cancelled) return;
      restored = false;
      setLoading(false);
      setError("We couldn't open this EPUB. Try again, or choose another copy of the book.");
    }

    function keydown(event: KeyboardEvent) {
      if (
        !restored ||
        navigating ||
        !scroller ||
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      )
        return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, select, button, a, [contenteditable="true"]')) return;
      if (currentMode === 'horizontal') {
        const direction =
          ['ArrowRight', 'PageDown'].includes(event.key) || (event.key === ' ' && !event.shiftKey)
            ? 1
            : ['ArrowLeft', 'PageUp'].includes(event.key) || (event.key === ' ' && event.shiftKey)
              ? -1
              : 0;
        if (direction) {
          event.preventDefault();
          void turnSpread(direction);
        }
        return;
      }
      const distance =
        event.key === 'ArrowDown'
          ? 48
          : event.key === 'ArrowUp'
            ? -48
            : event.key === 'PageDown' || (event.key === ' ' && !event.shiftKey)
              ? scroller.clientHeight * 0.85
              : event.key === 'PageUp' || (event.key === ' ' && event.shiftKey)
                ? -scroller.clientHeight * 0.85
                : 0;
      if (distance) {
        event.preventDefault();
        scroller.scrollBy({ top: distance, behavior: 'instant' });
      }
    }

    async function turnSpread(direction: number) {
      if (!rendition || !restored || navigating || cancelled || currentMode !== 'horizontal')
        return;
      persist();
      navigating = true;
      horizontalMoved = true;
      turningSpread = true;
      dirty = true;
      try {
        await bounded(direction > 0 ? rendition.next() : rendition.prev());
        await frame();
        await frame();
        if (cancelled) return;
        navigating = false;
        dirty = true;
        persist();
      } catch {
        /* A rejected chapter turn should leave the current book usable. */
      } finally {
        navigating = false;
        turningSpread = false;
      }
    }

    function wheel(event: WheelEvent) {
      if (currentMode !== 'horizontal' || !restored || cancelled || event.ctrlKey) return;
      event.preventDefault();
      const now = performance.now();
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (!delta) return;
      const direction = Math.sign(delta);
      if (now - lastWheel > 140 || direction !== wheelDirection) {
        wheelTotal = 0;
        wheelGestureConsumed = false;
      }
      lastWheel = now;
      wheelDirection = direction;
      if (navigating || wheelGestureConsumed) return;
      wheelTotal +=
        delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? host!.clientWidth : 1);
      // A light wheel nudge turns immediately; trailing momentum from that same
      // gesture cannot keep skipping pages once the turn has completed.
      if (Math.abs(wheelTotal) < 2) return;
      wheelTotal = 0;
      wheelGestureConsumed = true;
      void turnSpread(direction);
    }
    function touchstart(event: TouchEvent) {
      touchStart =
        event.touches.length === 1
          ? { x: event.touches[0].clientX, y: event.touches[0].clientY }
          : undefined;
    }
    function touchmove(event: TouchEvent) {
      if (
        currentMode === 'horizontal' &&
        touchStart &&
        event.touches.length === 1 &&
        Math.abs(event.touches[0].clientX - touchStart.x) >
          Math.abs(event.touches[0].clientY - touchStart.y)
      )
        event.preventDefault();
    }
    function touchend(event: TouchEvent) {
      const start = touchStart;
      touchStart = undefined;
      if (!start || currentMode !== 'horizontal' || !event.changedTouches.length) return;
      const dx = event.changedTouches[0].clientX - start.x;
      const dy = event.changedTouches[0].clientY - start.y;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        event.preventDefault();
        void turnSpread(dx < 0 ? 1 : -1);
      }
    }
    function gestures(target: HTMLElement | Document) {
      target.addEventListener('wheel', wheel as EventListener, { passive: false });
      target.addEventListener('touchstart', touchstart as EventListener, { passive: true });
      target.addEventListener('touchmove', touchmove as EventListener, { passive: false });
      target.addEventListener('touchend', touchend as EventListener, { passive: false });
      return () => {
        target.removeEventListener('wheel', wheel as EventListener);
        target.removeEventListener('touchstart', touchstart as EventListener);
        target.removeEventListener('touchmove', touchmove as EventListener);
        target.removeEventListener('touchend', touchend as EventListener);
      };
    }

    async function followLink(target: string) {
      if (!rendition || !restored || navigating) return;
      persist();
      horizontalMoved = true;
      navigating = true;
      setTransitioning(true);
      try {
        await bounded(rendition.display(target));
        await frame();
        await frame();
        if (cancelled) return;
        navigating = false;
        dirty = true;
        persist();
      } catch {
        fail();
      } finally {
        navigating = false;
        if (!cancelled) setTransitioning(false);
      }
    }

    async function changeZoom(next: number) {
      if (!rendition || !scroller || !restored || navigating || cancelled || next === currentZoom)
        return;
      // Flush real reading movement before locking out saves during reflow.
      // An immediate Home action during zoom can then retain that exact anchor.
      persist();
      navigating = true;
      setTransitioning(true);
      clearTimeout(saveTimer);
      const wasDirty = dirty || Math.abs(scrollPosition() - baselineScroll) >= 0.5;
      try {
        const location = currentLocation(rendition);
        if (!location) return;
        const cfi = horizontalAnchor(location.start.cfi);
        const offset = currentMode === 'vertical' ? anchorOffset(cfi) : 0;
        if (offset === undefined) return;
        currentZoom = Math.max(0.6, Math.min(2, next));
        setZoom(currentZoom);
        documents.forEach(({ contents }) => {
          applyTextSize(contents.document);
          contents.emit('expand');
        });
        await frame();
        await frame();
        if (cancelled) return;
        await bounded(rendition.display(cfi));
        await Promise.all(Array.from(documents.values(), (entry) => entry.ready));
        await frame();
        await frame();
        if (cancelled || !scroller) return;
        const actualOffset = anchorOffset(cfi);
        if (currentMode === 'vertical' && actualOffset !== undefined)
          scroller.scrollTop += actualOffset - offset;
        await frame();
        await frame();
        if (cancelled || !scroller) return;
        baselineScroll = scrollPosition();
        dirty = wasDirty;
        syncFrames();
        const actual = currentLocation(rendition);
        if (actual) updateLocation(actual);
      } catch {
        /* Keep the readable book and release the controls after a failed reflow. */
      } finally {
        navigating = false;
        if (!cancelled) setTransitioning(false);
      }
    }

    controls.current = {
      page: (next) => {
        if (!publication || !locationsReady || navigating || !restored || cancelled) return;
        const target = publication.locations.cfiFromLocation(
          Math.max(0, Math.min(publication.locations.length() - 1, next - 1)),
        );
        if (typeof target === 'string') void followLink(target);
      },
      zoom: (next) => {
        void changeZoom(next);
      },
      mode: (next) => {
        void changeMode(next);
      },
    };

    function attachContents(contents: Contents) {
      if (cancelled) return;
      const doc = contents.document;
      doc.documentElement.dataset.leafmarkMode = currentMode;
      if (!doc.documentElement.lang && publication?.packaging.metadata.language)
        doc.documentElement.lang = publication.packaging.metadata.language;
      const style = doc.createElement('style');
      const fontFaces = [
        { url: loraFont, weight: 400, style: 'normal' },
        { url: loraBoldFont, weight: 700, style: 'normal' },
        { url: loraItalicFont, weight: 400, style: 'italic' },
      ]
        .map(
          ({ url, weight, style }) => `
        @font-face {
          font-family: LeafmarkLora;
          src: url("${new URL(url, window.location.href).href}") format("woff2");
          font-weight: ${weight};
          font-style: ${style};
          font-display: swap;
        }
      `,
        )
        .join('\n');
      style.textContent = `${fontFaces}\n${epubContentStyles}`;
      doc.head.append(style);
      applyTextSize(doc);
      applyTheme(doc, themeRef.current);
      contents.window.frameElement?.setAttribute('title', 'EPUB chapter');
      function click(event: MouseEvent) {
        const anchor = (event.target as Element | null)?.closest?.('a[href]');
        const href = anchor?.getAttribute('href');
        if (!href || !publication) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        try {
          const url = new URL(href, doc.baseURI);
          if (url.origin !== window.location.origin || !['http:', 'https:'].includes(url.protocol))
            return;
          const target = publication.path.relative(url.pathname) + url.hash;
          if (publication.spine.get(target)) void followLink(target);
        } catch {
          /* Ignore malformed links in book content. */
        }
      }
      const removeGestures = gestures(doc);
      doc.addEventListener('keydown', keydown);
      doc.addEventListener('click', click, true);
      // EPUB's content hook runs asynchronously. Explicitly await its font work
      // before restoring, then expand the view to the final typeset height.
      const ready = bounded(
        Promise.all([
          doc.fonts.load(`${textSize()}px LeafmarkLora`),
          doc.fonts.load(`700 ${textSize()}px LeafmarkLora`),
          doc.fonts.load(`italic ${textSize()}px LeafmarkLora`),
        ]),
        4000,
      )
        .catch(() => {})
        .then(async () => {
          if (cancelled || !doc.defaultView?.frameElement?.isConnected) return;
          await frame();
          contents.emit('expand');
        });
      documents.set(doc, {
        ready,
        contents,
        cleanup: () => {
          removeGestures();
          doc.removeEventListener('keydown', keydown);
          doc.removeEventListener('click', click, true);
        },
      });
      return ready;
    }

    function makeRendition() {
      disposeRendition();
      const options = {
        width: host!.clientWidth,
        height: host!.clientHeight,
        manager: currentMode === 'vertical' ? 'continuous' : 'default',
        flow: currentMode === 'vertical' ? 'scrolled' : 'paginated',
        spread: currentMode === 'vertical' ? 'none' : 'auto',
        minSpreadWidth: 1100,
        allowScriptedContent: false,
        resizeOnOrientationChange: false,
      };
      rendition = publication!.renderTo(host!, options);
      rendition.hooks.content.register(attachContents);
      rendition.on('relocated', relocated);
      rendition.on('displayError', () => {
        if (restored) fail();
      });
      return rendition;
    }

    async function changeMode(next: ReadingMode) {
      if (
        !publication ||
        !rendition ||
        !scroller ||
        !restored ||
        navigating ||
        cancelled ||
        next === currentMode
      )
        return;
      persist();
      const location = currentLocation(rendition);
      if (!location) return;
      let cfi = horizontalAnchor(location.start.cfi);
      let offset = 0;
      if (currentMode === 'vertical') {
        verticalAnchor = { cfi, offset: anchorOffset(cfi) ?? 0 };
        horizontalMoved = false;
      } else if (!horizontalMoved && verticalAnchor) {
        cfi = verticalAnchor.cfi;
        offset = verticalAnchor.offset;
      }
      navigating = true;
      restored = false;
      setTransitioning(true);
      currentMode = next;
      modeRef.current = next;
      setMode(next);
      try {
        localStorage.setItem(modePreference, next);
      } catch {
        /* Optional preference. */
      }
      try {
        await frame();
        if (cancelled) return;
        const current = makeRendition();
        await bounded(current.display(cfi));
        await frame();
        await Promise.all(Array.from(documents.values(), (entry) => entry.ready));
        await frame();
        await frame();
        if (cancelled) return;
        scroller = host!.querySelector<HTMLElement>('.epub-container');
        if (!scroller) throw new Error('No reading viewport.');
        await bounded(current.display(cfi));
        await frame();
        if (cancelled) return;
        if (next === 'vertical') {
          const actualOffset = anchorOffset(cfi);
          if (actualOffset !== undefined) scroller.scrollTop += actualOffset - offset;
        }
        baselineScroll = scrollPosition();
        scroller.addEventListener('scroll', onScroll, { passive: true });
        restored = true;
        navigating = false;
        dirty = true;
        persist();
        syncFrames();
      } catch {
        fail();
      } finally {
        navigating = false;
        if (!cancelled) setTransitioning(false);
      }
    }

    const removeHostGestures = gestures(host);
    window.addEventListener('keydown', keydown);
    window.addEventListener('pagehide', persist);
    document.addEventListener('visibilitychange', onHidden);
    registerBeforeClose?.(persist);

    void (async () => {
      try {
        const bytes = await bounded(book.file.arrayBuffer());
        if (cancelled) return;
        publication = ePub();
        const loadNavigation = publication.loadNavigation.bind(publication);
        publication.loadNavigation = async (source) => {
          try {
            return await loadNavigation(source);
          } catch {
            publication!.packaging.navPath = '';
            publication!.packaging.ncxPath = '';
            return loadNavigation(source);
          }
        };
        void publication.opened.catch(() => {});
        void publication.ready.catch(() => {});
        opening = publication.open(bytes, 'binary');
        await bounded(opening);
        await bounded(publication.opened);
        if (cancelled) return;
        let count = 0;
        publication.spine.each(() => {
          count += 1;
        });
        spineCount = Math.max(1, count);
        void publication.loaded.navigation
          .then((nav) => {
            if (!cancelled) {
              toc = flatten(nav.toc);
              if (rendition?.location) relocated(rendition.location);
            }
          })
          .catch(() => {});
        // epubjs ignores the promises returned by its location queue. Catch each
        // section failure inside process so malformed books cannot reject them.
        const locations = publication.locations;
        const internals = locations as unknown as {
          request: (url: string) => Promise<Document>;
          pause: number;
          q: { clear: () => void };
        };
        internals.pause = 0;
        const request = internals.request;
        let generationStopped = false;
        let generationFailed = false;
        stopGenerating = () => {
          generationStopped = true;
          internals.q.clear();
        };
        internals.request = (url) =>
          bounded(
            Promise.resolve().then(() => request(url)),
            4000,
          );
        const process = locations.process.bind(locations);
        locations.process = async (section) => {
          if (cancelled || generationStopped) return [];
          try {
            return await process(section);
          } catch {
            generationFailed = true;
            stopGenerating?.();
            return [];
          }
        };
        generation = locations.generate(1600);
        try {
          await bounded(generation, 15000);
          if (!cancelled && !generationFailed && locations.length() > 0) {
            locationsReady = true;
            setTotalPages(locations.length());
          }
        } catch {
          stopGenerating();
          // Finish the bounded active section before rendering, since generation
          // unloads spine documents that the continuous manager also uses.
          await bounded(generation, 5000).catch(() => {});
        }
        if (cancelled) return;
        const saved = savedPosition.current;
        const candidates =
          saved?.type === 'epub' ? [saved.cfi, saved.href, undefined] : [undefined];
        let displayed = false;
        for (const target of candidates) {
          if (cancelled) return;
          if (target !== undefined) {
            try {
              if (!target || !publication.spine.get(target)) continue;
            } catch {
              continue;
            }
          }
          const current = makeRendition();
          try {
            await bounded(current.display(target), 10000);
            if (cancelled) return;
            await frame();
            await Promise.all(Array.from(documents.values(), (entry) => entry.ready));
            await frame();
            await frame();
            if (cancelled) return;
            scroller = host.querySelector<HTMLElement>('.epub-container');
            if (!scroller) throw new Error('No reading viewport.');
            if (saved?.type === 'epub' && target !== undefined && target === saved.cfi) {
              // Re-apply after fonts have settled, then retain the anchor's exact
              // vertical position instead of snapping it to a page boundary.
              await bounded(current.display(target), 10000);
              await frame();
              const offset = anchorOffset(target);
              const desired =
                saved.flow !== 'horizontal' && Number.isFinite(saved.offset) ? saved.offset! : 0;
              if (currentMode === 'vertical' && offset !== undefined)
                scroller.scrollTop += offset - desired;
            }
            await frame();
            await frame();
            if (cancelled) return;
            baselineScroll = scrollPosition();
            scroller.addEventListener('scroll', onScroll, { passive: true });
            const location = currentLocation(current);
            if (location) updateLocation(location);
            displayed = true;
            break;
          } catch {
            if (target === undefined) throw new Error('Unable to display EPUB.');
          }
        }
        if (!displayed || cancelled) return;
        restored = true;
        syncFrames();
        setLoading(false);
        let width = host.clientWidth,
          height = host.clientHeight;
        resizeObserver = new ResizeObserver(() => {
          cancelAnimationFrame(resizeFrame);
          resizeFrame = requestAnimationFrame(() => {
            if (
              cancelled ||
              !rendition ||
              !restored ||
              navigating ||
              (width === host.clientWidth && height === host.clientHeight)
            )
              return;
            persist();
            const location = currentLocation(rendition);
            const cfi = location?.start.cfi ? horizontalAnchor(location.start.cfi) : undefined;
            const offset = currentMode === 'vertical' && cfi ? anchorOffset(cfi) : undefined;
            width = host.clientWidth;
            height = host.clientHeight;
            navigating = true;
            void (async () => {
              try {
                documents.forEach(({ contents }) => {
                  applyTextSize(contents.document);
                  contents.emit('expand');
                });
                rendition!.resize(width, height);
                await frame();
                await frame();
                if (cancelled || !rendition || !cfi) return;
                await bounded(rendition.display(cfi));
                await frame();
                await frame();
                if (cancelled || !scroller) return;
                if (currentMode === 'vertical' && offset !== undefined) {
                  const actual = anchorOffset(cfi);
                  if (actual !== undefined) scroller.scrollTop += actual - offset;
                }
                baselineScroll = scrollPosition();
                syncFrames();
                const actual = currentLocation(rendition);
                if (actual) updateLocation(actual);
              } catch {
                /* Keep the last readable location on a failed resize. */
              } finally {
                navigating = false;
              }
            })();
          });
        });
        resizeObserver.observe(host);
      } catch {
        fail();
      }
    })();

    return () => {
      persist();
      cancelled = true;
      controls.current = null;
      stopGenerating?.();
      registerBeforeClose?.(null);
      clearTimeout(saveTimer);
      removeHostGestures();
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('pagehide', persist);
      document.removeEventListener('visibilitychange', onHidden);
      resizeObserver?.disconnect();
      cancelAnimationFrame(resizeFrame);
      disposeRendition();
      const oldBook = publication;
      if (oldBook) {
        void Promise.resolve(opening)
          .then(
            () => bounded(oldBook.opened),
            () => {},
          )
          .catch(() => {})
          .then(() => generation)
          .catch(() => {})
          .then(() => {
            try {
              oldBook.destroy();
            } catch {
              /* Partial archives can have incomplete resources. */
            }
          });
      }
    };
  }, [book.id, book.file, attempt, registerBeforeClose]);

  const pageInsets =
    mode === 'horizontal'
      ? 'inset-x-[clamp(16px,2vw,48px)] inset-y-[clamp(20px,3vh,36px)] max-[600px]:inset-x-0 max-[600px]:inset-y-3'
      : 'inset-0';

  return (
    <section
      className={cn(
        'epub-reader flex size-full min-h-0 flex-1 flex-col overflow-hidden bg-[var(--epub-paper)] font-sans text-foreground',
        `epub-reader--${mode}`,
        theme === 'black' && 'dark',
      )}
      data-reading-mode={mode}
      data-theme={theme}
      aria-label="EPUB reader"
    >
      <ReaderToolbar
        page={page}
        totalPages={totalPages}
        zoom={zoom}
        disabled={loading || !!error || transitioning}
        minZoom={0.6}
        maxZoom={2}
        readingMode={mode}
        onReadingModeChange={(next) => controls.current?.mode(next)}
        theme={theme}
        onThemeChange={setTheme}
        onPageChange={(next) => controls.current?.page(next)}
        onZoomChange={(next) => controls.current?.zoom(next)}
      />
      <div
        className={cn(
          'epub-page relative min-h-0 w-full flex-[1_1_0] self-center overflow-hidden bg-[var(--epub-paper)]',
          mode === 'horizontal' ? 'max-w-[2200px]' : 'max-w-[1000px]',
        )}
      >
        <div
          ref={viewport}
          className={cn('epub-viewport absolute overflow-hidden [&_iframe]:border-0', pageInsets)}
          aria-busy={loading}
          inert={!!error || loading}
        />
        {mode === 'horizontal' && (
          <div
            className={cn('epub-paper-frames pointer-events-none absolute z-1', pageInsets)}
            aria-hidden="true"
          >
            {pageFrames.map((paper, index) => (
              <div
                className="epub-paper-frame epub-sheet absolute inset-y-0"
                key={index}
                style={{ left: paper.left, width: paper.width }}
              />
            ))}
          </div>
        )}
        {loading && (
          <div
            className="epub-overlay absolute inset-0 z-2 flex flex-col items-center justify-center gap-3.5 bg-[var(--epub-paper)] p-7 text-center text-sm text-primary"
            role="status"
          >
            <BookOpen
              size={26}
              aria-hidden="true"
            />
            <span>Opening your book…</span>
          </div>
        )}
        {error && (
          <div
            className="epub-overlay epub-error absolute inset-0 z-2 flex flex-col items-center justify-center gap-3.5 bg-[var(--epub-paper)] p-7 text-center text-sm text-primary"
            role="alert"
          >
            <BookOpen
              size={28}
              aria-hidden="true"
            />
            <p className="max-w-[340px] leading-[1.6]">{error}</p>
            <Button
              variant="outline"
              type="button"
              onClick={() => setAttempt((value) => value + 1)}
            >
              <RotateCcw
                size={16}
                aria-hidden="true"
              />
              Try again
            </Button>
          </div>
        )}
      </div>
      <ReaderFooter
        className="epub-footer"
        label={sectionLabel || 'Preparing your book'}
        title={chapter}
        percentage={percentage}
      />
    </section>
  );
}
