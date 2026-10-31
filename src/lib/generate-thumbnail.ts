const MAX_WIDTH = 160;
const MAX_HEIGHT = 224;
const MAX_DATA_LENGTH = 65536;

function jpeg(canvas: HTMLCanvasElement): string {
  const data = canvas.toDataURL('image/jpeg', 0.8);
  return data.length <= MAX_DATA_LENGTH ? data : '';
}

async function pdfThumbnail(file: Blob): Promise<string> {
  const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist');
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  GlobalWorkerOptions.workerSrc = workerUrl;
  const task = getDocument({ data: await file.arrayBuffer() });
  // Password-protected and damaged books can still be imported without a preview.
  const canvas = document.createElement('canvas');
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const render = async () => {
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const size = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({
      scale: Math.min(MAX_WIDTH / size.width, MAX_HEIGHT / size.height),
    });
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    await page.render({ canvas, viewport, background: '#ffffff' }).promise;
    return jpeg(canvas);
  };
  try {
    return await Promise.race([
      render(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('PDF preview timed out.')), 8000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
    void task.destroy().catch(() => {});
    canvas.width = canvas.height = 0;
  }
}

async function epubThumbnail(file: Blob): Promise<string> {
  const { default: JSZip } = await import('jszip');
  const archive = await JSZip.loadAsync(await file.arrayBuffer());
  const xml = (source: string) => new DOMParser().parseFromString(source, 'application/xml');
  const container = archive.file('META-INF/container.xml');
  if (!container) return '';
  const root = xml(await container.async('string')).getElementsByTagNameNS('*', 'rootfile')[0];
  const path = root?.getAttribute('full-path');
  const packageFile = path && archive.file(path);
  if (!packageFile) return '';
  const packageDocument = xml(await packageFile.async('string'));
  const items = Array.from(packageDocument.getElementsByTagNameNS('*', 'item'));
  const legacyId = Array.from(packageDocument.getElementsByTagNameNS('*', 'meta'))
    .find((meta) => meta.getAttribute('name') === 'cover')
    ?.getAttribute('content');
  const cover =
    items.find((item) => item.getAttribute('properties')?.split(/\s+/).includes('cover-image')) ??
    items.find((item) => legacyId && item.getAttribute('id') === legacyId);
  const href = cover?.getAttribute('href');
  if (!href) return '';
  // Only embedded archive images are eligible. Never request a publisher's URL.
  const url = new URL(href, `https://epub.invalid/${path}`);
  if (url.origin !== 'https://epub.invalid') return '';
  const imageFile = archive.file(decodeURIComponent(url.pathname.slice(1)));
  if (!imageFile) return '';
  const bytes = await imageFile.async('uint8array');
  if (bytes.byteLength > 8 * 1024 * 1024) return '';
  const source = URL.createObjectURL(
    new Blob([new Uint8Array(bytes).buffer], {
      type: cover!.getAttribute('media-type') || 'image/jpeg',
    }),
  );
  const image = new Image();
  const canvas = document.createElement('canvas');
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('No readable cover image.'));
      timeout = setTimeout(() => reject(new Error('Cover image timed out.')), 8000);
      image.src = source;
    });
    if (
      !image.naturalWidth ||
      !image.naturalHeight ||
      image.naturalWidth * image.naturalHeight > 40_000_000
    )
      return '';
    const scale = Math.min(MAX_WIDTH / image.naturalWidth, MAX_HEIGHT / image.naturalHeight, 1);
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) return '';
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return jpeg(canvas);
  } finally {
    clearTimeout(timeout);
    image.src = '';
    URL.revokeObjectURL(source);
    canvas.width = canvas.height = 0;
  }
}

// Empty means generation completed without a usable preview. Undefined in a
// book record means it predates thumbnails and can be generated lazily.
export async function generateThumbnail(file: Blob, format: 'pdf' | 'epub'): Promise<string> {
  try {
    return await (format === 'pdf' ? pdfThumbnail(file) : epubThumbnail(file));
  } catch {
    return '';
  }
}
