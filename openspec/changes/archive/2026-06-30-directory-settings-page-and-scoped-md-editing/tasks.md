## 0. Dependency gate (Monaco)

- [x] 0.1 Confirm `add-internal-monaco-editor-pane` v1 is applied: `packages/shared/src/file-kind.ts`, the Monaco `markdown` viewer, and the extended `/api/file` read endpoint exist. If absent, Parts 2–4 below carry forward v3/v4 (write endpoint + edit-existing) for the markdown subset and remain the canonical write path. **VERIFIED (after rebase onto `develop`):** Monaco v1 present (`file-kind.ts` with `editable:false`, `editor-pane/MarkdownViewer.tsx`, `/api/file` read). `POST /api/file/write` absent → this change carries v3/v4 forward (Part 3) as the canonical write path.

## 1. Part 1 — Directory Settings page (no Monaco dependency)

- [x] 1.1 Swap `FolderActionBar` entry-point: icon `mdiToyBrickOutline` → `mdiCog`; label/title "Pi Resources" → "Directory Settings". Update tests asserting the prior icon/label. (i18n key `auto.directory_settings`.)
- [x] 1.2 Add route `/folder/:cwd/settings/:page?` in `App.tsx` (pages: `instructions`, `packages`, `resources`; default `packages`). Add replace-redirect from legacy `/folder/:cwd/pi-resources` → `…/settings/packages`. (`buildFolderSettingsUrl` builder; 3 mount sites + redirects.)
- [x] 1.3 Add `hasFolderSettingsRoute` to `lib/mobile-depth.ts` route-flag derivation; verify mobile depth (list → detail) matches global settings behaviour. (Depth-1 tier mirroring `hasSettingsRoute`, NOT overlay/depth-2; also threaded through `back-target.ts`.)
- [x] 1.4 Create `packages/client/src/components/DirectorySettings/DirectorySettings.tsx` — left-nav + mobile-hierarchy shell mirroring `SettingsPanel`, scoped to a `cwd` prop. Extract shared nav/mobile chrome into a presentational shell if duplication is real. (Shared resource-tree primitives extracted to `components/resource-tree.tsx`, reused by both DirectorySettings + PiResourcesView.)
- [x] 1.5 Mount existing Packages manage surface as the `packages` page and existing Resources listing as the `resources` page (reuse `PiResourcesView` internals; retire its local 2-tab bar). (`PackagesPage.tsx` + `ResourcesPage.tsx`.) NOTE: `instructions` page is a placeholder pending Part 2.
- [x] 1.6 Tests: cog button opens page; legacy route redirects; page nav updates URL; mobile depth correct. (`DirectorySettings.test.tsx` + updated route-builders/mobile-depth/back-target/useContentViews tests; 73 client tests green.)

## 2. Part 2 — Editable markdown surface (Monaco reuse)

- [x] 2.1 In `packages/shared/src/file-kind.ts`, make `editable` resolve `true` for the writable markdown subset (extension `.md`/`.mdx`); keep `false` elsewhere. Update file-kind tests.
- [x] 2.2 Make the Monaco `markdown` viewer support an editable mode (Monaco buffer, not read-only) behind the `editable` flag. Keep render-only path for non-editable mounts. (New `editor-pane/MarkdownEditor.tsx` controlled editable Monaco buffer + shared `editor-pane/monaco-setup.ts`; `MarkdownViewer.tsx` stays the render-only path; lazy-loaded boundary preserved.)
- [x] 2.3 Build the `Instructions` page: scoped picker + editable markdown buffer + dirty-gated Save Bar (Save/Discard) mirroring `unify-settings-save-contract`. Add unsaved-changes navigation guard. (`DirectorySettings/InstructionsPage.tsx`; 409 conflict banner w/ Reload+Overwrite; `beforeunload` + `Confirm` on dirty file-switch.)
- [x] 2.4 Mount `Instructions` as a page in `DirectorySettings` (directory scope, passes `cwd`) and in `SettingsPanel` → Advanced (global scope, no `cwd`). (SettingsPanel renders it full-bleed outside the `max-w-3xl` wrapper.) **Backend gap resolved:** added `GET /api/file/md-read` (same `isWritableMdTarget` guard) so global-scope reads work — `/api/file` is session-cwd-gated and cannot serve `~/.pi/agent`.
- [x] 2.5 Tests: Save Bar gating (clean=disabled, dirty=enabled); save clears dirty; unsaved-changes guard fires. (`InstructionsPage.test.tsx`, Monaco mocked as textarea.)

## 3. Part 3 — Write endpoint + scope-aware allowlist (security boundary)

