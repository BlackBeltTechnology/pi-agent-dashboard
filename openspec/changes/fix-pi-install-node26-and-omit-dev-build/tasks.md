# Tasks — fix-pi-install-node26-and-omit-dev-build

## 1. git-install `--omit=dev` build fix

- [ ] 1.1 In `packages/client/package.json`, move `vite`, `@vitejs/plugin-react`, `@tailwindcss/vite`, `tailwindcss` from `devDependencies` → `dependencies` (same version ranges).
- [ ] 1.2 Add `tsx` (`^4.21.0`, matching root/server) to `packages/client/package.json` `dependencies`; leave the root `tsx` devDependency and the `packages/server` runtime `tsx` dependency untouched.
- [ ] 1.3 Refresh `package-lock.json` (`npm install`) and confirm no workspace version drift.
- [ ] 1.4 Add `scripts/verify-release-deps.mjs` RULES asserting `vite`, `@vitejs/plugin-react`, `@tailwindcss/vite`, `tailwindcss`, `tsx` live in `packages/client/package.json` `dependencies` (mirror the existing `tsx`/`openspec` rule shape + evidence pointing at this change).

## 2. Node 26 engines cap raise (`<26` → `<27`)

- [ ] 2.1 Root `package.json#engines.node`: `>=22.19.0 <26` → `>=22.19.0 <27`.
- [ ] 2.2 `packages/shared/src/node-version.ts`: change the engines-cap arithmetic in `isOutOfEnginesRange` (`major >= 26` → `major >= 27`); update the module doc comment, the cap-history note, and the `isUsableNodeVersion` accept-set comment (now accepts 26, rejects 27+). `isAffectedNode` is unchanged (Node 26 is outside the Fastify-affected range).

## 3. CI — validate Node 26

- [ ] 3.1 `.github/workflows/_smoke.yml` `standalone-install-smoke-linux` matrix: add `node:26-bookworm-slim` + `node:26-alpine` legs (`node-version: 26`), mirroring the existing 25 entries.
- [ ] 3.2 Update any `ci.yml` lockstep Node-major list the `server-startup-node-version-guard` spec references so the engines-range set reads `[22, 24, 25, 26]`.

## 4. Tests (folded from test-plan.md — automated rows)

- [ ] 4.1 (test-plan #E1) Extend `packages/shared/src/__tests__/node-version.test.ts`. Triple: input `"v26.0.0"`/`"v26.5.0"` · trigger `isOutOfEnginesRange(v)` + `isUsableNodeVersion(v)` · observable `isOutOfEnginesRange` false, `isUsableNodeVersion` true. See `packages/shared/src/__tests__/node-version.test.ts`.
- [ ] 4.2 (test-plan #E2) Extend `node-version.test.ts`. Triple: input `"v27.0.0"` · trigger `isOutOfEnginesRange(v)` · observable returns true, `isUsableNodeVersion("v27.0.0")` false. See `packages/shared/src/__tests__/node-version.test.ts`.
- [ ] 4.3 (test-plan #E3) Extend `node-version.test.ts`. Triple: input `"v22.19.0"`,`"v22.18.0"`,`"v24.2.0"` · trigger `isUsableNodeVersion(v)` · observable `true`/`false`/`false` (floor + Fastify range unchanged). See `packages/shared/src/__tests__/node-version.test.ts`.
- [ ] 4.4 (test-plan #E4) Extend `node-version.test.ts` (or the node-guard message test). Triple: input `buildEnginesRangeMessage("v27.0.0")` · trigger call builder · observable string contains `cannot start on Node v27.`, `Required: >=22.19.0 <27`, `nvm install`, `PATH="$HOME/.pi-dashboard/node/bin`, `brew install node`. See `packages/shared/src/__tests__/node-version.test.ts`.
- [ ] 4.5 (test-plan #E5) Extend `node-version.test.ts` static-scan case (or the existing single-source assertion). Triple: input repo source tree · trigger grep for engines-cap arithmetic · observable literal `major >= 27` appears only in `packages/shared/src/node-version.ts`; no stray `major >= 26` cap check. See `packages/shared/src/__tests__/node-version.test.ts`.
- [ ] 4.6 (test-plan #E6) New repo-lint `packages/shared/src/__tests__/client-build-deps-runtime.test.ts`. Triple: input `packages/client/package.json` · trigger inspect deps vs devDeps · observable `dependencies` ⊇ {`vite`,`@vitejs/plugin-react`,`@tailwindcss/vite`,`tailwindcss`,`tsx`} and `devDependencies` ∩ first four = ∅. See `packages/shared/src/__tests__/bundled-node-meets-pi-floor.test.ts` (repo-lint-over-package.json exemplar).
- [ ] 4.7 (test-plan #E7) Assert the `verify-release-deps` guard fires. Triple: input `packages/client/package.json` with a build dep reverted to `devDependencies` · trigger run `scripts/verify-release-deps.mjs` · observable non-zero exit naming the missing client `dependencies` entry. See `packages/shared/src/__tests__/bundled-node-meets-pi-floor.test.ts`.
- [ ] 4.8 (test-plan #E8) New/extended repo-lint over the smoke workflow. Triple: input `.github/workflows/_smoke.yml` (+ `ci.yml` list) · trigger parse the Node matrix · observable matrix majors == `{22,24,25,26}` (includes 26). See `packages/shared/src/__tests__/publish-workflow-contract.test.ts` (workflow-YAML repo-lint exemplar).
- [ ] 4.9 (test-plan #X1) New qa install-smoke `qa/tests/02-omit-dev-build.sh`. Triple: input clean checkout, no `node_modules`/`packages/client/dist` · trigger `npm install --omit=dev --engine-strict=false` at repo root · observable exit `0` and `packages/client/dist/index.html` exists. See `qa/tests/01-install.sh`.
- [ ] 4.10 (test-plan #X2) Node 26 install-smoke leg (folds with task 3.1). Triple: input standalone install on Node 26 runner · trigger `_smoke.yml` linux leg `node-version: 26` · observable install-smoke job passes on Node 26. See `.github/workflows/_smoke.yml` `standalone-install-smoke-linux`.

## 5. Manual verification (folded from test-plan.md — manual-only)

- [ ] 5.1 (test-plan: manual-only) M1: on a fresh machine with Node 26 and pi installed, run `pi install git:github.com/BlackBeltTechnology/pi-agent-dashboard` and confirm it completes with no `EBADENGINE` and no `Cannot find module 'vite/package.json'`, and the dashboard loads. Deferred to post-merge per `ship-change`.

## 6. Close-out

- [ ] 6.1 Run `npm test 2>&1 | tee /tmp/pi-test.log` and confirm the folded L1 tests pass.
- [ ] 6.2 Update `CHANGELOG.md` `## [Unreleased]` (Fixed): Node 26 support (cap → `<27`) + git-install `--omit=dev` client build fix, referencing issue #357.
- [ ] 6.3 Comment on #357 and close once the change lands (Node 26 leg green + qa omit-dev build passing).
