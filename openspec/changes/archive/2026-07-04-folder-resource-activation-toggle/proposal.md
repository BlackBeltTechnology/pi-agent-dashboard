# pi-resource activation toggle (folder + global scope)

## Why

The dashboard already wraps pi's **install** dimension into settings pages at both scopes: the directory settings surface (`/folder/:cwd/settings/:page?`) and the global settings page (`/settings/:page?`, `SettingsPanel` + `UnifiedPackagesSection`) let a user install / update / uninstall / move packages, and browse every skill / extension / prompt available (`PiResourcesView` Resources tab / `usePiResources`, which already scans both `local` and `global` scopes).

What it does **not** wrap is pi's **activation** dimension — the "installed but turned off" state. pi already owns this: its `pi config` picker enables/disables an installed extension/skill/prompt/theme per global or project scope without uninstalling. Today the only dashboard-adjacent way to reach it is pi's interactive TUI; there is no dashboard control. This leaves a concrete gap for the user who wants a resource **installed** (available elsewhere, or later) but **inactive** for a given scope.

The key finding (verified against pi's source — see `design.md`): pi is **interactive-only at the CLI** for this, but it **exports the primitives programmatically**. The dashboard reuses them instead of reinventing:
- **Read** activation state: `PackageManager.resolve(): Promise<ResolvedPaths>` returns `ResolvedResource { path, enabled }` per resource — `enabled` already computed by pi applying its `+/-<pattern>` precedence.
- **Write** a toggle: `SettingsManager` typed setters (`setExtensionPaths` / `setSkillPaths` / `setPromptTemplatePaths` / `setThemePaths` + `setProject*` variants) — the exact writers pi's own `config-selector` uses, format-preserving.

Because both read and write are pi's own code, the dashboard reimplements **zero** glob logic; correctness and scanner↔write consistency are free.

Not to be confused with `add-plugin-activation-ui` (archived): that toggles **dashboard plugins** via global `~/.pi/dashboard/config.json#plugins.<id>.enabled`. This change toggles **pi resources** via pi's own `SettingsManager` / `settings.json` resource arrays. Different config store, different runtime (pi session load vs dashboard slot registry). No overlap.

## What Changes

### Shared types (additive, backward compatible)

- **MODIFY** `packages/shared/src/rest-api.ts` `PiResource`: add `enabled: boolean` (mirrors pi's `ResolvedResource.enabled` for the scanned resource). Existing fields unchanged.

### Server — derive activation state by reusing pi's resolver

- **MODIFY** `packages/server/src/pi-resource-scanner.ts`: after scanning, set `enabled` on each `PiResource` from pi's `PackageManager.resolve()` output (`ResolvedPaths`), matched by resolved `path`. The scanner does **not** re-derive glob precedence — it consumes pi's already-computed `enabled`. Applies to both `local` and `global` result sets (both already returned today). A resource pi does not report defaults `enabled: true`.

### Server — activation write endpoint (scope-aware, delegates to pi's SettingsManager)

- **ADD** `packages/server/src/routes/resource-activation-routes.ts`:
  - `POST /api/resources/toggle` — body `{ scope: "local"|"global"; cwd?: string; type: "extension"|"skill"|"prompt"|"theme"; filePath: string; enabled: boolean; packageSource?: string }`.
    - Constructs pi's `SettingsManager` for the target scope (`local` → `<cwd>/.pi`, requires `cwd`; `global` → `~/.pi/agent`) and replays pi's `config-selector` write logic: read the current array (`settings[type]` for loose, `pkg[type]` for package resources), strip any existing entry whose `!+-`-stripped value equals `pattern = relative(baseDir, filePath)`, then push `+<pattern>` (enable) or `-<pattern>` (disable). Persist via the matching typed setter. Package resources convert the entry to object-form as pi does (partial-key object form is intended).
    - Returns `{ affectedSessions: SessionId[] }` (running sessions governed by this scope, for the one-click reload).
    - 404 when `filePath` is not in the scanned resource set for that scope. Never uninstalls or moves a package.
  - Auth-gated through the same chain as the existing package routes.
  - Scope-bounded security guard (realpath-normalized): `local` writes only under the folder's `.pi/`; `global` writes only under `~/.pi/agent/`.

### Server — one-click reload (folder-scoped)

- **ADD** `POST /api/resources/reload` — body `{ scope: "local"|"global"; cwd?: string }`. Reloads the affected sessions through the **existing per-session reload interceptor** (`handleSendPrompt`/`/reload` in `session-action-handler.ts`, which already routes headless→respawn vs TUI→prompt). `local` filters connected sessions by cwd via the existing `pi-gateway` prefix-match (`findSessionByCwd`, made plural); `global` reloads all. Returns the reloaded count. Not the argless all-sessions `reloadSessions()`.

### Client — Resources surface gains a toggle + one-click reload

- **MODIFY** `packages/client/src/components/PiResourcesView.tsx` (Resources tab, via `MergedScopeSection` / `resource-tree`): render a per-resource enable/disable switch on each extension / skill / prompt / theme row, reflecting `PiResource.enabled`. Toggling issues `POST /api/resources/toggle` and optimistically updates. Applies to both the local and global sections the tab already renders; the global settings page reuses the same component.
- **ADD** `packages/client/src/lib/resources-api.ts` (`toggleResource`, `reloadResourceSessions`).
- After any toggle, a one-click **"Reload N sessions"** button appears (N = `affectedSessions.length`); clicking POSTs `/api/resources/reload` for that scope and clears the pending state on success. Hidden when N = 0. pi reads resource arrays at session start, so this is the apply step.
- Install / uninstall stays exclusively on the Packages tab / section — the toggle only flips activation, never removes.

## Impact

- Affected specs: `pi-resources-view` (Resources surface gains activation control + one-click reload). New capability delta under `specs/pi-resources-view/`.
- Affected code: `pi-resource-scanner.ts` (consume `PackageManager.resolve`), new `resource-activation-routes.ts` (use `SettingsManager`), `PiResourcesView.tsx` + `resource-tree`, `rest-api.ts`, new `resources-api.ts`.
- Reuses pi's exported `PackageManager` (read) + `SettingsManager` (write) from `@earendil-works/pi-coding-agent` — dashboard already loads pi via jiti. No new glob engine, no hand-written JSON, no shelling out to the interactive `pi config`.
- Backward compatible: `PiResource.enabled` additive; scopes with no exclusions resolve all `enabled: true` as today.
- Concurrency + reload both reuse proven in-repo patterns (`design.md` OQ3/OQ4, clarified): per-target write mutex from `file-routes.ts` guards concurrent toggles; the `pi-gateway` cwd filter + `session-action-handler` reload interceptor give correct folder-scoped reload across headless and TUI sessions. Optional mtime-409 documented, not required.
- Out of scope: subagent-level tool gating (`.md` `tools:` allowlist, a different mechanism); toggling whole *packages* on/off (install/uninstall already covers that).
