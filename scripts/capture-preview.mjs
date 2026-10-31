import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
});
await page.goto('http://127.0.0.1:5173');
await page.getByRole('heading', { name: 'Your library.' }).waitFor();
await page.screenshot({ path: 'test-results/library-empty-desktop.png', fullPage: true });
await page.getByRole('button', { name: 'Try sample books' }).click();
await page.getByRole('button', { name: 'Open The art of noticing.pdf' }).click();
await page.locator('.pdf-page[data-page-number="1"] canvas').waitFor({ state: 'visible' });
await page.getByRole('button', { name: 'Zoom in', exact: true }).waitFor();
await page.waitForFunction(() => !document.querySelector('.pdf-status'));
await page.screenshot({ path: 'test-results/pdf-desktop.png' });
await page.getByRole('button', { name: 'Next page', exact: true }).click();
await page.waitForFunction(() => !document.querySelector('.pdf-status'));
await page.getByRole('button', { name: 'Back to library' }).click();
await page.screenshot({ path: 'test-results/library-desktop.png', fullPage: true });
await page.getByRole('button', { name: 'Open A little room to read.epub' }).click();
await page.frameLocator('iframe').getByRole('heading', { name: 'Begin where you are' }).waitFor();
await page.screenshot({ path: 'test-results/epub-desktop.png' });
await browser.close();
