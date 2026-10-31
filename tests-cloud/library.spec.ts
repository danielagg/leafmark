import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';

const client = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY!,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  },
);
const ownerId = process.env.VITE_OWNER_ID!;
const code = process.env.LEAFMARK_ACCESS_CODE!;

async function unlock(page: Page) {
  await page.goto('/');
  await expect(page.getByLabel('Library code', { exact: true })).toBeVisible();
  // Avoid putting the code in Playwright action logs, even on a failed action.
  await page.evaluate((value) => {
    const input = document.querySelector<HTMLInputElement>('#library-code')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, code);
  await page.getByRole('button', { name: 'Unlock library', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Lock library' })).toBeVisible();
}

test('private cloud library remembers sessions, resumes across devices, uploads with TUS, and deletes', async ({
  browser,
}) => {
  expect(code, 'Set LEAFMARK_ACCESS_CODE before running live cloud tests').toBeTruthy();
  const auth = await client.auth.signInWithPassword({
    email: process.env.VITE_OWNER_EMAIL!,
    password: code,
  });
  if (auth.error) throw new Error(`Test owner sign-in failed (${auth.error.code}).`);
  const prefix = `cloud-test-${crypto.randomUUID()}`;
  const first = await browser.newContext();
  const second = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const desktop = await first.newPage();
  const phone = await second.newPage();
  const errors: string[] = [];
  for (const page of [desktop, phone]) page.on('pageerror', (error) => errors.push(error.message));
  try {
    await desktop.goto('/');
    await desktop.getByLabel('Library code', { exact: true }).fill('incorrect-library-code');
    await desktop.getByRole('button', { name: 'Unlock library', exact: true }).click();
    await expect(desktop.getByRole('alert')).toContainText('didn’t unlock');
    await expect(desktop.getByRole('button', { name: 'Add books', exact: true })).toHaveCount(0);
    await unlock(desktop);
    await desktop.reload();
    await expect(desktop.getByRole('button', { name: 'Lock library' })).toBeVisible();

    const pdfName = `${prefix}.pdf`;
    const pdf = await readFile('public/samples/The art of noticing.pdf');
    const largePdf = Buffer.concat([pdf, Buffer.alloc(7 * 1024 * 1024 - pdf.length, 32)]);
    const tusRequests: string[] = [];
    desktop.on('request', (request) => {
      if (request.url().includes('/storage/v1/upload/resumable'))
        tusRequests.push(request.method());
    });
    await desktop
      .getByLabel('Choose PDF or EPUB books')
      .setInputFiles({ name: pdfName, mimeType: 'application/pdf', buffer: largePdf });
    await expect(desktop.getByRole('button', { name: `Open ${pdfName}`, exact: true })).toBeVisible(
      { timeout: 60_000 },
    );
    expect(tusRequests).toContain('POST');
    expect(tusRequests).toContain('PATCH');
    await desktop.getByRole('button', { name: `Open ${pdfName}`, exact: true }).click();
    await expect(desktop.locator('.pdf-page[data-page-number="1"] canvas')).toBeVisible({
      timeout: 20_000,
    });
    await desktop.getByRole('button', { name: 'Next page', exact: true }).click();
    await desktop.getByRole('button', { name: 'Back to library' }).click();
    await expect
      .poll(
        async () =>
          (await client.from('books').select('reading_position').eq('filename', pdfName).single())
            .data?.reading_position?.page,
      )
      .toBe(2);

    await unlock(phone);
    await phone.getByRole('button', { name: `Open ${pdfName}`, exact: true }).click();
    await expect(phone.getByRole('spinbutton')).toHaveValue('2', { timeout: 20_000 });
    await phone.getByRole('button', { name: 'Next page', exact: true }).click();
    await phone.getByRole('button', { name: 'Back to library' }).click();
    await expect
      .poll(
        async () =>
          (await client.from('books').select('reading_position').eq('filename', pdfName).single())
            .data?.reading_position?.page,
      )
      .toBe(3);
    await desktop.getByRole('button', { name: `Open ${pdfName}`, exact: true }).click();
    await expect(desktop.getByRole('spinbutton')).toHaveValue('3');
    let failProgress = true;
    await desktop.route('**/rest/v1/books?*', (route) =>
      route.request().method() === 'PATCH' && failProgress
        ? route.abort('failed')
        : route.continue(),
    );
    await desktop.getByRole('button', { name: 'Next page', exact: true }).click();
    await expect(desktop.getByRole('alert')).toContainText('Your position could not be saved.');
    await expect(desktop.locator('.reader-status')).toBeEmpty();
    expect(
      (await client.from('books').select('reading_position').eq('filename', pdfName).single()).data
        ?.reading_position?.page,
    ).toBe(3);
    failProgress = false;
    await desktop.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect
      .poll(
        async () =>
          (await client.from('books').select('reading_position').eq('filename', pdfName).single())
            .data?.reading_position?.page,
      )
      .toBe(4);
    await expect(desktop.locator('.reader-status')).toBeEmpty();
    await expect(desktop.getByRole('alert')).toHaveCount(0);
    // An idle reader must not overwrite a newer save from another device.
    const updated = await client
      .from('books')
      .update({ reading_position: { type: 'pdf', page: 2, offset: 0 }, progress: 0.25 })
      .eq('filename', pdfName);
    expect(updated.error).toBeNull();
    await desktop.getByRole('button', { name: 'Back to library' }).click();
    expect(
      (await client.from('books').select('reading_position').eq('filename', pdfName).single()).data
        ?.reading_position?.page,
    ).toBe(2);

    const epubName = `${prefix}.epub`;
    await desktop.getByLabel('Choose PDF or EPUB books').setInputFiles({
      name: epubName,
      mimeType: 'application/epub+zip',
      buffer: await readFile('public/samples/A little room to read.epub'),
    });
    await desktop.getByRole('button', { name: `Open ${epubName}`, exact: true }).click();
    await expect(desktop.locator('.epub-viewport')).toHaveAttribute('aria-busy', 'false', {
      timeout: 20_000,
    });
    await desktop.getByRole('button', { name: 'Next page', exact: true }).click();
    await expect(desktop.locator('.epub-overlay')).toHaveCount(0);
    await expect(desktop.getByRole('spinbutton')).toHaveValue('2');
    await desktop.getByRole('button', { name: 'Back to library' }).click();
    await expect
      .poll(
        async () =>
          (await client.from('books').select('reading_position').eq('filename', epubName).single())
            .data?.reading_position?.cfi,
      )
      .toMatch(/^epubcfi\(/);
    const saved = (
      await client.from('books').select('reading_position').eq('filename', epubName).single()
    ).data!.reading_position;
    await phone.reload();
    await phone.getByRole('button', { name: `Open ${epubName}`, exact: true }).click();
    await expect(phone.locator('.epub-viewport')).toHaveAttribute('aria-busy', 'false', {
      timeout: 20_000,
    });
    await expect(phone.locator('.epub-overlay')).toHaveCount(0);
    await expect(phone.getByRole('spinbutton')).toHaveValue('2');
    await phone.getByRole('button', { name: 'Back to library' }).click();
    expect(
      (await client.from('books').select('reading_position').eq('filename', epubName).single()).data
        ?.reading_position,
    ).toEqual(saved);

    const row = (await client.from('books').select('storage_path').eq('filename', pdfName).single())
      .data!;
    await desktop.getByRole('button', { name: `Delete ${pdfName}`, exact: true }).click();
    await desktop.getByRole('button', { name: 'Remove book', exact: true }).click();
    await expect(desktop.getByRole('alertdialog')).toHaveCount(0);
    await expect(desktop.getByRole('button', { name: `Open ${pdfName}`, exact: true })).toHaveCount(
      0,
    );
    expect((await client.from('books').select('id').eq('filename', pdfName)).data).toEqual([]);
    expect((await client.storage.from('books').download(row.storage_path)).error).toBeTruthy();
    await desktop.getByRole('button', { name: 'Lock library' }).click();
    await expect(desktop.getByLabel('Library code', { exact: true })).toBeVisible();
    await desktop.reload();
    await expect(desktop.getByLabel('Library code', { exact: true })).toBeVisible();
    await phone.reload();
    await expect(phone.getByRole('button', { name: 'Lock library' })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await first.close();
    await second.close();
    const { data } = await client
      .from('books')
      .select('id,storage_path')
      .eq('owner_id', ownerId)
      .like('filename', `${prefix}%`);
    if (data?.length) {
      const removed = await client.storage
        .from('books')
        .remove(data.map((row) => row.storage_path));
      if (removed.error) throw new Error('Could not clean up cloud test files.');
      const deleted = await client
        .from('books')
        .delete()
        .in(
          'id',
          data.map((row) => row.id),
        );
      if (deleted.error) throw new Error('Could not clean up cloud test records.');
    }
    await client.auth.signOut({ scope: 'local' });
  }
});
