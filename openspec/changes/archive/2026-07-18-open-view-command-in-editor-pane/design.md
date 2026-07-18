# Design — Open `/view` targets in the editor pane

## Context

`/view` has its own inline preview machine, parallel to the editor pane:

```
              /view @path  |  /view <url>
                     │
                     ▼  onViewLocal(target)   [App.tsx, OUTSIDE the split provider]
              send { inject_view_message }
                     │  server
              ViewMessageStore ──► view_messages_update ──► viewMessagesMap
                     │  merged by timestamp into state.messages
                     ▼
              ChatView renders <PreviewCard target={msg.view}/>   ← inline, size-capped

   MEANWHILE the editor pane already renders files + urls richly:
              /session/:id/editor?file=…  ──► SplitRouteSync ──► openInSplit
              canvas url target           ──► CanvasDriver   ──► openUrlTarget ──► UrlViewer
                     │
                     ▼  viewer-registry → shared preview/* (PdfPreview, ImagePreview, …)
```

The pane and the inline card **already share the same `preview/*` renderers**
(`UrlViewer` calls the identical `dispatchPreview → PreviewBody` the card uses).
The only reasons `/view` doesn't already land in the pane:

1. `fileKind()` (pane classifier) lacks branches for `docx/pptx/spreadsheet/
   asciidoc/email`, so those open as Monaco raw text.
2. The `/view` handler sits outside `SplitWorkspaceProvider` and can't call the
   openers; and the editor deep-link route carries `?file=` only, not `?url=`.

## Goals

- `/view @path` and `/view <url>` open in the editor pane, rendering identically
  to the retired inline card (same `preview/*` components).
- The editor pane renders **all** kinds `/view` accepts — closing the
  classifier gap for the five rich kinds in one reconciliation (consuming
  `fix-eml-preview-in-editor-pane`).
- Retire only the `/view`-specific inline surface; leave the shared renderers,
  overlays, canvas, and linkification untouched.

## Decisions

### D1 — Route-based bridge, not a new driver (Option A)

Files already have `/session/:id/editor?file=…` → `SplitRouteSync` →
`openInSplit`. Extend that route with `?url=…`; `SplitRouteSync` calls
`openUrlTarget(url)` when the param is present. `onViewLocal` becomes a pure
`navigate(...)`:

```
  file target → navigate(`/session/${id}/editor?file=${encode(path)}`)
  url  target → navigate(`/session/${id}/editor?url=${encode(url)}`)
```

Rejected — a `ViewDriver` mirroring `CanvasDriver` (in-provider state pump).
Route-based is smaller, keeps the opened view **URL-shareable and reload-safe**,
and reuses a bridge that already exists for files. The composer never needs
provider access.

Loopback URLs: `openUrlTarget` vs `openLiveTarget` — `SplitRouteSync` applies the
same `isLoopbackUrl` split `CanvasDriver` uses, so `/view http://localhost:5173`
lands in the SSRF-gated `LiveServerViewer`, everything else in `UrlViewer`.
**Caveat (S9):** `isLoopbackUrl` deliberately excludes `0.0.0.0`, so
`/view http://0.0.0.0:5173` routes to `UrlViewer`, not `LiveServerViewer` —
consistent with `CanvasDriver`; accepted, not special-cased here.

### D2 — Retire the inline surface, keep the shared substrate

`/view` is the **sole** feeder of `ViewMessageStore` / `ChatMessage.view` /
`PreviewCard`-in-chat. Removing that path deletes:

- server: `view-message-store.ts`, `inject_view_message` handler,
  `view_messages_update` emission + its `handler-context` wiring.
- client: `ChatMessage.view?`, `viewMessagesMap` + its App-level merge,
  `useMessageHandler` `view_messages_update` case, the `<PreviewCard>` **render
  call** in `ChatView`.

