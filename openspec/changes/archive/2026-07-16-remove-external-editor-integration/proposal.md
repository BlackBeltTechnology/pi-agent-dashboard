## Why

The dashboard ships a large **external editor launcher** subsystem: it detects a `code-server` binary, spawns/proxies per-folder VS Code instances (via a keeper sidecar + PID registry), and offers "open in native editor" buttons (Zed, VS Code, IntelliJ). This is heavy (7 server modules + keeper sidecar, a proxy, a Docker `code-server` install layer, client detection/status polling, and cross-component prop threading), fragile (orphan sweeps, port allocation, idle timers, restart adoption), and now redundant: the dashboard already has a first-class **internal Monaco editor pane** (`editor-pane/`) that renders and edits files in-browser. Every place that opens an external editor should instead open the internal pane.

## What Changes

- **BREAKING**: Remove the external editor launcher entirely — no `code-server` proxy, no native-editor (Zed / VS Code / IntelliJ) launch, no `code-server` binary detection.
- Delete server subsystem: `editor-manager`, `editor-registry`, `editor-detection`, `editor-pid-registry`, `editor-proxy`, `editor-keeper/` (sidecar + `keeper.cjs`), `routes/editor-routes.ts`, and all their tests. Remove wiring from `server.ts` (imports, manager creation, route + proxy registration, WS `editor` upgrade scope, boot-time keeper adoption/orphan sweep, `stopAll` on shutdown).
- Remove `EditorConfig` / `DEFAULT_EDITOR_CONFIG` / `parseEditorConfig` and the `editor` field from shared `DashboardConfig`; delete `editor-types.ts`.
- Delete client external-editor surface: `EditorView.tsx` (code-server iframe), `EditorInstallGuide.tsx`, `lib/editor-api.ts`, `lib/use-editors.ts`, and the `interactive-renderers/EditorRenderer.tsx` if it targets the external editor.
- **Redirect all entry points to the internal Monaco pane:**
  - Sidebar folder `[Editor]` button + `/folder/:cwd/editor` route → mount a **new folder-scoped internal Monaco pane rooted at the folder cwd** (replacing `EditorView`).
  - `OpenFileButton` → drop the native-editor caret dropdown; body-click into the internal pane only.
  - `BinaryWarn` → drop "Open in <native editor>" buttons; keep the binary notice.
  - `FileLink` / `useFileOpenRouting` → drop the `openEditor` branch; always route to internal preview / pane.
  - Remove `editors` / `nativeEditors` prop threading from `FolderActionBar`, `SessionCard`, `SessionHeader`, `MobileActionMenu`, `SessionList`, `tool-renderers/types.ts`.
- Remove the `code-server` install layer from `docker/Dockerfile`; update `docker/README.md` + `docker/AGENTS.md`.
- Remove `editor.*` external-launcher i18n keys (`i18n.tsx`, `i18n-hu.ts`, `i18n-en-source.json`, `i18n-legacy-aliases.ts`), keeping any reused by the internal pane.

## Capabilities

### New Capabilities
- `folder-scoped-editor-pane`: The internal Monaco editor pane can be mounted rooted at a folder `cwd` (not only a session), so the sidebar folder `[Editor]` button and `/folder/:cwd/editor` route open the in-browser editor for that directory. State/persistence keyed by folder path.

### Modified Capabilities
- `open-in-editor`: File-open entry points route exclusively to the internal Monaco pane; the "open in external/native editor" behavior is REMOVED.
- `folder-action-bar`: The `[Editor]` button opens the internal folder-scoped pane; native-editor (Zed) buttons and code-server availability/status coloring are REMOVED.
- `editor-view`: REMOVED — the `/folder/:cwd/editor` code-server iframe view no longer exists (superseded by the folder-scoped internal pane).
- `editor-manager`: REMOVED — no server-side code-server lifecycle manager.
- `editor-detection`: REMOVED — no `code-server` binary detection.
- `editor-keeper-sidecar`: REMOVED — no editor keeper sidecar / PID registry.

## Impact

- **Server**: `packages/server/src/` (5 editor modules + `editor-keeper/` + `routes/editor-routes.ts` deleted; `server.ts` de-wired). Removes the `/editor/<id>/` HTTP proxy and the `editor` WS scope.
- **Shared**: `packages/shared/src/config.ts` (`editor` config removed — a config-shape change; existing `settings.json` files with an `editor` block are ignored, not an error), `editor-types.ts` deleted.
- **Client**: `packages/client/src/` — external-editor components/libs deleted; `App.tsx` route repurposed; `FolderActionBar` + card/header/menu prop threading trimmed; `OpenFileButton` / `BinaryWarn` / `FileLink` / `useFileOpenRouting` de-branched; new folder-scoped pane mount.
- **Docker**: `docker/Dockerfile` loses the `code-server` install (smaller image); docs updated.
- **Tests**: delete external-editor server + client tests; update `FolderActionBar`, `OpenFileButton`, `FileLink`, `SettingsPanel` tests; add folder-scoped pane coverage.
- **Docs / OpenSpec**: archive/retire the removed editor specs; per-directory `AGENTS.md` rows updated for every deleted/edited file.

## Discipline Skills

- `doubt-driven-review` — the folder-scoped internal-pane variant is a non-trivial new path (session-keyed → cwd-keyed state); review before it stands.
- `code-simplification` — this is a large net removal; ensure no orphaned imports/props/state remain after de-wiring.
