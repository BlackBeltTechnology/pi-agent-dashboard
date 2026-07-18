# Tasks — Open `/view` targets in the editor pane

## 1. Shared classifier — five rich kinds + `.csv` (consumes `fix-eml`)

- [x] 1.1 In `packages/shared/src/file-kind.ts`, add `"docx" | "pptx" |
      "spreadsheet" | "asciidoc" | "email"` to BOTH the `ViewerKind` and
      `FileKind` unions. → verify: `tsc` sees them; `viewerRegistry` record now
      flagged until entries added.
- [x] 1.2 Add extension sets + `fileKind()` branches (before the sniff/unknown
      tail), each returning `{ kind, mimeType, viewer, editable }`:
      `.docx`→docx, `.pptx`→pptx, `.xlsx`/`.xls`→spreadsheet(editable:false),
      `.adoc`/`.asciidoc`→asciidoc, `.eml`→email. Add matching `MIME_BY_EXT`
      entries (`message/rfc822` for `.eml`, office MIMEs). → verify: unit test 1.5.
- [x] 1.3 Move `.csv` OUT of `TEXT_EXTENSIONS`; classify `.csv` →
      `{ kind:"spreadsheet", viewer:"spreadsheet", editable:true }`. → verify:
      test 1.5 shows `.csv` editable, `.xlsx` NOT editable.
- [x] 1.4 Classify by extension only (sniff MUST NOT change any of the six
      results). → verify: test 1.5 passes bytes and result is unchanged.
- [x] 1.5 Extend `packages/shared/src/__tests__/file-kind.test.ts`: each of
      `x.docx x.pptx x.xlsx x.csv x.adoc mail.eml` (and an UPPERCASE variant)
      classifies to the expected `{kind,viewer,editable}`; `.csv` editable true,
      `.xlsx` editable false. → verify: `npm test` green.

## 2. Editor-pane viewer registry

- [x] 2.1 In `components/editor-pane/viewer-registry.tsx`, import `DocxPreview`,
      `PptxPreview`, `SpreadsheetPreview`, `AsciiDocPreview`, `EmlPreview`; add a
      `const XViewer = (p) => <XPreview target={asTarget(p)} />` for each and
      register `docx/pptx/spreadsheet/asciidoc/email` in `viewerRegistry`. →
      verify: `tsc` no longer flags the exhaustive `Record<ViewerKind, …>`.
- [x] 2.2 Extend `.../editor-pane/__tests__/viewer-registry.test.tsx`: registry
      has all five entries, each mapping to a component that renders the matching
      `preview/*` component. → verify: `npm test` green.

## 3. FilePreviewOverlay + icons (prevents blank regression)

- [x] 3.1 In `components/FilePreviewOverlay.tsx`, add early branches (beside the
      existing `isImage`) for the five rich kinds that mount the matching
      `preview/*` component with `{ kind:"file", cwd, path }` and skip the
      `/api/file` `content` fetch. → verify: test 3.3.
- [x] 3.2 Add `ICON_BY_EXT` entries in `lib/file-icon.ts` for `.docx .pptx .xlsx
      .xls .csv .adoc .asciidoc .eml` (extension-keyed, NOT viewer-derived). →
      verify: tree + tab show the typed icon, not the generic default.
- [x] 3.3 Extend `.../__tests__/FilePreviewOverlay.test.tsx`: each rich-kind path
      renders its `preview/*` component and does NOT fetch `/api/file` for
      `content`. → verify: `npm test` green.
- [x] 3.4 Grep every `/api/file` consumer for a `.content` read that could hit a
      reclassified extension (`rg "api/file[^-].*content|json.data.content"`);
      confirm none other than `FilePreviewOverlay` regresses. → verify: no other
      consumer breaks.

## 4. Server — content when `editable` (`.csv` edit)

- [x] 4.1 In `packages/server/src/routes/file-routes.ts` (~line 356), widen the
      `content` gate to `viewer === "monaco" || viewer === "markdown" ||
      kindResult.editable === true`. → verify: test 4.2.
