## 1. Census

- [x] 1.1 Sweep `packages/server/src/**/__tests__` for one-shot reads of real-process outcomes (spawn → wait fixed/implicit → assert state) and wall-clock budget assertions; list every member with its mechanism — result in `census.md` (sections A–E)
- [x] 1.2 Repeat for `packages/*/src/**/__tests__` (client waitFor-budget sites where the awaited chain is process-backed) — `census.md` section C

## 2. Fix members (one commit per member, poll-or-budget rule)

- [x] 2.1 `cli-signal-forwarding`: bounded poll for the exitIntent record instead of a fixed propagation window
- [x] 2.2 `auth-redirect-base` P1: measure isolated baseline; set a fork-count-scaled budget with documented headroom (10ms isolated / 101ms saturated → 1000ms)
- [x] 2.3 `FileLink.split`: make the resolve chain deterministic in-test or raise the effective budget with justification (client `asyncUtilTimeout` 5s → 10s, 5s margin under the 15s `testTimeout`)
- [x] 2.4 Remaining census members (see `census.md`): 5s-default `testTimeout` → 30s in `shared` / `bus-client` / `extension` / `scripts` / `automation-plugin`; server `hookTimeout` 30s; `linkify-tool-output.perf` 250ms → 1000ms; mcp-server-plugin P1 p95 1ms → 10ms; inbound-drop-report P2 estimator → min-of-arms; `contention-resume-guard-api` temp-backed session paths + file-scoped server hooks; `ChatView.selection-anchor` scroll-aware stub; mutation harness per-target cap 240s → 600s

## 3. Verification

- [ ] 3.1 The `parallel-test-execution` 3-consecutive-run soak passes on a loaded developer machine (re-run of the environment-limited P2 from `make-test-suite-deterministic`) — **DEFERRED (manual — environment-limited on this host)**: 5 full-suite runs recorded (failures 20 → 4 → 6 → 2 → 8) at ambient load 48–400 on 16 cores vs the change's ~4–10 design point; the failing set rotates per run and every observed member passes in isolation. Evidence in `census.md` §G. Verify on a calm machine / in PR CI.
- [x] 3.2 `openspec validate --changes contention-harden-real-process-tests`

## 4. Documentation

- [x] 4.1 FAQ: extend the "npm test red locally" entry with the real-process test class and the poll-or-budget rule
