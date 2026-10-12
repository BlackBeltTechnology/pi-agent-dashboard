## Context

Pi reads its package list from `~/.pi/agent/settings.json#packages[]`. The array stores raw source strings — `npm:foo`, `git:owner/repo`, `https://…`, absolute filesystem paths, or relative paths. Pi resolves each on load via its `DefaultPackageManager`. If a source no longer resolves, pi logs and skips it; if two sources resolve to the same package, pi loads both (which is the duplicate-bridge bug).

The dashboard already wraps `DefaultPackageManager` (`package-manager-wrapper.ts`) and surfaces `packages[]` via `/api/packages/installed`. The enricher (`installed-package-enricher.ts`) already does the per-entry `package.json` read that the health scanner needs.

The goal of this change is to add **classification + user-mediated cleanup** on top of those existing primitives — not to rewrite them.

## Decision 1 — Duplicate identity is `package.json#name`, not source-kind identity

`package-source-helpers.computeIdentity()` returns `npm-name` for `npm:` entries, the canonical git URL for `git:`/`https://` entries, and the absolute resolved path for local entries. That's the right primitive for **deduplication of the same source** (same npm package listed twice, same path listed twice).

But it is **not** what catches the case that triggered this change. The pi-dashboard-extension appeared 4 times under 4 different source kinds (local dev path + bundled `/Applications/...` path + managed `~/.pi-dashboard/...` path + pnpm cache path). `computeIdentity` says "4 different identities." A user who reads the list says "4 copies of the same extension."

**Decision:** duplicates are grouped by **`package.json#name`** (the enricher already reads this). `computeIdentity` is used as a secondary key for stable group ids and as the dedup key for entries that have no resolvable `package.json` (e.g. stale `npm:foo` where the install dir is gone — those go to `stale-npm`, not `duplicate`).

### Considered alternatives

- **`computeIdentity` only** — rejected; misses the multi-path-same-package case that motivated this change.
- **Hash of `package.json` contents** — rejected; two builds of the same package legitimately differ in dist/lockfile shape and would not group.
- **User-tagged groups** — rejected as over-engineering; the name-based grouper covers the realistic cases.

## Decision 2 — Cleanup is user-mediated, not automatic

The boot-time scan is **log-only in v1**. The `/api/packages/cleanup` endpoint requires an explicit `drop: string[]` list — the server never decides what to remove on its own.

### Why not auto-cleanup on boot

The boot path runs before the user can see what's wrong. If a network-mounted directory is briefly unavailable at boot, an "auto-drop missing paths" policy would silently delete valid entries. The cost of a false-positive deletion (user manually re-adds a package) is high enough that we require explicit consent.

### Why not auto-drop *missing-only* entries

Same reason in attenuated form. We do, however, **pre-check** missing-path entries inside a duplicate group as "drop candidates" in the UI — if the user opens the panel and reviews the list, they get a sensible default selection.

### Considered alternatives

- **Auto-clean entries that have been broken for >7 days** — interesting but requires a persistent "first seen broken" timestamp. Defer.
- **Boot-time auto-clean behind config flag** — defer to a follow-up change. Out of scope here.

## Decision 3 — Cleanup writes one backup per call, atomically

`POST /api/packages/cleanup` performs:

1. Read current `settings.json`.
2. Validate every `drop[]` entry exists in `packages[]` (404 if any unknown — fail closed, no partial work).
3. Write `~/.pi/agent/settings.json.<ISO-ts>.bak` (full content, not just the diff).
4. Compute `next.packages = current.packages.filter(p => !dropSet.has(p))`.
5. Atomic write (`tmp + fsync + rename`) — same primitive as `meta-persistence.ts`.
6. Return `{ before, after, dropped, backupPath }`.

No per-entry remove calls (so the user sees one log line, one backup, one consistent post-state). No automatic backup pruning — the user can `rm ~/.pi/agent/settings.json.*.bak` whenever they want.

### Considered alternatives

- **Sequential `/api/packages/remove` calls** — rejected; produces N backups (or zero if `packageManagerWrapper.remove` doesn't write them), N log lines, and a window where the array is half-cleaned.
- **No backup** — rejected; cheap insurance for an irreversible mutation.

## Decision 4 — Boot-time scan log line format

Single line at INFO level, after `reconcilePluginBridgePackages` finishes:

```
[package-health] 13 entries: 6 ok, 4 stale-npm, 2 missing-path, 1 duplicate-group (pi-dashboard-extension ×2)
```

Format chosen to be greppable (`grep package-health ~/.pi/dashboard/server.log`) and to surface the most actionable detail (which package is duplicated, and how many copies). If there are no issues, the line is suppressed to avoid noise.

## Decision 5 — Where does the UI live

Inside `UnifiedPackagesSection.tsx`, above the existing installed-packages list, behind an `Issues (N)` collapsed banner. Rationale:

- Users already think of `packages[]` as "the Packages tab in Settings."
- A separate top-level "Health" tab would split mental model and require routing changes.
- A modal-on-open is annoying for users with chronic-but-tolerated duplicates.

The banner is collapsed by default when N=0 (hidden entirely) and auto-expanded when N>0 on first visit. User collapsing it is sticky for that browser session.

### Considered alternatives

- **Toast notification on dashboard load** — rejected; noisy for users with persistent issues they've chosen to ignore.
- **Dedicated `/settings/packages/health` route** — rejected; adds routing complexity for one panel.

## Risks

- **False-positive duplicates** — two packages that legitimately publish under the same npm name (rare but possible with scoped + unscoped mirrors). Mitigated by always showing version + path + mtime + source-kind in the UI; user makes the call.
- **Concurrent writes** — `packageManagerWrapper` and the bridge bootstrap both mutate `settings.json`. The cleanup endpoint must serialize through the same file-lock mechanism the wrapper uses. Need to confirm at implementation time that the wrapper exposes a lock or that we route the write through it.
- **`package.json` parse cost on boot** — the boot-time scan calls `enrichInstalled` over every entry. With ~15 entries this is microseconds; with hundreds it's still <100ms. Acceptable.

## Open questions

1. Should `POST /api/packages/cleanup` trigger a `server_restarting` broadcast + soft-restart, the way the existing package install/remove flow recommends? Probably yes for consistency, but the existing remove route does not auto-restart either. **Tentative answer:** match existing `/api/packages/remove` behavior — surface a "restart required" banner client-side, don't auto-restart.
2. Should the boot-time scan also examine `dashboardPluginBridges` (the legacy parallel-write key from `plugin-bridge-register.ts`)? **Tentative answer:** no — that key is already reconciled by `reconcilePluginBridgePackages`. Health scan focuses solely on `packages[]`.