- [x] 4.2 Extend the file-routes test: `/api/file` returns `content` for `.csv`
      (editable) and OMITS `content` for `.xlsx` and `.docx`. → verify: `npm test`.

## 5. `.csv` Preview/Edit toggle (generalize markdown toggle)

- [x] 5.1 Generalize the markdown Preview/Edit tab affordance so an `editable`
      non-markdown tab (`.csv`) shows Preview (`SpreadsheetPreview`) / Edit
      (Monaco text buffer over raw CSV). Save → `POST /api/file/write` + loaded
      `mtime`; 409 surfaces the changed-on-disk banner. → verify: test 5.2.
- [x] 5.2 Component test: a `.csv` tab renders the spreadsheet grid in Preview,
      switches to a Monaco buffer in Edit, and a stale save (409) shows the
      banner + leaves disk unchanged. → verify: `npm test` green.

## 5b. Large-file byte cap (D7)

- [x] 5b.1 Add a shared `MAX_PREVIEW_BYTES = 10 * 1024 * 1024` constant and a
      `TooLargePreview` fallback (notice + **Open raw** → `/api/file/raw`). The
      editor-pane viewer wrapper mounts it INSTEAD of the rich renderer when the
      opened file's `size` (from `/api/file`) exceeds the cap; Monaco text tabs
      keep their existing large-file handling. → verify: test 5b.2.
- [x] 5b.2 Test: a `.csv`/`.docx` reported at `size` just above 10 MB mounts
      `TooLargePreview` (not the rich viewer); at 10 MB exactly and just below it
      mounts the rich viewer. → verify: `npm test` green (BVA boundary).

## 6. Reroute `/view` → editor pane

- [x] 6.1 In `components/SessionSplitView.tsx` `SplitRouteSync`, parse a `url`
      query param alongside `file`; when present call `openUrlTarget(url)` (or
      `openLiveTarget` when `isLoopbackUrl(url)`), mirroring the `file` →
      `openInSplit` bridge. When BOTH `file` and `url` are present, `file` wins
      and `url` is ignored (D6). → verify: test 6.4 + 6.5.
- [x] 6.2 In `App.tsx`, change `onViewLocal(target)` to `navigate` instead of
      `send({ inject_view_message })`: file → `/session/${id}/editor?file=${enc}`,
      url → `/session/${id}/editor?url=${enc}`. `editorMatch` derivation includes
      the `url` param. → verify: test 6.4 + manual.
- [x] 6.3 Confirm `parseViewCommand` is UNCHANGED (still parses `@path` + url);
      only the sink changed. → verify: existing `CommandInput-view.test.tsx` still
      green.
- [x] 6.4 Tests: `/view @src/foo.md` navigates to `?file=src/foo.md` and opens the
      tab; `/view https://youtu.be/x` navigates to `?url=…` and `UrlViewer`
      renders the YouTube embed; `/view http://localhost:5173` routes to
      `LiveServerViewer`. → verify: `npm test` green.
- [x] 6.5 Test: a route with BOTH `?file=a.ts&url=https://x` opens the file tab
      and does NOT open a URL tab (`file` wins, D6). → verify: `npm test` green.

## 6b. System-open tab actions (D9/D10)

- [x] 6b.0 Add `capabilities.systemOpen: boolean` to the `/api/health` payload,
      computed once at startup (true only for a desktop-capable host — OS opener
      + display session; false when headless/container). The Docker image
      advertises false via its env marker. → verify: health test asserts the flag
      present + false under the container env marker.
