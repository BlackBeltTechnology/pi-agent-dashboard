# Test Plan — stabilize-flaky-unit-tests

Stage: apply   Generated: 2026-11-03   Clarifications: resolved (owner decision 2026-11-03, all recommended answers accepted)

> Test-only change. System under test = the test code itself (EditorSearchPanel test, real-serve test + stub fixture). All levels are L1 (vitest); no rendered-UI/e2e or VM smoke rows apply.
>
> Resolved decisions:
> - Q1: mutation / negative-control / stress rows (F1, F2, X3, X4, P1–P3) are one-off verification runs recorded in task notes, never committed → `manual-only`.
> - Q2: pid file present but empty/non-numeric at `afterEach` → fail the hook with a message naming the file and its contents (E4).
> - Q3: leak assertion verified on Linux/macOS only; no Windows unit job, no new infra (X2).

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable | exemplar |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|----------|
| E1 | #1097 deterministic ArrowDown/Enter (design D1) | state-transition | L1 | automated | `setup()` files `[src/editor.ts, src/edit-log.ts]`, `vi.useFakeTimers()`, input `"edit"` (≥ `minLen` 3) | `await act(async()=>vi.advanceTimersByTimeAsync(250))`, `getByText("src/editor.ts")`, keyDown ArrowDown, then Enter, then Escape | row 1 has bare `bg-[var(--bg-hover)]` synchronously after ArrowDown (no `waitFor`); `onOpen` called once with `("src/edit-log.ts", undefined)`; `onClose` not called | `packages/client/src/components/editor-pane/__tests__/EditorSearchPanel.test.tsx` |
| E2 | #1097 debounce boundary (`DEBOUNCE_MS`=200) | BVA | L1 | automated | same setup, fake timers, value `"edit"` | advance 199 ms (inside `act`), then the remaining time | at 199 ms `queryByText("src/editor.ts")` is null; after the remaining time rows render (fake timers, not real time, drive the commit) | `packages/client/src/components/editor-pane/__tests__/capped-viewer-limit.test.tsx` |
| E3 | #1097 timer hygiene (`useRealTimers` in afterEach) | decision-table | L1 | automated | a test that throws after `useFakeTimers()` | following tests in the file run (`prefill`, content-mode `waitFor`) | `vi.isFakeTimers()` is false at the start of every following test; file 7/7 green, no hang in the real-timer `waitFor` tests | `packages/client/src/components/editor-pane/__tests__/EditorSearchPanel.test.tsx` |
| E4 | #1071 pid-file read (design D3: absent skip; malformed fail) | EP (absent / valid / empty / non-numeric) | L1 | automated | `readStubPid(file)` helper used by `afterEach`: (a) file absent, (b) valid pid, (c) empty file, (d) `"abc"` | helper called | (a) returns undefined, test 1 (real serve) still exits 0 in <1000 ms, no throw; (b) returns the positive integer; (c)(d) throws an Error whose message names the file path and its contents | `packages/obs-studio-plugin/src/server/__tests__/real-serve.test.ts` |
| E5 | #1070 AUTH-006 bounds (`890 ≤ s0 ≤ 900`, `s1 ≤ s0-1`, `≤ s1-2`) | BVA | L1 | automated | existing `ProviderAddDialog.test.tsx` AUTH-006 at HEAD (includes `f93a27812`), `shouldAdvanceTime:true` | `vitest run -t AUTH-006`, file unmodified | green; `git diff` empty for the file; countdown assertions are inequalities only | `packages/client/src/__tests__/ProviderAddDialog.test.tsx` |
| E6 | Closeout: #1097 comment, #1070 closed with `f93a27812` + stress evidence, `Refs #1103` in trailer, no edit to `bridge.ts` / `cli-service.ts` | checklist | — | manual-only | GitHub issues #1097 / #1070 / #1071 / #1103 | maintainer posts comments pre-merge; reviews `git diff --name-only` | issue-tracker state + diff allow-list (only the 3 test/fixture files + `fixtures/AGENTS.md`); no repo-observable assertion | — |

### Performance

