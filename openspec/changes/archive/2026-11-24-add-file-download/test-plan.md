# Test Plan — add-file-download

Stage: design   Generated: 2026-11-23

No open clarifications. All Triples are filled from the spec deltas and design D1–D6.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | file-and-url-preview: Binary-safe file serving endpoint (D2) | EP | L1 | automated | name `summary.md` | `contentDispositionAttachment("summary.md")` | returns exactly `attachment; filename="summary.md"; filename*=UTF-8''summary.md` |
| E2 | same (D2) | EP (non-ASCII class) | L1 | automated | name `jelentés é.pdf` | helper call | ASCII part `filename="jelent_s _.pdf"`; `filename*=UTF-8''jelent%C3%A9s%20%C3%A9.pdf` |
| E3 | same — header injection | EP (hostile class) | L1 | automated | name `a"b\r\nX-Evil: 1.txt` | helper call | result contains no `\r`, no `\n`, and no `"` inside the `filename="…"` value; `filename*` percent-encodes `"` `\r` `\n` |
| E4 | same — attr-char boundary | BVA (RFC 5987 attr-char) | L1 | automated | name `a\b'(x)*!~.txt` | helper call | ASCII part replaces `\` with `_`; `filename*` encodes `'()*` as `%27%28%29%2A`; `!` and `~` stay literal |
| E5 | raw route download mode | EP | L1 | automated | `notes/summary.md` in an admitted cwd | `GET /api/file/raw?cwd=…&path=notes/summary.md&download=1` (fastify inject) | 200; body equals the file bytes; `content-disposition` = E1 value |
| E6 | raw route default inline | decision table (`download` ∈ absent, `0`, `true`, `1`) | L1 | automated | same file | four requests | absent / `0` / `true` → `inline`; only `1` → `attachment; …` |
| E7 | download keeps the scriptable sandbox | EP | L1 | automated | `page.svg` in an admitted cwd | `GET …&path=page.svg&download=1` | `content-security-policy` equals `RAW_SANDBOX_CSP`; `x-content-type-options: nosniff`; disposition is attachment |
| E8 | download keeps Range | BVA | L1 | automated | 4096-byte file | `download=1` + `Range: bytes=1024-2047` | 206; `content-range: bytes 1024-2047/4096`; disposition is attachment |
| E9 | download does not widen admission | decision table | L1 | automated | (a) `cwd=/unknown`; (b) `path=../../../etc/passwd` | each with `download=1` | (a) 403 `code:"cwd_unknown"`; (b) 403 `path outside working directory`; same bodies as without `download` |
| E10 | EML attachment moves onto the shared helper (D2) | EP | L1 | automated | EML whose attachment filename is `a\b.txt` | `GET /api/file/eml-attachment?…&index=0` | `content-disposition` = `attachment; filename="a_b.txt"; filename*=UTF-8''a%5Cb.txt` |
| E11 | editor-pane-chrome: hybrid delivery | decision table (base same/cross × in/outside cwd) | L1 | automated | `getApiBase()` ∈ {`""`, `https://other:8000`} × `outsideCwd` ∈ {false, true} | `startDownload(target, {outsideCwd})` | only (`""`, false) clicks a temporary `<a download>` whose `href` = `downloadUrl(target)`, with `fetch` not called; the other 3 combos call `fetch(downloadUrl(target))` |
| E12 | Blob path success | EP | L1 | automated | cross-origin base; fetch resolves 200 with body `hello` | `startDownload({cwd:"/Users/u/proj", path:"notes/summary.md"})` | `URL.createObjectURL` called once; anchor `download` attribute = `summary.md`; `URL.revokeObjectURL` called with the same URL |
| E13 | downloadUrl encoding | EP | L1 | automated | `{cwd:"/Users/u/proj", path:"notes/summary.md"}`, base `""` | `downloadUrl(target)` | equals `/api/file/raw?cwd=%2FUsers%2Fu%2Fproj&path=notes%2Fsummary.md&download=1` |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | editor-pane-chrome: More menu Download | state | L1 | automated | active file tab `notes/summary.md` | open `doc-more-menu`, click `doc-download` | `startDownload` called with `{cwd, path:"notes/summary.md"}` and `outsideCwd:false`; menu panel removed |
| F2 | dirty hint | decision table (clean / built-in dirty / handler dirty) | L1 | automated | the three tab states | open the More menu | clean → no hint; both dirty states → `doc-download` enabled with the text "Unsaved changes not included" |
| F3 | outside-cwd tab | EP | L1 | automated | active tab with `outsideCwd` true | click `doc-download` | `startDownload` called with `outsideCwd:true` |
| F4 | host requirement — non-file tabs | EP | L1 | automated | URL tab, terminal tab | render the document bar | no `doc-download` in the DOM |
| F5 | row actions menu contents | decision table (file / dir row) | L1 | automated | file row `src/foo.ts`, dir row `.git` | activate the glyph | file: items in order Copy full path, Copy relative path, Copy file name, Download (`tree-row-download`); dir: the three copy items and no `tree-row-download` |
| F6 | right-click opens the menu | state | L1 | automated | file row `src/foo.ts`; dir row `src` | `fireEvent.contextMenu(row)` | event `defaultPrevented === true`; menu open; `onOpenFile` not called (file); `onToggleRoot` not called (dir) |
| F7 | keyboard open + menu keyboard model | state-transition | L1 | automated | focused row button `src/foo.ts` | Shift+F10, then ↓, Enter | menu opens with focus on Copy full path; Copy relative path runs (clipboard gets `src/foo.ts`); `ContextMenu` key also opens |
| F8 | Escape focus return | state-transition | L1 | automated | (a) opened via glyph; (b) opened via Shift+F10 on row | Escape | menu closes; focus is (a) the glyph, (b) the row button |
| F9 | tree Download | EP | L1 | automated | file row `docs/report.pdf`, cwd `/Users/u/proj` | open menu, click `tree-row-download` | `startDownload` called with `{cwd:"/Users/u/proj", path:"docs/report.pdf"}`; menu closed; `onOpenFile` not called |
| F10 | glyph a11y + touch visibility | EP | L1 | automated | any row | render; open menu | glyph `aria-label="Row actions"`, `aria-haspopup="menu"`, `aria-expanded` false→true; class contains `[@media(hover:none)]:opacity-100` |
| F11 | dismissal | state-transition | L1 | automated | open row menu | outside click / rail scroll / Escape (each) | menu closes; no clipboard write, no `startDownload` |
| F12 | end-to-end viewer download | state | L3 | automated | docker harness workspace file `notes/summary.md` with known content | open the file, More → Download, `page.waitForEvent('download')` | `download.suggestedFilename() === "summary.md"`; saved bytes equal the file content |
| F13 | end-to-end tree right-click download | state | L3 | automated | same file shown in the rail | right-click its row → Download | download event with `suggestedFilename() === "summary.md"`; the tab set is unchanged (file not opened) |
| F14 | touch devices | visual/hardware | — | manual-only | iOS Safari / Android Chrome on a phone | look at the rail, tap the glyph, Download | [judgment: glyph visible, menu usable by touch, file lands in the device's downloads] |
| F15 | Electron save dialog | hardware/shell | — | manual-only | local main window + a remote server window in the packaged app | Download from the More menu | [judgment: a native save dialog appears and the saved file is correct] |
| F16 | hint presentation | visual/subjective | — | manual-only | dirty tab, More menu, dark + light theme | look | [judgment: the hint reads as secondary text and does not crowd the menu] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | failed fetch download | fault-injection (abort: HTTP 403/404) | L1 | automated | fetch resolves `{ok:false,status:404}` (then 403) | `startDownload` on the Blob path | error toast with `editor.downloadFailed` text shown; `URL.createObjectURL` not called; no anchor clicked |
| X2 | failed fetch download | fault-injection (abort: network) | L1 | automated | fetch rejects `TypeError("Failed to fetch")` | `startDownload` on the Blob path | error toast shown; no save; no unhandled rejection |
| X3 | missing file via raw | fault-injection | L1 | automated | `path` does not exist | `GET …&download=1` | 404; no `Content-Disposition: attachment` on the error response |

---

## Coverage summary

- Requirements covered: 5/5 delta requirements (Binary-safe file serving endpoint; More menu navigate/copy/download; host controls; menu keyboard model; row actions menu)
- Scenarios by class: edge 13 · perf 0 · frontend 16 · error 3
- Scenarios by level: L1 27 · L2 0 · L3 2
- Scenarios by disposition: automated 29 · manual-only 3

Performance: there is no latency or memory threshold in the spec. The link path streams; Blob-path memory is an accepted trade-off (design Risks). No perf row.

## New infra needed

- none (fastify-inject server tests, vitest + RTL client tests and the Playwright docker harness all exist)