- [x] 6b.1 Add `POST /api/open-in-system` + `POST /api/reveal-in-file-manager`
      (`{ cwd, path }`): reuse the file-routes containment gate (`cwd + path.sep`);
      REFUSE when `capabilities.systemOpen` is false; reject a request whose
      Origin/Host is non-loopback OR absent; then spawn the OS opener via
      `execFile`/`spawn` with an **argument array** (no shell) — macOS
      `open`/`open -R`, Linux `xdg-open`/freedesktop reveal, Windows
      `start`/`explorer /select,` (the `/select,<path>` and the path are separate
      array elements). Never read file content. → verify: tests 6b.2 + 6b.3.
- [x] 6b.2 Server test: valid `{cwd,path}` inside a known session cwd spawns the
      opener (mock `execFile`, assert argv is an array, path un-interpolated); a
      `path` escaping cwd → 403, no spawn; a non-loopback origin → rejected; an
      ABSENT origin → rejected; `systemOpen:false` → refused, no spawn; a path
      with a comma → passed as one argv element. → verify: `npm test` green.
- [x] 6b.3 Client: add tab actions — file tab: *Open in system app* →
      `/api/open-in-system`, *Reveal in file manager* →
      `/api/reveal-in-file-manager`, both shown only when
      `capabilities.systemOpen === true` (from `/api/health`); url tab: *Open in
      system browser* → `window.open(url, "_blank")` (unconditional). → verify:
      test 6b.4.
- [x] 6b.4 Component test: with `systemOpen:true` a file tab shows both file
      actions; with `systemOpen:false` they are hidden and only the url action
      shows; the url action calls `window.open(url,"_blank")`. → verify: `npm test`.

## 6c. Diff panel: rename Preview→Regions + new type-based Preview (D11)

- [x] 6c.1 In `packages/client/src/components/DiffPanel.tsx`, rename the existing
      `Preview` mode/button to **`Regions`** — `ViewMode` `"preview"` →
      `"regions"`, `data-testid="preview-toggle"` → `"regions-toggle"`, label
      `diff.preview` → `diff.regions`, tooltip updated. Function UNCHANGED
      (`buildPreviewLines(file.gitDiff)`, `regionsAvailable = lines.length > 0`,
      disabled without gitDiff, auto-fallback to Diff). → verify: test 6c.4.
- [x] 6c.2 Add a NEW `Preview` mode (`ViewMode` `"filePreview"`,
      `data-testid="file-preview-toggle"`, label `diff.preview`): thread `cwd`
      from `DiffViewer` into `DiffPanel` (new prop); resolve `abs = join(cwd,
      file.path)`; fetch `GET /api/file?cwd&path` once for `{ kind, mimeType,
      size }` (metadata + existence probe); mount
      `viewerRegistry[fileKind(abs).viewer]` with the FULL `ViewerProps`
      (`{ cwd, path: file.path, kind, mimeType, size }`) — `ViewerProps.size` is
      required and has no other source. Bytes come from `/api/file*`, NOT
      `/api/session-file`. Available when `file.previewable !== false`;
      omitted/disabled otherwise. A 404 metadata fetch renders the not-found
      state, not a crash. → verify: tests 6c.5–6c.7.
- [x] 6c.3 Toolbar renders all four modes in order `Diff · File · Regions ·
      Preview`; default mode `diff`; none persists across mount. → verify: test 6c.4.
- [x] 6c.4 Test: `Regions` behaves exactly as today's Preview — changed regions
      from gitDiff, disabled without a parseable gitDiff. → verify: `npm test`.
- [x] 6c.5 Test: an in-cwd `README.md` diff (`previewable !== false`) shows an
      enabled `Preview`; selecting it mounts the markdown viewer with the current
      file (not source, not diff), regardless of `gitDiff` presence. → verify:
      `npm test` green.
- [x] 6c.6 Test: an out-of-cwd entry (`previewable === false`) omits/disables the
      new `Preview` button. → verify: `npm test` green.
- [x] 6c.7 Test: a `type:"tool"` entry in `files[]` whose file is missing →
      selecting Preview → `/api/file` metadata fetch 404 → not-found/error state;
      the panel does not throw. → verify: `npm test` green.

## 7. Retire the inline `/view` surface (doubt-driven-review FIRST)

