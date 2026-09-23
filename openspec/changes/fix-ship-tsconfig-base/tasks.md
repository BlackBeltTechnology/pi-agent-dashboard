## 1. Tests first (red)

- [x] 1.1 In `scripts/__tests__/verify-published-imports.test.mjs`, add unit tests for `tsconfigExtendsFindings` covering: dangling, shipped, array (per-entry), extension-less, package-name (ignored), JSONC (comments plus trailing commas), and unparseable (warning).
- [x] 1.2 Add unit tests for `packEntryFiles` covering the array, single-object, and keyed-object forms, plus the no-files case (null).
- [x] 1.3 Add unit tests for `rootPackage`: non-private root → `rel: "."`, private root → null.
- [x] 1.4 Run the tests and confirm they fail.

## 2. Implementation

- [x] 2.1 `verify-published-imports.mjs`: add `packEntryFiles`. `packWorkspace` uses it, and a missing files list → error (`pack-failed`).
- [x] 2.2 `verify-published-imports.mjs`: add `tsconfigExtendsFindings`, wire it into `analyzeWorkspace` (packages/*), and parse through `ts.parseConfigFileTextToJson`.
- [x] 2.3 `verify-published-imports.mjs`: add `rootPackage`. `analyzeRepository` packs the root and applies only `tsconfigExtendsFindings`.
- [x] 2.4 Run `node scripts/verify-published-imports.mjs` on the unfixed tree and confirm it reports `dangling-tsconfig-extends` for the three root-shipped package tsconfigs.
- [x] 2.5 Add `tsconfig.base.json` to the root `package.json` `files`. Re-run the check and the tests until both are green.

## 3. Verify the real artifact

- [x] 3.1 Run `npm pack` on the root and extract the tarball into a temp directory. Confirm `tsconfig.base.json` is present and that the tsconfig `extends` chain of `packages/server/tsconfig.json` resolves (`ts.getParsedCommandLineOfConfigFile` reports no errors).

## 4. Closeout

- [x] 4.1 `CHANGELOG.md` `## [Unreleased]` → Fixed: "Published package now ships `tsconfig.base.json`; `pi-dashboard start/restart` crashed on 0.8.0 installs." Also note the extended publish check.
- [x] 4.2 Update the `verify-published-imports.mjs` row, its sidecar in `scripts/`, and the test sidecar. Add `See change: fix-ship-tsconfig-base`.
- [x] 4.3 Run `review-code` on the diff.
- [ ] 4.4 Follow-up (not in this change): full import-correctness for the root meta-package. Track it as a new OpenSpec change.
- [ ] 4.5 After merge, cut 0.8.1 through the `release-cut` skill. That release is outside this change's gate.
