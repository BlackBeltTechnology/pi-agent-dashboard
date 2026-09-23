## 1. Tests first (red)

- [ ] 1.1 In `scripts/__tests__/verify-published-imports.test.mjs`, add unit tests for the tsconfig-extends resolver covering: string, array, extension-less, package-name (ignored), and JSONC (comments plus trailing commas).
- [ ] 1.2 Add a known-bad fixture: a package that ships a `tsconfig.json` whose `extends` target is not packed. Expect `dangling-tsconfig-extends` and a non-zero exit. Add the matching known-good fixture that passes. Neither fixture may leave repository artifacts.
- [ ] 1.3 Add a test that `listWorkspaces` includes a non-private root (`rel: "."`) and skips a private one.
- [ ] 1.4 Run the tests and confirm they fail.

## 2. Implementation

- [ ] 2.1 `verify-published-imports.mjs`: add the root package to `listWorkspaces` when it is not private.
- [ ] 2.2 `verify-published-imports.mjs`: add a tsconfig-extends pass over the packed `tsconfig*.json` files, with minimal JSONC stripping and a `.json` fallback. Emit `dangling-tsconfig-extends` as an error. An unparseable tsconfig produces a warn finding.
- [ ] 2.3 Run `node scripts/verify-published-imports.mjs` and confirm it now fails on the current tree with `dangling-tsconfig-extends` for the three root-shipped package tsconfigs. This proves the bug is caught.
- [ ] 2.4 Add `tsconfig.base.json` to the root `package.json` `files`.
- [ ] 2.5 Triage any other root-package findings the check now surfaces. Fix each one, or allowlist it with a reason.
- [ ] 2.6 Re-run the check and the tests until both are green.

## 3. Verify the real artifact

- [ ] 3.1 Run `npm pack` on the root and install the tarball into a temp prefix. Confirm `tsconfig.base.json` is present and that `pi-dashboard start` (or a jiti import of `packages/server/src`) no longer throws the `tsconfig.base.json not found` error.

## 4. Closeout

- [ ] 4.1 `CHANGELOG.md` `## [Unreleased]` → Fixed: "Published package now ships `tsconfig.base.json`; `pi-dashboard start/restart` crashed on 0.8.0 installs." Also note the extended publish check.
- [ ] 4.2 Update the `verify-published-imports.mjs` row in `scripts/AGENTS.md` (the root package is now included; new `dangling-tsconfig-extends` finding). Add `See change: fix-ship-tsconfig-base`.
- [ ] 4.3 Run `review-code` on the diff.
- [ ] 4.4 After merge, cut 0.8.1 through the `release-cut` skill. That release is outside this change's gate.
