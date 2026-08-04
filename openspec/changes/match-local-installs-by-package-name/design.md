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

### D2 — ONE memoized `package.json` parse per path per request

The route must not gain a second on-disk reader alongside the `version`/`pi.skills` read it already performs. `createPkgReader()` returns a memoized `dir → parsed package.json | undefined` function (swallow-on-error) held for one request; **both** the name match and the existing `version`/`pi.skills` read go through it. Consequences:

- A given directory is read + parsed **at most once per request**, however many recommended entries probe it (N entries × M rows collapse to one read per distinct path).
- The route ends up with exactly **one** package.json reader, not two — satisfying the DRY concern that motivated reusing an existing reader, while also removing the duplicate read the previous framing would have introduced.
- `readPackageJsonName` in `installed-package-enricher.ts` is left untouched and still serves its own callers; it is not called here because this site needs `name` + `version` + `pi.skills` from a single parse, not just the name.

Net IO is still not zero: an entry that fails the string match but resolves a local path incurs one read it would not perform today (today's read is gated behind an already-matched scope). The added reads are bounded by the number of distinct local paths touched.

### D3 — wizard bootstrap enricher parity: DEFER, documented

The Electron first-launch wizard has its own bootstrap enricher that also uses `sourcesMatch`. It runs pre-install (nothing installed locally yet), so the local-name gap is not observable there in the common path. This change scopes the fix to the server route. If wizard parity is later required, extract `npmNameMatchesPath` into a shared fs-aware helper callable with an explicit path — kept OUT of `source-matching.ts` so that module stays fs-free (extracting into the pure module would pull `fs` into the shared package and break the very purity this design protects). Recorded as an open follow-up, not implemented here.

## Risks / Trade-offs

- **False positive**: two unrelated local packages with the same `package.json` name — impossible within one settings scope (npm names are unique) and no worse than today.
- **Multiple checkouts, same name** (e.g. a fork alongside upstream, or v1/v2 branches): `installed.find(...)` picks the first match, so `version`/`skills` may come from the wrong checkout. Pre-existing behavior of the `.find()`; not regressed by this change; documented, not fixed here.
- **Git-sourced local installs under decorated dir names**: not matched (npm-name-only resolution). Parallel gap, explicit Non-Goal.
- **Cache**: results cached 60s, busted on install/remove — a fresh local install shows correctly after the next cache miss, identical to current freshness.

## Migration / Rollback

Pure read-path change. No persisted state, no settings migration. Rollback = revert the `enrichEntry` diff; string matching resumes.
