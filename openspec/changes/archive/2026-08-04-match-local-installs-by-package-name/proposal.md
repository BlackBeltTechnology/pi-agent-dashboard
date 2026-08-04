## Why

The Packages tab's "Recommended for this dashboard" panel shows locally-installed extensions as **not installed** (Install / Optional) instead of **Active / Remove**. The matcher that decides "installed" compares the manifest npm source against the `packages[]` entry using the local path **basename** vs the npm **unscoped name**. In this monorepo the checkout directory is named for its role (`image-fit-extension`, `mockup-loop`, `anti-slop`) while the published package carries product decorations (`pi-`, `pi-dashboard-`, `-frontend`), so 7/7 locally-installed recommended packages fail to match and misreport their state.

## What Changes

- Resolve a local install's identity by reading its on-disk `package.json` `name` and match that against the recommended entry's parsed npm name, via `npmNameMatchesPath(entrySource, candidatePath, readPkg)` (fail-closed).
- Apply the fs-aware either-match in the **server enrichment layer** (`enrichEntry` in `recommended-routes.ts`) at **all three** decision sites that currently use only `sourcesMatch`: (a) `inGlobal`/`inLocal` (over installed rows, which carry `installedPath`); (b) the inner `installed.find(...)` that gates the `version`/`pi.skills` read; and (c) **`activeInPi`** (over `activeSources` — the settings `packages[]` strings; for a local install the source string IS the checkout path, so read `package.json` `name` from it directly). Fixing only (a) leaves the actual bug unfixed: the Active/Remove button and the missing-required count both key off `activeInPi`, not `installed.scope`.
- Keep `sourcesMatch` in `packages/shared/src/source-matching.ts` **pure and unchanged** (string-only, no fs) so the Electron wizard bootstrap enricher and plugin loader keep working; the fs read is a layered addition, not a replacement.
- Back the name match with `createPkgReader()` — ONE memoized `package.json` parse per path per request, shared with the pre-existing `version`/`pi.skills` read, so each distinct path is read at most once and the route keeps exactly one reader (N recommended entries × M installed rows otherwise re-read the same file).
- Once `activeInPi` is corrected, `Install all missing` and the missing-required counts fold in automatically.

## Capabilities

### New Capabilities
- `local-install-name-resolution`: An fs-aware resolution step in the recommended-extensions enrichment that identifies a locally-installed package by its `package.json` `name` (read via the request-scoped `readPkg` from `createPkgReader()`) at a local path — either an installed row's `installedPath` or an `activeSources` checkout-path string — so decoration-mismatched checkout directories are matched exactly against a recommended entry's npm name. Applies to npm-sourced recommended entries only (git entries have no npm `name`).

### Modified Capabilities
- `installed-package-row-enrichment`: The recommended-extensions enrichment SHALL treat a local install as installed AND active when the `package.json` `name` at its local path equals the entry's npm name, in addition to the existing string `sourcesMatch`. The either-match SHALL be applied at every site that decides installed-scope OR `activeInPi` OR gates the installed `package.json` read.

## Discipline Skills

- `review-code`: non-trivial matcher change — review before commit.
- `systematic-debugging`: if the enrichment misclassifies an entry during implementation, root-cause before patching.

## Impact

- **Code**: `packages/server/src/routes/recommended-routes.ts` (`enrichEntry`: `inGlobal`/`inLocal`, inner `installed.find(...)`, and `activeInPi`; new exports `npmNameMatchesPath`, `createPkgReader`). Possible parity mirror in the Electron wizard bootstrap enricher (deferred — see design D3).
- **APIs**: `GET /api/packages/recommended` response values change (correct `installed.scope` / `activeInPi`); shape unchanged.
- **No change** to `sourcesMatch` / `package-source-matching` spec (stays pure).
- **IO**: NOT zero-IO. Entries that fail the string match but resolve a local path incur one `readPackageJsonName` read each (they read nothing today, since the current `package.json` read is gated behind a matched `installedScope`). Reads are memoized per path within a request; the delta is bounded and necessary to fix the bug.
- **Migration/rollback**: pure read-path fix, no persisted state, no settings migration; revert restores prior behavior. Results are cached 60s and busted on install/remove — no cache-shape change.