- [x] 7.1 `doubt-driven-review`: enumerate every emitter of `view_messages_update`
      and every reader of `ChatMessage.view`; confirm `/view` is the sole feeder
      before deleting. → verify: caller inventory shows no other producer.
- [x] 7.2 Server: delete `packages/server/src/view-message-store.ts`; remove the
      `inject_view_message` case + `view_messages_update` emission in
      `browser-gateway.ts` and the `viewMessageStore` wiring in
      `browser-handlers/*` + `handler-context.ts`. → verify: `tsc` + `npm test`.
- [x] 7.3 Client: remove `ChatMessage.view?` (`lib/event-reducer.ts`), the
      `viewMessagesMap` state + App-level merge (`App.tsx`), the
      `view_messages_update` case (`hooks/useMessageHandler.ts`), and the
      `<PreviewCard>` render call in `ChatView.tsx`. **DO NOT delete
      `PreviewCard.tsx`** — it exports `PreviewBody`, imported by `UrlViewer` /
      `PreviewOverlayView` / the new diff Preview. Keep the file + `PreviewBody`;
      removing the now-unused `PreviewCard` wrapper export is optional. Keep
      `preview/*`/`dispatchPreview`/`FilePreviewOverlay`/overlay routes intact.
      → verify: `tsc` + `npm test`; ChatView no longer renders `PreviewCard`;
      `UrlViewer` still imports `PreviewBody` OK.
- [x] 7.3a Test (D8 legacy replay): reduce/replay an OLD serialized session whose
      messages still carry a `view` field — the reducer ignores it, no throw, no
      inline card, all other fields intact. → verify: `npm test` green.
- [x] 7.4 Remove the consumed change dir
      `openspec/changes/fix-eml-preview-in-editor-pane/`. → verify: `openspec list`
      no longer shows it; this change covers `.eml`.

## 8. End-to-end verification

- [x] 8.1 Extend/author `tests/e2e/view-command.spec.ts` (docker harness): `/view`
      on a `.md`, `.docx`, `.csv`, `.eml`, and a URL each opens the editor pane
      with the correct viewer; assert NO inline `PreviewCard` appears in the
      transcript. → verify: `npm run test:e2e` passes.
- [x] 8.2 Cross-surface parity: the same `.eml`/`.docx` renders its rich viewer
      from the editor-pane tree, a FileLink overlay, AND `/view` — none shows raw
      or blank. → verify: E2E green.
- [x] 8.3 Manual: full rebuild + restart; `/view @file`, `/view <url>`, tree open,
      FileLink open for each rich kind; confirm parity and that reload of a copied
      `?url=` URL reopens the tab. → verify: visual parity.

## Tests — folded scenarios (test-plan.md manifest is source of truth)

One task per automated `test-plan.md` row (id · level · exemplar · Triple). The
manual-only row folds to a tagged manual task, no test authored.

### Edge-case (L1 vitest)

