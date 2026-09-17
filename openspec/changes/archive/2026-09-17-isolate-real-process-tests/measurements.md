# Measurements — isolate-real-process-tests

Machine: Apple Silicon, Node v25.8.1, pnpm 11.15.1.
Load: a `while :; do npm run build; done` loop in another shell for the whole window.
Command: `npm test` (= `test:parallel` `&&` `test:real-process`).

## Three loaded runs (task 1.4)

| Run | Wall clock | Exit | `grep -c "retry x"` | Phase 1 | Phase 2 |
|---|---|---|---|---|---|
| 1 | 840 s | 1 | 0 | 1 failed, 1708 passed, 7 skipped | not reached (`&&`) |
| 2 | 905 s | 0 | 0 | 1709 passed, 7 skipped | 10 passed (78 tests, 1 skipped) |
| 3 | 908 s | 0 | 0 | 1709 passed, 7 skipped | 10 passed (78 tests, 1 skipped) |

Keeper E5 (`rpc-keeper/__tests__/keeper.test.ts`) passed in every phase-2 run, with
zero retries. `retry` is 0 outside CI by construction, so a retry could not have
masked anything here.

Run 1's phase-1 red is **not** a member of this change: `FilePicker` "collapsing a
directory hides its descendants and persists only that path" — an unrelated jsdom
one-shot of the same class as the four named members, not in the named set. Because
the two phases are chained with `&&`, a phase-1 red means phase 2 never runs.

## Unloaded reference

| Run | Wall clock | Exit | Phase 1 | Phase 2 |
|---|---|---|---|---|
| clean | 874 s | 0 | 1709 passed, 7 skipped | 10 passed |

Phase 2 alone: **52 s** (`npm run test:real-process`), 9 passed + 1 skipped
(`faux-session.integration` self-skips without `pi` on PATH).

## The phase's own canary fired once

A review round proposed locking the retried-pass JSON signature with a test that spawns a
nested `vitest run` over a fail-once fixture, added to the real-process list. With it in,
keeper E5 timed out at 60 s on two consecutive runs; phase wall clock went 57 s → 107 s. The
nested run is a CPU spike, and at `maxWorkers: 2` it lands beside `keeper.test.ts` — the exact
starvation this change exists to remove, reintroduced by its own guard. The test was dropped
(`test:ci-scenarios` precedent: nested/meta runs stay out of `npm test`) and the signature is
documented + verified by hand instead. Phase returned to 10 passed / 57 s.

## Residual flake class (out of scope, recorded)

Across 6 full `npm test` runs on this tree: 3 fully green, 3 red on ONE or TWO files, never the
same pair twice and never a file this change touches — `FilePicker` "collapsing a directory…",
`DiagnosticsSection` "falls back to textarea modal…", `directory-service-eventloop-turns` 4.2
(asserts ZERO event-loop spikes; a loaded machine produces one). All pass in isolation on rerun.
A baseline `npm test` on the `develop` checkout in the same window was red with 67 failed files,
so this tree is markedly greener than its baseline; the residue is the pre-existing timing class
this change narrows but does not close.

## Notes

- A first measurement attempt produced 14 red files in this worktree; root cause was
  a missing/partial `node_modules` (no `pnpm install` had been run in the worktree),
  not the change. After `pnpm install` the same tree runs green.
- `packages/client/src/__tests__/chat-input-draft-integration.test.tsx` fails with
  `window.localStorage.clear is not a function` when run WITHOUT the
  `NODE_OPTIONS=--localstorage-file=…` the `test` script sets. Reproduced identically
  on `develop`; pre-existing, unrelated.
