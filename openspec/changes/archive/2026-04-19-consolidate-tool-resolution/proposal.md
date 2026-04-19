## Why

Binary and module resolution is scattered across the dashboard: `ToolResolver` in `packages/shared/src/platform/binary-lookup.ts` knows *how* to search; `dependency-detector.ts` in `packages/electron/` classifies results but only for Electron; `loadPiPackageManager()` is implemented twice (server + electron) with slightly different fallback chains; per-tool caches live in `runner.ts`, `npm.ts`, and `package-manager-wrapper.ts` independently. When any of these fail on Windows — where dual Node installs, bash shims vs. `.cmd`, PATHEXT ordering, and `~/.pi-dashboard/` managed roots all collide — users see opaque errors like "pi-coding-agent is not installed" with **no visibility** into which strategies were tried or why each failed, and **no way to override** the wrong pick without editing PATH.

## What Changes

- Introduce a single **`ToolRegistry`** service in `packages/shared/src/tool-registry/` that:
  - Registers every tool the dashboard depends on (`pi` binary, `pi-coding-agent` module, `openspec`, `npm`, `node`, `tsx`, `git`, `zrok`) with a typed definition (strategy chain, expected artifact, classification rules).
  - Resolves each tool through a uniform **override → strategy chain → fail** pipeline, caching per-process.
  - Records **diagnostics per resolution**: every strategy tried, why each succeeded or failed, the winner, and the timestamp.
  - Reads user overrides from `~/.pi/dashboard/tool-overrides.json` (separate from `config.json` to keep machine-specific paths out of portable config).
- Consolidate the two `loadPiPackageManager()` copies (server + electron) into `ToolRegistry.resolveModule("pi-coding-agent")` returning a loaded module reference.
- Expose a **REST API** on the server:
  - `GET /api/tools` — snapshot of every registered tool (resolved path, source, strategy, diagnostics, override status).
  - `POST /api/tools/rescan` — invalidate caches and re-resolve; optional `{ name }` to target one tool.
  - `PUT /api/tools/:name` — set `{ path }` override; `DELETE` to clear.
- Add a **Tools** section to `SettingsPanel` showing each tool's status, the resolution strategy that won, a "Browse…" override input, a per-tool "Rescan" button, and a top-level "Rescan all" / "Reset overrides" / "Export diagnostics" trio.
- Migrate existing consumers (`process-manager`, `openspec-poller`, `package-manager-wrapper`, `tunnel`, `editor-*`, `dependency-detector`, `dependency-installer`, electron `doctor`) from ad-hoc `ToolResolver`/`which`/custom lookup to `ToolRegistry.resolve(name)`.
- Supersede the narrower `fix-portable-windows-package-manager` change (its managed-install fallback becomes one registered strategy for the `pi-coding-agent` tool).

## Capabilities

### New Capabilities

- `tool-registry`: Centralized resolution of every external binary and module the dashboard depends on, with per-resolution diagnostics, user overrides, and cache invalidation.
- `tool-settings-ui`: Settings-panel surface for inspecting tool resolutions, setting per-tool path overrides, and triggering rescans.

### Modified Capabilities

- `dependency-installer`: `detectPi()` / `detectOpenSpec()` / `detectDashboardPackage()` / `detectBridgeExtension()` become thin wrappers over `ToolRegistry`. Classification (`system` / `managed` / `settings`) is owned by the registry.
- `command-executor`: `resolveBinary()` in `runner.ts` delegates to `ToolRegistry` so that overrides apply uniformly to every Recipe (npm, openspec, git, etc.). Per-process `resolverCache` in `runner.ts` is retired in favor of the registry's cache.
- `package-install`: `loadPiPackageManager()` in `packages/server/src/package-manager-wrapper.ts` is replaced by `ToolRegistry.resolveModule("pi-coding-agent")`. Error messages surface the diagnostic trail instead of a generic "not installed" throw.
- `settings-panel`: Add a **Tools** tab (or section under General) rendering tool-registry data.

## Impact

- **Code**:
  - New: `packages/shared/src/tool-registry/{registry,definitions,overrides,types}.ts` + tests.
  - Modified: `packages/shared/src/platform/runner.ts` (delegate resolution), `packages/shared/src/platform/npm.ts` (drop private cache), `packages/server/src/package-manager-wrapper.ts` (drop duplicate loader), `packages/server/src/routes/` (new `tool-routes.ts`), `packages/server/src/server.ts` (register routes), `packages/electron/src/lib/dependency-detector.ts` + `dependency-installer.ts` + `doctor.ts` (consume registry), `packages/client/src/components/SettingsPanel.tsx` (new Tools section + helpers).
- **Config**: New file `~/.pi/dashboard/tool-overrides.json` (machine-local, gitignored via user's home).
- **REST API**: Three new endpoints under `/api/tools` (see `docs/architecture.md` to be updated).
- **Backward compatibility**: `ToolResolver.which()` remains as a lower-level primitive — the registry uses it internally. No external consumers of the platform module break; they just gain override support transparently.
- **Risk**: Medium. Touches the resolution path every spawn flows through. Mitigated by (a) keeping `ToolResolver` as the underlying mechanism unchanged, (b) registry tests covering each strategy's win/lose ordering, (c) a feature flag `toolRegistry.overridesEnabled` if we want to roll out UI before overrides.
- **Supersedes**: `openspec/changes/fix-portable-windows-package-manager/` — fold its managed-install strategy into the registry and archive the older change once this lands.
