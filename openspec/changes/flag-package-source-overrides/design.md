## Context

The unified packages section (`UnifiedPackagesSection` / `InstalledPackagesList` → `PackageRow`) already renders, for every installed package:
- `displayName` (npm-manifest name when `isRecommended`, else basename of `source`),
- a source-type badge from `classifySource(source)` ∈ `{npm, git, local, global}`,
- the raw `source` caption,
- a version pill + optional `current → latest` + `[Update]` button.

The linkage "this local/git checkout IS the recommended npm package X" is already computed server-side by `matchRecommendedEntry()` → `sourcesMatch()` (`package-source-matching` capability), surfaced as `InstalledPackage.isRecommended`.

## Goals / Non-Goals

**Goals**
- Make "declared npm, installed from local/git" visible in words, not just an inferred badge+path pairing.
- Correct the `git:`-prefix badge so a git-prefixed override reads as `git`, not `global`.
- Zero new server/API surface — derive everything from existing fields.

**Non-Goals**
- **Not gating / disabling the Update button.** The originally proposed clobber danger does not exist (see Doubt review below); Update-affordance behavior is unchanged for every row.
- Not changing install/update *mechanics* (pi's PackageManager owns those).
- Not auto-migrating a local install to npm, nor offering a "convert to npm" action.

## Key decision: derive the override, don't persist it

`isOverride` is a pure function of two fields already on `InstalledPackage`:

```
isSourceOverride(pkg) =
  pkg.isRecommended === true  &&  classifySource(pkg.source) !== "npm"
```

- `isRecommended` → the row has a canonical npm identity (matched a `RECOMMENDED_EXTENSIONS` npm source via `sourcesMatch`).
- `classifySource(source) !== "npm"` → but the actual install is not an npm spec (a `global`-**scope** install of a recommended npm package still has `source = "npm:<name>"`, so it classifies `"npm"` and is NOT an override — scope-global ≠ the classifier bucket `"global"`).

Consequences:
- No REST/WS change, no migration, no server test surface. Two pure helpers, unit-tested.
- Single source of truth in `package-classifier.ts`, consumed by the list components.
- Detection reads `pkg.isRecommended` which is **optional** on the wire `InstalledPackage`; `=== true` makes an un-enriched row default to non-override. All current list paths run `enrichInstalledRows` (sets it); a future un-enriched path would silently not-flag — documented dependency, not a blocker.

Rejected alternative: add `isOverride`/`sourceKind` to the server `InstalledPackage` payload. More code, a new field to keep in sync, and no consumer needs it server-side. Deferred unless a server consumer appears.

## Classifier fix: `git:` prefix → `git`

`classifySource` and `parseSourceKey` disagree on one source form: a `git:<host>/<owner>/<repo>` string **without a `.git` suffix** is bucketed `"global"` by `classifySource` (its regex catches `git@` / `ssh://` / `http(s)` / a trailing `.git`, but not the bare `git:` prefix) while `parseSourceKey`/`sourcesMatch` parse it as `kind:"git"`. So such an install is simultaneously `isRecommended === true` AND `classifySource === "global"`.

Note the scope is narrow: a `git:host/o/r.git` source already classifies `"git"` (the `.git`-suffix disjunct). Only the suffix-less form (e.g. `git:github.com/o/r#main`) falls through. Fix: add a `git:` prefix check so the badge is correct. Detection (`isSourceOverride`) does not depend on this — `"global" !== "npm"` is already true — so the fix is purely for a correct `git` badge, not for the override predicate.

## Rendering rules

`isSourceOverride` drives one thing: whether the `override` pill renders. The Update control, version hint, and every other affordance are untouched.

| isRecommended | classifySource(source) | isSourceOverride | badges | Update |
|---|---|---|---|---|
| true | `npm` | **false** | `npm` | unchanged |
| true | `git` / `local` | **true** | badge + **`override`** pill | unchanged |
| false | `git` / `local` / any | **false** | badge (no override pill) | unchanged |

Notes:
- After the `git:`-prefix fix, a git-prefixed install badges `git` (not `global`); being `isRecommended`, it also gets the `override` pill. Consistent badge + remark.
- Non-recommended git/local rows are **out of scope** — no npm identity to override; `isSourceOverride` is false, no pill.
- `PackageBrowser.tsx` also renders installed rows, but only non-recommended ones (`installedNonRecommended`) — never overrides. Passing `isOverride` there is optional and a no-op; left unchanged.

### The `override` pill
- Reuses the existing 10px badge language in `PackageRow`. Text: `override`. Style: amber-ish to read as "heads up" without being an error (distinct from the amber `bundled` — use a subtle outline; final token chosen during implementation against the theme system).
- Tooltip / `aria-label`: "Declared as npm:`<name>` but installed from a `<local|git>` source."
- **A dedicated pill, NOT the `isDev` marker.** `PackageRow`'s existing `isDev` prop renders the literal word `dev` (`PackageRow.tsx:163`) and is currently unused by any caller; reusing it for overrides would print a misleading `dev` label. The override remark is the pill alone.

### Prop plumbing
`isOverride` is a NEW prop on `PackageRowProps`. `UnifiedPackagesSection` renders installed rows through `WhatsNewPackageRow`, which spreads `rowProps` into `<PackageRow>` — the prop must be added to the `rowProps` object AND forwarded by `WhatsNewPackageRow`. `InstalledPackagesList` renders `PackageRow` directly.

## Doubt review (2026-07-04) — why the update-gating half was dropped

A fresh-context adversarial review, cross-checked against pi's `package-manager.js`, found the originally proposed **update-gating defends a bug that cannot occur today**. Findings, grounded in source:

- **`update()` routes by the row's own source, never npm.** `onUpdate: () => operations.update(pkg.source)` → pi `update(source)` (`package-manager.js:769`) matches by `getPackageIdentity(source)` and updates the *configured source string* — local stays local, git stays git. No npm-over-checkout path exists.
- **Local override → button never renders.** `checkForAvailableUpdates()` (`:882`) does `if (parsed.type === "local" || parsed.pinned) return undefined` → `updateAvailable` always false → PackageRow's `updateAvailable && canUpdate && onUpdate` guard (`PackageRow.tsx:211`) draws nothing. And `installParsedSource` (`:1017`) has no `local` branch → `update()` on a local source is a no-op.
- **Git override → button can render, but `update()` does `installGit` (git fetch/pull)** — not an npm clobber.
- **Inert edit site.** `InstalledPackagesList` is used only in `PiResourcesView`, not Settings; its `updateAvailable` comes from `pkg.updateAvailable`, which the server enricher never sets → always false. (The override *pill* still renders there and is worth showing; only the dropped gating would have been inert.)
- **Miscounted sites.** Four `canUpdate={true}` sites exist (`PackageBrowser.tsx:195`, `UnifiedPackagesSection.tsx:302` + `:396`, `InstalledPackagesList.tsx:212`) — moot now that no gating is applied.
- **`isDev` renders the literal word `dev`** — folded into the pill decision above.
- **Predicate fragility (latent).** `isSourceOverride` would misfire if a future `RECOMMENDED_EXTENSIONS` entry declared a git/local source (all 18 are `npm:` today). Recorded, not guarded here.

**Outcome:** update-gating (former problem #2, former tasks §2.3 + §3 gating) dropped. This change is the verbal `override` remark + the `git:` badge fix only.

## Risks
- **`sourcesMatch` basename false-positive:** a recommended package "matched" to an unrelated local path whose basename collides is the accepted `sourcesMatch` tradeoff; the override remark inherits it. Blast radius is now just a label — harmless.
- **Enrichment dependency:** override detection needs `isRecommended` set by the server enricher. Un-enriched rows default to non-override (no pill). Acceptable today (all list paths enrich); flagged so a future un-enriched path does not silently drop the remark.
- **Predicate fragility (latent):** see Doubt review — safe against all current recommended entries; revisit if a git/local recommended entry is added.
