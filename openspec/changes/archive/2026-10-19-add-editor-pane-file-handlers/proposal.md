## Why

The editor pane's viewers are hard-wired: each file kind maps to exactly one built-in renderer, and only text kinds can be edited. A plugin cannot add an editor or an alternative viewer for a file type. The existing `editor-pane-tab` slot is addressed by a virtual path prefix (`browser:…`), not by file type, and unmounts inactive tab bodies.

The first concrete need is in-pane Office editing with the ArtCraft web builds (change `edit-office-in-pane-with-craft-web`). It belongs in a plugin, not in core. Other candidates are already visible: a deck3d/DeckCraft `.pptx` editor, a draw.io editor, and image editing.

Core must provide the extension point *and* own the safety-critical parts every editor needs:
- reading a consistent snapshot;
- writing bytes back inside the workspace with conflict detection;
- guarding unsaved edits;
- bounding the resources of heavy editors.

Otherwise each plugin re-implements file writes.

## What Changes

- **New slot `editor-pane-file-handler`** (React, multiplicity `many`). A plugin claims non-text file extensions (text-backed kinds per `fileKind` are rejected) with:
  - `mode` (`preview` | `edit`) and a label (ordering by plugin priority);
  - optional `keepAlive` (max live instances);
  - optional `maxBytes`;
  - optional `firstOverwriteNotice` (text for a core-shown confirmation);
  - `copySuffix` (required for edit claims).
- **Mode switcher on file tabs.**
  - A file tab whose extension has enabled handler claims shows a mode switcher: the built-in Preview plus each claimed mode, ordered by priority then plugin id.
  - Built-in viewers stay as they are and remain the default (level L1: additive). They are not re-registered through the slot.
- **Core handler services**, passed to the handler component as props:
  - **snapshot read**: bytes plus a content-hash conflict token for the same content;
  - **save** (`overwrite` | `copy`) through a new core route, `POST /api/file/write-binary`;
  - **dirty reporting**;
  - **close and leave guard**.
- **`POST /api/file/write-binary`** (`control` tier). Core enforces:
  - a known session cwd and realpath containment under it;
  - an extension allowlist derived from *enabled* edit-mode claims, checked on both the requested and the resolved path, and the claim's `maxBytes` under a core ceiling;
  - content-hash 409 (not mtime);
  - atomic replace preserving permissions;
  - exclusive-create copies `<stem>.<plugin-suffix>.<ext>`.

  A plugin server may register a content validator for its own claims (and a main-thread enable switch). It runs in a worker with a hard timeout, can only narrow what core already admits, and a claim declaring one is not writable until it is loaded. Handler saves go through the dependency's own-save tracker, so they never raise the banner. The response returns `{ mtime, sha1 }` and feeds the changed-on-disk baseline from `gate-changed-on-disk-by-content`.
- **Keep-alive pool** for claims with `keepAlive`.
  - Instances stay mounted across tab switches, under a per-page cap (default 3).
  - The least recently used *clean* instance is evicted.
  - Instances with unsaved edits, or an unknown saved state, are never evicted automatically.
- **Core conflict and overwrite UX**:
  - A conflict dialog offers Reload / Save as copy / Overwrite anyway / Cancel.
  - The first overwrite of a file per open editor (shared by that file's tabs in the session) asks for confirmation when the claim provides `firstOverwriteNotice`.
  - The changed-on-disk banner's Refresh re-mounts a handler from a fresh snapshot, confirming first when dirty.
- **Not in scope:** credential-less loopback GETs from sandboxed opaque-origin frames (live-server today, handler frames tomorrow) to `/api/*`. A follow-up hardening change fixes the shared genuine-local predicate after `close-loopback-legacy-window`, which MODIFIES the same requirement (design.md D7).

## Capabilities

### New Capabilities
- `editor-pane-file-handlers`: covers
  - handler claim matching and the mode switcher;
  - handler props contract (snapshot, save, dirty, guard);
  - core binary write route and its authorization, validation hook and copy naming;
  - keep-alive pool and eviction;
  - conflict and first-overwrite UX;
  - banner Refresh behaviour for handler tabs;
  - the built-in large-file limit vs handler `maxBytes`.

### Modified Capabilities
- `dashboard-shell-slots`: adds the `editor-pane-file-handler` slot (claim fields, validation, registry hash, predicate classification).
- `internal-monaco-editor-pane`:
  - the kind-based registry governs the built-in view; a selected handler mode replaces it and the registry viewer is not mounted;
  - "read-only in v1" gains handler edit modes as a save path;
  - manual refresh on a handler tab reloads the handler (so the dependency's banner Refresh, which uses the manual-refresh path, needs no second MODIFY);
  - the Preview/Edit-toggle requirement stops forbidding an Edit affordance on non-text kinds when a handler claims one.

## Dependencies

- `gate-changed-on-disk-by-content` lands first. Handler saves and banner Refresh rely on its digest baseline and its `sha1`-returning save contract.

## Impact

- **Shared** (`packages/shared/src/dashboard-plugin/slot-types.ts`, `manifest-types.ts`; `file-kind.ts` exports `extOf`): new slot id, claim type, predicate classification. Minor version bump of `pi-dashboard-shared`.
- **Plugin runtime / registry generation** (`packages/dashboard-plugin-runtime`): claim validation (extensions, mode, keepAlive, maxBytes), registry hash, server-side `ctx.registerFileValidator`.
- **Client** (`packages/client/src/components/editor-pane/`):
  - mode switcher;
  - `FileHandlerHost` (props/services);
  - page-level handler layer mounted at the app shell, outside `EditorPane` (so pane close, tab and session switches never unmount instances);
  - refresh routing to handler re-mount;
  - conflict + first-overwrite dialogs;
  - banner Refresh for handler tabs.
- **Server**:
  - `POST /api/file/write-binary` (encapsulated octet-stream parser + `bodyLimit`, `networkGuard`, `isWritableHandlerTarget`, per-target write lock shared with `/api/file/write` and keyed by realpath in both routes);
  - `ROUTE_TIERS` entry;
  - `worker_threads` validator runner.
- **Docs:** `docs/plugin-seams.md` gains a file-handler section.

## Discipline Skills

- `security-hardening` — new binary write path into the workspace driven by plugin claims; symlink/extension checks; plugin validator hook.
- `doubt-driven-review` — public plugin API (slot contract + handler props) is hard to change once plugins depend on it; review before it stands.
- `performance-optimization` — keep-alive pool bounds memory/GPU for heavy handlers; large binary bodies.
- `observability-instrumentation` — log binary writes (path class, bytes, outcome, conflict), validator rejections, evictions.
- `review-code` — before commit.
