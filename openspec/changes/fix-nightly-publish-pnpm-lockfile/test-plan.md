# Test Plan — fix-nightly-publish-pnpm-lockfile

Stage: design   Generated: 2026-11-23

Requirement under test: nightly-verification "The nightly publish script SHALL regenerate pnpm-lock.yaml before its lockfile gate" (R1), with its scenarios "Standalone run passes the lockfile gate" (S1), "Caller already regenerated the lockfile" (S2), "Missing pnpm fails before any publish" (S3) and "Step (c) runs on Windows" (S4).

Owner decision (2026-11-23): behaviour is checked by a real-run integration test in the budget lane plus a post-merge nightly dispatch for the Windows legs.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | R1 (pnpm command) | static contract | L1 | automated | `scripts/nightly-verdaccio-publish.mjs` source | vitest reads the file | a whitespace-tolerant regex matches `run("pnpm", ["install", "--lockfile-only"])` |
| E2 | R1 (order) | state-transition (step order) | L1 | automated | same source | vitest finds the call offsets | offset of the `sync-versions.js` call < offset of the pnpm call < offset of the `verify-lockfile-versions.mjs` call |
| E3 | R1 (no npm regeneration) | static contract (negative) | L1 | automated | `nightly-verdaccio-publish.mjs` and `generate-runtime-lock.mjs` sources | vitest reads both | the publish script contains no `--package-lock-only`; `generate-runtime-lock.mjs` still runs `npm install --package-lock-only` (the role-split survivor is not rewritten) |
| E4 | S4 (Windows spawn) | decision table (cmd × platform) | L1 | automated | `run()` / `bin()` source | vitest reads the file | the win32 `shell` condition covers both `npm` and `pnpm`; `bin()` maps only `npm` to `npm.cmd` |
| E5 | S1 | real run, standalone | L1 (budget lane) | automated | temp `git worktree` of HEAD with the working-tree `nightly-verdaccio-publish.mjs` copied in; `NIGHTLY_VERSION=<next patch>-nightly.20990101.abcdef0`; `REGISTRY=http://127.0.0.1:<closed port>`; no prior lockfile regeneration | run `node scripts/nightly-verdaccio-publish.mjs` in the temp worktree | output contains `✓ All cross-ref specifiers match ^<NIGHTLY_VERSION>`; every workspace cross-ref specifier in the temp `pnpm-lock.yaml` `importers:` equals `^<NIGHTLY_VERSION>`; the run then exits non-zero at step (e) (connection refused on the closed port), so no package reaches any registry |
| E6 | S2 | real run, caller pre-regenerated | L1 (budget lane) | automated | temp worktree as E5, after running `npm pkg set version=<NIGHTLY_VERSION> --workspaces --include-workspace-root`, `node scripts/sync-versions.js`, `pnpm install --lockfile-only` | run the script with the same `NIGHTLY_VERSION` | the gate line `✓ All cross-ref specifiers match ^<NIGHTLY_VERSION>` is printed; every workspace cross-ref specifier in `pnpm-lock.yaml` is still `^<NIGHTLY_VERSION>` |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | S3 | fault injection (missing binary) | L1 (budget lane) | automated | temp worktree as E5; `PATH` keeps the `node`/`npm` dirs and drops every dir holding `pnpm` | run the script | exit code non-zero; output does not contain `✓ All cross-ref specifiers match`; output contains no `Publishing <n> workspace(s) to` line (`nightly-verdaccio-publish.mjs:213`), so step (e) never started |
| X2 | S2, S4 | post-merge CI run | — | manual-only | none (real runners) | `workflow_dispatch` of `nightly.yml` on `develop` after merge | every electron leg, including `windows-latest` x64 and arm64, passes "Publish workspaces to Verdaccio (nightly)" (`_electron-build.yml:331-335`) |

---

## Coverage summary

- Requirements covered: 1/1 (R1 and all four of its scenarios)
- Scenarios by class: edge 6 · perf 0 · frontend 0 · error 2
- Scenarios by level: L1 4 · L1 budget lane 3 · manual 1
- Scenarios by disposition: automated 7 · manual-only 1

## New infra needed

- A real-run test in the budget lane: `scripts/__tests__/nightly-verdaccio-publish-standalone.budget.test.mjs`. Budget files are excluded from `npm test` (`BUDGET_TEST_EXCLUDE` in `vitest.workers.ts`) and run with `RUN_BUDGET_TESTS=1`. It creates and removes a temp `git worktree`; `pnpm install --lockfile-only` may use the network. No new harness or level.
