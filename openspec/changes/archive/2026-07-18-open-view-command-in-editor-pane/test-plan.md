# Test Plan — open-view-command-in-editor-pane

Stage: design   Generated: 2026-07-17

> All clarifications resolved (C1 → file wins · C2 → 10 MB byte cap fallback ·
> C3 → reducer silently drops). Every row is fully concrete.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | fileKind office/email | decision-table | L1 | automated | path `report.docx` | `fileKind(path)` | `{ kind:"docx", viewer:"docx", editable:false }` + MIME `application/vnd…wordprocessingml.document` |
| E2 | fileKind pptx | decision-table | L1 | automated | `deck.pptx` | `fileKind(path)` | `{ kind:"pptx", viewer:"pptx", editable:false }` |
| E3 | fileKind xlsx | decision-table | L1 | automated | `book.xlsx` | `fileKind(path)` | `{ kind:"spreadsheet", viewer:"spreadsheet", editable:false }` |
| E4 | fileKind csv editable | decision-table | L1 | automated | `data.csv` | `fileKind(path)` | `{ kind:"spreadsheet", viewer:"spreadsheet", editable:true }` |
| E5 | fileKind asciidoc | decision-table | L1 | automated | `doc.adoc` AND `doc.asciidoc` | `fileKind(path)` | both `{ kind:"asciidoc", viewer:"asciidoc", editable:false }` |
| E6 | fileKind email | decision-table | L1 | automated | `mail.eml` | `fileKind(path)` | `{ kind:"email", viewer:"email", editable:false }` + MIME `message/rfc822` |
| E7 | case-insensitive ext | EP (invalid class) | L1 | automated | `MAIL.EML`, `REPORT.DOCX` | `fileKind(path)` | identical to lowercase result |
| E8 | sniff-independence | EP (invalid class) | L1 | automated | `mail.eml` + `sniff` = buffer with NUL byte | `fileKind(path, sniff)` | still `{ kind:"email", viewer:"email" }` — NOT `binary-warn` |
| E9 | `.csv` left TEXT_EXTENSIONS | regression guard | L1 | automated | `data.csv` | `fileKind(path)` | viewer is `spreadsheet`, NOT `monaco`; `.csv` absent from `TEXT_EXTENSIONS` |
| E10 | content gate — content present | decision-table | L1 | automated | `data.csv` (editable) | `GET /api/file` | response includes `content`, `kind:"spreadsheet"` |
| E11 | content gate — content absent (binary sheet) | decision-table | L1 | automated | `book.xlsx` (editable:false) | `GET /api/file` | response OMITS `content` |
| E12 | content gate — content absent (office/email) | decision-table | L1 | automated | `report.docx`, `mail.eml` | `GET /api/file` | response OMITS `content` for each |
| E13 | `/view @file` parse→route | decision-table | L1 | automated | `/view @src/foo.ts`, cwd `/p` | submit | `navigate("/session/:id/editor?file=src/foo.ts")`; NO `inject_view_message` sent |
| E14 | `/view <url>` parse→route | decision-table | L1 | automated | `/view https://youtu.be/x` | submit | `navigate("…/editor?url=https%3A%2F%2Fyoutu.be%2Fx")` |
| E15 | bare `/view` no-op | BVA (empty) | L1 | automated | `/view` (no arg) | submit | no navigate, no send, draft preserved (unchanged behavior) |
| E16 | `/view @` empty path | BVA (just-below-min) | L1 | automated | `/view @` | submit | `parseViewCommand` → null; no navigate |
| E17 | system-open gating (D9) | decision-table | L1 | automated | file tab × `capabilities.systemOpen`={true,false} | render tab actions | true → *Open in app* + *Reveal* shown; false (headless/Docker/remote) → both hidden, url action still shown |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | large-file byte cap fallback (D7) | BVA (boundary) | L1 | automated | file `size` = 10MB−1 / 10MB / 10MB+1 | open in pane | ≤10MB → rich viewer mounts; >10MB → `TooLargePreview` (notice + Open raw), rich viewer NOT mounted |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | `/view` opens pane, no inline card | state-transition | L3 | automated | session open, chat visible | run `/view @docs/x.md` | split opens with `x.md` active tab; transcript has ZERO `[data-testid=preview-card]` |
| F2 | `/view <url>` → UrlViewer | state-transition | L3 | automated | session open | run `/view https://youtu.be/x` | `[data-testid=canvas-url-viewer]` mounts a YouTube embed; no inline card |
| F3 | copied `?url=` reload reopens tab, no canvas loop | state-transition | L3 | automated | URL `…/editor?url=https://example.com/a.pdf` | load fresh + reload | URL tab present after reload; no duplicate/oscillating open (canvas key ≠ route key) |
| F4 | both `?file=` and `?url=` (D6) | state-transition (illegal edge) | L3 | automated | `…/editor?file=a.ts&url=https://x` | load | file tab for `a.ts` opens; NO URL tab (`file` wins, `url` ignored) |
| F5 | csv Preview/Edit toggle | state-transition | L3 | automated | `.csv` open in pane | Preview → Edit → Preview | Preview shows spreadsheet grid; Edit mounts Monaco text buffer over raw CSV; toggle back restores grid |
| F6 | cross-surface parity | convergence/invariant | L3 | automated | same `report.docx` | open via (tree) + (FileLink overlay) + (`/view`) | all three mount `DocxPreview`; none shows Monaco raw or blank |
| F7 | office kind not raw in pane | state-transition (illegal edge) | L3 | automated | `report.docx` | open in editor pane | renders `DocxPreview`; the Monaco buffer is NOT mounted for this tab |
| F8 | FilePreviewOverlay rich kind not blank | convergence/invariant | L3 | automated | `mail.eml` via FileLink (non-split) | click link | `EmlPreview` renders; NO `/api/file` `content` fetch issued for `.eml` |
| F9 | typed tree/tab icon | decision-table | L1 | automated | `.docx .pptx .xlsx .csv .adoc .eml` rows | `ICON_BY_EXT[ext]` | each returns a typed icon, not the generic default |
| F10 | visual parity across surfaces | visual/subjective | — | manual-only | rich file opened 3 ways | human compares | [judgment: "renders identically / looks correct" — no automatable observable] |
| F11 | open URL in system browser (D9) | state-transition | L1 | automated | url tab, any origin (incl. remote) | activate *Open in system browser* | `window.open(url, "_blank")` called; no server round-trip |
| F12 | diff `Regions` = old Preview, gitDiff-gated (D11) | decision-table | L1 | automated | `FileDiffEntry` with / without parseable `gitDiff` | render toolbar | with gitDiff → `Regions` enabled, shows changed regions; without → disabled, stays Diff |
| F13 | diff new `Preview` renders current file via type-based renderer (D11) | state-transition | L1 | automated | in-cwd `README.md` diff, `previewable !== false` | select `Preview` | markdown viewer mounts with current file (not source, not diff); holds regardless of `gitDiff` |
| F14 | diff new `Preview` unavailable out-of-cwd (D11) | decision-table | L1 | automated | `previewable === false` | render toolbar | `Preview` button omitted/disabled |
| F15 | diff toolbar shows 4 modes, defaults Diff (D11) | state-transition | L1 | automated | any diff tab | first open | control lists `Diff · File · Regions · Preview`; active = Diff; no mode persists across mount |
| F16 | diff new `Preview` degrades on deleted file (D11/S4) | fault-injection (abort) | L1 | automated | `type:"tool"` entry, file deleted after change | select `Preview` | `/api/file` fetch fails → viewer not-found state; panel does not crash |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | corrupt docx | fault-injection (abort) | L3 | automated | truncated/garbage `.docx` bytes | open in pane | `DocxPreview` shows an inline parse-error; NO Monaco raw fallback, NO app crash |
| X2 | malformed eml | fault-injection (abort) | L1 | automated | non-RFC822 `.eml` | open → server parse | `/api/file/eml` → 400 → `EmlPreview` inline error, app stable |
| X3 | csv stale write 409 | state-transition (illegal edge) | L3 | automated | `.csv` edited in Edit mode; disk changed underneath | click Save | `POST /api/file/write` → 409 → changed-on-disk banner; on-disk file UNCHANGED |
| X4 | eml remote-content blocked | fault-injection (abort) | L3 | automated | `.eml` body with remote `<img src=http…>` | open in pane | sandboxed iframe, no `allow-scripts`/`allow-same-origin`; remote asset NOT fetched (posture reused verbatim) |
| X5 | reclassified kind content ripple | decision-table | L1 | automated | grep all `/api/file` `.content` readers | `.docx` now returns no `content` | only `FilePreviewOverlay` consumes it; no other consumer reads `.docx` `content` (regression guard) |
| X6 | retired-field replay compat (D8) | state-transition | L1 | automated | OLD session with `ChatMessage.view` set | reduce/replay | field silently dropped — no throw, no inline card, all other fields intact |
| X7 | editable gate no binary leak | EP (invalid class) | L1 | automated | large `.xlsx` (editable:false) | `GET /api/file` | `content` OMITTED (binary bytes never serialized into JSON) |
| X8 | ViewMessageStore removal | state-transition (illegal edge) | L1 | automated | server post-change | any `inject_view_message`-shaped message | handler gone; message ignored/rejected; no emitter of `view_messages_update` remains |
| X9 | system-open path containment (D10) | fault-injection (abort) | L1 | automated | `POST /api/reveal-in-file-manager` with `path=../../../etc/passwd` | request | 403, NO opener spawned |
| X10 | system-open non-loopback/absent origin (D10) | fault-injection (abort) | L1 | automated | `POST /api/open-in-system` with non-loopback OR absent Origin/Host | request | rejected, NO opener spawned (absent treated as non-loopback) |
| X11 | system-open refused when incapable + no-shell (D10) | fault-injection (abort) | L1 | automated | `systemOpen:false` server; and a valid path containing a comma | request / spawn | `systemOpen:false` → refused, no spawn; comma path → passed as one `execFile` argv element, no shell injection |

---

## Coverage summary

- Requirements covered: 12/12 (ViewTarget route, shared renderers, `/view`→pane,
  `?url=` route + file-wins precedence, viewer registry ×5, fileKind classifier,
  `/api/file` gate, Preview/Edit toggle, large-file cap, system-open actions,
  diff-Preview-from-payload, retire).
- Scenarios by class: edge 17 · perf 1 · frontend 16 · error 11
- Scenarios by level: L1 29 · L2 0 · L3 15 · manual-only 1
- Scenarios by disposition: automated 44 · manual-only 1
- Blocked pending clarification: none (C1–C3 resolved)
- Doubt-review (cross-model @propose-review-1 glm-5.2) reconciled: S1/S2 (systemOpen gate), S3 (cwd/fileKind/endpoint), S4 (deleted file), S5 (PreviewBody survives), S6 (csv break), S7 (no-shell/absent-origin), S8 (parity wording), S9 (0.0.0.0 caveat).

## New infra needed

- none. L1 → existing vitest `__tests__`; L3 → existing `tests/e2e/` Playwright
  against the docker harness (port from `.pi-test-harness.json` `dashboardPort`,
  never hardcoded). No qa/ VM smoke rows (no install/process surface changed).