**`PreviewCard.tsx` the FILE survives (S5 — do NOT delete it).** It exports BOTH
`PreviewCard` (the in-chat wrapper, now unused) and **`PreviewBody`**, which
`UrlViewer`, `PreviewOverlayView`, and the new diff Preview all import. Retiring
the inline surface removes only the `<PreviewCard>` usage in `ChatView` and the
inline size caps; `PreviewBody` and the module stay. Removing the now-unused
`PreviewCard` wrapper export is optional cleanup, but the file and `PreviewBody`
MUST remain. "Migration: None" refers to serialized data, not to the module.

**Kept** (other callers): `dispatchPreview`, `ViewTarget`, every `preview/*`
renderer, `PreviewBody`, `FilePreviewOverlay`, the `/pi-view` + `…/view` overlay
routes (FileLink clicks, canvas, tool-output linkification). `doubt-driven-review`
gate before deletion confirms this caller inventory.

`parseViewCommand` is unchanged — it still parses both `@path` and `http(s)://`
into a `ViewTarget`; only the *sink* (`onViewLocal`) changes.

### D3 — Close the classifier gap for all five rich kinds (generalize `fix-eml`)

`fix-eml-preview-in-editor-pane` established the recipe for one extension; this
change applies it to five. Per that change's analysis, `fileKind` is **shared
server + client** and drives three surfaces, so each added kind is a
three-surface reconciliation, not a registry line:

| Surface | Dispatch | Fix |
| --- | --- | --- |
| Split editor-pane (tree / `/view`) | `fileKind` → `viewer-registry` | add kind + registry entry → shared `preview/*` |
| `PreviewCard` / overlay | `dispatchPreview` (`RENDERER_BY_EXT`) | already correct |
| `FilePreviewOverlay` (FileLink, non-split) | `/api/file` `content` | add rich-kind branch (skips `content` fetch) |

Five kinds, delegating to existing components:

```
  docx        → DocxPreview          .docx
  pptx        → PptxPreview          .pptx
  spreadsheet → SpreadsheetPreview   .xlsx .xls .csv
  asciidoc    → AsciiDocPreview      .adoc .asciidoc
  email       → EmlPreview           .eml
```

Classify by extension only (before the sniff/unknown tail), server/client
identical — same discipline `fix-eml` chose for `.eml` (D2 there). `editable`:
`false` for docx/pptx/asciidoc/email; **`true` for spreadsheet** (see D4).

### D4 — `.csv` = spreadsheet viewer, editable in Monaco (markdown pattern)

Per the user decision: `.csv` renders as a `SpreadsheetPreview` grid but keeps a
**Preview / Edit** toggle (like `.md`/`.mdx`). Edit mounts a plain Monaco text
buffer over the raw CSV.

- Remove `.csv` from `TEXT_EXTENSIONS`; classify `{ kind: "spreadsheet",
  viewer: "spreadsheet", editable: true }`.
- Generalize the existing "Markdown tabs SHALL offer a Preview/Edit toggle"
  requirement: an `editable` non-markdown tab (currently only `.csv`) shows a
  Preview (its rich viewer) / Edit (Monaco text) toggle; save goes through the
  same `POST /api/file/write` + `mtime` 409 path.
- **Server ripple:** `/api/file` currently ships `content` only for
  `viewer ∈ {monaco, markdown}`. Extend the gate to
  `viewer ∈ {monaco, markdown} OR editable === true`, so Monaco Edit can load CSV
  text. `.xlsx/.xls` stay `editable:false` → binary, no `content` (grid via the
  spreadsheet parse endpoint, unchanged).

Rejected — csv → monaco text only (loses the grid the old inline `/view` showed);
or csv → spreadsheet read-only (loses the requested edit path).

**Behavior break (S6) + two data paths.** `.csv` is in `TEXT_EXTENSIONS` today —
it opens as Monaco text. After this change it defaults to the spreadsheet grid;
this is a visible change to existing `/view data.csv` and file-tree `.csv` opens,
called out in proposal Impact. Also `SpreadsheetPreview` now serves TWO data
paths under one `spreadsheet` kind: `.csv` = text via `/api/file` `content`
(editable), `.xlsx`/`.xls` = binary via the existing spreadsheet parse endpoint
(not editable). The renderer selects the path by extension; the `editable` flag
drives which one Edit mode is offered for.

### D5 — Icons are not automatic

