## Why

`embed-managed-node-runtime` lands a persistent Node copy at `~/.pi-dashboard/node/`, but never updates it. Over time the managed Node will fall behind the upstream LTS (security fixes, npm bugfixes, native-module ABI changes). Users currently have no way to refresh it short of deleting the directory and re-bootstrapping. We also have three different sources of `node` on a given machine — `managed`, `system` (PATH outside our dirs), and `bundled-electron` (inside the running Electron resources) — and the dashboard today has no language for talking about which one is in use, so any future Update button would silently "do the wrong thing" on two of the three.

This change introduces a source-aware Node runtime updater that mirrors the existing pi-core-updater shape: classify the runtime, route the update accordingly, refuse cleanly when not applicable, and stage-and-swap on Windows where `node.exe` is locked while running.

## What Changes

- Add `classifyNodeSource(nodePath)` pure helper in `packages/shared/src/platform/classify-node-source.ts` returning `"managed" | "system" | "bundled-electron"`. Compares `realpathSync(nodePath)` against `~/.pi-dashboard/node/`, against `process.resourcesPath/node/`, else `"system"`.
- Add `packages/server/src/node-runtime-checker.ts` mirroring `pi-core-checker.ts`. Probes `https://nodejs.org/dist/index.json`, filters for LTS in the current major, caches 24 h. Returns `{ source, currentVersion, latestVersion, updateAvailable }`.
- Add `packages/server/src/node-runtime-updater.ts` mirroring `pi-core-updater.ts`. Per-source routing:
  - `managed` → download new Windows/macOS/Linux zip into `<managedDir>/node-pending/`, write a swap-marker file, schedule swap on next start.
  - `system` → refuse with typed error `NodeRuntimeUpdateNotApplicable("system")`. UI surfaces disabled button + tooltip.
  - `bundled-electron` → refuse with typed error `NodeRuntimeUpdateNotApplicable("bundled-electron")`. UI surfaces "Update via Electron app" CTA.
- Add `packages/electron/src/lib/node-runtime-swap.ts` and matching helper for the standalone CLI. Runs at startup before health check; if `<managedDir>/node-pending/` + marker exist, swap directories (`node` → `node-old`, `node-pending` → `node`) and clear the marker. Schedules `node-old` deletion on next start.
- Extend `PiCoreChecker.getStatus()` to include a synthetic `node (runtime)` entry alongside `pi (core agent)`. Reuses the existing `UnifiedPackagesSection` UI (replaced the former `PiCoreVersionsSection` under change: consolidate-packages-settings-ui); renders source badge (`local` / `global` / `bundled`) and disabled button with tooltip when source is not `managed`.
- Add new REST surface: `POST /api/pi-core/update-node` (mirrors `POST /api/pi-core/update`) with the same `runExclusive` busy-lock and progress event pipeline (`pi_core_update_progress` / `pi_core_update_complete` reuse).
- Major-version policy: stay within current major by default. Cross-major updates require an explicit `{ allowMajor: true }` payload field, surfaced via a confirmation dialog.

## Capabilities

### New Capabilities

- `node-runtime-update`: governs source classification, latest-LTS probing, source-aware update routing, stage-and-swap lifecycle, and major-version policy for the managed Node runtime.

### Modified Capabilities

- `pi-core-version-check`: `getStatus()` SHALL include the Node runtime as an entry with `source: "managed" | "system" | "bundled-electron"` derived from `classifyNodeSource`.
- `pi-core-version-ui`: `UnifiedPackagesSection` (formerly `PiCoreVersionsSection`) SHALL render the Node entry, SHALL disable the Update button with an explanatory tooltip when source is not `managed`, and SHALL show a confirmation dialog before invoking a cross-major update.
- `managed-node-runtime` (introduced by `embed-managed-node-runtime`): SHALL support a `node-pending/` staging directory and a swap-on-start lifecycle; the post-swap `node-old/` SHALL be cleaned up on the next successful start.

## Impact

- **Files touched (production)**: `packages/server/src/node-runtime-checker.ts` (new), `packages/server/src/node-runtime-updater.ts` (new), `packages/server/src/pi-core-checker.ts` (synthetic entry merge), `packages/server/src/routes/pi-core-routes.ts` (new endpoint), `packages/electron/src/lib/node-runtime-swap.ts` (new), `packages/server/src/cli.ts` (call swap helper at startup), `packages/client/src/components/UnifiedPackagesSection.tsx` (source-aware buttons + confirm dialog; the section replaced the former `PiCoreVersionsSection` under change `consolidate-packages-settings-ui`), `packages/client/src/components/PiUpdateBadge.tsx` (count Node updates).
- **APIs**: one new REST route, one new WS event class (or reuse `pi_core_update_progress` keyed by `name: "node"`).
- **Network**: probes nodejs.org dist index (24 h cache) and downloads ~30 MB Windows/Linux/macOS zips on update. Honors existing npm proxy/registry config? **No** — direct HTTPS only; document this in design.md.
- **Compatibility**: depends on `embed-managed-node-runtime`. Without it, the managed-Node row reports `source: "system"` (or `"bundled-electron"` when running in Electron) and the Update button stays disabled — graceful degradation, no error.
- **Risk**: stage-and-swap on Windows can leak `node-old/` if the next start crashes between swap-detection and old-dir deletion. Mitigated by deleting `node-old/` lazily on every successful start, plus a Doctor check.
- **Out of scope**: updating npm independently of Node (npm ships in the same bundle), updating tsx (handled by the existing extension package update flow), and switching to a different Node distribution (e.g. Bun, Deno).

## Drift reconciliation — 2026-07-13

**Foundation shipped.** Predecessor change `embed-managed-node-runtime` archived 2026-05-03. Managed Node lives at `~/.pi-dashboard/node/`. `installManagedNode()` present. `managedRuntimeStrategy` lives in `packages/shared/src/tool-registry/strategies.ts`. Windows bundle copies `npm.cmd`/`npx.cmd`. PATH prepend works in `process-manager.ts` + `pi-core-updater.ts`.

**Update lifecycle entirely unbuilt.** Nothing below this section has been implemented:

- `node-runtime-checker.ts` (probe nodejs.org/dist/index.json) — absent.
- `node-runtime-updater.ts` (download/stage/swap) — absent.
- `node-runtime-swap.ts` in `packages/electron/src/lib/` — absent.
- `POST /api/pi-core/update-node` route — absent (only `/api/pi-core/update` exists).
- `classifyNodeSource()` helper — absent.
- `PiCoreChecker.getStatus()` — has no Node entry.
- `UnifiedPackagesSection` (formerly `PiCoreVersionsSection`) — shows no Node version/source row.

**Stale refs corrected in this pass:**
- `PiCoreVersionsSection.tsx` → `UnifiedPackagesSection.tsx` (renamed under change: consolidate-packages-settings-ui).
- Path prefix `src/shared/` → `packages/shared/src/` for shared source (e.g. `classify-node-source.ts`, `rest-api.ts`).
- `PiCorePackage.installSource` union today is `"global" | "managed"` — will need `"bundled"` added (task 5.2).
