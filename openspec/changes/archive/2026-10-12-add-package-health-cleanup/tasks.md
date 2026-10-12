## 1. Shared types

- [x] 1.1 Add `PackageHealthStatus = "ok" | "stale-npm" | "missing-path" | "duplicate"` to `packages/shared/src/rest-api.ts`.
- [x] 1.2 Add `PackageHealthReport` interface: `source`, `status`, `resolvedPath?`, `packageName?`, `version?`, `duplicateGroupId?`, `mtime?`, `reason?` (human-readable).
- [x] 1.3 Add `PackageHealthSummary` (counts per status + `duplicateGroups`) and `PackageHealthListResponse`.
- [x] 1.4 Add `PackageCleanupRequest = { drop: string[] }` and `PackageCleanupResponse = { before: number; after: number; dropped: string[]; backupPath: string }`.

## 2. Pure scanner module

- [x] 2.1 Create `packages/server/src/package-health-scanner.ts`. Exports `scanPackageHealth(packages: string[], enricher): PackageHealthReport[]` — pure, takes enricher result as input.
- [x] 2.2 Implement classification: `ok` (path exists + `package.json` resolved), `stale-npm` (`npm:` source with no resolved `installedPath`), `missing-path` (local/git source with no resolved `installedPath`).
- [x] 2.3 Implement duplicate grouping by `package.json#name`. Generate stable `duplicateGroupId` from the name (lowercased, e.g. `dup:pi-dashboard-extension`).
- [x] 2.4 Build `summary` aggregator: counts per status + list of duplicate-group names.
- [x] 2.5 Unit tests in `package-health-scanner.test.ts`:
  - empty input → all-zero summary
  - all-ok input → no duplicates, no stale, no missing
  - stale-npm classification
  - missing-path classification
  - 4-copy duplicate (the real-world case from session 019e4411) groups correctly
  - mixed input produces correct per-status counts

## 3. REST routes

- [x] 3.1 Create `packages/server/src/routes/package-health-routes.ts`.
- [x] 3.2 Implement `GET /api/packages/health` — calls `enrichInstalled` once, feeds into `scanPackageHealth`, returns `{ entries, summary }`. Auth-gated like sibling routes.
- [x] 3.3 Implement `POST /api/packages/cleanup`:
  - Validate body matches `PackageCleanupRequest` (Ajv schema).
  - Read `~/.pi/agent/settings.json`.
  - Reject 400 with `{ unknown: string[] }` if any `drop[]` entry is not in current `packages[]`.
  - Write `settings.json.<ISO-ts>.bak` (full file copy).
  - Atomically rewrite `settings.json` with `packages` filtered.
  - Return `PackageCleanupResponse`.
- [x] 3.4 Wire routes into `server.ts` route registration.
- [x] 3.5 Route tests in `package-health-routes.test.ts`:
  - health endpoint returns expected shape
  - cleanup rejects unknown sources (400, no file mutation)
  - cleanup writes backup before mutation
  - cleanup atomic-rewrite preserves all non-`packages` keys in `settings.json`
  - idempotent re-apply (second call with empty `drop[]` is a no-op)

## 4. Boot-time log scan

- [x] 4.1 Export `logPackageHealthAtBoot()` from `package-health-scanner.ts` — reads settings, runs scan, emits the single-line summary if any non-ok status is present.
- [x] 4.2 Call from `server.ts` startup after `reconcilePluginBridgePackages`. Log at INFO. Suppress entirely when summary is clean.
- [x] 4.3 Test that the boot logger:
  - emits nothing when all entries are ok
  - emits one line with correct counts when issues exist
  - never throws (wrapped in try/catch — boot must not fail on a scanner bug)

## 5. Client API + types

- [x] 5.1 Create `packages/client/src/lib/package-health-api.ts` with `fetchPackageHealth()` and `applyPackageCleanup(drop: string[])`.
- [x] 5.2 Both helpers throw typed errors carrying response body for the UI to render.

## 6. Client UI

- [x] 6.1 Create `packages/client/src/components/PackageHealthPanel.tsx`. Props: `report: PackageHealthListResponse`, `onApply: (drop: string[]) => Promise<void>`, `onRefresh: () => void`.
- [x] 6.2 Implement three sub-sections (rendered only if non-empty): Stale npm, Missing path, Duplicates.
- [x] 6.3 Stale + missing sections: per-row checkbox + "Select all" header. Apply button uses union of checked rows.
- [x] 6.4 Duplicate sub-section: per-group expandable card showing every member with version, source-kind, resolved path, mtime. Allow multi-keep (checkboxes), with missing-path members pre-checked for drop.
- [x] 6.5 Apply button disabled when no drops selected or POST in flight. Surfaces server error inline.
- [x] 6.6 After successful apply: re-fetch `/api/packages/installed`, dismiss panel, show "Restart required" banner (reuse the existing one if available).
- [x] 6.7 Integrate into `UnifiedPackagesSection.tsx`: fetch on mount, show `Issues (N)` badge when N>0, render `<PackageHealthPanel/>` above the existing list.
- [x] 6.8 Component tests:
  - empty/healthy state renders nothing
  - all four status groups render with their members
  - missing-path duplicate is pre-checked
  - apply disabled with no selection
  - apply POST + refresh on success

## 7. Documentation

- [x] 7.1 Add row to `docs/file-index-server.md` for `package-health-scanner.ts` and `routes/package-health-routes.ts` (caveman style).
- [x] 7.2 Add row to `docs/file-index-client.md` for `PackageHealthPanel.tsx` and `package-health-api.ts`.
- [x] 7.3 Update `docs/architecture.md` if there's a "Packages" section describing the existing flow.
- [x] 7.4 Add FAQ entry to `docs/faq.md`: "How do I clean up stale entries from `settings.json`?"
- [x] 7.5 Update `AGENTS.md` "Key Files" rows only if the new modules become architectural backbone (probably not — they're feature code).

## 8. Validation

- [x] 8.1 `openspec validate add-package-health-cleanup --strict` passes.
- [x] 8.2 Manual: run dashboard against a `settings.json` with each rot category and verify the panel surfaces it correctly.
- [x] 8.3 Manual: apply cleanup, verify `.bak` exists, verify `packages[]` shrank correctly, verify server still boots.
