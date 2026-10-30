# Leafmark

A small, quiet PDF and EPUB reader. Add your files, open a book, and pick up where you left off.

## Run locally

Requires a current Node.js release supported by Vite, such as Node 22.12+ or Node 24.

```sh
npm install
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). Choose **Try sample books** to explore a PDF and an EPUB, or use **Add books** to select your own files. You can also drop files onto the library.

The development server binds to this computer's loopback address by default.

## This MVP

- A responsive filename library with upload and deletion.
- Continuous PDF scrolling with page jumps and zoom. Only nearby pages render to keep long documents light on memory.
- Reflowable EPUB reading with a vertical/horizontal switch. Vertical scrolls continuously; horizontal shows bordered pages, two side by side on wide screens and one on narrow screens. Mouse wheel, trackpad, touch, and keyboard support reading navigation.
- Automatic reading positions that survive closing and reopening a book or refreshing the app. EPUB positions retain the visible text anchor and its vertical offset, and flush before returning to the library.
- A continue-reading shortcut and progress indicators.
- One shared toolbar for PDF and EPUB: previous/next page, page input and total, and zoom out/in. The percentage appears only away from 100%. EPUB page numbers use stable text locations across the whole book; saved positions still use the exact content anchor.
- Light styling, locally bundled fonts, and PWA manifest and icons.
- Two original sample books included in the repository.

Files and positions are stored in this browser's IndexedDB. They stay on this device and browser profile. Clearing site data removes the library; original files on your computer are unaffected. Each hostname and port has its own library, so keep using the same URL.

This local preview opens directly into the library. Shared-code access, Supabase storage, and cross-device synchronization are planned in [PLAN.md](PLAN.md) and are not connected in this version. There is no cloud account or deployment setup required to try it. Do not publish this preview as a private hosted library without adding those access controls.

Accepts ordinary `.pdf` and `.epub` files up to 50 MB. Password-protected PDFs, restricted Kindle downloads, and unusual fixed-layout EPUBs may be unsupported. The EPUB reader disables book scripts. Offline startup is not implemented.

PWA installation depends on the browser. On a supported browser, use its install-app action to open Leafmark from its own icon. This version has no service worker and does not promise offline startup.

## Checks

```sh
npm run build
npm run test:e2e
```

The browser tests cover PDF and EPUB reading and position persistence, file uploads and validation, deletion, and a phone-sized layout. Install the test browser once if needed:

```sh
npx playwright install chromium
```

For a local production build preview:

```sh
npm run build
npm run preview
```

The preview uses a different port and therefore a separate browser library.

The included samples can be regenerated with `node scripts/generate-samples.mjs`.