- [x] 3.1 Implement pure `isWritableMdTarget(absPath, { cwd? }): boolean` (shared or server lib). Dir scope: `<cwd>/**/*.md` + `<cwd>/.pi/**`. Global scope (no cwd): `~/.pi/agent/**/*.md` only. Realpath-normalize before check. **NOTE:** implemented in `packages/server/src/lib/writable-md-target.ts` as `async` (realpath is I/O); markdown-extension check applied in both branches so non-`.md` under `.pi/**` is rejected (honors spec "non-markdown targets rejected").
- [x] 3.2 Exhaustive unit tests for the guard: in-scope `.md` allowed; non-`.md` rejected; `..` traversal rejected; symlink-escape (realpath) rejected; sibling-dir bypass rejected; global path outside `~/.pi/agent` rejected; missing-home handled. (`writable-md-target.test.ts`, 14 cases.)
- [x] 3.3 Implement `POST /api/file/write` (advancing Monaco v3/v4 for markdown): body `{ cwd?, path, content, mtime }`; call `isWritableMdTarget` first (`403` on fail); compare on-disk mtime (`409 Conflict` on mismatch, no write); atomic write (tmp + rename, json-store pattern) on success; return new mtime. Read endpoint now also returns `mtime`.
- [x] 3.4 Update `packages/shared/src/rest-api.ts` with the `POST /api/file/write` request/response types. (`FileWriteRequest`/`FileWriteResult`/`FileWriteResponse` + `mtime?` on `FileContentResult`.)
- [x] 3.5 Server tests: `403` out-of-scope; `403` symlink escape; `409` mtime mismatch leaves file unchanged; success writes + returns new mtime; global vs dir branch both covered. (`file-write-endpoint.test.ts`, 9 cases.)

## 4. Part 4 — Scoped file picker

- [x] 4.1 Server: candidate enumerator — directory scope from `pi-resource-scanner` output filtered to the allowlist; global scope from a small `~/.pi/agent` markdown walk. Both pass through `isWritableMdTarget` so picker ⊆ guard. **NOTE:** implemented as a dedicated bounded markdown walk (`lib/md-candidates.ts`), not the resource-scanner — scanner enumerates skills/extensions/prompts, not root `AGENTS.md`/arbitrary `.md`; spec requires "markdown under cwd + `.pi/` tree". Every candidate still passes `isWritableMdTarget`.
- [x] 4.2 Add a list endpoint (or extend an existing one) returning scoped candidates; type in `rest-api.ts`. (`GET /api/file/md-candidates`; `MdCandidate`/`MdCandidatesResult`/`MdCandidatesResponse`.)
- [x] 4.3 Client `FilePicker` component: lists scoped candidates, selecting one loads it into the editor buffer. No free-form path input. (`DirectorySettings/FilePicker.tsx`; scope chip + substring filter.)
- [x] 4.4 Tests: picker only lists allowlisted candidates; selecting loads buffer; directory vs global scope produce the right candidate sets. (`FilePicker.test.tsx` client + `md-candidates.test.ts` server.)

## 5. Docs

- [x] 5.1 (delegate to docs subagent, caveman style) Add file-index rows for `DirectorySettings/`, the `Instructions`/`MarkdownEditor`/`FilePicker` components, and `isWritableMdTarget`. Add a `docs/architecture.md` note: dashboard's first user-facing write surface + the scope-aware allowlist model + Monaco dependency. (Delegated to general-purpose subagent, caveman style: file-index-client 8 added/6 updated, file-index-server 2 added/1 updated, file-index-shared 2 updated, architecture.md subsection.)

## 6. Verification

- [x] 6.1 `npm test` green (file-kind, guard, write endpoint, picker, page-route tests). 8599 pass / 21 skip. 2 pre-existing flaky timeouts (`doctor-route`, `event-wiring-source-stamp` — server-spawn tests) pass in isolation; unrelated to this change.
- [x] 6.2 `npm run quality:changed` clean. All 17 brand-new files lint-clean (Biome); diff introduces zero new warnings (fixed: useButtonType, unused imports, 4 cognitive-complexity via `walkMd` extraction + `applyWriteOutcome` helper + `InstructionsEditorPane` split). `tsc --noEmit` adds no new errors. Residual Biome warnings (App.tsx ×11, FolderActionBar/PiResourcesView useButtonType) are PRE-EXISTING (HEAD baseline identical) — left untouched per Surgical Changes.
- [x] 6.3 `openspec validate directory-settings-page-and-scoped-md-editing --strict` passes.
