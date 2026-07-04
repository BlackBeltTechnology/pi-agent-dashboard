## Why

Many recommended pi extensions are declared as npm packages (`RECOMMENDED_EXTENSIONS[].source = "npm:<name>"`) but are actually installed on a developer's machine from a **local checkout** (`/home/dev/pi-web-access`) or a **git URL**. The dashboard already resolves this linkage — `matchRecommendedEntry()` uses `sourcesMatch()` to tie a local/git install back to its canonical npm identity, so such a row renders with the npm `displayName` and a `local`/`git` source badge.

The problem: **no verbal remark.** The user must mentally connect "this is the recommended npm extension" (name) with "installed from a local/git source" (badge + path). Nothing states the override explicitly, so a dev-linked extension looks identical in intent to a normally-installed one.

Detection needs **no new server data**: the `source` string plus the already-computed `isRecommended` flag are sufficient. This change surfaces that fact.

> **Scope note (see `design.md` → Doubt review).** An earlier draft also proposed *gating* the npm Update button on override rows, on the belief that clicking it reinstalls from npm over the local/git checkout. Verified against pi's `package-manager.js`, that danger does not exist: `update(source)` routes by the row's own source (never npm), local sources are excluded from update checks (the button never renders) and are a no-op on update, and git sources do a git fetch/pull. The update-gating half was dropped; this change is now the verbal remark only.

## What Changes

- **Derived "source override" concept.** A row is an *override* when it has a canonical npm identity (`isRecommended === true`) but its actual installed `source` is NOT an npm spec (`classifySource(source) !== "npm"`) — i.e. "declared npm, installed from a local/git checkout". Purely derivable client-side; a shared helper `isSourceOverride(pkg)` in `package-classifier.ts` centralizes it.
- **`classifySource` git-prefix fix (badge correctness).** `classifySource` buckets a `git:<host>/<owner>/<repo>` source (no `.git` suffix) as `"global"` — its regex catches `git@` / `ssh://` / `http(s)` / a trailing `.git` but not the bare `git:` prefix — while `sourcesMatch`/`parseSourceKey` correctly treat `git:` as git. Left unfixed, a git-prefixed override renders a wrong `global` badge. `classifySource` SHALL recognize the `git:` prefix as `"git"`, aligning it with `parseSourceKey`. (Override *detection* already works without this — any non-npm classification is an override — so the fix is purely for a correct badge.)
- **Verbal remark.** Override rows render a compact **`override`** pill next to the source-type badge, with a tooltip / `aria-label` naming the declared npm identity and the actual source kind. A dedicated pill — NOT the pre-existing `isDev` marker, which renders the literal word `dev` and would mislead.

## Capabilities

### New Capabilities

(none — extends an existing capability only)

### Modified Capabilities

- `pi-core-version-ui`: the "Row identity and source caption" scenario gains source-override rendering; a new requirement + scenarios define the override remark and the `git:`-prefix badge fix. No change to Update-affordance behavior.

## Impact

**Code**:
- `packages/client/src/lib/package-classifier.ts` — add `isSourceOverride(pkg)` helper (pure); fix `classifySource` to bucket `git:`-prefixed sources as `"git"` (align with `parseSourceKey`).
- `packages/client/src/components/PackageRow.tsx` — add an `isOverride?: boolean` prop to `PackageRowProps`; when set, render an `override` pill next to the source-type badge. No change to the Update control.
- `packages/client/src/components/UnifiedPackagesSection.tsx` + `InstalledPackagesList.tsx` — pass `isOverride={isSourceOverride(pkg)}` on installed rows. `WhatsNewPackageRow` (the wrapper `UnifiedPackagesSection` renders installed rows through) forwards the prop. `canUpdate` is left as-is.

**APIs**: none. No REST or WS surface change — detection is client-derived from existing `InstalledPackage` fields (`source`, `isRecommended`). Detection depends on the server enricher setting `isRecommended` (optional on the wire type; `isSourceOverride` uses `=== true`, so an un-enriched row safely defaults to non-override). All current list paths (`enrichInstalledRows`) populate it.

**Docs**: `packages/client/src/lib/AGENTS.md` + `packages/client/src/components/AGENTS.md` rows updated for the new helper / pill.