`file-icon.ts` `ICON_BY_EXT` is **extension-keyed**, not viewer-derived (a
correction `fix-eml` surfaced). Each of the five extensions needs an explicit
entry or it shows the generic file icon in the tree + tab. Required, not cosmetic.

### D6 — Route precedence: `file` wins over `url` (resolves C1)

`?file=` and `?url=` are documented mutually exclusive, but a hand-typed or
stale link may carry both. `SplitRouteSync` SHALL treat `file` as authoritative:
when both params are present it opens the file and ignores `url`. `file` is the
common case and the deterministic default; no error surface for the malformed
combo. (`onViewLocal` only ever emits one param, so this rule guards inbound URLs
only.)

### D7 — Large-file byte cap → "too large to preview" fallback (resolves C2)

The inline size caps are removed with the inline surface (D2), so a huge file
would otherwise open uncapped in the pane. Reinstate a guard at the byte level,
not the row level: when the opened file's `size` (already returned by
`/api/file`) exceeds **10 MB**, the viewer SHALL mount a `TooLargePreview`
fallback — a short notice plus an **Open raw** affordance that streams
`/api/file/raw` — instead of the rich renderer. Applies to every rich kind
(spreadsheet/docx/pptx/pdf/image/…); Monaco text tabs keep their own existing
large-file handling. The cap is a single shared constant
(`MAX_PREVIEW_BYTES = 10 * 1024 * 1024`) so all surfaces agree.

Rejected — a per-kind row/element cap (e.g. 5000 spreadsheet rows). Byte size is
uniform across kinds, already available without parsing, and cannot be gamed by
a pathological single-row-huge-cell file.

### D8 — Retired `view` field: reducer silently drops (resolves C3)

Removing `ChatMessage.view?` must not break replay of a session persisted while
the field existed. The reducer SHALL simply not read `view`; an old serialized
message carrying it deserializes, the field is ignored (dropped), no inline card
renders, and no code throws. No migration pass, no legacy fallback renderer —
the field becomes inert. This mirrors the additive backward-compat the field's
introduction guaranteed, in reverse.

### D9 — System-open tab actions, gated on a SERVER capability (not browser origin)

Each editor-pane tab SHALL offer system-open actions:

- **file tab** — *Open in system app* and *Reveal in file manager*.
- **url tab** — *Open in system browser*.

**Whose "system" — the corrected gate.** The opener spawns on the **server host**,
so the real question is "can THIS server reach the user's desktop?", which a
browser-side loopback check CANNOT answer. Counter-example (why an
`isLocalhost()`-style client gate is wrong): a user runs the Docker all-in-one
and reaches it at `http://localhost:18000` — browser origin IS loopback, but the
server is in a headless container; `open`/`xdg-open` there no-ops or errors.
(There is also no `isLocalhost()` helper in the client today — the earlier draft
invented it.)

The authoritative gate is therefore a **server-advertised capability**
`capabilities.systemOpen: boolean`, exposed on `/api/health`, computed once at
startup. **Detection (concrete):**

- An explicit env override wins first: `PI_DASHBOARD_SYSTEM_OPEN=0|1` → forces
  false/true (the Docker image sets `0`; also its existing container marker →
  false).
- Else by platform: macOS (`darwin`) and Windows (`win32`) → **true** (desktop
  OSes ship `open` / `start`+`explorer`; the loopback-origin + containment gates
  still bound it). Linux → true only when a display session is present
  (`DISPLAY` or `WAYLAND_DISPLAY` set) AND not detected as a container; else
  false (headless server / CI).

The result is `false` when headless / container / no desktop, `true` on a normal
desktop host. The client shows the two **file** actions only when
`capabilities.systemOpen === true`; otherwise they are hidden. This is correct in
every topology, unlike a client origin check:

```
  Electron local / standalone local (desktop host) → systemOpen:true  → shown
  Docker all-in-one (localhost:PORT, headless)     → systemOpen:false → hidden
  Remote browser / mobile                          → systemOpen:false → hidden
```

