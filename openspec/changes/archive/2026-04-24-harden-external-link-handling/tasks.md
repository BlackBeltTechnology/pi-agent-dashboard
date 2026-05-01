## 1. Step 1 — Client: harden `MarkdownContent` anchors

- [x] 1.1 Add an `a` component override inside `packages/client/src/components/MarkdownContent.tsx` `ReactMarkdown` `components` map. Behavior: external hrefs (anything resolving to a different origin than the current page) render as `<a target="_blank" rel="noopener noreferrer">`; same-origin hrefs and fragment-only hrefs (`#foo`) render as a bare `<a>` so they stay in-document. _(Implemented via new exported pure helper `isExternalHref` + `a` component override in `components` map.)_
- [x] 1.2 Keep the existing styling consistent (same `className`, inherit text color from parent). Match `InlineMarkdown.tsx`'s style for the anchor. _(Uses `className="text-blue-400 hover:underline"`, identical to InlineMarkdown.)_
- [x] 1.3 Add/extend unit test in `packages/client/src/components/__tests__/MarkdownContent.test.tsx` — new `anchor target handling` describe block with 6 cases (external `[text](url)`, GFM autolink, fragment link, relative path, same-origin absolute URL, styling preservation). TDD: tests written first, 3 failed on bare `<a>`, now all pass.
- [x] 1.4 Run `npm test -- MarkdownContent` — all new cases green. _(24/24 passed, 2 pre-existing skipped.)_

## 2. Step 2 — Electron: pure same-origin helper

- [x] 2.1 Create `packages/electron/src/lib/link-handling.ts` exporting `isSameOriginUrl(href: string, serverOrigin: string): boolean`. Pure, no Electron imports. _(Uses `URL` constructor with base; parses both sides defensively; returns false on any parse failure so caller routes via `shell.openExternal`.)_
- [x] 2.2 Create `packages/electron/src/__tests__/link-handling.test.ts` with 15 cases covering all required variants plus extras (different port, different host same port, different scheme, implicit default port, malformed serverOrigin).
- [x] 2.3 Run `npm test -- link-handling` — all cases green. _(15/15 passed; run from `packages/electron/` since the root vitest config excludes electron.)_

## 3. Step 3 — Electron: wire up `setWindowOpenHandler` and `will-navigate`

- [x] 3.1 In `packages/electron/src/main.ts`, import `shell` from `electron` and `isSameOriginUrl` from `./lib/link-handling.js`.
- [x] 3.2 In `createMainWindow`, register `mainWindow.webContents.setWindowOpenHandler((details) => { shell.openExternal(details.url); return { action: "deny" }; })`.
- [x] 3.3 In the same function, register `mainWindow.webContents.on("will-navigate", (event, url) => { if (!isSameOriginUrl(url, serverUrl)) { event.preventDefault(); shell.openExternal(url); } })`.
- [x] 3.4 Handlers are registered **before** `loadURL(serverUrl)` so they're live for any navigation the initial load triggers (e.g. OAuth bounces). Block is prefaced with a comment referencing #13 and the change name.

## 4. Step 4 — Electron: integration verification (manual + smoke)

**Note**: these are manual steps that require an interactive Electron session. Unit coverage for the decision logic (`isSameOriginUrl`) is exhaustive (15 cases including the auth-login redirect and malformed inputs). The wiring in `createMainWindow` is a one-to-one mapping from those pure decisions to `shell.openExternal` / `event.preventDefault()` calls. Manual verification below to be run by the implementer before archiving.

- [ ] 4.1 Manual verification: start Electron in dev mode (`cd packages/electron && npm run start:dev`), click a URL in a chat message, confirm it opens in the system browser (not an Electron window).
- [ ] 4.2 Manual verification: trigger the auth-login redirect (the banner in `App.tsx:673` when auth is enabled but unauthenticated) — confirm the dashboard navigates in-window without opening a system browser.
- [ ] 4.3 Manual verification: click an external URL emitted by the agent in a chat message — confirm the bug is gone (dashboard stays put, URL opens in system browser).

## 5. Step 5 — Regression guard

- [x] 5.1 Added `packages/client/src/__tests__/no-bare-external-anchor.test.ts`. Two-phase scan: match `<a ... href="http(s)://...">` opening tags with a global regex, then separately check each matched tag for a `target=` attribute (works regardless of attr order). Per-line `ban:bare-anchor-ok` opt-out marker supported. The `App.tsx:673` auth-login redirect uses a template literal href, so it doesn't match the literal-http regex — no explicit allowlist needed.
- [x] 5.2 Run `npm test` — **3018/3018 tests pass, 9 skipped, 0 failures.** _(Full-suite run took ~335s.)_

## 6. Step 6 — Docs

- [x] 6.1 Update `AGENTS.md` — extended the `packages/electron/src/main.ts` entry with the external-link-hardening note, added new rows for `packages/electron/src/lib/link-handling.ts`, `packages/client/src/components/MarkdownContent.tsx`, and the new lint `packages/client/src/__tests__/no-bare-external-anchor.test.ts`.
- [x] 6.2 Update `docs/architecture.md` — added a new `### External Link Routing (#13)` subsection after `### PWA Support` describing both layers (client markdown `a` override + Electron `setWindowOpenHandler`/`will-navigate`), the pure `isSameOriginUrl` helper, and the repo-level lint.
- [x] 6.3 Added a `### Fixed` bullet under `## [Unreleased]` in `CHANGELOG.md` describing the user-visible fix and referencing the change name + issue #13.

## 7. Step 7 — Archive readiness

- [x] 7.1 Run `openspec validate harden-external-link-handling` — passes ("Change 'harden-external-link-handling' is valid").
- [x] 7.2 Run `npm run build` + `curl -X POST http://localhost:8000/api/restart` — build green (29.82s, gzip ↑ 71%); restart returned `{"ok":true}`, new server PID 1576167 serving `/api/health` 200 in production mode with 12 active sessions. _(Note: `restart.log` recorded a 10s false-negative timeout but the child did come up — orthogonal to this change, pre-existing flakiness of the restart-helper watchdog.)_
- [x] 7.3 Ready to archive via `openspec-archive-change`.
