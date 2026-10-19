## Why

The editor pane's changed-on-disk banner fires on any `fs.watch` event for an open file, not on a content change. On macOS (Node 26, measured), `touch`, `chmod`, an identical-content rewrite (pi `write` tool, formatters, `git checkout`/`stash`) and an atomic tmp+rename all fire it, so the Refresh banner appears far too often. The pane's own Save (`/api/file/write` = tmp+rename) also raises the banner for the user's own edit, and after that rename the watcher stays bound to the old inode, so later real changes are silently missed.

| Action on open `a.txt` | Event today | Correct? |
|---|---|---|
| read `a.txt` / write sibling `b.txt` | none | yes |
| `touch` / `chmod` / identical rewrite | `change` | false positive |
| atomic tmp+rename (incl. own Save) | `rename` | false positive |
| real change after a rename | none | missed |

## What Changes

- **Banner only on a real content difference.** A `file_changed` signal becomes a *candidate*. The client verifies it against a per-tab content baseline before showing the banner; an identical digest clears the candidate silently.
- **Pane-level baseline.** The editor pane records a content digest per open file tab when its viewer mounts or is refreshed (Refresh resets it). No viewer has to report what it loaded.
- **New endpoint `GET /api/file/digest?cwd&path`.** Returns `{ size, mtime, sha1 }` without sending content. Uses the same cwd/grant containment as `GET /api/file`. Above a fixed 256 MiB digest ceiling it returns `{ size, mtime }` without a hash, and the client falls back to showing the banner (today's behavior).
- **Configurable editor large-file limit.** New config field `editor.largeFileLimitMb` (default `10`, `1`–`256`), edited in Settings. It drives the pane's rich-viewer too-large gate (today's fixed `MAX_PREVIEW_BYTES` = 10 MiB, which blocks e.g. editing a `.md` over 10 MiB). The digest ceiling is decoupled and fixed, so the banner stays exact for every file a viewer can open, including Monaco text tabs (never gated by the limit). It applies live through the existing config write/apply path. Content still travels over REST (`/api/file`, `/api/file/raw`), never the WebSocket. Office conversion caps (`OFFICE_SIZE_CAPS`, server 413) stay fixed: they are an untrusted-content security bound, not a UX preference.
- **Own Save never raises the banner.** `POST /api/file/write` additionally returns `size` + `sha1` of the written bytes. Every in-pane writer (`MarkdownViewer`, `EditablePreviewTab`, `MarkupRepairBanner`, `MermaidApplyFix`) sets the tab baseline from it through one helper. A candidate for a path with a save in flight is verified after the save settles.
- **Large saves work.** `POST /api/file/write` today inherits Fastify's default 1 MiB body limit, so any markdown save over ~1 MiB fails with 413. The route accepts content up to the 256 MiB ceiling.
- **Watches survive reconnect.** The open-file watch set is re-declared on every WebSocket reconnect, followed by a catch-up check.
- **Watch survives atomic replace.** `file-watch-manager` re-attaches a path's watcher synchronously after a `rename` event (with a short bounded retry for delete+re-create), so changes after a tmp+rename (own Save, editors that write atomically, `git checkout`) are still signalled.
- **Unchanged.** `watch_files` / `file_changed` wire shapes, open-files-only watch scope, no auto-reload, Refresh/Dismiss semantics, folder-scoped pane (no banner).

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `internal-monaco-editor-pane`: the changed-on-disk banner requirement is gated on a content difference against the tab's baseline; own-save suppression; watch re-attach after atomic replace / quick re-create; digest endpoint contract (same gate as `/api/file`); the too-large cap becomes the configured editor large-file limit instead of a fixed 10 MiB.
- `settings-panel`: Settings exposes the editor large-file limit.
- `file-read-containment`: the digest route is contained by the read site's gate (by reference, no new anchor set).

## Impact

- Server: `packages/server/src/file-watch-manager.ts` (rename re-attach), `packages/server/src/routes/file-routes.ts` (shared `/api/file` read gate helper, new `/api/file/digest`, `sha1` in the `/api/file/write` response), `packages/server/src/routes/system-routes.ts` (accept + broadcast `editor` config), `packages/shared/src/route-tiers.ts` + `packages/mcp-server-plugin/src/server/tools.denylist.ts` (new route).
- Client: `packages/client/src/hooks/useMessageHandler.ts` + `App.tsx` (`changedOnDisk` per-path generations; `config_updated` filter gains `editor`), `packages/client/src/components/split/SplitWorkspaceContext.tsx` (baseline map, candidate verification), `packages/client/src/components/editor-pane/EditorPane.tsx` (baseline capture on mount/refresh, verified banner), `MarkdownViewer.tsx`, `EditablePreviewTab.tsx`, `components/preview/MarkupRepairBanner.tsx`, `components/preview/MermaidApplyFix.tsx` (rebaseline from write `sha1`).
- Shared: `ApiResponse` data shape for the digest endpoint and the write response (additive); `packages/shared/src/config.ts` gains an `editor` block (`largeFileLimitMb`, parse + clamp + default); `file-kind.ts` `MAX_PREVIEW_BYTES` becomes the default, not the enforced value.
- Client config: `CappedViewer.tsx` / `TooLargePreview.tsx` read the limit from a `GET /api/config` mirror (same pattern as `lib/preview/mermaid-repair-config.ts`), refreshed on `config_updated`; `components/settings/SettingsPanel.tsx` gains the field and a `CONFIG_FIELD_PAGE.editor` entry.
- No protocol (`browser-protocol.ts`) change. No new dependency (`node:crypto` server-side only; no `crypto.subtle` on the client, which is unavailable in non-secure LAN contexts).

## Discipline Skills

- `security-hardening` — the new digest endpoint takes an untrusted `path`; it must reuse the `/api/file` containment and grant gate exactly.
- `observability-instrumentation` — new endpoint; the candidate→verified/suppressed decision should be diagnosable.
- `performance-optimization` — hashing runs on watch events for open files and before each session-pane tab mount; the size+mtime fast path, fixed ceiling and per-path single-flight bound its cost.
- `review-code` — before commit.
