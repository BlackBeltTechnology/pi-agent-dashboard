# Doctor probes look in the bundled tree, not just ~/.pi-dashboard

## Why

After `eliminate-electron-runtime-install` (R3 dep lift), `pi`, `openspec`, `tsx`, and `jiti` ship as **regular dependencies of the bundled server** under `<resourcesPath>/server/node_modules/`. There is no longer a runtime install into `~/.pi-dashboard/`; the managed dir is empty by design on a fresh Electron install.

`packages/shared/src/doctor-core.ts` was not updated for the new layout. Several checks still look **only** under `<managedDir>/node_modules/*` and on `PATH`, never under the bundled tree:

- `TypeScript loader` (line ~556): looks at `<managedDir>/node_modules/jiti/package.json` and `<managedDir>/node_modules/tsx/package.json` and `where tsx` / `which tsx`. Misses bundled `<resourcesPath>/server/node_modules/jiti/package.json`.
- `pi CLI` (same module): looks only on PATH and in managed dir. Misses bundled `<resourcesPath>/server/node_modules/@earendil-works/pi-coding-agent/` (note the **scoped** package name — the current probe path doesn't even target the right directory shape).
- `openspec CLI` (same module): same omission for `<resourcesPath>/server/node_modules/@fission-ai/openspec/`.

Result: a fresh, correctly-built Electron install reports three Doctor errors that are pure false positives. The user is directed to "run the setup wizard (Help → Setup)" — but there is nothing to set up; the binaries are already shipped under `resources/server/node_modules/`.

**Sibling finding (added 2026-05-25):** `packages/electron/src/lib/doctor.ts::probeServer()` reads `health.starter` (line 121), but the dashboard server emits `health.launchSource` (per `packages/server/src/__tests__/health-shape.test.ts`, post-`eliminate-electron-runtime-install`). Result: the "Server starter" row reports `Unknown (old server?)` on a current-version server. Same class of bug — Doctor wasn't updated for the post-R3 field-name change. Folded into this proposal because the fix is one line and the failure mode is identical (Doctor misleadingly suggests "old server build" when the server is current).

The irony in the same module: `packages/electron/src/lib/doctor.ts:359` already uses `resolver.resolveJiti(...)` which **does** find the bundled jiti and feeds it into the launch-test argv. So Doctor knows where jiti lives — but the "TypeScript loader" check probe is independent code that doesn't.

Surfaced during the spike for `fix-ci-electron-runnable-bundles` (CI run 26416255173). Independent of `fix-doctor-windows-launch-test` (which fixes a different probe bug).

## What Changes

- **Add bundle-aware probe paths** to the four affected checks in `packages/shared/src/doctor-core.ts`:
  - `TypeScript loader`: also probe `<resourcesPath>/server/node_modules/jiti/package.json` and `<resourcesPath>/server/node_modules/tsx/package.json` before falling back to PATH.
  - `pi CLI`: also probe `<resourcesPath>/server/node_modules/@earendil-works/pi-coding-agent/package.json` (the scoped path actually used by the bundle). Use `pi-package-resolver.ts` if available to resolve the entry CLI script.
  - `openspec CLI`: also probe `<resourcesPath>/server/node_modules/@fission-ai/openspec/package.json`.
- **Fix `probeServer()` field rename** in `packages/electron/src/lib/doctor.ts:121`: read `health.launchSource` instead of `health.starter`. The server-side rename happened in `eliminate-electron-runtime-install` but Doctor was missed. Keep a fallback to `health.starter` for one minor version for graceful degradation against an actually-old server (then drop it the release after).
- **Shared helper**: extract `findBundledPackage(resourcesPath, pkgName)` into a pure utility returning `{ packageJsonPath, version } | null`. Reused by all three checks; testable in isolation.
- **Probe order**: bundled location FIRST, then managed dir, then PATH. The bundled location is the authoritative source of truth for an Electron install; if both exist (e.g. user manually installed a newer `pi` to PATH), Doctor SHOULD report both with the bundled one as the "active" version. Initial scope: report the first match only; mismatch-warning is a follow-on.
- **Remediation messages**: when a binary IS found in the bundle, no remediation text. When NOT found and the install is Electron, the message names the missing bundle path explicitly, not "run the setup wizard" (which would do nothing).
- **`resourcesPath` plumbing**: the existing `runSharedChecks(opts)` signature gains an optional `resourcesPath: string | null`. `packages/electron/src/lib/doctor.ts` passes `process.resourcesPath` from the Electron context. The standalone server (no Electron) passes `null` and the bundle-aware probes simply skip — same code path stays valid in the npm-global install.

## Extended scope (added 2026-05-26)

A Doctor side-by-side comparison on the win32-x64 Electron build of commit `9b76139` (post-launch-source-fix) surfaced two more divergences from `fix-windows-path-system32-missing` task 7.4 follow-through:

1. **Settings → Diagnostics shows fewer rows than the Electron Doctor window.** Settings (`/api/doctor` → `runSharedChecks`) reports 7 rows. The Electron Doctor window reports 13. The 6 missing rows are: `Electron <version>`, `Bundled Node.js`, `Bundled npm`, `Bundled Node runtime`, `Dashboard server code`, `Server starter`. All but `Electron <version>` are file-system / HTTP probes a server with `resourcesPath` can run directly.

2. **System Node.js mislabel.** `runSharedChecks` calls `detectSystemNode()`, which does `where node`. On an Electron-launched server, `ToolResolver.buildSpawnEnv` prepends `<res>/node` to PATH (so the server can find Node for its own children). Result: `where node` returns `<res>/node/node.exe`, and the row is labelled "System Node.js" pointing at the bundled binary. The user sees an apparent contradiction ("System Node.js found" + "System Node.js not on PATH") between Settings and Doctor.

### Extended what-changes

- **Lift 5 rows into `runSharedChecks`** when `resourcesPath` is non-null:
  - `Bundled Node.js` (probe `<res>/node/node.exe` on win32, `<res>/node/bin/node` on POSIX).
  - `Bundled npm` (probe `<res>/node/node_modules/npm/bin/npm-cli.js`).
  - `Bundled Node runtime` (one-line summary of the active runtime — mirror existing Electron-side check).
  - `Dashboard server code` (resolve `<res>/server/...cli.ts` via the same logic used by `selectLaunchSource`).
  - `Server starter` (fetch `/api/health` via `deps.fetchHealth?` injection; read `launchSource` with legacy `starter` fallback per task 1b).
- **Electron-side `doctor.ts` shrinks**: drop those 5 checks (now redundant). Keep only the `Electron <version>` row, which the standalone arm has no equivalent for.
- **Filter bundled-node from System Node**: in `runSharedChecks`, after `detectSystemNode()` returns `{ path }`, if `path` resolves under `<resourcesPath>/node/` (case-insensitive on win32), treat as `not-found-on-PATH` and emit the existing warning row. The new `Bundled Node.js` row carries the bundled-node info honestly.
- **No protocol break for legacy servers**: an attached older server's `/api/health` lacks `launchSource`; the legacy fallback to `starter` covers it (already in task 1b).

### Extended capabilities (NOT implemented)

> These extended-scope requirements were never implemented. They remain aspirational.

- `doctor-diagnostic`: ADDS a Requirement that `runSharedChecks` SHALL surface bundled-runtime rows (Node, npm, server-code, server-starter) when `resourcesPath` is provided, so the Settings ↔ Doctor surfaces are not divergent.
- `doctor-diagnostic`: ADDS a Requirement that the `System Node.js` check SHALL NOT report a binary located under `<resourcesPath>/node/` as system Node — that's bundled Node leaking through PATH-injection.

### Extended impact (NOT implemented)

> These impacts were aspirational; they were never realized.

- Settings → Diagnostics would show 12/13 rows (only `Electron <version>` Electron-only). Currently shows 7.
- `System Node.js` row would honestly report system Node state. Currently can falsely report bundled Node as "System Node".
- Electron-side `doctor.ts` would become thinner (~70 LOC dropped, 1 LOC kept).
- Standalone-arm impact: zero (no `resourcesPath` → lifted checks skip, same as before).

## Capabilities

### Modified Capabilities

- `doctor-diagnostic`: extends the existing TypeScript-loader / pi-CLI / openspec-CLI requirements with a "bundle-aware probe order" sub-requirement. Adds a new requirement that remediation text SHALL NOT instruct an Electron user to "run setup" when the binary is missing from the bundle (a corrupted-install signal, not a setup-needed signal).

## Impact

- **Scope**: 1 file changed (`doctor-core.ts`), 1 signature gain (optional `resourcesPath`), 1 file extended (`doctor.ts` to pass it), ~50 LOC + tests.
- **User-visible**: fresh Electron install Doctor output goes from `5 ok / 5 warn / 3 err` → `8 ok / 4 warn / 0 err` (approximate). The wizard-needed-now? message disappears for users who have a complete bundle.
- **Standalone-install (npm i -g) impact**: zero. `resourcesPath` is `null` for that arm; probes fall through to managed dir + PATH as today.
- **Bridge-arm impact**: zero. Bridge installs pi itself via the parent pi process; never reaches the bundle-probe path.
- **Risk**: low. Each new probe is additive (looks in a new place before falling back to existing logic). False negatives in the existing logic become true positives; no false positives are introduced.
- **Out of scope**: managing version skew between bundled and PATH installs; auto-cleanup of stale managed dirs; node-pty / native-module probes (covered by GO/NO-GO in `bundle-server.mjs:273`).

## Drift reconciliation — 2026-07-13

### Architecture change

The implementation diverged from this proposal in one material way: instead of a `resourcesPath` parameter + `findBundledPackage` helper, the production code uses **dependency injection** (`deps.detectPi`, `deps.detectOpenSpec` in `runSharedChecks`) and **`tryResolvePkg`** (via `createRequire` for bundled jiti/tsx lookup). This was a simpler, more testable approach that avoided threading `resourcesPath` through the shared/server boundary.

### Delivered items (via the alternative architecture)

| What | How it was done |
|---|---|
| Bundle-aware TypeScript loader | `tryResolvePkg("jiti")` / `tryResolvePkg("tsx")` in `doctor-core.ts` (bundled `Resources/server/node_modules/` lookup) |
| Bundle-aware pi probe | `deps.detectPi()` injected into `runSharedChecks`; `electron/doctor.ts` wires `detectPi()` from local `dependency-detector.ts` |
| Bundle-aware openspec probe | `deps.detectOpenSpec()` injected into `runSharedChecks`; same wiring pattern |
| Remediation messages | `SUGGESTIONS` map in `doctor-core.ts` updated with bundle-appropriate text (no "run setup wizard" for Electron users) |
| Stale Managed-install row | Removed in sibling change `fix-doctor-stale-managed-install-check` (archived) |
| Doctor skill | Created in sibling change `add-modular-doctor-skill` (archived) |
| `SECTION_OF` entries for "Bundled Node.js" / "Bundled npm" | Defined in `doctor-core.ts` (line ~359) but still only emitted by `electron/doctor.ts`, not by `runSharedChecks` |

### Items NOT yet delivered

These gaps remain from the original scope:

1. **`electron/doctor.ts` duplicates shared rows.** "Bundled Node.js", "Bundled npm", and "Dashboard server code" are each checked independently in `packages/electron/src/lib/doctor.ts` (lines ~189–260, ~305–330) via their own `getBundledNodePath()` / `getBundledNpmPath()` / filesystem probes. The proposal called for lifting these into `runSharedChecks` so the Electron Doctor and Settings → Diagnostics emit the same canonical rows. Not done — each arm still has its own copy.

2. **`probeServer()` still reads `health.starter`.** `packages/electron/src/lib/doctor.ts` `probeServer()` (line ~262) reads `health.starter` instead of `health.launchSource`. The dashboard server has emitted `health.launchSource` since `eliminate-electron-runtime-install`; the Doctor row shows `"Unknown (old server?)"` on a current server. Proposal task 1b covers this.

3. **Extended scope not implemented.** The 5-row lift (Bundled Node.js, Bundled npm, Bundled Node runtime, Dashboard server code, Server starter) into `runSharedChecks` and the bundled-Node filtering from the System Node check were never started. These were aspirational scope-additions in the proposal that remain future work.
