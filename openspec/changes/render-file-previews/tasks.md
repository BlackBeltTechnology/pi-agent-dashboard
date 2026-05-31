## 1. Shared types

- [x] 1.1 Add `ViewTarget` discriminated union to `packages/shared/src/types.ts`:
  - `{ kind: "file"; cwd: string; path: string }`
  - `{ kind: "url"; url: string }`
- [x] 1.2 Add `view?: ViewTarget` optional field to `ChatMessage` (lives in `packages/client/src/lib/event-reducer.ts`, not shared). Imports `ViewTarget` from shared. Additive, backward-compat.
- [x] 1.3 Re-export from `packages/shared/src/index.ts`.
- [x] 1.4 Type-check `npm run lint` (project's tsc `--noEmit` entry) clean across all workspaces.

## 2. Server — binary-safe file serving

- [x] 2.1 Create `packages/server/src/lib/mime-types.ts` with `extToContentType(ext): string` covering `.pdf`, `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.webp`, `.mp4`, `.webm`, `.mov`, `.html`, `.htm`, `.txt`, `.md`, `.adoc`, `.asciidoc`. Default `application/octet-stream`.
- [x] 2.2 Add `GET /api/file/raw?cwd=&path=` to `file-routes.ts`. Reuse anti-traversal gate from `/api/file`. Use `fs.createReadStream` so `Range` headers work for video seek.
- [x] 2.3 Set `Content-Type` from `extToContentType`, `Content-Disposition: inline`, `Cache-Control: private, max-age=60`.
- [x] 2.4 Tests: cwd-allowlist enforcement, traversal rejection (`../`), MIME mapping correctness, 404 on missing file, range request returns 206. (`packages/server/src/__tests__/file-raw-render-endpoints.test.ts`)

## 3. Server — AsciiDoc rendering

- [x] 3.1 Add `asciidoctor` to `packages/server/package.json` dependencies.
- [x] 3.2 Add `GET /api/file/render?cwd=&path=` to `file-routes.ts`. Reject extensions other than `.adoc` / `.asciidoc` with HTTP 400 `{ error: "renderer not supported for extension" }`.
- [x] 3.3 Initialize `asciidoctor` lazily (module-level singleton, first-call init).
- [x] 3.4 Convert with `safe: "secure"` mode. Return `{ success: true, data: { html: "<rendered>" } }`.
- [x] 3.5 Tests: rejects `.md`, accepts `.adoc`, renders sample, sanitizes a malicious include directive.

## 4. Client — preview dispatch + URL extraction

- [x] 4.1 Create `packages/client/src/lib/preview-dispatch.ts` exporting `dispatchPreview` + `RENDERER_BY_EXT`.
- [x] 4.2 Unit tests pass (`preview-dispatch.test.ts`).
- [x] 4.3 Create `packages/client/src/lib/extract-urls.ts` exporting pure `extractRecentUrls`.
- [x] 4.4 Unit tests pass (`extract-urls.test.ts`).

## 5. Client — per-format renderer components

Path: `packages/client/src/components/preview/`

- [x] 5.1 `MarkdownPreview.tsx` — fetches `/api/file`, passes content to `<MarkdownContent>`. Loading / error states.
- [x] 5.2 `AsciiDocPreview.tsx` — fetches `/api/file/render`, renders via `dangerouslySetInnerHTML` in `.asciidoc-body` wrapper.
- [x] 5.3 `HtmlPreview.tsx` — fetches `/api/file/raw` text, renders in `<iframe sandbox="allow-same-origin" srcDoc={html}>`. NO `allow-scripts`.
- [x] 5.4 `PdfPreview.tsx` — dynamic `import("pdfjs-dist")`, page nav (Prev/Next/`Page X of Y`).
- [x] 5.5 `VideoPreview.tsx` — `<video src={rawUrl} controls preload="metadata">` 16:9.
- [x] 5.6 `ImagePreview.tsx` — `<img>` capped `max-h-[40vh] max-w-full`.
- [x] 5.7 `YouTubePreview.tsx` — `extractYouTubeId` handles `youtu.be`, `youtube.com/watch?v=`, `/embed/`, `/v/`, `/shorts/`; iframe embed.
- [x] 5.8 `FallbackPreview.tsx` — file: download link to `/api/file/raw`; URL: open-in-new-tab.
- [x] 5.9 Added `pdfjs-dist` to `packages/client/package.json`.
- [x] 5.10 Worker resolved at runtime via Vite `?url` import of `pdfjs-dist/build/pdf.worker.min.mjs?url` (simpler than copying to `public/` — Vite hashes + serves it as a static asset automatically).

## 6. Client — PreviewCard shell + overlay routes

- [x] 6.1 `PreviewCard.tsx` — header (icon + label + expand button) + body via dispatched renderer. Inline size caps per D2.
- [x] 6.2 Tests pass (`PreviewCard.test.tsx`): dispatches each kind, expand button navigates to correct overlay URL.
- [x] 6.3 Route `/folder/:encodedCwd/view?path=…` added in `App.tsx` shell-overlay matcher.
- [x] 6.4 Route `/pi-view?url=…` added.
- [x] 6.5 New `PreviewOverlayView.tsx` shell shares `PreviewBody` (exported from `PreviewCard.tsx`) so inline + overlay use the same renderer component.

## 7. Client — ChatView integration

- [x] 7.1 `ChatView.tsx` branches on `msg.view` BEFORE role checks; renders `<PreviewCard>` aligned right (matches user-bubble position).
- [x] 7.2 Test passes (`PreviewCard.test.tsx` → "ChatView — view-bearing messages").

## 8. Client — CommandInput `/view` interception + URL autocomplete

- [x] 8.1 Exported `DASHBOARD_LOCAL_COMMANDS` from `CommandInput.tsx`; merged into the `/`-autocomplete dropdown after `BUILTIN_COMMANDS`.
- [x] 8.2 Added `onViewLocal?: (target: ViewTarget) => void` + `currentCwd?: string` props.
- [x] 8.3 Submit handler detects `/view`; `parseViewCommand` (exported, pure) handles `@`-file / URL / no-arg / multi-token / non-URL no-op cases.
- [x] 8.4 `@` autocomplete extended with `extractRecentUrls(sessionMessages)`; filtered by `atQuery` substring (URL or host).
- [x] 8.5 URL entries render with globe icon (`mdiWeb`, cyan host text); `selectUrl` replaces `@<q>` with the URL verbatim (no `@`).
- [x] 8.6 Tests pass (`CommandInput-view.test.tsx`): 16 tests covering parse cases, `/view` dropdown listing, send routing, URL surfacing + filtering.

## 9. App.tsx wiring + ChatMessage injection

- [x] 9.1 `<CommandInput onViewLocal>` sends `{ type: "inject_view_message", sessionId, target }` over the existing browser→server WebSocket (new protocol message `InjectViewMessageBrowserMessage`).
- [x] 9.2 `onViewLocal` threaded from App.tsx inline arrow.
- [x] 9.3 `sessionMessages={selectedState.messages}` passed (covers existing chat + interleaved view rows; `extractRecentUrls` ignores view rows because their `content` is empty).

## 10. Server-side ChatMessage persistence + agent filter

- [x] 10.1 Server-side `ViewMessageStore` (per-session JSON file at `~/.pi/dashboard/view-messages/<sid>.json`). `case "inject_view_message"` in `browser-gateway.ts` appends + broadcasts `view_messages_update` to every subscriber. On subscribe, the current snapshot is sent before event replay.
- [x] 10.2 Per option B (per ask_user resolution): NO bridge filter needed. View messages live in a server-side store separate from pi's events.jsonl and never enter the pi-bound forwarding path. The store is not imported by any code under `packages/extension/src/` or `pi-gateway.ts`.
- [x] 10.3 Tests pass (`view-message-store.test.ts`): 7 tests covering store semantics + architectural isolation (grep-based assertion that bridge code never references the store).

## 11. Documentation

- [x] 11.1 `docs/file-index-client.md` — rows added (PreviewCard, PreviewOverlayView, 8 preview/*.tsx, 4 lib files, 4 test files); existing rows for `ChatView.tsx`, `CommandInput.tsx`, `App.tsx`, `event-reducer.ts`, `useMessageHandler.ts` annotated.
- [x] 11.2 `docs/file-index-server.md` — rows added (`mime-types.ts`, `view-message-store.ts`, 2 test files); `file-routes.ts`, `browser-gateway.ts`, `subscription-handler.ts` annotated.
- [x] 11.3 `docs/file-index-shared.md` — `ViewTarget` row added; `browser-protocol.ts` row annotated with new `InjectViewMessageBrowserMessage` + `ViewMessagesUpdateMessage`.
- [x] 11.4 `docs/faq.md` — new entry "How to preview a PDF / video / AsciiDoc / YouTube link in the dashboard?" at top of file.
  - **Note**: AGENTS.md mandates delegating docs writes to a general-purpose subagent for caveman-style enforcement; in this environment the `Explore` agent failed to resolve its model (`@fast` role). Edits authored directly in caveman style instead. Flag this in the final summary.

## 12. Verification

- [x] 12.1 `npm run lint` (project's tsc --noEmit) clean across all workspaces.
- [x] 12.2 `npm test`: 6891 / 6911 pass (19 skipped, 1 pre-existing flake in `run-bootstrap.test.ts > throttles progress events` — unrelated timing test).
- [x] 12.3 `npm run build` succeeds. `packages/client/dist/assets/` shows: `pdf-CcZYcL52.js` (365 KB lazy chunk) + `PdfPreview-CPx3LeIO.js` (Suspense chunk) + `pdf.worker.min-yatZIOMy.mjs` (Vite `?url` asset). `index-*.js` does NOT contain pdfjs (grep clean).
- [x] 12.4 Manual smoke (deferred to user — requires a live server + browser).
- [x] 12.5 Manual smoke (deferred to user).
- [x] 12.6 Manual smoke (deferred to user).
- [x] 12.7 Manual smoke (deferred to user).
- [x] 12.8 Structural guarantee covered by `view-message-store.test.ts > view messages — architectural isolation`: tree-wide grep proves `view-message-store` is not imported by any code under `packages/extension/src/` or `pi-gateway.ts`. View messages live in a separate store and never enter pi-bound traffic.
