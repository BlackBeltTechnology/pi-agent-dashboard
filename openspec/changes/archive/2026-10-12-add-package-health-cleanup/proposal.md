## Why

Pi's `~/.pi/agent/settings.json` `packages[]` array accumulates rot over time. A real cleanup session (`019e4411-…`) found a 13-entry array containing:

- **4 stale npm entries** referring to packages that had been uninstalled from `~/.pi-dashboard/node/lib/node_modules` (`@blackbelt-technology/pi-model-proxy`, `@howaboua/pi-glm-via-anthropic`, `@tintinweb/pi-subagents`, `pi-agent-browser`).
- **2 dead local-path entries** pointing at directories that no longer existed (a moved managed install + an evicted pnpm cache).
- **2 valid-but-duplicate entries** registering the same `pi-dashboard-extension` package from two different roots (project dev source + bundled Electron app). Pi happily loaded both, causing duplicate bridge registrations and port-9999 contention.

The cleanup required hand-running a Python script: read `settings.json`, classify each entry, ask the user which duplicate to keep, atomically rewrite the file, restart the server. That logic should live in the dashboard.

Today the dashboard already has most of the primitives:

- `installed-package-enricher.ts` reads each `packages[]` entry, resolves `installedPath`, and parses `package.json#name/version`.
- `package-source-helpers.ts` exports `parseSourceKind` + `computeIdentity` (the basis for duplicate detection).
- `package-routes.ts` already mutates `packages[]` via `packageManagerWrapper.remove(...)`.
- `plugin-bridge-register.ts#reconcilePluginBridgePackages` is the precedent for "scrub `packages[]` at boot, drop dangling managed entries, atomic write."

What's missing is the **classifier**, the **duplicate-grouper that asks the user before deciding**, and the **UI surface** that surfaces the rot before it bites.

## What Changes

**NEW server-side module**

- **NEW** `packages/server/src/package-health-scanner.ts` — pure classifier producing `PackageHealthReport[]`:
  - status: `ok` | `stale-npm` | `missing-path` | `duplicate` | `unreachable-remote` (v1: only first four; remote-liveness deferred).
  - `duplicateGroup`: stable id grouping entries that share the same `package.json#name` after enrichment.
  - reuses `enrichInstalled` for `installedPath` + `package.json#name/version` resolution; reuses `computeIdentity` for npm/git/abs-path identity.

**NEW REST routes** (in a new `package-health-routes.ts`)

- **NEW** `GET /api/packages/health` — returns `{ entries: PackageHealthReport[], summary: { ok, stale, missing, duplicates } }`. JWT-gated like the existing package routes.
- **NEW** `POST /api/packages/cleanup` — body `{ drop: string[] }` where each string is an exact `source` from `packages[]`. Validates each source exists in current `packages[]`, then atomically rewrites `settings.json` minus those entries. Returns `{ before, after, dropped: string[], backupPath }`. Writes a timestamped backup to `~/.pi/agent/settings.json.<ts>.bak` before mutation.

**NEW boot-time scan (log-only in v1)**

- **MODIFY** `packages/server/src/server.ts` (startup sequence) to call `runPackageHealthScan({ logOnly: true })` once after `reconcilePluginBridgePackages`. Logs a single-line summary (`[package-health] 13 entries: 6 ok, 4 stale, 2 missing, 1 duplicate group`) so power users see the rot in `server.log` even without opening Settings. **Never auto-deletes in v1.** A future change can flip this to opt-in auto-cleanup via config.

**NEW client UI**

- **MODIFY** `packages/client/src/components/UnifiedPackagesSection.tsx` — fetches `/api/packages/health` on mount, shows an `Issues (N)` badge on the section header when N > 0.
- **NEW** `packages/client/src/components/PackageHealthPanel.tsx` — expandable panel listing problem entries grouped by status:
  - **Stale / Missing** group: one-click "Remove all" + per-row checkbox + Apply.
  - **Duplicates** group: per-group radio (or multi-keep) with file mtime + version + source-kind shown to help the user choose; auto-marks any missing-path duplicates as "drop."
  - **Apply cleanup** button issues a single `POST /api/packages/cleanup` with the union of selected drops, then re-fetches `/api/packages/installed`.
- **NEW** `packages/client/src/lib/package-health-api.ts` — typed fetch wrappers.

**NEW shared types**

- **MODIFY** `packages/shared/src/rest-api.ts` — adds `PackageHealthReport`, `PackageHealthStatus`, `PackageHealthSummary`, `PackageCleanupRequest`, `PackageCleanupResponse`.

**Tests**

- Unit tests for the pure classifier (`package-health-scanner.test.ts`): every status path, duplicate-grouping by `package.json#name`, deterministic group ids.
- Route tests for `/api/packages/cleanup` covering: unknown-source rejection, partial-drop, backup creation, idempotent re-apply.
- Component test for `PackageHealthPanel` covering: no-issues empty state, all four status groups, "missing dupes are pre-checked," apply-flow disabled during pending POST.

## Out of scope (deferred to a follow-up)

- **Auto-cleanup at boot** — log-only in v1. Behavior change too risky for first release.
- **Remote-liveness probes** — `git ls-remote` for git entries, npm-registry checks for `npm:` entries. Adds 1–3s + network deps to every scan; defer until users ask.
- **Watch-mode** — scanning only happens on Settings open + manual "Rescan" button. No filesystem watchers.
- **Restoring deletions** — the timestamped `.bak` exists for manual rollback; no in-UI undo button.

## Migration / compatibility / rollback

- **Migration**: none. New code reads existing `settings.json` shape; no schema change.
- **Compatibility**: older pi-coding-agent versions tolerate a shorter `packages[]` without issue (existing `pi packages remove` already shrinks this array).
- **Rollback**: revert this change; the boot-time log line and `/api/packages/health` route disappear. Any cleanup already applied stays applied (it's just a `settings.json` mutation that any other tool can re-create).
- **Backup**: every cleanup writes `~/.pi/agent/settings.json.<ISO-ts>.bak` first. Old backups are not auto-pruned in v1.
