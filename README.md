# Leafmark

A small, private PDF and EPUB reader. Add your files, open a book, and pick up where you left off on another device.

Live library: [leafmark-lemon.vercel.app](https://leafmark-lemon.vercel.app).

## Run locally

Requires Node 22.12+ or Node 24.

```sh
npm install
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The configured app uses Supabase and asks for your library code. This machine's ignored `.env.local` contains the connection settings and `LEAFMARK_ACCESS_CODE`. The code is a Supabase password, never a frontend environment variable.

For a preview without a cloud account, run `npm run dev:local`. This development-only mode stores files and positions in this browser's IndexedDB. Existing local books remain there; upload their original files into the cloud library to use them across devices. Clearing site data removes local books. Each hostname and port has its own local library.

Both modes include **Try sample books**, a PDF and an EPUB you can remove afterward. Use **Add books** or drop files into the library for your own files. The development server binds to this computer's loopback address.

Use the pencil beside a book to edit its display title. Titles sync with your cloud library; the original filename, file contents, and reading progress stay intact.

The library shows first-page previews for PDFs and embedded cover images for EPUBs, with format icons when no preview is available. Small previews are saved privately with the library. Older books get previews as they come into view without changing their reading history.

## Cloud setup

The existing Supabase project is `wvcwmujpnhrpzjkmuhsw`. Setup uses its existing Free plan. No subscription, compute, or paid add-on settings are configured by this repo.

The migration creates `public.books`, a private `books` storage bucket, and a private singleton owner allowlist. Database and Storage policies independently require that owner. An arbitrary signed-in user has no library access. Global public signup and anonymous sign-in are disabled; the email/password provider remains enabled for the provisioned owner.

On a trusted computer with the Supabase CLI installed and logged in:

```sh
supabase link --project-ref wvcwmujpnhrpzjkmuhsw
supabase config diff --project-ref wvcwmujpnhrpzjkmuhsw
supabase config push --project-ref wvcwmujpnhrpzjkmuhsw
supabase db push --linked --skip-vault
npm run setup:owner
```

The migration has already been applied to this project. `setup:owner` creates one confirmed internal identity and a strong random code, records its ID in the trusted allowlist, and writes `.env.local` with owner-only file permissions. It obtains a privileged API key in memory through the logged-in CLI and never writes that key. Rerunning it verifies the existing code and owner; it does not reset credentials or replace an existing owner. The app has no signup or account-management screens.

Use `.env.example` as the public configuration template. These four values may be included in a frontend build:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_OWNER_EMAIL`, an internal non-secret identifier
- `VITE_OWNER_ID`

Keep the access code, database password, and privileged keys out of `VITE_*` variables, source control, and hosting configuration. Production builds require the public configuration and always use the unlock screen, even if `VITE_STORAGE_MODE=local` is set.

Sessions are remembered on each device. **Lock library** signs out only that device. Internet is required to open files and save progress. Failed saves show an error and retry while the reader is open, visible, and connected. Reopening a book fetches its latest position; the last successful save wins if two devices are actively reading.

Uploads go directly to private Supabase Storage, using TUS above 6 MiB. The per-file limit is 50 MiB. File records are created only after upload; failed record creation attempts file cleanup. Deletion removes bytes first and then the record so partial failures can be retried. Cloud files are downloaded into memory when opened, not copied into IndexedDB.

Supabase Free has limited storage and transfer allowances and may pause inactive projects. Keep original copies of your books. See [Supabase pricing](https://supabase.com/pricing) for current limits.

## Host on Vercel

Import this repository as a Vite project. `vercel.json` specifies the build and output directory. Add only the four public variables above to production, then deploy. Book uploads bypass Vercel Functions. No server or paid database integration is needed.

The production project and public variables are configured, and the live deployment passed the cloud browser tests. The repository is connected to Vercel for automatic deployment on pushes to `main`.

For a local production build preview, run `npm run build` and `npm run preview`. This uses the cloud library and its own remembered device session.

## Reader

- Filename library, upload, deletion, continue-reading shortcut, and progress indicators.
- Continuous PDF scrolling with page jumps and zoom. Only nearby pages render to limit memory use.
- EPUB vertical continuous scrolling or horizontal book spreads, two pages on wide screens and one on narrow screens. Horizontal mode uses a continuous paper background, generous margins, larger responsive type, and natural paragraph spacing. Supports wheel, trackpad, touch, and keyboard navigation.
- One shared toolbar for page navigation and zoom. The percentage appears only away from 100%.
- A shared bottom progress bar with a highlighted percentage read in both formats.
- Automatic resume using PDF page/offset or an EPUB content anchor. EPUB page numbers use stable text locations across the book.
- EPUB White / Sepia / Black theme switch with White as the default and the choice remembered on each device. Bundled fonts, PWA manifest, and app icons.

Accepts ordinary `.pdf` and `.epub` files. Password-protected PDFs, restricted Kindle downloads, and unusual fixed-layout EPUBs may be unsupported. Book scripts are disabled. Offline startup is not implemented.

PWA installation depends on the browser. Use a supported browser's install-app action to launch Leafmark from its own icon. There is no service worker or offline reading promise. Native installation still needs manual verification on the target devices.

## Styling and formatting

The app uses Tailwind CSS v4 through its Vite plugin. Shared colors, fonts, radii, and reader dark-mode tokens live in `src/styles.css`. Reusable shadcn/ui components live in `src/components/ui`; screen layouts use Tailwind utilities. `components.json` configures the `@/` import alias and component registry.

The EPUB engine creates its own scroll containers and chapter iframes. Its small integration stylesheet is `src/readers/epub-reader.css`; the isolated chapter typography is in `src/readers/epub-content.css`.

Prettier formats JSX with one attribute per line and sorts Tailwind classes:

```sh
npm run format
npm run format:check
```

## Checks

```sh
npm run build
npm run format:check
npm run test:e2e
npm run test:cloud
npm run test:security
```

Install Chromium once with `npx playwright install chromium`. The 11 local browser tests use port 4173 and explicit IndexedDB mode. Live cloud tests use port 4174 and `.env.local`; they create and remove uniquely named test books. Traces and videos are disabled to avoid recording credentials.

Cloud tests cover incorrect codes, remembered sessions, device-local locking, 7 MiB TUS upload, PDF and EPUB resume across desktop/phone contexts, failed-save recovery, idle-reader protection, and deletion. `test:security` also requires the logged-in CLI to provision and remove a temporary unrelated identity and verify that both it and anonymous visitors are denied access. No check changes billing settings.

To check a hosted deployment, run `LEAFMARK_TEST_URL=https://your-deployment.vercel.app npm run test:cloud` using the same configured owner. The tests leave your other books alone.

The included samples can be regenerated with `node scripts/generate-samples.mjs`.