| id | requirement | technique | level | disposition | input | trigger | expected observable | exemplar |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|----------|
| P1 | #1097 flake under load | soak under CPU contention | L1 | manual-only | `EditorSearchPanel.test.tsx` whole file, 4× `yes >/dev/null`, `HOME=$(mktemp -d)` | 50 consecutive runs | 0 failures of ≥ 50 runs; count in task notes | — |
| P2 | #1070 flake under load | soak under CPU contention | L1 | manual-only | `-t AUTH-006` ≥ 50×; whole `ProviderAddDialog.test.tsx` ≥ 20×, same 4× CPU hogs | 50 + 20 runs | 0 failures; counts in task notes | — |
| P3 | #1071 no survivor across runs | soak | L1 | manual-only | `real-serve.test.ts` 5× back-to-back | after each run check no stub grandchild remains (`pgrep -f "setInterval"` by the maintainer; in-test liveness assertion also held) | 0 survivors after each of 5 runs | — |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable | exemplar |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|----------|
| F1 | #1097 root cause: passive-effect `setActiveIndex(0)` clobbers ArrowDown | state-transition + illegal-edge | L1 | manual-only | fake timers, panel mounted, `"edit"` typed | advance debounce with an act-less timer advance (commit, effects unflushed), fire ArrowDown, then flush | converges to active row 0 (clobber reproduced); red run recorded in task notes; if no deterministic ordering is found in the timebox the cause stays "inferred" (design Risks) | — |
| F2 | #1097 fix is load-bearing (mutation check) | mutation | L1 | manual-only | E1 with the `act` flush removed (plain `advanceTimersByTimeAsync`) | run E1 | E1 goes red (active row ≠ 1 or act warning); result in task notes | — |
| F3 | #1097 key-handler stale closure (Enter before re-render must open item 1) | state-transition | L1 | automated | panel in E1 state, ArrowDown just fired, no re-render awaited | `Enter` immediately after ArrowDown | opens `src/edit-log.ts` (index 1), not `src/editor.ts` | `packages/client/src/components/editor-pane/__tests__/EditorSearchPanel.test.tsx` |

### Error-handling

| id | requirement | technique | level | disposition | input | trigger | expected observable | exemplar |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|----------|
| X1 | #1071 happy reap (design D3) | fault-injection (EOF-ignoring grandchild) | L1 | automated | `STUB_IGNORE_EOF=1`, `STUB_CHILD_PID_FILE=<tmpdir>/pid`, `disposeGraceMs=600` | test 2 runs, `m.dispose("obs")`, then `afterEach` | pid file holds a positive integer written before dispose; `killProcess(pid,{timeoutMs:1000})` called; `vi.waitFor(isProcessAlive(pid)===false,{timeout:2000})` passes; tmpdir removed | `packages/obs-studio-plugin/src/server/__tests__/real-serve.test.ts` |
| X2 | #1071 liveness-assert timing (killProcess returns right after SIGKILL); Linux/macOS only | BVA on poll window (0 ms / ≤2000 ms / >2000 ms) | L1 | automated | grandchild whose termination lags the `killProcess` return | `afterEach` polls | one-shot read would false-fail; bounded poll passes within 2000 ms; pid still alive at 2000 ms fails the assertion (not hang) | `packages/extension/src/__tests__/process-scanner-kill.test.ts` |
| X3 | #1071 red-first negative control | mutation | L1 | manual-only | `afterEach` with the reap step removed | run test 2 | liveness assertion fails (leak reproduced); leftover pid killed manually; recorded once in task notes | — |
| X4 | #1071 reap runs when the test body fails | fault-injection | L1 | manual-only | temporarily make test 2's `expect(k - t0)…` fail after the grandchild spawned | run | `afterEach` still reaps; no surviving grandchild after the failing run; recorded in task notes | — |
| X5 | #1071 stub contract unchanged | regression | L1 | automated | test 1 (`STUB_IGNORE_EOF` unset, no pid file) | EOF to the stub's child (real `pi-obs serve`) | stub exits with child code 0; no pid file created; grandchild script/argv unchanged (`setInterval` still matches) | `packages/obs-studio-plugin/src/server/__tests__/real-serve.test.ts` |
| X6 | #1071 pid already dead at afterEach | EP (alive / already-dead) | L1 | automated | grandchild exited on its own before `afterEach` | `killProcess` on dead pid | no throw; liveness assertion passes immediately | `packages/extension/src/__tests__/process-scanner-kill.test.ts` |

---

## Coverage summary

- Requirements covered: task groups 1.x, 2.x, 3.x, 4.x; design D1–D3 and Risks mapped; D4 (deferred product fix, #1103) is the manual closeout E6.
- Scenarios by class: edge 6 · perf 3 · frontend 3 · error 6
- Scenarios by level: L1 17 · L2 0 · L3 0 (— 1)
- Scenarios by disposition: automated 10 (E1–E5, F3, X1, X2, X5, X6) · manual-only 8 (E6, P1–P3, F1, F2, X3, X4)

## New infra needed

- none (shared `killProcess` / `isProcessAlive` from `@blackbelt-technology/pi-dashboard-shared/platform/process.js` already exist).
