## 0. Preconditions

- [ ] 0.1 Confirm that `fix-ship-tsconfig-base` (PR #726) is merged into `develop`, then merge `origin/develop`. `rootPackage`, `tsconfigOnly`, `packEntryFiles(parsed, name)` and `tsconfigExtendsFindings` must be present in `scripts/verify-published-imports.mjs`.

## 1. L1 tests first (red): `scripts/__tests__/verify-published-imports.test.mjs`

Exemplar for all of section 1: the `mkdtemp` `fixture()` helper and the "root package discovery" block already in `scripts/__tests__/verify-published-imports.test.mjs`. Root fixtures need a root `package.json` plus `packages/<dir>/package.json` files, and are driven through `analyzeRepository(fixtureRoot, { allowlist: [] })`.

- [ ] 1.1 Direct workspace credit (test-plan #E1). Root depends on `@f/server`, which declares `fastify`. Packed `packages/server/src/x.ts` imports `fastify`. Run `analyzeRepository`. Expect no finding for `fastify`.
- [ ] 1.2 Transitive credit (test-plan #E2). Server depends on `@f/shared`, which declares `bonjour-service`; the root does not list `@f/shared`. Packed `packages/shared/src/y.ts` imports it. Run `analyzeRepository`. Expect no finding.
- [ ] 1.3 Unreachable workspace gets no credit (test-plan #E3). Packed `packages/other/src/z.ts` imports `left-pad`, which `@f/other` declares, but nothing reaches `@f/other`. Run `analyzeRepository`. Expect exactly one `undeclared-import` for `left-pad` at that file.
- [ ] 1.4 Dev-only in the owning workspace (test-plan #E4). `@f/server` declares `vitest` in `devDependencies` only. Packed `packages/server/src/x.ts` imports `vitest`. Run `analyzeRepository`. Expect one `dev-only-import` for `vitest`.
- [ ] 1.5 A root devDependency does not shadow a credit (test-plan #E5). The root has `devDependencies.fastify`, and the reachable server has `dependencies.fastify`. The root copy imports `fastify`. Run `analyzeRepository`. Expect no finding.
- [ ] 1.6 No credit outside `packages/` (test-plan #E6). Packed `scripts/a.cjs` does `require("fastify")`, and only a workspace declares it. Run `analyzeRepository`. Expect one `undeclared-import` at `scripts/a.cjs`.
- [ ] 1.7 No credit for bundle output (test-plan #E7). Packed `packages/dist/client/assets/a.js` imports `left-pad`, and there is no `packages/dist/package.json`. Run `analyzeRepository`. Expect one `undeclared-import` at that file.
- [ ] 1.8 A dependency cycle terminates (test-plan #E8). The root depends on `@f/a`, `@f/a` depends on `@f/b`, and `@f/b` depends on `@f/a`. Packed `packages/b/src/q.ts` imports a package that `@f/b` declares. Run `analyzeRepository` within the 5 s test timeout. Expect it to return with no finding.
- [ ] 1.9 The exception applies to the root only (test-plan #E9). Non-root `packages/w` depends on `@f/v`, and `src/i.ts` imports a package that only `@f/v` declares. Run `analyzeWorkspace`. Expect one `undeclared-import`.
- [ ] 1.10 Directory boundary (test-plan #E10). A reachable `packages/server` declares `fastify`. The unreachable `packages/server-extra/src/e.ts` imports `fastify`. Run `analyzeRepository`. Expect one `undeclared-import`.
- [ ] 1.11 The root gets the full rule set (test-plan #E11). Replace #726's "applies ONLY the tsconfig rule" test; the spec reverses that contract, so this is a replacement, not a weakening. A public root with `files` `index.js` and `tsconfig.json`: `index.js` imports `left-pad`, and the tsconfig extends `./missing.json`. Run `analyzeRepository`. Expect rules `["dangling-tsconfig-extends", "undeclared-import"]`.
- [ ] 1.12 A private root is skipped (test-plan #E12). A root with `private: true` and an undeclared import. Run `analyzeRepository`. Expect no `rel "."` entry in `workspaces` and no root finding.
- [ ] 1.13 Credit count summary (test-plan #E13). Use the E1+E2 fixture, which has 2 credited imports. Run the summary formatter. Expect it to contain `2 root import(s) credited via reachable workspace`.
- [ ] 1.14 Negation order in the real root `files` (test-plan #E16). Read the root `package.json` `files`. Expect every `!` entry's index to be greater than every non-negated entry's index.
- [ ] 1.15 Over-exclusion is caught (test-plan #X1). Packed `packages/server/src/a.ts` imports `./__tests__/helper.js`, which is not packed. Run `analyzeRepository`. Expect one `dangling-relative-import` for `./__tests__/helper.js`.
- [ ] 1.16 A malformed workspace manifest does not break reachability (test-plan #X2). `packages/broken/package.json` is `{ not json`, and the root depends on a valid `@f/server`. Run `analyzeRepository`. Expect no throw, and the E1 import still credited.
- [ ] 1.17 Run the file and confirm that every section-1 test except 1.12, 1.14 and 1.15 fails. Those three may already pass through existing behaviour, or once the `files` change lands. Record which ones pass.

## 2. Implementation

- [ ] 2.1 `scripts/verify-published-imports.mjs`: add `reachableWorkspaces(root, rootManifest)`. It is the closure over `RUNTIME_FIELDS` of names that resolve to a `packages/*` workspace. It is cycle-safe and skips unparseable manifests.
- [ ] 2.2 `analyzeWorkspace` gains an optional credit hook used only for the root. For a packed `packages/<dir>/…` file whose `packages/<dir>/package.json` `name` is reachable, `declared` becomes root runtime ∪ owner runtime, and `devOnly` becomes (root dev ∪ owner dev) − `declared`. Count credited imports. The comment must name the hoisting reliance.
- [ ] 2.3 Remove `tsconfigOnly`. `analyzeRepository` runs the full analysis plus `verifyDeclaredRanges` on the root. Rewrite the stale "~250 findings, follow-up" `rootPackage` docstring.
- [ ] 2.4 Add the summary line `N root import(s) credited via reachable workspace` to `main`, through a small exported formatter.
- [ ] 2.5 In the root `package.json` `files`, append after every include: `!packages/**/__tests__`, `!packages/**/__fixtures__`, `!packages/**/__mocks__`, `!packages/**/*.test.*`, `!packages/**/*.spec.*`, `!packages/**/AGENTS.md`, `!packages/**/*.AGENTS.md`.
- [ ] 2.6 Get section 1 green. Then run `node scripts/verify-published-imports.mjs` on the unbuilt tree and expect exit 0 with the root in the checked set (test-plan #E17). Triage anything left: fix it, or allowlist it with `workspace: "."` and a reason.

## 3. ci-level scenarios

- [ ] 3.1 Root pack exclusions (test-plan #E14). Exemplar: `scripts/__tests__/kb-packaging.test.mjs` (`RUN_CI_SCENARIOS`, `npm pack --dry-run --json`). Run the pack at the real root. Expect 0 packed paths under `packages/` that contain `__tests__/`, `__fixtures__/` or `__mocks__/`, or match `.test.`, `.spec.`, `/AGENTS.md` or `.AGENTS.md`. Add it as a new `scripts/__tests__/root-packaging.test.mjs`.
- [ ] 3.2 Root keeps its intended files (test-plan #E15). Exemplar: same as 3.1, in the same file. Run the same pack. Expect the packed set to contain `AGENTS.md` and `tsconfig.base.json`.
- [ ] 3.3 Runtime budget with the full root analysis (test-plan #P1). Exemplar: the existing P1 block in `scripts/__tests__/dependency-declarations.test.mjs`. Run the full CLI under `npm run test:ci-scenarios`. Expect a wall-clock time under 120 s. Record the measured time in the PR.
- [ ] 3.4 Post-build CI run is wired (test-plan #X3). Exemplar: `packages/shared/src/__tests__/nightly-workflow-contract.test.ts`. Parse the `ci` job in `.github/workflows/ci.yml`. Expect a `node scripts/verify-published-imports.mjs` step after `Build (fail on regressed warnings)`. Then add that step to `ci.yml`.
- [ ] 3.5 The built tree passes (test-plan #X4). Exemplar: the 3.4 step. Locally, run `npm run build` then `node scripts/verify-published-imports.mjs`. Expect exit 0, and triage any `packages/dist/` finding before the PR. CI then confirms it on the PR through the 3.4 step.
- [ ] 3.6 The installed root boots without the excluded files (test-plan #X5). Exemplar: `scripts/test-standalone-npm-install.sh` (and its `.ps1` twin). Extend both: after install, `find <installed root>/packages` for `__tests__`, `*.test.*` and `*.AGENTS.md` must print nothing, and the existing 60 s `/api/health` `ok: true` probe must pass. Run the `.sh` locally once; `publish.yml` runs both through `_smoke.yml`.

## 4. Closeout

- [ ] 4.1 `CHANGELOG.md` `## [Unreleased]`, under Changed: the root tarball no longer ships tests, fixtures or DOX sidecars (about 1238 files, about 7.8 MB). The publish check now applies its full rules to the root, with reachable-workspace credit, and runs again after the build.
- [ ] 4.2 Update the `scripts/` DOX sidecars: `verify-published-imports.mjs.AGENTS.md`, the test sidecar, and a new row for `__tests__/root-packaging.test.mjs`. Add `See change: check-root-package-imports`.
- [ ] 4.3 Run `review-code` on the diff.

## Follow-ups (outside this change, not gated)

- Extract `require.resolve()` specifiers in the checker (`scripts/fix-pty-permissions.cjs` → `node-pty`, `scripts/maybe-patch-package.cjs` → `patch-package`).
- A structural alternative: the root bin delegates to the installed `@blackbelt-technology/pi-dashboard-server` and stops shipping duplicate sources.