**Transport — one server endpoint pair, no Electron IPC.** File actions dispatch
to `POST /api/open-in-system` and `POST /api/reveal-in-file-manager`, which spawn
the OS opener on the server host: macOS `open` / `open -R`, Linux `xdg-open` /
freedesktop reveal, Windows `start` / `explorer /select,`. The **url** action is a
plain `window.open(url, "_blank")` (Electron rewrites it to `openExternal`;
browsers honor it natively) — no gate, no server round-trip; it targets the
user's OWN browser, so it is valid in every context.

Reject — a dedicated Electron `dashboard:open-path` IPC channel (the server-spawn
path already covers local-Electron). Reject a client-only `isLocalhost` gate (S2:
wrong for Docker forwarded-port).

### D10 — System-open security: containment + no-shell spawn + capability/origin refusal

`open`-ing a file launches its default handler, which for a `.sh`/`.app`/
`.desktop` **executes** it. Mitigations, all required:

- **Path containment.** Both endpoints reuse the file-routes gate: the resolved
  path MUST start with a known session `cwd + path.sep` (the same path-traversal
  guard `/api/file` enforces). No arbitrary absolute paths.
- **No-shell spawn (injection guard).** The opener SHALL be invoked via
  `execFile`/`spawn` with an **argument array**, never a shell string — so a path
  containing a comma, space, quote, or newline cannot break `explorer /select,`
  or inject into `sh -c`. The `/select,<path>` argument is passed as one array
  element.
- **Capability + origin refusal (server-side).** The endpoints SHALL refuse
  (return an error, spawn nothing) when `capabilities.systemOpen` is false, AND
  when the request Origin/Host is not loopback. **A missing Origin/Host SHALL be
  treated as non-loopback (rejected)** — the legitimate same-origin client sends
  Origin on a POST; absent means don't-know, so deny. This is defense-in-depth
  behind the UI capability gate.
- **Reveal is the safe default.** *Reveal in file manager* (`open -R` /
  `explorer /select,`) selects the file WITHOUT executing it. *Open in system
  app* (execution-capable, within the session cwd only) is offered but audited
  under `security-hardening`.
- No new bytes path, no content read — the endpoints take a `{ cwd, path }` and
  spawn; they never stream the file.

### D11 — Diff panel: rename old Preview → "Regions"; add a new type-based "Preview"

The original report — "the Preview button is disabled on the diff panel" — is
really two conflated wants: (1) the existing changed-regions view, and (2) a way
to see the resulting file itself, richly. Splitting them resolves it cleanly. The
diff panel's segmented control becomes four coexisting modes:

```
   Diff  |  File  |  Regions  |  Preview
   ────     ────     ───────     ───────────────────────────────────────
   red/     plain    (RENAMED    (NEW) the current on-disk file rendered by the
   green    syntax-  from        TYPE-BASED renderer — the SAME fileKind →
   diff     high-    today's     viewer-registry dispatch a file-tree click uses:
            lighted  "Preview")  markdown→rendered, image, pdf, docx, pptx,
            source   changed     spreadsheet, html, mermaid, monaco for code.
                     regions,
                     tinted
```

**Regions = the old Preview, function unchanged.** It keeps deriving from
`buildPreviewLines(file.gitDiff)` — changed regions, additions tinted, removed
omitted — and stays disabled when there is no parseable `gitDiff`. (This
supersedes the earlier iteration of this decision that tried to source the old
Preview from disk; Regions reverts to the original shipped behavior.)

**Preview = new.** It renders the current file the diff was made against through
the shared type-based renderer selected by `fileKind(absPath).viewer`, then mounts
that `viewerRegistry` component — the same dispatch a file-tree open uses **at the
viewer-lookup layer** (it does NOT replicate `openInSplit`'s mtime/optimistic-
concurrency/scroll state — it is a stateless embed; S8).

**Three concrete wiring facts (S3 + cycle-2 S1/S2):**

- `fileKind()` **throws on a relative path** (`file-kind.ts` — `if
  (!isAbsolutePath(absPath)) throw`). `FileDiffEntry.path` is **relative to cwd**.
  So Preview MUST build the absolute path first: `join(cwd, file.path)`. The cwd
  is available — `DiffViewer` receives `{ path, cwd }` (`ViewerProps`) and today
  drops `cwd` when it renders `<DiffPanel file selection sessionId />`. Thread
  `cwd` into `DiffPanel` (new prop).
