## 1. Real-process project (`packages/server/`, root `vitest.config.ts`, `package.json`)

- [ ] 1.1 Census — run the D2 spawn predicate over `packages/server/src/**/__tests__/*.test.ts`, read each hit, and write `packages/server/vitest.real-process-files.ts` (`REAL_PROCESS_TESTS: string[]`) with a one-line reason per entry (keeper/mock-pi/wrapper/full-server/signal). Verify: every listed file exists; the 23 grep hits are each either listed or annotated `// real-process-exempt: <reason>` at the call.
- [ ] 1.2 Test the disjointness guard — new `packages/shared/src/__tests__/real-process-project-guard.test.ts` (tree-scan pattern of the fixed-tick guard): (a) listed files exist; (b) main include minus exclude is disjoint from the list; (c) a fixture file under a temp dir that calls `spawnKeeper(` and is not listed fails naming it; (d) no vitest config in the tree other than the real-process one contains `retry:`. Verify red first (c, d).
- [ ] 1.3 Implement D1: `packages/server/vitest.real-process.config.ts` (`name: "server-real-process"`, include from the list, `maxWorkers: 2`, 60 s budgets, `retry: process.env.CI ? 1 : 0`, same globalSetup/setupFiles/alias as the server config); `packages/server/vitest.config.ts` `exclude: REAL_PROCESS_TESTS`; root `package.json` `test` = main run `&&` real-process run (same `HOME`/`NODE_OPTIONS` env), plus `test:real-process` alone. Verify 1.2 green; `npm test` runs both phases; `npx vitest run --config packages/server/vitest.real-process.config.ts` runs only the listed files.
- [ ] 1.4 Verify no starvation: run `npm test` three times on a loaded machine (a parallel `npm run build` in another shell) — keeper E5 passes every time with no retry (`grep -c "retry x" /tmp/pi-test.log` = 0). Record the three timings in `openspec/changes/isolate-real-process-tests/measurements.md`.

## 2. CI report artifact (`.github/workflows/ci.yml`)

- [ ] 2.1 Test the workflow contract — extend the existing ci-workflow repo-lint (or add a case beside `nightly-workflow-contract.test.ts`): the `pnpm test` step is followed by an `actions/upload-artifact` step with `if: always()` whose `path` includes `test-results/vitest*.json`. Verify red first.
- [ ] 2.2 Implement D3: add `--reporter=default --reporter=json --outputFile=test-results/vitest.json` to both phases in the `test` script (or via `vitest.config` `reporters` under `CI`); the upload step with `retention-days: 14`. Verify 2.1 green; a dispatch of `ci.yml` on the branch shows the artifact on the run page.

## 3. jsdom races (`packages/client/src/**/__tests__/`)

- [ ] 3.1 Root-cause each member — for `SettingsPanel` "Initialize on worktree", `EditorSearchPanel` "Esc dismisses the hoisted overlay", `EditorSearchPanel` "keyboard: ArrowDown + Enter …", `FilePreviewContext` "E24 …": read the test and the component, name the effect/flush the one-shot read or premature `fireEvent` races, and write it as a one-line `// race: …` comment above the fix. Verify: reproduce at least one by running the file under `stress` (`vitest run <file> --repeat 20` with a parallel `npm run build`) before the fix.
- [ ] 3.2 Fix each per D4 (poll the dependent state before the event; `findBy*` before the click). Verify: the four files pass `--repeat 20` under load, and the fixed-tick guard stays green.

## 4. Docs + closeout

- [ ] 4.1 `docs/code-quality.md` "Running tests" gains the two-phase shape and `npm run test:real-process`; `.pi/skills/ci-troubleshoot/SKILL.md` gains "check the vitest JSON artifact first" and the retry semantics. Delegate prose to `DocScribe`. Verify grep `test:real-process` in both.
- [ ] 4.2 `AGENTS.md` rows: `packages/server/AGENTS.md` (two new config files), `packages/shared/src/__tests__/AGENTS.md` (guard), `.github/workflows/AGENTS.md`. Verify `kb dox lint` clean.
- [ ] 4.3 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` zero failures; `npm run quality:changed` clean; comment on #652 and #604 with the change name.