- [x] E1 `report.docx` → `fileKind` → `{kind:docx,viewer:docx,editable:false}`+MIME — see `packages/shared/src/__tests__/file-kind.test.ts` (test-plan #E1)
- [x] E2 `deck.pptx` → `fileKind` → `{pptx,pptx,false}` — see file-kind.test.ts (test-plan #E2)
- [x] E3 `book.xlsx` → `fileKind` → `{spreadsheet,spreadsheet,false}` — see file-kind.test.ts (test-plan #E3)
- [x] E4 `data.csv` → `fileKind` → `{spreadsheet,spreadsheet,editable:true}` — see file-kind.test.ts (test-plan #E4)
- [x] E5 `doc.adoc`/`doc.asciidoc` → `{asciidoc,asciidoc,false}` — see file-kind.test.ts (test-plan #E5)
- [x] E6 `mail.eml` → `{email,email,false}`+`message/rfc822` — see file-kind.test.ts (test-plan #E6)
- [x] E7 `MAIL.EML`/`REPORT.DOCX` → identical to lowercase (case-insensitive) — see file-kind.test.ts (test-plan #E7)
- [x] E8 `mail.eml`+NUL sniff → still `email` (not binary-warn) — see file-kind.test.ts (test-plan #E8)
- [x] E9 `data.csv` → viewer `spreadsheet` NOT `monaco`; `.csv` absent from `TEXT_EXTENSIONS` — see file-kind.test.ts (test-plan #E9)
- [x] E10 `GET /api/file` csv (editable) → includes `content` — see `packages/server/src/__tests__/openspec-profile-routes.test.ts` (route harness) (test-plan #E10)
- [x] E11 `GET /api/file` xlsx (editable:false) → OMITS `content` — see openspec-profile-routes.test.ts (test-plan #E11)
- [x] E12 `GET /api/file` docx/eml → OMITS `content` — see openspec-profile-routes.test.ts (test-plan #E12)
- [x] E13 `/view @src/foo.ts` → navigate `?file=src/foo.ts`, no `inject_view_message` — see `packages/client/src/components/__tests__/CommandInput-view.test.tsx` (test-plan #E13)
- [x] E14 `/view https://youtu.be/x` → navigate `?url=…` — see CommandInput-view.test.tsx (test-plan #E14)
- [x] E15 bare `/view` → no navigate/send, draft preserved — see CommandInput-view.test.tsx (test-plan #E15)
- [x] E16 `/view @` → `parseViewCommand` null, no navigate — see CommandInput-view.test.tsx (test-plan #E16)
- [x] E17 file tab × `capabilities.systemOpen`={true,false} → true shows Open/Reveal; false hides, url stays — see `packages/client/src/components/editor-pane/__tests__/viewer-registry.test.tsx` (component harness) (test-plan #E17)

### Performance (L1)

- [x] P1 file `size`=10MB−1/10MB/10MB+1 → open → ≤10MB rich viewer; >10MB `TooLargePreview` — see viewer-registry.test.tsx (test-plan #P1)

### Frontend-quirk

- [x] F1 L3 `/view @docs/x.md` → split opens active tab; ZERO `preview-card` in transcript — see `tests/e2e/editor-pane.spec.ts` (test-plan #F1)
- [x] F2 L3 `/view <youtube url>` → `canvas-url-viewer` embeds; no inline card — see `tests/e2e/editor-pane.spec.ts` (test-plan #F2)
- [x] F3 L3 copied `?url=` reload → url tab reopens, no canvas loop — see `tests/e2e/editor-pane.spec.ts` (test-plan #F3)
- [x] F4 L3 `?file=a.ts&url=…` → file tab opens, NO url tab (file wins) — see `tests/e2e/editor-pane.spec.ts` (test-plan #F4)
- [x] F5 L3 `.csv` tab → Preview grid ↔ Edit Monaco ↔ back — see `tests/e2e/editor-pane.spec.ts` (test-plan #F5)
- [x] F6 L3 same `report.docx` via tree+FileLink+`/view` → all mount `DocxPreview`, none raw/blank — see `tests/e2e/eml-preview.spec.ts` (test-plan #F6)
- [x] F7 L3 `report.docx` in pane → `DocxPreview`, Monaco NOT mounted — see `tests/e2e/eml-preview.spec.ts` (test-plan #F7)
- [x] F8 L3 `mail.eml` via FileLink → `EmlPreview`, no `/api/file` content fetch — see `tests/e2e/eml-preview.spec.ts` (test-plan #F8)
- [x] F9 L1 `.docx/.pptx/.xlsx/.csv/.adoc/.eml` → `ICON_BY_EXT[ext]` typed icon, not default — see viewer-registry.test.tsx (test-plan #F9)
- [x] F10 manual-only: rich file opened 3 ways → human confirms visual parity — no test authored (test-plan: manual-only #F10)
- [x] F11 L1 url tab any origin → *Open in system browser* → `window.open(url,"_blank")`, no round-trip — see viewer-registry.test.tsx (test-plan #F11)
- [x] F12 L1 `FileDiffEntry` with/without gitDiff → `Regions` enabled+regions / disabled+stays-Diff — see `packages/client/src/components/__tests__/DiffPanelPreview.test.tsx` (test-plan #F12)
- [x] F13 L1 in-cwd `README.md` diff → select `Preview` → markdown viewer with current file (not source/diff), any gitDiff — see DiffPanelPreview.test.tsx (test-plan #F13)
- [x] F14 L1 `previewable===false` → new `Preview` button omitted/disabled — see DiffPanelPreview.test.tsx (test-plan #F14)
- [x] F15 L1 diff tab first open → control lists `Diff·File·Regions·Preview`, active Diff, no persist — see DiffPanelPreview.test.tsx (test-plan #F15)
- [x] F16 L1 `type:"tool"` entry file deleted → select `Preview` → `/api/file` 404 → not-found state, no crash — see DiffPanelPreview.test.tsx (test-plan #F16)

### Error-handling

- [x] X1 L3 corrupt `.docx` → open → inline parse-error, no Monaco raw, no crash — see `tests/e2e/eml-preview.spec.ts` (test-plan #X1)
- [x] X2 L1 malformed `.eml` → `/api/file/eml` 400 → EmlPreview inline error — see `packages/client/src/components/__tests__/FilePreviewOverlay.test.tsx` (test-plan #X2)
- [x] X3 L3 `.csv` Edit + disk changed → Save → 409 changed-on-disk banner, disk unchanged — see `tests/e2e/editor-pane.spec.ts` (test-plan #X3)
- [x] X4 L3 `.eml` remote-img body → opaque sandbox, remote NOT fetched — see `tests/e2e/eml-preview.spec.ts` (test-plan #X4)
- [x] X5 L1 grep `/api/file` `.content` consumers → only `FilePreviewOverlay` reads reclassified-kind content — see FilePreviewOverlay.test.tsx (test-plan #X5)
- [x] X6 L1 OLD session with `ChatMessage.view` → reduce/replay → dropped, no throw, no card, other fields intact — see `packages/client/src/lib/__tests__/diff-tree.test.ts` (lib harness) (test-plan #X6)
- [x] X7 L1 large `.xlsx` (editable:false) → `GET /api/file` OMITS content (no binary leak) — see openspec-profile-routes.test.ts (test-plan #X7)
- [x] X8 L1 post-change `inject_view_message`-shaped msg → handler gone, ignored; no `view_messages_update` emitter — see `packages/server/src/__tests__/session-diff.test.ts` (server harness) (test-plan #X8)
- [x] X9 L1 `POST /api/reveal-in-file-manager` path `../../../etc/passwd` → 403, no spawn — see openspec-profile-routes.test.ts (test-plan #X9)
- [x] X10 L1 `POST /api/open-in-system` non-loopback OR absent Origin/Host → rejected, no spawn — see openspec-profile-routes.test.ts (test-plan #X10)
- [x] X11 L1 `systemOpen:false` → refused; comma path → one `execFile` argv element, no shell — see openspec-profile-routes.test.ts (test-plan #X11)

## 9. Ship gate

- [x] 9.1 `security-hardening`: confirm every rich renderer's sandbox / remote-block
      posture is reused unchanged across all three surfaces; no raw-bytes path
      added; the `editable` content gate does not leak binary spreadsheet bytes;
      AND audit the system-open endpoints — containment gate + loopback-origin
      check hold, `open`-in-app execution risk is accepted only under
      cwd-containment + explicit user action, reveal does not execute. → verify:
      no new untrusted-render or arbitrary-exec exposure.
- [x] 9.2 `review-code` pass on the diff; fix blocking findings. → verify: clean
      re-review.
- [x] 9.3 `npm run quality:changed` green (biome + tsc + tests). → verify: single
      exit 0.
