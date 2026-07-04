## Why

Many recommended pi extensions are declared as npm packages (`RECOMMENDED_EXTENSIONS[].source = "npm:<name>"`) but are actually installed on a developer's machine from a **local checkout** (`/home/dev/pi-web-access`) or a **git URL**. The dashboard already resolves this linkage — `matchRecommendedEntry()` uses `sourcesMatch()` to tie a local/git install back to its canonical npm identity, so such a row renders with the npm `displayName` and a `local`/`git` source badge.

Two problems remain:

1. **No verbal remark.** The user must mentally connect "this is the recommended npm extension" (name) with "installed from a local/git source" (badge + path). Nothing states the override explicitly, so a dev-linked extension looks identical in intent to a normally-installed one.
2. **Unsafe Update affordance.** `canUpdate` is hardcoded `true` for every row (`UnifiedPackagesSection.tsx:302`, `InstalledPackagesList.tsx:212`). An override row still shows an npm **[Update]** button that, if clicked, reinstalls the package from npm over a live local checkout / git working copy — clobbering the user's source.

Detection needs **no new server data**: the `source` string plus the already-computed `isRecommended` flag are sufficient. This change surfaces that fact and makes the Update affordance source-aware.

## What Changes

- **Derived "source override" concept.** A row is an *override* when it has a canonical npm identity (`isRecommended === true`) but its actual installed `source` is NOT an npm spec (`classifySource(source) !== "npm"`) — i.e. "declared npm, installed from a local/git checkout". Purely derivable client-side; a shared helper `isSourceOverride(pkg)` in `package-classifier.ts` centralizes it.
- **`classifySource` git-prefix fix (prerequisite).** `classifySource` currently buckets a `git:<host>/<owner>/<repo>` source as `"global"` — its regex only catches `git@` / `ssh://` / `http(s)` / a `.git` suffix — while `sourcesMatch`/`parseSourceKey` (which computes `isRecommended`) correctly treat `git:` as git. Left unfixed, a git-prefixed override would render a wrong `global` badge. `classifySource` SHALL recognize the `git:` prefix as `"git"`, aligning it with `parseSourceKey`.
- **Verbal remark (A + C).** Override rows render a compact **`override`** pill next to the source-type badge, and feed the existing `PackageRow.isDev` marker (`isDev = isOverride`). No new row component.
- **Update gating (B).** `canUpdate` is derived from the `isSourceOverride` **boolean** — NOT from the raw `classifySource` bucket (the two diverge on `git:`-prefix and would leave the destructive Update enabled). `isSourceOverride === true` → the **[Update] control renders disabled** (not omitted) hosting a tooltip explaining the package is installed from a local/git source and should be updated via `git pull` / re-link, not npm. Otherwise active. Non-recommended local/git rows are NOT overrides and keep their existing Update behavior unchanged.
- **Version hint as muted FYI.** When an override row has a newer npm version, the `current → latest` hint is retained but rendered muted/non-actionable (informative, not a trap) rather than paired with an active button.

## Capabilities

### New Capabilities

(none — extends an existing capability only)

### Modified Capabilities

- `pi-core-version-ui`: the "Row identity and source caption" and "Update available shown" scenarios gain source-override rendering + update-gating rules; a new requirement defines the override remark and the disabled-Update contract.

## Impact

**Code**:
- `packages/client/src/lib/package-classifier.ts` — add `isSourceOverride(pkg)` helper (pure); fix `classifySource` to bucket `git:`-prefixed sources as `"git"` (align with `parseSourceKey`).
- `packages/client/src/components/PackageRow.tsx` — render an `override` pill; wire the existing `isDev` marker semantics; render `canUpdate={false}` state with a tooltip + muted version hint.
- `packages/client/src/components/UnifiedPackagesSection.tsx` + `InstalledPackagesList.tsx` — stop hardcoding `canUpdate={true}`; derive `isDev`/`canUpdate` from `isSourceOverride` + `classifySource`.

**APIs**: none. No REST or WS surface change — detection is client-derived from existing `InstalledPackage` fields (`source`, `isRecommended`). Detection depends on the server enricher setting `isRecommended` (optional on the wire type; `isSourceOverride` uses `=== true`, so an un-enriched row safely defaults to non-override). All current list paths (`enrichInstalledRows`) populate it.

**Docs**: `packages/client/src/lib/AGENTS.md` + `packages/client/src/components/AGENTS.md` rows updated for the new helper / row behavior.
