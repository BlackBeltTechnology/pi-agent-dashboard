## Why

The Packages tab's "Recommended for this dashboard" panel shows locally-installed extensions as **not installed** (Install / Optional) instead of **Active / Remove**. The matcher that decides "installed" compares the manifest npm source against the `packages[]` entry using the local path **basename** vs the npm **unscoped name**. In this monorepo the checkout directory is named for its role (`image-fit-extension`, `mockup-loop`, `anti-slop`) while the published package carries product decorations (`pi-`, `pi-dashboard-`, `-frontend`), so 7/7 locally-installed recommended packages fail to match and misreport their state.

## What Changes

- Resolve a local install's identity by reading its on-disk `package.json` `name` (available via the `installedPath` already returned by `listConfiguredPackages()`), and match that against the recommended entry's parsed npm name.
- Apply the fs-aware match in the **server enrichment layer** (`enrichEntry` in `recommended-routes.ts`), which already opens `<installedPath>/package.json` for `version` + `pi.skills` — the `name` is read in the same parse, zero extra IO.
- Keep `sourcesMatch` in `packages/shared/src/source-matching.ts` **pure and unchanged** (string-only, no fs) so the Electron wizard bootstrap enricher and plugin loader keep working; the fs read is a layered addition, not a replacement.
- Once display is corrected, `Install all missing` and the missing-required counts fold in automatically (matched entries become `activeInPi: true`).

## Capabilities

### New Capabilities
- `local-install-name-resolution`: An fs-aware resolution step in the recommended-extensions enrichment that identifies a locally-installed package by its `package.json` `name` at `installedPath`, so decoration-mismatched checkout directories are matched exactly against a recommended entry's npm name.

### Modified Capabilities
- `installed-package-row-enrichment`: The recommended-extensions enrichment SHALL treat a local install as installed/active when its `installedPath` `package.json` `name` equals the entry's npm name, in addition to the existing string `sourcesMatch`.

## Discipline Skills

- `review-code`: non-trivial matcher change — review before commit.
- `systematic-debugging`: if the enrichment misclassifies an entry during implementation, root-cause before patching.

## Impact

- **Code**: `packages/server/src/routes/recommended-routes.ts` (`enrichEntry` `inGlobal`/`inLocal` + `activeInPi`). Possible parity mirror in the Electron wizard bootstrap enricher (scope decision in design).
- **APIs**: `GET /api/packages/recommended` response values change (correct `installed.scope` / `activeInPi`); shape unchanged.
- **No change** to `sourcesMatch` / `package-source-matching` spec (stays pure).
- **Migration/rollback**: pure read-path fix, no persisted state, no settings migration; revert restores prior behavior. Results are cached 60s and busted on install/remove — no cache-shape change.
