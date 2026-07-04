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
- Prevent the npm `[Update]` button from clobbering a local checkout / git working copy.
- Zero new server/API surface — derive everything from existing fields.

**Non-Goals**
- Not changing install/update *mechanics* (pi's PackageManager still owns those).
- Not auto-migrating a local install to npm, nor offering a "convert to npm" action.
- Not implementing git-pull / re-link *actions* from the row (the tooltip only explains the correct manual path). A future change may add those.

## Key decision: derive the override, don't persist it

`isOverride` is a pure function of two fields already on `InstalledPackage`:

```
isSourceOverride(pkg) =
  pkg.isRecommended === true  &&  classifySource(pkg.source) !== "npm"
```

- `isRecommended` → the row has a canonical npm identity (matched a `RECOMMENDED_EXTENSIONS` npm source via `sourcesMatch`).
- `classifySource(source) !== "npm"` → but the actual install is not an npm spec (a `global`-**scope** install of a recommended npm package still has `source = "npm:<name>"`, so it classifies `"npm"` and is NOT an override — scope-global ≠ the classifier bucket `"global"`).

**Prerequisite — fix a classifier divergence.** `classifySource` and `parseSourceKey` disagree on one source form: a `git:<host>/<owner>/<repo>` string is bucketed `"global"` by `classifySource` (its regex catches only `git@` / `ssh://` / `http(s)` / a `.git` suffix) but parsed as `kind:"git"` by `parseSourceKey`/`sourcesMatch`. So a `git:`-prefixed recommended install is simultaneously `isRecommended === true` AND `classifySource === "global"`. Two consequences, both fixed here:
1. **Gate off the boolean, never the bucket.** `canUpdate = !isSourceOverride(pkg)`. The `isSourceOverride` boolean flags the git-prefix case correctly (`isRecommended && "global" !== "npm"` → true); a bucket-keyed rule ("npm/global active") would wrongly leave Update enabled on that git checkout — the exact destructive case this change prevents.
2. **Align `classifySource` with `parseSourceKey`.** Teach `classifySource` to bucket the `git:` prefix as `"git"`, so the badge is correct too. One-line fix; removes the whole divergence class.

Consequences:
- No REST/WS change, no migration, no server test surface. Two pure helpers, unit-tested.
- Single source of truth in `package-classifier.ts`, consumed by both list components.
- Detection reads `pkg.isRecommended` which is **optional** on the wire `InstalledPackage`; `=== true` makes an un-enriched row default to non-override. All current list paths run `enrichInstalledRows` (sets it); a future un-enriched path would silently not-flag — documented dependency, not a blocker.

Rejected alternative: add `isOverride`/`sourceKind` to the server `InstalledPackage` payload. More code, a new field to keep in sync, and no consumer needs it server-side. Deferred unless a server consumer appears.

## Rendering rules

Gating keys off the `isSourceOverride` **boolean**, not the raw badge bucket:

| isRecommended | classifySource(source) | isSourceOverride | badges | Update | version hint |
|---|---|---|---|---|---|
| true | `npm` | **false** | `npm` | active | `x → y` + button |
| true | `git` / `local` | **true** | badge + **`override`** pill + `dev` marker | **disabled control** + tooltip | `x → y` muted FYI |
| false | `git` / `local` / any | **false** | badge (no override pill) | unchanged | unchanged |

Notes:
- After the `git:`-prefix fix, a git install badges `git` (not `global`) and, being `isRecommended`, is `isSourceOverride` → disabled. Consistent badge + gating.
- Non-recommended git/local rows are **out of scope** — no npm identity to override. This change does NOT alter them: replacing the hardcoded `canUpdate={true}` with `canUpdate={!isSourceOverride(pkg)}` is a no-op for them (`isSourceOverride` is false). It only gates the override case. (A future change may decide git/local rows should never offer an npm-style Update regardless of `isRecommended`; recorded, not done here.)
- **Disabled control, not omitted button.** `PackageRow` today *omits* the Update button when `!canUpdate`, leaving nothing to host the tooltip. The override case MUST render the control **disabled** (visible) so the tooltip has an anchor.

### The `override` pill
- Reuses the existing 10px badge language in `PackageRow`. Text: `override`. Style: amber-ish to read as "heads up" without being an error (distinct from the amber `bundled` — use a subtle outline; final token chosen during implementation against the theme system).
- Tooltip / `aria-label`: "Declared as npm:`<name>` but installed from a `<local|git>` source."

### The disabled Update tooltip
> "Installed from a local/git source — update with `git pull` / re-link, not npm. The npm Update is disabled here so it can't overwrite your checkout."

### Version hint (muted FYI)
When an override row has `updateAvailable` + `latestVersion`, keep the `current → latest` text but render it muted (no accent color, no button). It informs "npm has a newer version" without implying a safe one-click update.

## Open sub-decisions (settled defaults)
1. **Show version FYI on override rows** — YES, muted. (Alternative: hide entirely — rejected, loses signal.)
2. **Badge shape** — compact separate `override` pill (not merged `npm ⟶ local` text). Fits existing badge row; less horizontal churn.

## Risks
- **Classifier divergence (addressed).** The `git:`-prefix mismatch between `classifySource` and `parseSourceKey` is the one real hazard; fixed by gating off the boolean + aligning `classifySource`. Regression-guarded by a unit test asserting `classifySource("git:github.com/o/r") === "git"` and `isSourceOverride` true for that row.
- **`sourcesMatch` basename false-positive:** a recommended package “matched” to an unrelated local path whose basename collides is the accepted `sourcesMatch` tradeoff; the override remark inherits it. Low blast radius — a label + a *disabled* button; both harmless and reversible.
- **Enrichment dependency:** override detection needs `isRecommended` set by the server enricher. Un-enriched rows default to non-override (Update stays enabled). Acceptable today (all list paths enrich); flagged so a future un-enriched path does not silently regress the protection.
