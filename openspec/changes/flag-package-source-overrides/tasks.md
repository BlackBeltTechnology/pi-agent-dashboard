# Tasks

## 1. Classifier fix + shared helper (detection)
- [ ] 1.1 Fix `classifySource` in `packages/client/src/lib/package-classifier.ts` to bucket a `git:<host>/<owner>/<repo>` source as `"git"` (currently falls through to `"global"`), aligning it with `parseSourceKey`. Add the `git:` prefix check alongside the existing `git@` / `ssh://` / `http(s)` / `.git` checks.
- [ ] 1.2 Add `isSourceOverride(pkg: InstalledPackage): boolean` to the same file — `pkg.isRecommended === true && classifySource(pkg.source) !== "npm"`. Pure, no I/O.
- [ ] 1.3 Unit tests in `packages/client/src/lib/__tests__/package-classifier.test.ts`:
  - `classifySource("git:github.com/o/r") === "git"` (regression guard for the divergence).
  - `isSourceOverride`: recommended+local → true; recommended+`git@`/`git:`-prefix → true; recommended+`npm:` → false; non-recommended+local → false; `isRecommended` undefined → false.

## 2. PackageRow rendering
- [ ] 2.1 Add an `isOverride?: boolean` prop to `PackageRow`; when true render a compact `override` pill next to the source-type badge with tooltip/`aria-label` "Declared as npm:<name> but installed from a <local|git> source".
- [ ] 2.2 Feed the existing `isDev` marker from `isOverride` at the call sites (no new marker element).
- [ ] 2.3 When `canUpdate === false` due to override, render the Update control **disabled and visible** (not omitted — today PackageRow omits it, leaving no tooltip anchor); attach the disabled-update tooltip text (see design.md); render the `current → latest` version hint muted (no accent).
- [ ] 2.4 Component tests in `packages/client/src/components/__tests__/`: override row shows `override` pill + `dev` marker; override row has NO enabled Update button; override row shows muted `current → latest` when `updateAvailable`.

## 3. Wire call sites (update gating)
- [ ] 3.1 `UnifiedPackagesSection.tsx` — replace hardcoded `canUpdate={true}` with `canUpdate={!isSourceOverride(pkg)}` (gate off the boolean, NOT a `classifySource`-bucket rule — they diverge on `git:`-prefix); pass `isOverride={isSourceOverride(pkg)}`.
- [ ] 3.2 `InstalledPackagesList.tsx` — same treatment.
- [ ] 3.3 Confirm no behavior change for non-recommended git/local rows (`isSourceOverride` false → `canUpdate` stays true). No Recommended/Other "Update All" affordance exists today (only Core, which override rows cannot enter), so no count to adjust — add a code comment so a future Update-All excludes overrides.

## 4. Docs
- [ ] 4.1 Update `packages/client/src/lib/AGENTS.md` row for `package-classifier.ts` (add `isSourceOverride`).
- [ ] 4.2 Update `packages/client/src/components/AGENTS.md` rows for `PackageRow.tsx` / `UnifiedPackagesSection.tsx` (override pill + update gating). `See change: flag-package-source-overrides`.

## 5. Verification
- [ ] 5.1 `npm test` green (new unit + component tests pass).
- [ ] 5.2 `npm run quality:changed` clean.
- [ ] 5.3 Manual/isolated-UI check: a recommended extension installed from a local checkout shows `override` + `dev`, a disabled Update, and a muted version FYI.
