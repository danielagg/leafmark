import { test, expect } from '@playwright/test';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';

async function samples(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try sample books' }).click();
  await expect(page.getByRole('button', { name: 'Open The art of noticing.pdf' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open A little room to read.epub' })).toBeVisible();
}

test('PDF renders, navigation persists after reload, deletion is real', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await samples(page);
  await page.getByRole('button', { name: 'Open The art of noticing.pdf' }).click();
  await expect(page.locator('.pdf-page[data-page-number="1"] canvas')).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('button', { name: 'Next page', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect.poll(async () => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('leafmark-library', 1); request.onsuccess = () => resolve(request.result); });
    return new Promise<number>(resolve => { const request = db.transaction('books').objectStore('books').getAll(); request.onsuccess = () => resolve(request.result.find((b: {format:string}) => b.format === 'pdf')?.position?.page ?? 0); });
  })).toBe(2);
  await page.getByRole('button', { name: 'Back to library' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Open The art of noticing.pdf' }).click();
  await expect(page.locator('.pdf-page[data-page-number="2"] canvas')).toBeVisible();
  await expect(page.getByRole('spinbutton')).toHaveValue('2');
  // Leaving immediately after a page turn must still save that deliberate turn.
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await page.getByRole('button', { name: 'Back to library' }).click();
  await page.getByRole('button', { name: 'Open The art of noticing.pdf' }).click();
  await expect(page.getByRole('spinbutton')).toHaveValue('3');
  await page.getByRole('button', { name: 'Back to library' }).click();
  await page.getByRole('button', { name: 'Delete The art of noticing.pdf' }).click();
  await page.getByRole('button', { name: 'Keep book' }).click();
  await expect(page.getByRole('button', { name: 'Open The art of noticing.pdf' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete The art of noticing.pdf' }).click();
  await page.getByRole('button', { name: 'Remove book', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open The art of noticing.pdf' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Open The art of noticing.pdf' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

for (const mobile of [false, true]) {
  test(`${mobile ? 'mobile' : 'desktop'} EPUB scrolls across chapters and restores visible text immediately after leaving`, async ({ page }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await samples(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Open A little room to read.epub' }).click();
    const reader = page.getByRole('region', { name: 'EPUB reader' });
    const viewport = reader.locator('.epub-viewport');
    const container = viewport.locator('.epub-container');
    await expect(viewport).toHaveAttribute('aria-busy', 'false', { timeout: 20000 });
    await expect(reader.locator('.epub-overlay')).toHaveCount(0);
    await expect(reader.getByRole('button', { name: 'Next page', exact: true })).toBeEnabled();
    await expect(reader.getByRole('button', { name: 'Previous page', exact: true })).toBeVisible();
    await expect(page.frameLocator('iframe').first().getByRole('heading', { name: 'Begin where you are' })).toBeVisible();
    expect(await container.evaluate(element => ({
      verticalScrolling: ['auto', 'scroll'].includes(getComputedStyle(element).overflowY),
      scrollable: element.scrollHeight > element.clientHeight,
    }))).toEqual({ verticalScrolling: true, scrollable: true });

    if (!mobile) {
      // Wheel input over the embedded book must scroll its parent reader.
      const bounds = (await container.boundingBox())!;
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await page.mouse.wheel(0, 240);
      await expect.poll(() => container.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      await page.keyboard.press('PageUp');
      await expect.poll(() => container.evaluate(element => element.scrollTop)).toBe(0);
    }

    // Read through the actual scroll container. Continuous mode loads and unloads
    // chapter iframes as the viewport approaches them.
    await expect.poll(async () => container.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      const laterChapter = Array.from(element.querySelectorAll('iframe')).some(frame => {
        const heading = frame.contentDocument?.querySelector('h1');
        if (heading?.textContent !== 'The things we pass by') return false;
        const top = frame.getBoundingClientRect().top + heading.getBoundingClientRect().top;
        return top >= bounds.top && top < bounds.bottom;
      });
      if (!laterChapter) element.scrollTop += element.clientHeight * 0.55;
      return laterChapter;
    }), { timeout: 20000, intervals: [100, 150, 250] }).toBe(true);
    await container.evaluate(element => {
      const frame = Array.from(element.querySelectorAll('iframe')).find(frame =>
        frame.contentDocument?.querySelector('h1')?.textContent === 'The things we pass by')!;
      const heading = frame.contentDocument!.querySelector('h1')!;
      element.scrollTop += frame.getBoundingClientRect().top + heading.getBoundingClientRect().top - element.getBoundingClientRect().top;
    });
    await expect(reader.locator('.epub-footer')).toContainText(/2 of 4/);
    await expect.poll(async () => container.evaluate(element => {
      const frame = Array.from(element.querySelectorAll('iframe')).find(frame =>
        frame.contentDocument?.querySelector('h1')?.textContent === 'The things we pass by');
      return !!frame?.contentDocument?.body.textContent?.includes('Walk a little more slowly');
    })).toBe(true);
    await container.evaluate(async element => {
      await Promise.all(Array.from(element.querySelectorAll('iframe')).map(frame => frame.contentDocument?.fonts.ready));
    });

    // Use a rendered paragraph as the anchor, with the first visible word and
    // paragraph offset in pixels. An unchanged database CFI cannot pass this.
    const readingPosition = (scrollBy = 0, leave = false, zoomBeforeLeaving = false) => container.evaluate((element, action) => {
      if (action.scrollBy) {
        element.scrollTop += action.scrollBy;
      }
      const bounds = element.getBoundingClientRect();
      for (const frame of element.querySelectorAll('iframe')) {
        const doc = frame.contentDocument;
        if (!doc || getComputedStyle(frame).visibility === 'hidden') continue;
        const frameTop = frame.getBoundingClientRect().top;
        const paragraphs = Array.from(doc.querySelectorAll('p'));
        for (const [index, paragraph] of paragraphs.entries()) {
          const rect = paragraph.getBoundingClientRect();
          if (frameTop + rect.bottom <= bounds.top + 8 || frameTop + rect.top >= bounds.bottom) continue;
          const walker = doc.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
          let node: Node | null;
          let visibleText = '';
          while ((node = walker.nextNode()) && !visibleText) {
            const text = node.textContent || '';
            for (const match of text.matchAll(/\S+/g)) {
              const range = doc.createRange();
              range.setStart(node, match.index!);
              range.setEnd(node, match.index! + match[0].length);
              const word = range.getBoundingClientRect();
              if (frameTop + word.bottom > bounds.top + 8 && frameTop + word.top < bounds.bottom) {
                visibleText = text.slice(match.index, match.index! + 100);
                break;
              }
            }
          }
          if (!visibleText) continue;
          const position = {
            chapter: doc.querySelector('h1')?.textContent,
            paragraph: index,
            text: paragraph.textContent,
            visibleText,
            top: frameTop + rect.top - bounds.top,
          };
          // Scroll and Home happen in this single browser task. No relocated
          // debounce, polling, or Playwright click delay can save the position first.
          if (action.leave) {
            if (action.zoomBeforeLeaving) {
              document.querySelector<HTMLButtonElement>('button[aria-label="Zoom in"]')!.click();
            }
            const home = document.querySelector<HTMLButtonElement>('button[aria-label="Back to library"]');
            if (!home) throw new Error('Missing Home button');
            home.click();
          }
          return position;
        }
      }
      throw new Error('No visible reading text in loaded EPUB iframes');
    }, { scrollBy, leave, zoomBeforeLeaving });

    await expect(reader).toHaveAttribute('data-theme', 'light');
    const beforeTheme = await readingPosition();
    await page.getByRole('button', { name: 'Switch to dark mode', exact: true }).click();
    await expect(page.frameLocator('iframe').first().locator('body')).toHaveCSS('background-color', 'rgb(24, 33, 28)');
    expect(await readingPosition()).toEqual(beforeTheme);
    for (let reopen = 0; reopen < 3; reopen += 1) {
      const before = await readingPosition();
      const saved = await readingPosition(reopen === 0 ? 213 : 97, true, reopen === 2);
      expect(saved.top).not.toBe(before.top);
      expect(saved.chapter).not.toBe('Begin where you are');
      await expect(page.getByRole('button', { name: 'Open A little room to read.epub' })).toBeVisible();
      if (reopen === 1) await page.reload();
      await page.getByRole('button', { name: 'Open A little room to read.epub' }).click();
      await expect(viewport).toHaveAttribute('aria-busy', 'false', { timeout: 20000 });
      await expect(reader.locator('.epub-overlay')).toHaveCount(0);
      await expect(reader).toHaveAttribute('data-theme', 'dark');
      await expect(page.frameLocator('iframe').first().locator('p').first()).toHaveCSS('color', 'rgb(220, 229, 220)');
      await expect.poll(async () => {
        const restored = await readingPosition();
        return {
          chapter: restored.chapter,
          paragraph: restored.paragraph,
          text: restored.text,
          visibleText: restored.visibleText,
          samePixelPosition: Math.abs(restored.top - saved.top) <= 4,
        };
      }, { timeout: 10000 }).toEqual({
        chapter: saved.chapter,
        paragraph: saved.paragraph,
        text: saved.text,
        visibleText: saved.visibleText,
        samePixelPosition: true,
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await container.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    }
    if (mobile) await page.screenshot({ path: 'test-results/epub-mobile.png' });
    const beforeLight = await readingPosition();
    await page.getByRole('button', { name: 'Switch to light mode', exact: true }).click();
    await expect(reader).toHaveAttribute('data-theme', 'light');
    await expect(page.frameLocator('iframe').first().locator('body')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    expect(await readingPosition()).toEqual(beforeLight);
    expect(errors).toEqual([]);
  });
}

test('file picker accepts real uploads and rejects invalid formats', async ({ page }) => {
  await page.goto('/');
  const input = page.getByLabel('Choose PDF or EPUB books');
  await input.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a book') });
  await expect(page.getByRole('alert')).toContainText("isn't a PDF or EPUB");
  await page.getByRole('button', { name: 'Dismiss message' }).click();
  await input.setInputFiles(path.resolve('public/samples/The art of noticing.pdf'));
  await expect(page.getByRole('button', { name: 'Open The art of noticing.pdf' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Open The art of noticing.pdf' })).toBeVisible();
});

for (const mobile of [false, true]) {
  test(`${mobile ? 'mobile' : 'desktop'} PDF scrolls continuously and preserves its exact place on immediate exit`, async ({ page }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await samples(page);
    await page.getByRole('button', { name: 'Open The art of noticing.pdf' }).click();
    const viewport = page.locator('.pdf-viewport');
    await expect(page.locator('.pdf-page')).toHaveCount(4, { timeout: 20000 });
    await expect(page.locator('.pdf-page[data-page-number="1"] canvas')).toBeVisible();
    const bounds = (await viewport.boundingBox())!;
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.wheel(0, 220);
    await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    for (let cycle = 0; cycle < 3; cycle += 1) {
      // Read different positions and leave in the same browser task, before a
      // scroll event or debounce has an opportunity to write progress.
      const expected = await viewport.evaluate((element, cycle) => {
        const target = element.querySelector<HTMLElement>(`.pdf-page[data-page-number="${cycle > 1 ? 3 : 2}"]`)!;
        const bounds = element.getBoundingClientRect();
        element.scrollTop += target.getBoundingClientRect().top - bounds.top + target.clientHeight * (.23 + cycle * .07);
        const top = target.getBoundingClientRect().top - bounds.top;
        document.querySelector<HTMLButtonElement>('button[aria-label="Back to library"]')!.click();
        return { page: cycle > 1 ? 3 : 2, top };
      }, cycle);
      await expect(page.getByRole('button', { name: 'Open The art of noticing.pdf' })).toBeVisible();
      if (cycle === 1) await page.reload();
      await page.getByRole('button', { name: 'Open The art of noticing.pdf' }).click();
      await expect(page.getByRole('spinbutton', { name: 'Page number' })).toHaveValue(String(expected.page));
      await expect(page.locator(`.pdf-page[data-page-number="${expected.page}"] canvas`)).toBeVisible();
      await expect.poll(() => viewport.evaluate((element, pageNumber) => {
        const target = element.querySelector<HTMLElement>(`.pdf-page[data-page-number="${pageNumber}"]`)!;
        return target.getBoundingClientRect().top - element.getBoundingClientRect().top;
      }, expected.page).then(top => Math.abs(top - expected.top) <= 4)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    // Zooming in and back to 100% retains the reading content and its offset.
    const position = () => viewport.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      const target = Array.from(element.querySelectorAll<HTMLElement>('.pdf-page')).find(target => target.getBoundingClientRect().bottom > bounds.top + 1)!;
      return { page: target.dataset.pageNumber, fraction: (bounds.top - target.getBoundingClientRect().top) / target.clientHeight };
    });
    const before = await position();
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await expect.poll(async () => {
      const after = await position();
      return after.page === before.page && Math.abs(after.fraction - before.fraction) < .015;
    }).toBe(true);
    await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
    await expect.poll(async () => {
      const after = await position();
      return after.page === before.page && Math.abs(after.fraction - before.fraction) < .015;
    }).toBe(true);
    expect(await viewport.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    // Verify actual PDF ink returns after zoom, rather than merely a visible canvas.
    await expect.poll(() => page.locator('.pdf-page[data-page-number="3"] canvas').evaluate(element => {
      const canvas = element as HTMLCanvasElement;
      if (!canvas.width || !canvas.height) return false;
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let index = 0; index < pixels.length; index += 16) {
        if (pixels[index] < 200 && pixels[index + 1] < 200 && pixels[index + 2] < 200) return true;
      }
      return false;
    })).toBe(true);
    if (mobile) await page.screenshot({ path: 'test-results/pdf-mobile.png' });
    await viewport.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(page.getByRole('progressbar', { name: 'Reading progress', exact: true })).toHaveAttribute('aria-valuenow', '100');
    await expect(page.locator('.reader-progress-value')).toHaveText('100% read');
    await page.getByRole('button', { name: 'Back to library' }).click();
    await expect(page.getByRole('button', { name: 'Open The art of noticing.pdf' })).toContainText('100% read');
    expect(errors).toEqual([]);
  });
}

test('long mixed-size PDFs reserve all pages and render only nearby canvases', async ({ page }) => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < 36; index += 1) {
    const sheet = pdf.addPage(index % 2 ? [720, 540] : [595, 842]);
    sheet.drawText(`Page ${index + 1}`, { x: 45, y: 100, size: 32, font });
  }
  await page.goto('/');
  await page.getByLabel('Choose PDF or EPUB books').setInputFiles({ name: 'Mixed pages.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
  await page.getByRole('button', { name: 'Open Mixed pages.pdf' }).click();
  await expect(page.locator('.pdf-page')).toHaveCount(36, { timeout: 20000 });
  await expect(page.locator('.pdf-page[data-page-number="1"] canvas')).toBeVisible();
  await expect.poll(() => page.locator('canvas').count()).toBeLessThan(10);
  const input = page.getByRole('spinbutton', { name: 'Page number' });
  await input.fill('30');
  await input.press('Enter');
  await expect(page.locator('.pdf-page[data-page-number="30"] canvas')).toBeVisible();
  await expect.poll(() => page.locator('canvas').count()).toBeLessThan(10);
  await expect(page.locator('.pdf-page[data-page-number="1"] canvas')).toHaveCount(0);
  expect(await page.locator('.pdf-viewport').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
});

for (const mobile of [false, true]) {
  test(`${mobile ? 'mobile' : 'desktop'} readers share page and zoom controls without fit-width duplication`, async ({ page }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await samples(page);
    const appearances: unknown[] = [];
    for (const filename of ['The art of noticing.pdf', 'A little room to read.epub']) {
      await page.getByRole('button', { name: `Open ${filename}` }).click();
      const toolbar = page.getByRole('toolbar', { name: 'Reading controls' });
      const input = toolbar.getByRole('spinbutton', { name: 'Page number' });
      await expect(toolbar.getByRole('button', { name: 'Next page', exact: true })).toBeEnabled({ timeout: 20000 });
      await expect(input).toHaveValue('1');
      const progress = page.getByRole('progressbar', { name: 'Reading progress', exact: true });
      await expect(progress).toHaveAttribute('aria-valuenow', '0');
      await expect(toolbar.getByRole('button', { name: 'Previous page', exact: true })).toBeDisabled();
      await expect(toolbar.locator('.reader-zoom-value')).toHaveCount(0);
      await expect(page.getByText('Fit width', { exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Fit to width/i })).toHaveCount(0);
      const total = await toolbar.locator('.reader-page-count').textContent();
      appearances.push(await toolbar.evaluate(element => {
        const style = getComputedStyle(element);
        const button = getComputedStyle(element.querySelector('button')!);
        return { height: element.clientHeight, width: element.clientWidth, top: element.getBoundingClientRect().top, padding: style.padding, font: style.font, background: style.backgroundColor, buttonWidth: button.width, buttonHeight: button.height, buttonColor: button.color, buttonBorder: button.border };
      }));
      await toolbar.getByRole('button', { name: 'Next page', exact: true }).click();
      await expect(input).toHaveValue('2');
      await toolbar.getByRole('button', { name: 'Previous page', exact: true }).click();
      await expect(input).toHaveValue('1');
      await input.fill('3');
      await input.press('Enter');
      await expect(input).toHaveValue('3');
      await expect.poll(async () => Number(await progress.getAttribute('aria-valuenow'))).toBeGreaterThan(0);
      await toolbar.getByRole('button', { name: 'Zoom in', exact: true }).click();
      await expect(toolbar.locator('.reader-zoom-value')).toHaveText('110%');
      // Zoom never changes the stable book-wide page count.
      await expect(toolbar.locator('.reader-page-count')).toHaveText(total!);
      await toolbar.getByRole('button', { name: 'Zoom out', exact: true }).click();
      await expect(toolbar.locator('.reader-zoom-value')).toHaveCount(0);
      await expect(toolbar.getByRole('button', { name: 'Zoom in', exact: true })).toBeEnabled();
      await expect(input).toHaveValue('3');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (mobile) await page.screenshot({ path: `test-results/${filename.endsWith('.pdf') ? 'pdf' : 'epub'}-toolbar-mobile.png` });
      await page.getByRole('button', { name: 'Back to library' }).click();
    }
    expect(appearances[0]).toEqual(appearances[1]);
  });
}

for (const mobile of [false, true]) {
  test(`${mobile ? 'mobile' : 'desktop'} EPUB switches scroll directions, shows bordered pages, and restores horizontal reading`, async ({ page }) => {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await samples(page);
    await page.getByRole('button', { name: 'Open A little room to read.epub' }).click();
    const reader = page.getByRole('region', { name: 'EPUB reader' });
    const horizontal = page.getByRole('button', { name: 'Horizontal scrolling', exact: true });
    const vertical = page.getByRole('button', { name: 'Vertical scrolling', exact: true });
    await expect(vertical).toHaveAttribute('aria-pressed', 'true');
    await expect(reader).toHaveAttribute('data-theme', 'light');
    await page.getByRole('button', { name: 'Switch to dark mode', exact: true }).click();
    await expect(horizontal).toBeEnabled();
    const total = await reader.locator('.reader-page-count').textContent();
    await horizontal.click();
    await expect(reader).toHaveAttribute('data-reading-mode', 'horizontal');
    await expect(horizontal).toHaveAttribute('aria-pressed', 'true');
    await expect(horizontal).toBeEnabled({ timeout: 20000 });
    await expect(page.frameLocator('iframe').first().locator('body')).toHaveCSS('background-color', 'rgb(24, 33, 28)');
    await expect(reader.locator('.epub-sheet')).toHaveCount(mobile ? 1 : 2);
    expect((await reader.locator('.epub-page').boundingBox())!.width).toBeGreaterThanOrEqual(page.viewportSize()!.width * .95);
    await expect(reader.locator('.reader-page-count')).toHaveText(total!);

    // Count real laid-out text inside each bordered sheet, rather than accepting
    // decorative empty page frames as a two-page reader.
    const visibleWords = () => reader.evaluate(element => {
      const papers = Array.from(element.querySelectorAll<HTMLElement>('.epub-sheet')).map(sheet => sheet.getBoundingClientRect());
      const words: Array<{ word: string; x: number; y: number; sheet: number }> = [];
      for (const frame of element.querySelectorAll('iframe')) {
        const doc = frame.contentDocument;
        if (!doc || getComputedStyle(frame).visibility === 'hidden') continue;
        const bounds = frame.getBoundingClientRect();
        const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = walker.nextNode())) {
          if ((node.parentElement?.closest('script,style'))) continue;
          for (const match of (node.textContent || '').matchAll(/\S+/g)) {
            const range = doc.createRange();
            range.setStart(node, match.index!);
            range.setEnd(node, match.index! + match[0].length);
            const rect = range.getBoundingClientRect();
            const x = bounds.left + rect.left, y = bounds.top + rect.top;
            const sheet = papers.findIndex(paper => x >= paper.left - 1 && x + rect.width <= paper.right + 1 && y >= paper.top - 1 && y + rect.height <= paper.bottom + 1);
            if (sheet >= 0 && rect.height > 0) words.push({ word: match[0], x, y, sheet });
          }
        }
      }
      words.sort((a, b) => a.sheet - b.sheet || Math.round(a.y / 3) - Math.round(b.y / 3) || a.x - b.x);
      return { text: words.map(word => word.word).join(' '), perSheet: papers.map((_, index) => words.filter(word => word.sheet === index).length) };
    });
    await expect.poll(async () => (await visibleWords()).perSheet.every(count => count > 15)).toBe(true);
    const initial = (await visibleWords()).text;
    const viewport = reader.locator('.epub-viewport');
    const bounds = (await viewport.boundingBox())!;
    await page.mouse.move(bounds.x + bounds.width * .6, bounds.y + bounds.height * .5);
    // A tiny wheel movement must be sufficient, even over the embedded chapter.
    await page.mouse.wheel(0, 2);
    await expect.poll(async () => (await visibleWords()).text).not.toBe(initial);
    await expect(horizontal).toBeEnabled();
    const afterWheel = (await visibleWords()).text;
    expect(afterWheel.length).toBeGreaterThan(60);
    await page.getByRole('button', { name: 'Back to library' }).click();
    await page.getByRole('button', { name: 'Open A little room to read.epub' }).click();
    await expect(horizontal).toHaveAttribute('aria-pressed', 'true');
    await expect(horizontal).toBeEnabled({ timeout: 20000 });
    await expect.poll(async () => (await visibleWords()).text).toBe(afterWheel);
    if (mobile) {
      const touch = await page.context().newCDPSession(page);
      const area = (await viewport.boundingBox())!;
      const y = area.y + area.height / 2;
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: area.x + area.width - 40, y }] });
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: area.x + 40, y }] });
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect.poll(async () => (await visibleWords()).text).not.toBe(afterWheel);
      await touch.detach();
    } else {
      await page.setViewportSize({ width: 800, height: 1000 });
      await expect(reader.locator('.epub-sheet')).toHaveCount(1);
      await expect.poll(async () => (await visibleWords()).perSheet.every(count => count > 15)).toBe(true);
      await page.setViewportSize({ width: 1440, height: 1000 });
      await expect(reader.locator('.epub-sheet')).toHaveCount(2);
      await page.setViewportSize({ width: 1920, height: 1000 });
      await expect.poll(async () => (await reader.locator('.epub-page').boundingBox())!.width).toBeGreaterThanOrEqual(1920 * .95);
      await expect(reader.locator('.epub-sheet')).toHaveCount(2);
      await expect.poll(async () => (await reader.locator('.epub-sheet').first().boundingBox())!.width).toBeGreaterThan(1920 * .44);
    }
    await page.screenshot({ path: `test-results/epub-horizontal-${mobile ? 'mobile' : 'desktop'}.png` });

    await vertical.click();
    await expect(vertical).toHaveAttribute('aria-pressed', 'true');
    await expect(vertical).toBeEnabled({ timeout: 20000 });
    await expect(reader.locator('.epub-sheet')).toHaveCount(0);
    expect(await reader.locator('.epub-container').evaluate(element => ['auto', 'scroll'].includes(getComputedStyle(element).overflowY))).toBe(true);
    await expect(reader.locator('.reader-page-count')).toHaveText(total!);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}
