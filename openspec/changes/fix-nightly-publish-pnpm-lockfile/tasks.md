## 1. Regression pins first (L1, static)

Exemplar for 1.1–1.4: the "spawns npm through npm.cmd + a shell on win32" case in `scripts/__tests__/nightly-verdaccio-publish.test.mjs:184` ("nightly infra contracts"). Use whitespace-tolerant regexes (design D3).

- [ ] 1.1 Pin the step (c) command (test-plan #E1): input `scripts/nightly-verdaccio-publish.mjs` source · trigger vitest reads it · observable a regex matches `run("pnpm", ["install", "--lockfile-only"])`
- [ ] 1.2 Pin the step order (test-plan #E2): input same source · trigger vitest finds the call offsets · observable `sync-versions.js` call < pnpm call < `verify-lockfile-versions.mjs` call
- [ ] 1.3 Pin no npm regeneration (test-plan #E3): input `nightly-verdaccio-publish.mjs` and `generate-runtime-lock.mjs` sources · trigger vitest reads both · observable the publish script has no `--package-lock-only`, and `generate-runtime-lock.mjs` still runs `npm install --package-lock-only`
- [ ] 1.4 Pin the Windows spawn (test-plan #E4): input `run()` / `bin()` source · trigger vitest reads it · observable the win32 `shell` condition covers `npm` and `pnpm`, and `bin()` maps only `npm` to `npm.cmd`
- [ ] 1.5 Run `npx vitest run scripts/__tests__/nightly-verdaccio-publish.test.mjs`; confirm 1.1, 1.2 and 1.4 fail and 1.3's publish-script half fails on the unchanged script

## 2. Step (c) on pnpm

- [ ] 2.1 In `scripts/nightly-verdaccio-publish.mjs` step (c) (`:192-193`), replace `run("npm", ["install", "--package-lock-only", "--no-audit", "--no-fund"])` with `run("pnpm", ["install", "--lockfile-only"])` (design D1)
- [ ] 2.2 In `run()` (`:156-158`), spawn `pnpm` through a shell on win32 as `npm` is (`shell: isWin && (cmd === "npm" || cmd === "pnpm")`); keep `bin()` mapping only `npm` to `npm.cmd`; update the comment at `:153-154` to name pnpm and the constant-arguments rule (design D2)
- [ ] 2.3 Update the header comment: step (c) line (`:15`) to `pnpm install --lockfile-only`; line `:6` to say it runs inside `_electron-build.yml` and needs no lockfile regeneration by its caller
- [ ] 2.4 Re-run `npx vitest run scripts/__tests__/nightly-verdaccio-publish.test.mjs`; all cases pass

## 3. Real-run tests (L1, budget lane)

Create `scripts/__tests__/nightly-verdaccio-publish-standalone.budget.test.mjs` (budget lane: excluded from `npm test`, run with `RUN_BUDGET_TESTS=1`; exemplar for lane placement: `scripts/__tests__/knip-scan.budget.test.mjs`). Shared fixture: a temp `git worktree add --detach <tmp> HEAD`, the working-tree `scripts/nightly-verdaccio-publish.mjs` copied in, `NIGHTLY_VERSION=<next patch>-nightly.20990101.abcdef0`, `REGISTRY=http://127.0.0.1:<closed port>`; remove the worktree in `afterAll`.

- [ ] 3.1 Standalone run passes the gate (test-plan #E5): input the fixture with no prior lockfile regeneration · trigger `node scripts/nightly-verdaccio-publish.mjs` in the temp worktree · observable output contains `✓ All cross-ref specifiers match ^<NIGHTLY_VERSION>`, every workspace cross-ref in the temp `pnpm-lock.yaml` `importers:` is `^<NIGHTLY_VERSION>`, and the run exits non-zero at step (e) on the closed port
- [ ] 3.2 Caller pre-regenerated (test-plan #E6): input the fixture after `npm pkg set version=<NIGHTLY_VERSION> --workspaces --include-workspace-root`, `node scripts/sync-versions.js`, `pnpm install --lockfile-only` · trigger run the script with the same version · observable the gate line is printed and every workspace cross-ref is still `^<NIGHTLY_VERSION>`
- [ ] 3.3 Missing pnpm fails before publish (test-plan #X1): input the fixture with `PATH` keeping the `node`/`npm` dirs and dropping every dir holding `pnpm` · trigger run the script · observable non-zero exit, no `✓ All cross-ref specifiers match` line, no `Publishing <n> workspace(s) to` line
- [ ] 3.4 Run `RUN_BUDGET_TESTS=1 npx vitest run scripts/__tests__/nightly-verdaccio-publish-standalone.budget.test.mjs`; all pass. Run `node scripts/check-budget-lane.mjs`; exit 0

## 4. Docs and validation

- [ ] 4.1 Update `scripts/nightly-verdaccio-publish.mjs.AGENTS.md`: "lockfile regen" to "`pnpm install --lockfile-only` lockfile regen"; say it needs no caller lockfile pre-step; add `See change: fix-nightly-publish-pnpm-lockfile`
- [ ] 4.2 Update `scripts/__tests__/nightly-verdaccio-publish.test.mjs.AGENTS.md` for the new step (c) pin cases; add `scripts/__tests__/nightly-verdaccio-publish-standalone.budget.test.mjs.AGENTS.md` and its row in `scripts/AGENTS.md` (next to `__tests__/knip-scan.budget.test.mjs`, `:74`)
- [ ] 4.3 In `.pi/skills/ci-troubleshoot/references/common-failures.md` (`verify-lockfile-versions.mjs` drift entry, `:22-37`), change the title (`:22`) and cause 2 (`:25`) from `package-lock.json` / `npm install --package-lock-only` to `pnpm-lock.yaml` / `pnpm install --lockfile-only`, and replace the npm reproduction with `npm pkg set version=… --workspaces --include-workspace-root`, `node scripts/sync-versions.js`, `pnpm install --lockfile-only`, `node scripts/verify-lockfile-versions.mjs`, and `git checkout package.json packages/*/package.json pnpm-lock.yaml`
- [ ] 4.4 Run `openspec validate fix-nightly-publish-pnpm-lockfile --strict`

## 5. Post-merge

- [ ] 5.1 Manual check (test-plan: manual-only, #X2): after merge, `workflow_dispatch` `nightly.yml` on `develop`; every electron leg, including `windows-latest` x64 and arm64, passes "Publish workspaces to Verdaccio (nightly)" (`_electron-build.yml:331-335`)
