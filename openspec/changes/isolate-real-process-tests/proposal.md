## Why

`develop` CI still fails ~1 run in 4 on timing, never on the diff under test. Two classes remain after `make-test-suite-deterministic` and `contention-harden-real-process-tests`:

1. **Real-process tests starved by the fork storm.** `rpc-keeper/__tests__/keeper.test.ts` E5 (a real keeper + a mock-pi writer, polling for log rotation) hit its 60 s poll budget twice in the last two weeks of `develop` CI (#652) while passing 32/32 in isolation. It already polls a bounded condition — the remaining defect is that ~19 000 unit tests across `50 %` forks leave the subprocess no CPU. `test:ci-scenarios` set the precedent: CPU-heavy work runs *alone, sequentially* in its own step, not inside the saturated run.
2. **jsdom tests whose assertion races an effect flush.** `SettingsPanel` "Initialize on worktree" (#604) plus three more seen since — `EditorSearchPanel` "Esc dismisses the hoisted overlay" and "ArrowDown + Enter", `FilePreviewContext` E24 — each fails once under full-suite load and passes on rerun. Each is a one-shot `getBy*` or a `fireEvent` issued before the state it depends on has landed.

Every such red blocks a required check and trains people to `rerun --failed`, which is how a real regression will eventually slip through.

## What Changes

- **Real-process project.** A new vitest project `packages/server/vitest.real-process.config.ts` collects the server tests that spawn a keeper, a mock-pi, a wrapper, or a full server *process* (census in `design.md`; first members `rpc-keeper/__tests__/keeper*.test.ts`, `cli-signal-forwarding`, `session-kill-e2e`, `shutdown-*`, `headless-pid-registry-kill-*`, `recovery-exit-intent`, `reclamation-soak`). The main `packages/server` project excludes them. The project runs with `maxWorkers: 2`, `testTimeout`/`hookTimeout` 60 s, and — **only under `CI`** — `retry: 1`, with the retry recorded in the run output so a retried test is visible, not silent.
- **`npm test` keeps its single-command contract.** The root `test` script runs the main projects, then the real-process project, sequentially. CI runs the same script; the second phase starts on an idle machine.
- **jsdom fixes, root-caused member by member.** The four named tests are fixed by the existing poll-not-guess rule (`findBy*` / `waitFor` around the one-shot read; `await` the fetch-resolved baseline before the first `fireEvent`), each with a one-line cause recorded in `tasks.md`. No blanket `asyncUtilTimeout` raise.
- **Flake ledger in the failure.** The client and server vitest setup files gain nothing new; instead the CI job uploads the vitest JSON reporter output as an artifact so a retried or failed timing test is attributable from the run page without log mining.

Out of scope: `retry` on any project other than real-process; changing `PARALLEL_MAX_WORKERS`; the browser-E2E suite (`stabilize-browser-e2e`).

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `parallel-test-execution`: new requirement — real-process tests run in a dedicated low-concurrency project after the parallel run, with CI-only single retry that is reported; the four named jsdom tests comply with the poll-not-guess rule.
- `ci-cd-pipeline`: the CI workflow uploads the vitest JSON report as an artifact on every run.

## Impact

- `packages/server/vitest.config.ts` (exclude list), new `packages/server/vitest.real-process.config.ts`, root `vitest.config.ts` (project entry), root `package.json` (`test`, `test:real-process`).
- `.github/workflows/ci.yml` (artifact upload step), `packages/shared/src/__tests__/` repo-lint case for the exclude/include disjointness.
- `packages/client/src/components/__tests__/SettingsPanel.test.tsx`, `packages/client/src/components/editor-pane/__tests__/EditorSearchPanel.test.tsx`, `packages/client/src/components/__tests__/FilePreviewContext.test.tsx`.
- `AGENTS.md` "Running Tests" stays valid (`npm test` still runs everything); `docs/code-quality.md` / `.pi/skills/ci-troubleshoot/SKILL.md` gain the real-process phase and the artifact.

## Discipline Skills

- `systematic-debugging` — each jsdom member is root-caused (which effect/flush the assertion raced) before its edit; no "raise the timeout" fixes.
- `doubt-driven-review` — introducing `retry` anywhere is a policy decision; it is scoped to one project, CI-only, reported, and reviewed before it stands.
- `review-code` — before commit.
