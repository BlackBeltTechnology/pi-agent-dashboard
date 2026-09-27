## Context

The dashboard server runs as `node --import jiti-register packages/server/src/cli.ts`. The editor
pane mounts viewers through `viewerRegistry` with no scroll container of its own. Saves go through
`POST /api/file/write`, gated by `isWritableMdTarget` and an exact `mtimeMs` optimistic-concurrency
check.

## Goals / Non-Goals

**Goals:** edit + save `.adoc` from the editor pane / canvas; make csv save actually work; make
server-side sanitizing work under the real loader.

**Non-Goals:** PlantUML without Kroki (no local `plantuml.jar` renderer); showing the AsciiDoc
document title (embedded rendering omits the header); widening the diagram-type allowlist.

## Decisions

### D1 — Load DOMPurify with `createRequire`, not dynamic `import()`

Under `jiti-register`, `import("isomorphic-dompurify")` hands jsdom's CJS files to jiti, which breaks
jsdom's `interfaces.js` ↔ `create-element.js` require cycle. Plain node and `createJiti` both work,
so only a test under the real loader reproduces it. `createRequire(import.meta.url)` bypasses the
ESM hook and keeps native CJS cycle semantics. Kept lazy (a broken jsdom still fails one request,
not boot). Only a working instance is cached, since a failed init otherwise pins a
`sanitize`-less object (`purify.sanitize is not a function`) for the process lifetime.

Alternatives: excluding jsdom from jiti transforms (loader-config coupling, fragile); a lighter DOM
for DOMPurify (new dependency).

### D2 — Widen the write allowlist by extension only

`WRITABLE_MD_EXTENSIONS` = `.md`, `.mdx`, `.adoc`, `.asciidoc`, `.csv`: exactly the `editable` text
kinds, so the client never shows a Save the server rejects. Extension is still checked on the
realpath target; containment, `..`/symlink escape rejection and the global `~/.pi/agent` scope are
unchanged. `.csv` was already `editable` client-side but always 403'd.

### D3 — Full-precision mtime on `GET /api/file`

The write side compares `mtimeMs` exactly (full precision was chosen deliberately so two fast saves
cannot share a token). `GET /api/file` rounded it, producing a false `409` on nearly every save on
APFS/ext4. Fix the reader, not the comparator, matching the other read endpoint.

### D4 — One generic `EditablePreviewTab`

The csv Preview/Edit/Save tab becomes `EditablePreviewTab({ cwd, path, preview, testIdPrefix })`,
used by csv (thin wrapper, `csv-*` ids unchanged) and AsciiDoc (`adoc-*`). Its `overflow-auto` body
is the scroll container the editor pane lacks. Returning to Preview remounts the preview, so it
re-renders the saved file.

## Risks / Trade-offs

- [Wider write surface] → extension-only widening; same containment tests plus `.adoc` escape test.
- [Real-process test cost ~1s] → listed in `vitest.real-process-files.ts`, off the parallel pool.

## Migration Plan

None. Server restart + client rebuild. Rollback = revert; old behaviour returns (403 on csv/adoc
save, false 409s, broken sanitizing).
