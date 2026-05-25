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
