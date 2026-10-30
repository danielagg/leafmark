# Personal ebook reader: implementation plan

Updated 2026-10-30. The reader MVP and private Supabase library are implemented.

The default app uses a code-only Supabase owner session, private Storage, and shared reading positions. The schema and access policies are applied to the existing project; its plan and billing settings are unchanged. An explicit development-only local preview retains browser storage. See [README.md](README.md) for setup, tests, and run instructions. Browser tests cover cloud resume and access isolation; native PWA installation on the target devices still needs manual verification.

## Product intent

Build a private, personal file library and reader for PDFs and EPUBs. Upload a file, open it on any supported device, and continue from the last saved reading position. Keep the product simple.

The app is for one person. Source code or a portfolio page may be public, but books and reading history must remain private.

## Confirmed scope

- Support Mac, Windows, Android phones, and Android tablets equally. There is no primary reading device.
- Provide an installable PWA that launches from its own app icon. Opening a browser window manually should not be part of daily use.
- Require internet for the first release. Offline reading and offline synchronization are deferred.
- Accept PDF and EPUB files through an in-app upload control.
- Show a simple file list using each file's original filename.
- Open files, save reading position automatically, and resume across devices.
- Include file deletion.
- Use a plain light-mode reader with only the controls needed to navigate and read the file.
- Protect the library with one shared access code, remembered on each device. No signup or account-management interface.
- Start with approximately 12–24 books, typically 5–10 MB each. Estimated original-file storage is 60–240 MB.
- Prefer a simple architecture that can run on free tiers, including Vercel Hobby.

The owner accepted the web application, Vercel, and Supabase approach. Implementation defaults below can be adjusted to make these requirements work without adding product scope.

## Out of scope

Title or author editing, metadata extraction, cover artwork, library search, custom sorting controls, folders, annotations, highlights, manual bookmarks, dark mode, reading themes, social features, multiple users, and offline support.

The app accepts existing PDF and EPUB files. Kindle account integration, book purchasing, file conversion, and removal of ebook restrictions are out of scope. Unsupported or protected files should produce a clear error.

## Name and appearance

Use Leafmark as a configurable working name. The owner has not selected final branding, and names or domains have not been checked.

Use a simple responsive layout, readable text, and a white reading background. Keep controls usable with touch, mouse, and keyboard. Preserve the document's own content and colors.

## Recommended stack

| Concern | Recommendation |
| --- | --- |
| UI | React + TypeScript + Vite |
| Installation | Web app manifest, app icons, standalone display |
| Hosting | Vercel Hobby, static frontend |
| Shared access code and remembered device access | Supabase Auth behind a code-only unlock screen |
| File records and saved positions | Supabase Postgres |
| Original files | Supabase private Storage |
| PDF rendering | Mozilla PDF.js |
| EPUB rendering | epub.js |

Verify installation and standalone launch in Helium on Mac and Windows, and Chrome on Android phones and tablets. Also support ordinary website use. PWA installation does not imply offline support; add a service worker only if a verified installation requirement calls for one.

## Shared access code and privacy

Recommended implementation: provision one confirmed owner identity in Supabase during setup. Use the shared access code as that identity's password. The UI asks only for the code and supplies a fixed, non-secret account identifier internally. The owner does not create or manage an account in the app.

- Use Supabase's password sign-in and persisted, renewable sessions to remember each device. Ask for the code again when a session can no longer be renewed or device storage has been cleared.
- Disable public signup. Restrict database and storage access to the configured owner's user ID using row-level security.
- Use a strong generated access code rather than a short numeric PIN. Verify the authentication service's protections against repeated failed attempts during setup.
- Keep the code out of source code, client configuration, logs, and local storage. Store session credentials through the SDK's session mechanism.
- Browser configuration may contain the Supabase URL, publishable key, and fixed account identifier. Privileged keys belong only in trusted setup tooling or server-side secrets.
- Keep the storage bucket private. Hiding controls or using an obscure URL does not protect data.

This keeps the direct-browser architecture and avoids a custom authentication backend. A single internal identity is sufficient for this personal library.

## File list and reading

The library shows filenames and an upload control. Use a fixed alphabetical order and allow deletion with a simple confirmation. Show useful empty, loading, upload, and failure states.

Open a file in the appropriate reader. Provide a way back to the library. Start PDFs fitted to the available width, with continuous vertical scrolling, page jumps, and basic zoom. Render nearby pages while reserving stable space for the whole document. Let EPUB text reflow to the available screen. Offer vertical continuous scrolling and horizontal paged reading with two bordered pages on wide screens or one on narrow screens. Wheel gestures move horizontally in horizontal mode; switching layouts retains the content location. Both formats share one toolbar for previous/next page, book-wide page input and total, and zoom out/in. Show the zoom percentage only away from 100%. EPUB page numbers use stable text locations; preserve the exact content locator for resume. Extra appearance settings are deferred.

Keep EPUB scripts disabled. Treat file content and filenames as untrusted input. Test the reader with representative books before building the rest of the app around it.

## File handling

