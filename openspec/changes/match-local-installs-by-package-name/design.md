## Context

`GET /api/packages/recommended` (`recommended-routes.ts` → `enrichEntry`) decides each recommended entry's `installed.scope` / `activeInPi` with the pure `sourcesMatch(a, b)` string predicate. For local monorepo installs the settings source is a filesystem path whose basename is decorated differently from the published npm name (`image-fit-extension` vs `pi-image-fit-extension`), so `sourcesMatch`'s npm↔raw basename rule fails on 7/7 local recommended packages.

Traced facts (verified against `recommended-routes.ts`):
- `enrichEntry` decides state at **three** sites, all using only `sourcesMatch`: `inGlobal`/`inLocal` (over installed rows carrying `installedPath`), the inner `installed.find(...)` that gates the `version`/`pi.skills` read, and **`activeInPi = activeSources.some((s) => sourcesMatch(s, entry.source))`**.
- `activeInPi` — NOT `installed.scope` — drives the client Active/Remove button (`RecommendedExtensions.tsx`) and the missing-required count (`MissingRequiredBanner.tsx`). Fixing only `inGlobal`/`inLocal` leaves the visible bug unfixed.
- `activeSources` are bare settings `packages[]` strings (no `installedPath`); for a local install the string IS the checkout path, so `package.json` `name` is readable from it directly.
- The installed `package.json` read is gated behind `if (installedScope)`; for the 7/7 unmatched entries `installedScope` is `null` today, so **no read happens today** — the fix adds a read, it is not free.
- `readPackageJsonName(installedPath)` and `matchRecommendedEntry(...)` already exist, exported and tested, in `packages/server/src/package/installed-package-enricher.ts`.
- Each local checkout's `package.json` `name` equals the manifest npm source exactly (7/7, npm-sourced entries).

## Goals / Non-Goals

**Goals**
- Correct display AND state (`activeInPi`) for locally-installed recommended packages — so the Active/Remove button and missing-required count fold in.
- Minimize IO: reuse the existing `readPackageJsonName` reader, memoize per path within a request. (NOT zero-IO — newly-matched entries read a file they skip today; see D2.)
- Keep `sourcesMatch` pure (no fs) so the Electron wizard enricher and plugin loader are unaffected.

**Non-Goals**
- Renaming monorepo directories to match npm names.
- Changing `package-source-matching` behavior or the `/api/packages/recommended` response shape.
- Fuzzy/substring name matching.
- Matching git-sourced recommended entries by name (they have no npm `name`).
- Fixing `installed.find(...)` first-match ambiguity for multiple same-name checkouts (pre-existing).

## Decisions

### D1 — fs-aware either-match at the enrichment layer, applied at ALL THREE sites

`sourcesMatch` is imported by the shared package (wizard bootstrap, plugin loader) and is contractually pure string logic. The local path is only known at the enrichment layer. So name resolution is added inside `enrichEntry` as an **either-match** at every site that currently uses only `sourcesMatch`:

1. `inGlobal`/`inLocal` — `sourcesMatch(row.source, entry.source) || npmNameMatchesPath(entry, row.installedPath)`.
2. the inner `installed.find(...)` gating the `version`/`pi.skills` read — same either-match predicate, else the read is skipped for the newly-matched entries and `updateAvailable`/`skillsRegistered` stay unset.
3. `activeInPi` — `activeSources.some((s) => sourcesMatch(s, entry.source) || npmNameMatchesPath(entry, s))`, where the active source string is treated as a candidate local path. This is the site that fixes the actual bug.

`npmNameMatchesPath(entry, candidatePath)`: only for npm-sourced entries (`parseSourceKey(entry.source).kind === "npm"` → `name`); reads `readPackageJsonName(candidatePath)` (existing exported reader) and compares exactly; fails closed (false) on non-npm entry, missing/unreadable path, invalid JSON, or non-string `name`, so behavior degrades to today's string match. Git-sourced entries have no npm `name` and are out of scope (Non-Goal).

### D2 — reuse the existing reader; memoize per path per request

Do NOT author a new parse helper: `readPackageJsonName(installedPath)` already exists (exported, tested, swallow-on-error) in `installed-package-enricher.ts`. Wrap it in a per-request `Map<string, string | undefined>` memo so N recommended entries × M installed rows do not re-read the same `package.json`. The existing `version`/`pi.skills` read stays as-is (separate concern); the memo only bounds the new name reads. Net IO is one read per distinct local path touched by a failed string match — not zero, but bounded and cached.

### D3 — wizard bootstrap enricher parity: DEFER, documented

The Electron first-launch wizard has its own bootstrap enricher that also uses `sourcesMatch`. It runs pre-install (nothing installed locally yet), so the local-name gap is not observable there in the common path. This change scopes the fix to the server route. If wizard parity is later required, extract `npmNameMatchesPath` into a shared fs-aware helper callable with an explicit path — kept OUT of `source-matching.ts` so that module stays fs-free (extracting into the pure module would pull `fs` into the shared package and break the very purity this design protects). Recorded as an open follow-up, not implemented here.

## Risks / Trade-offs

- **False positive**: two unrelated local packages with the same `package.json` name — impossible within one settings scope (npm names are unique) and no worse than today.
- **Multiple checkouts, same name** (e.g. a fork alongside upstream, or v1/v2 branches): `installed.find(...)` picks the first match, so `version`/`skills` may come from the wrong checkout. Pre-existing behavior of the `.find()`; not regressed by this change; documented, not fixed here.
- **Git-sourced local installs under decorated dir names**: not matched (npm-name-only resolution). Parallel gap, explicit Non-Goal.
- **Cache**: results cached 60s, busted on install/remove — a fresh local install shows correctly after the next cache miss, identical to current freshness.

## Migration / Rollback

Pure read-path change. No persisted state, no settings migration. Rollback = revert the `enrichEntry` diff; string matching resumes.