- **A viewer-registry component needs the full `ViewerProps`** — `{ cwd, path,
  kind, mimeType, size }` (`editor-pane/types.ts`; `size` is REQUIRED). `fileKind`
  supplies `kind`/`mimeType`/`viewer` but NOT `size`. So Preview SHALL fetch
  `GET /api/file?cwd&path` once to obtain `{ kind, mimeType, size }` (the metadata
  the editor-pane open flow already uses), then mount `viewerRegistry[fileKind(
  join(cwd, file.path)).viewer]` with the complete `ViewerProps`. This single
  metadata fetch ALSO doubles as the existence probe (see missing-file below).
- The rich viewer components fetch their own bytes via `/api/file/raw` (image,
  pdf, video, audio) or `/api/file` content (markdown/text); Preview does NOT use
  the diff panel's `/api/session-file?sessionId&path`. The metadata + bytes both
  come from the in-cwd, containment-gated `/api/file*` endpoints.

**Availability + missing-file (S4, corrected S2).** Preview is shown when the
entry is in-cwd (`previewable !== false`) and not a pure deletion. `otherChanges`
entries carry `previewable: false` (`session-diff.ts`) — so they are already
omitted; the missing-file case applies to a **`type:"tool"` entry in `files[]`**
(previewable, detected on disk) whose file was **deleted** before the click: the
`GET /api/file` metadata fetch 404s and the mode SHALL render a not-found/error
state, never crashing the panel. Preview does not pre-probe beyond that metadata
fetch. Out-of-cwd (`previewable === false`) omits/disables the button. Preview
does NOT depend on `gitDiff`, so it is available for non-git Edit/Write diffs —
the case the original report hit.

**Coexist with File (accepted overlap).** `File` renders plain
syntax-highlighted source; `Preview` renders the type-based viewer. For a
renderable kind they differ sharply (source vs rendered markdown/image/pdf); for
plain code both show source (monaco vs react-syntax-highlighter). The overlap for
code is accepted — the user chose to keep all four modes rather than hide Preview
for non-renderable kinds.

Reject — folding Regions and Preview into one button. They answer different
questions ("what changed" vs "what does the file look like now") and one cannot
represent the other. Reject reusing `dispatchPreview`/`RendererKind` (no `monaco`
case — code would fall through); the `fileKind` → viewer-registry path is the one
that matches a file-tree open.

## Risks & corrections

- **Deletion irreversibility.** Removing `ViewMessageStore` is load-bearing only
  if nothing else emits `view_messages_update`. Verified sole caller is
  `inject_view_message`; `doubt-driven-review` before the delete.
- **Blank-`FilePreviewOverlay` regression (from `fix-eml`).** Any reclassified
  extension stops getting `/api/file` `content`; the overlay must route it to a
  rich renderer or it renders blank. Covered for all five in §3; grep every
  `/api/file` `.content` consumer during implementation.
- **`.csv` content gate.** The `editable`-based gate widening must NOT leak
  `content` for large binary spreadsheets — only `.csv` is `editable:true`;
  `.xlsx/.xls` remain `editable:false`. Assert in a unit test.
- **Malformed rich files (accepted).** Extension-only classification routes a
  corrupt `.docx`/`.eml` to its rich renderer → parse error → inline error,
  instead of Monaco raw. Correct default; raw-bytes inspection lost for these
  kinds (same trade `fix-eml` accepted).
- **Exhaustive `Record<ViewerKind, …>`** — adding five kinds makes TypeScript
  flag `viewerRegistry` until all five entries exist. Desired compile-time guard;
  the only exhaustive `ViewerKind` switch is the registry (`PreviewCard` switches
  `RendererKind`, unaffected).
- **URL shareability edge:** a copied `/session/:id/editor?url=…` reopens the URL
  tab on load via `SplitRouteSync`; confirm it does not loop with canvas auto-open
  (different key space — canvas uses target identity, route uses the param).