1. Unlock the app through the remembered owner session or shared code.
2. Validate the selected file's type and size. Use a 50 MB upload limit for the initial Supabase Free deployment and report unsupported files clearly.
3. Generate a unique book ID and upload directly from the browser to private Storage under an owner-scoped path. Keep the original filename separately for display.
4. Use resumable TUS uploads for files above 6 MB. Show upload progress and allow retry after failure.
5. Create the database record after the upload succeeds. If that write fails, attempt to remove the uploaded object and report the failure. Do not show an incomplete book as ready to read.
6. Open the file through an authenticated storage request or a short-lived signed URL. Store the object path in the database, never the signed URL. If signed URLs are used, handle renewal during long sessions and later range requests.
7. For deletion, remove the storage object and then the database record. Make retries tolerate an object that was already deleted. Report partial failures so the owner can retry.

Do not route book bytes through a Vercel Function. The expected files exceed its ordinary 4.5 MB request/response payload limit. Keep PDF.js workers and supporting assets compatible with the deployed renderer version.

## Saved reading position

Store one current position per book, directly on its database row. A separate progress table is unnecessary for this single-user app.

- PDF positions contain a one-based document page number and a normalized vertical offset within the page. Convert consistently at renderer boundaries. Printed page labels may differ from document page numbers.
- EPUB positions contain an EPUB CFI, its vertical offset within the reading viewport, and a chapter reference as a fallback. Restore after fonts settle and capture the current visible position before returning to the library. Screen-dependent page numbers are unsuitable for resuming on a different device.
- Fetch the latest saved position whenever a book opens and restore it before enabling progress writes.
- Save after actual reading navigation, with a short debounce. Serialize writes within a reader so older requests cannot overtake newer ones.
- Do not write an old position just because a reader mounts, restores a position, becomes idle, or closes. Hidden readers must not keep sending progress updates.
- For simultaneous active use, the last successful save wins. Do not add merge dialogs or a device-management interface.
- Show a small failure indication if progress cannot be saved. Retry while the reader is active and connected. Do not silently claim progress is synchronized.

The first release restores the latest position when a book is reopened. It does not move an already open reader in response to another device.

## Minimum data model

| Table | Fields |
| --- | --- |
| `books` | `id`, `owner_id`, `filename`, `format`, `storage_path`, `byte_size`, nullable `reading_position`, nullable `last_read_at`, `created_at` |

Use `pdf` or `epub` for `format`. Store the format-specific locator as validated JSON in `reading_position`. Set progress timestamps on the server. Use unique storage paths even when two files have the same filename.

Database and Storage need separate owner-restricted policies. Access requires the configured owner identity; an arbitrary authenticated session must not grant access to the library.

## Implementation sequence

1. Scaffold the frontend and prove PDF and EPUB opening with sample files on desktop and Android. Check mobile memory use, layout changes, and position restoration.
2. Configure Supabase, the single owner identity, private Storage, database schema, and access policies. Add the code-only unlock screen and remembered sessions.
3. Build the filename list, direct uploads, upload recovery, and deletion.
4. Add saved positions and verify resume between devices, including failure handling.
5. Add PWA metadata and icons, verify standalone launch, and deploy to Vercel with setup instructions.

## Acceptance criteria

- A new device asks for the shared code. Correct entry unlocks the library; incorrect entry does not. A remembered valid session survives closing and reopening the app.
- Unauthenticated requests and unrelated authenticated users cannot list, download, change, or delete books or reading positions.
- Upload a representative PDF and EPUB from each supported device class. Their original filenames appear, and both open in the reader.
- Files above 6 MB use the intended resumable path. Unsupported files, files over the limit, and interrupted uploads produce useful errors or retry behavior.
- Read part of a PDF, close it, and reopen on another device. Resume at the saved page and approximate position within the page.
- Repeat with an EPUB across different screen sizes and orientations. Resume at the same content location.
- Opening or closing an idle reader does not overwrite more recent progress from another device.
- Network failures show the save or upload failure. The app does not claim offline availability or successful synchronization after a failed save.
- Deletion removes the file and its record, including saved progress. Partial deletion can be retried.
- Install and launch from an app icon on Mac, Windows, an Android phone, and an Android tablet. Confirm standalone presentation and usable touch controls.
- The production build contains no access code or privileged keys. Reader content cannot execute EPUB scripts.

## Reference documentation

- [Supabase password sign-in](https://supabase.com/docs/reference/javascript/auth-signinwithpassword)
- [Supabase owner identity provisioning](https://supabase.com/docs/reference/javascript/auth-admin-createuser)
- [Supabase sessions](https://supabase.com/docs/guides/auth/sessions)
- [Supabase database row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
- [Supabase resumable uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads)
- [Supabase file limits](https://supabase.com/docs/guides/storage/uploads/file-limits)
- [Vercel Function limits](https://vercel.com/docs/functions/limitations)
- [PDF.js setup](https://mozilla.github.io/pdf.js/getting_started/)
- [epub.js scripted content](https://github.com/futurepress/epub.js#scripted-content)
- [PWA installation requirements](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)
- [Helium](https://helium.computer/)
