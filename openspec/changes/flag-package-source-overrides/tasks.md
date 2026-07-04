# Tasks

## 1. Classifier fix + shared helper (detection)
- [x] 1.1 Fix `classifySource` in `packages/client/src/lib/package-classifier.ts` to bucket a `git:<host>/<owner>/<repo>` source as `"git"` (currently the suffix-less form falls through to `"global"`), aligning it with `parseSourceKey`. Add the `git:` prefix check alongside the existing `git@` / `ssh://` / `http(s)` / `.git` checks.
- [x] 1.2 Add `isSourceOverride(pkg: InstalledPackage): boolean` to the same file — `pkg.isRecommended === true && classifySource(pkg.source) !== "npm"`. Pure, no I/O.
- [x] 1.3 Unit tests in `packages/client/src/lib/__tests__/package-classifier.test.ts`:
  - `classifySource("git:github.com/o/r") === "git"` (regression guard for the divergence).
  - `isSourceOverride`: recommended+local → true; recommended+`git@`/`git:`-prefix → true; recommended+`npm:` → false; non-recommended+local → false; `isRecommended` undefined → false.

## 2. PackageRow rendering (verbal remark only)
- [x] 2.1 Add an `isOverride?: boolean` prop to `PackageRowProps`; when true render a compact `override` pill next to the source-type badge with tooltip/`aria-label` "Declared as npm:<name> but installed from a <local|git> source". Use a dedicated pill — do NOT reuse the `isDev` marker (it prints the literal word `dev`).
- [x] 2.2 Leave the Update control, `canUpdate`, and version hint untouched — this change adds no gating.
- [x] 2.3 Component tests in `packages/client/src/components/__tests__/`: override row shows the `override` pill with the expected `aria-label`; non-override row shows no pill; Update-button behavior is unchanged (still renders when `updateAvailable && canUpdate`).

## 3. Wire call sites (pass isOverride)
- [x] 3.1 `UnifiedPackagesSection.tsx` — add `isOverride: isSourceOverride(pkg)` to the installed-row `rowProps` object (~line 302). Ensure `WhatsNewPackageRow` forwards `isOverride` to the inner `<PackageRow>`. Do NOT touch `canUpdate`.
- [x] 3.2 `InstalledPackagesList.tsx` — pass `isOverride={isSourceOverride(pkg)}` on the row (~line 212). Do NOT touch `canUpdate`.
- [x] 3.3 `PackageBrowser.tsx` renders only non-recommended installed rows (`isSourceOverride` always false) — leave unchanged; add a one-line comment noting overrides can't appear there.

## 4. Docs
- [x] 4.1 Update `packages/client/src/lib/AGENTS.md` row for `package-classifier.ts` (add `isSourceOverride`; note `git:`-prefix classification fix).
- [x] 4.2 Update `packages/client/src/components/AGENTS.md` rows for `PackageRow.tsx` / `UnifiedPackagesSection.tsx` (override pill). `See change: flag-package-source-overrides`.

## 5. Verification
- [x] 5.1 `npm test` green (new unit + component tests pass).
- [x] 5.2 `npm run quality:changed` clean.
- [x] 5.3 Manual/isolated-UI check: a recommended extension installed from a local checkout shows the `override` pill with the correct `aria-label`; a git-prefixed override badges `git` (not `global`); Update affordances behave exactly as before.
