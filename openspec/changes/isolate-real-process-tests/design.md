## Context

See `proposal.md` — Why. Relevant facts:

- Root `vitest.config.ts` lists ~35 projects; vitest runs projects concurrently over one fork pool bounded per project by `PARALLEL_MAX_WORKERS = "50%"` (`vitest.workers.ts`). A low `maxWorkers` on one project does NOT protect it — sibling projects still saturate the CPU. Only sequencing does.
- Precedent: `test:ci-scenarios` (`RUN_CI_SCENARIOS=1 vitest run --project scripts`) is held out of `pnpm test` and run alone in `ci.yml` because its CPU spike starved 5 s-timeout tests.
- `packages/server/vitest.config.ts`: `include: ["src/**/__tests__/**/*.test.ts"]`, `pool: "forks"`, `testTimeout`/`hookTimeout` 30 s, `globalSetup` + `setupFiles` for the ephemeral HOME.
- Keeper E5 (`keeper.test.ts:817`) already polls with 60 s budgets and a size-based child-data gate (`make-test-suite-deterministic`); the two recent CI timeouts show the poll never observed 8 KiB of child writes in 60 s — starvation, not a race.
- Census of server tests that spawn a real process (grep `spawnKeeper|spawn(process.execPath|fork(|SIGTERM|mock-pi`): 23 files. Not all are real-process-outcome tests (some only import a module that references SIGTERM); the census is refined in task 1.1 by a stricter predicate — the file calls `spawn`/`fork`/`execFile` on `process.execPath` or a `.cjs`/`.mjs` entry, or uses `spawnKeeper`/`bootRealServer`.
- jsdom members: `SettingsPanel.test.tsx:650` toggles a switch immediately after `waitFor(getByText("Initialize on worktree"))` — the label renders before the fetched config baseline is committed, so a fast click can be diffed against an unset baseline and no Save bar appears. `EditorSearchPanel` and `FilePreviewContext` E24 to be read in task 3.1.

## Goals / Non-Goals

**Goals:** real-process tests get an idle machine; `npm test` stays one command; a retry is a visible event; each jsdom fix names its race.

**Non-Goals:** retries anywhere else; changing worker counts; touching the harness-backed E2E suite; fixing product timing (none of these are product bugs).

## Decisions

### D1 — Dedicated project + sequential script, not a tag or `sequence.concurrent`

`packages/server/vitest.real-process.config.ts` mirrors the server config (same `environment`, `globalSetup`, `setupFiles`, `resolve.alias`) with `include: REAL_PROCESS_TESTS` (an exported array in `packages/server/vitest.real-process-files.ts` so the main config can `exclude` the same list — one source of truth), `maxWorkers: 2`, `testTimeout: 60_000`, `hookTimeout: 60_000`, `retry: process.env.CI ? 1 : 0`, `name: "server-real-process"`. It is NOT listed in the root `projects` (so `vitest run` does not pick it up); the root `test` script becomes `<main vitest run> && <same env> vitest run --config packages/server/vitest.real-process.config.ts`. *Alternative rejected:* listing it as a root project with `sequence` options — vitest has no cross-project ordering guarantee; a tag/`describe.sequential` does not stop sibling projects from consuming the CPU.

### D2 — Disjointness guard

Repo-lint test (`packages/shared/src/__tests__/real-process-project-guard.test.ts`, tree-scan pattern already used by the fixed-tick guard): (a) every file in `REAL_PROCESS_TESTS` exists; (b) the main server project's effective include minus exclude and `REAL_PROCESS_TESTS` are disjoint; (c) every `packages/server/src/**/__tests__/*.test.ts` matching the spawn predicate (`spawnKeeper(`, `spawn(process.execPath`, `fork(`, `execFile(process.execPath`, `bootRealServer(`) is in `REAL_PROCESS_TESTS` unless it carries an inline `// real-process-exempt: <reason>` comment on the call. Same opt-out shape as the fixed-tick guard.

### D3 — Retry is reported, not hidden

Vitest prints `(retry x1)` on the list reporter; the JSON reporter (`--reporter=default --reporter=json --outputFile=test-results/vitest.json`) records `retryCount`. `ci.yml` adds `actions/upload-artifact` with `if: always()` for `test-results/vitest*.json`. Only the real-process config sets `retry`; the guard asserts no other vitest config in the tree contains `retry:`.

### D4 — jsdom members: poll-not-guess, per member

- `SettingsPanel` — `await screen.findByText(...)` is not enough; wait for the baseline: `await waitFor(() => expect(within(row).getByRole("switch")).toHaveAttribute("aria-checked", "false"))` (the fetched value) BEFORE the click; then `await screen.findByTestId("save-btn")` before clicking it.
- `EditorSearchPanel` ×2 and `FilePreviewContext` E24 — read in task 3.1; expected shape is the same (a `getBy*` immediately after a `fireEvent` whose handler flushes in an effect, or a keyboard event before the listbox has rendered). Fix with `findBy*`/`waitFor`; record the exact race in the task line.

## Risks / Trade-offs

- [`npm test` wall-clock grows by the real-process phase (~1–2 min) since it no longer overlaps] → accepted; it is the cost of an attributable verdict. The phase is listed in `docs/code-quality.md` so `npm run test:real-process` can be run alone during iteration.
- [Census misses a file and it keeps flaking in the main run] → D2 predicate guard catches new members; an existing miss is one line to fix.
- [A retry masks a real regression in a real-process test] → it fires only in CI, only once, only in that project, and is recorded in the artifact; a regression that fails twice still blocks.
- [Vitest JSON reporter output is large] → one file per run, `retention-days: 14`.

## Migration Plan

Additive. Rollback: drop the second phase from the `test` script and the exclude list — files return to the main project.
