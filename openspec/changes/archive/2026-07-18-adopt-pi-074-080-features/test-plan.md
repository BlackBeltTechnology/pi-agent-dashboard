# Test Plan — adopt-pi-074-080-features

Stage: proposal/design   Generated: 2026-07-17

All Triple slots are concrete. Two gaps were resolved before writing: R4 `status` semantics (reuse existing unused `"ended"`, source-derived) and R7 annotation placement (visible badge/pill, decided via HARD gate). No `[NEEDS CLARIFICATION]` markers.

Requirement refs: R1 bridge `agent_settled` normalization · R2 bridge `session_info_changed` self-filter · R3 bridge `project_trust` · R4 reducer idle transition · R5 reducer compaction fields · R6 headless-spawn `--name` · R7 context-usage-bar compaction badge.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | R1 | BVA (version) | L1 | automated | bridge reports pi version `0.80.4` (boundary) | `agent_end` then run ends | bridge forwards pi's native `agent_settled`; emits NO synthesized settle |
| E2 | R1 | BVA (version) | L1 | automated | bridge reports pi version `0.80.3` (just below floor of native) | `agent_end` forwarded | bridge synthesizes exactly one `agent_settled` synchronously after that `agent_end` |
| E3 | R6 | BVA (empty) | L1 | automated | `sessionFlagsToArgv({ name: "" })` | build argv | result contains NO `--name` token |
| E4 | R6 | decision-table | L1 | automated | `sessionFlagsToArgv({ name:"x", sessionFile:"/s", fork:true, model:"m" })` | build argv | argv contains `--name x` AND `--fork /s` AND `--model m`; and `--name` also present on the `--session` path |
| E5 | R3 | decision-table | L1 | automated | the 3-bool matrix `dashboardSpawned × isHeadlessRpcSession × (eventCwd===activationCwd)` | `project_trust` event | trust returned ONLY for T·T·T; all 7 other rows defer |
| E6 | R5 | EP (enum) | L1 | automated | `session_compact` with `reason` ∈ {manual,threshold,overflow}, `willRetry:true`, estimate=N | reduce event | state stores the exact `reason`, `willRetry`, estimate for each value |
| E7 | R7 | decision-table (pure) | L1 | automated | label deriver called with `reason` ∈ {manual,threshold,overflow} | derive label | returns {"manual","auto-threshold","overflow-retry"} respectively |
| E8 | R6 | edge (injection-safety) | L1 | automated | `sessionFlagsToArgv({ name:'a "b" c' })` | build argv | the name is a single argv element (no splitting), preserved verbatim |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | R4+R1 | state-transition | L1 | automated | modern-pi event stream | `agent_start→agent_end→auto_retry→agent_start→agent_end→agent_settled` | `status` is `"ended"` after each `agent_end`, `"streaming"` during, `"idle"` ONLY after the final `agent_settled`; never `"idle"` between the first `agent_end` and the retry `agent_start` |
| F2 | R4+R1 | state-transition | L1 | automated | floor-pi: `agent_end` + bridge-synthesized `agent_settled` dispatched same batch | reduce both | terminal `status==="idle"` resolved in the same dispatch batch; observable equals today's `agent_end`→`idle` |
| F3 | R4 | state-transition | L1 | automated | `agent_end` carrying a provider error + pending retry | reduce `agent_end` | `lastError` extracted AND `retryState`/`pendingPrompt` cleared on `agent_end`; only `status:"idle"` is deferred to the settle arm |
| F4 | R2 | state-transition | L1 | automated | bridge auto-name `= "Foo"`, then external rename to `"Bar"` | `session_info_changed{name:"Bar"}` | `onObservedName` classifies external → exactly one `session_name_update{nameSource:"user"}` + auto-name lockout |
| F5 | R2 | state-transition (regression) | L1 | automated | bridge self-applies title `"Foo\nBar"`; pi sanitizes to `"Foo Bar"` | `session_info_changed{name:"Foo Bar"}` | normalized self-comparison classifies self → NO `session_name_update`; auto-naming still active |
| F6 | R7 | state-convergence (rendered) | L3 | automated | session state with `reason:"threshold"`, reduction 12,400 tokens | dashboard renders the context bar | a visible badge with text `auto-threshold −12.4k` appears next to the bar (DOM text) |
| F7 | R7 | state-transition (rendered) | L3 | automated | session state with NO compaction metadata | dashboard renders the context bar | NO compaction badge in the DOM; bar renders as today |
| F8 | R1 | state-transition | L1 | automated | modern pi, single run | native `agent_settled` fires once after the run loop | bridge forwards exactly one `agent_settled` `event_forward` and sets `isAgentStreaming=false`; no synth |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | R3 | fault-injection | L1 | automated | reading `eventCwd` from a stale/replaced `ctx` throws | `project_trust` event | handler catches the throw and defers to pi default; no crash, no trust granted |
| X2 | R1 | illegal-edge | L1 | automated | `agent_settled` arrives with NO preceding `agent_end` | reduce/forward | bridge clears `isAgentStreaming`; reducer resolves `"idle"` without crashing |
| X3 | R3 | ordering-regression | L1 | automated | `project_trust` handler invoked BEFORE the `session_start` handler runs | fire `project_trust` first | `activationCwd` (captured at activation, not session_start) is already defined → gate compares real cwds, not `undefined` (the cycle-2 dead-on-arrival guard) |
| X4 | R3 | fault/integration | L3 | automated | headless RPC session spawned in a resource-bearing (`.pi/`), not-yet-trusted cwd | dashboard spawns the session | session reaches ready/idle (auto-trusted, no stall) within the harness timeout; project resources load |

---

## Coverage summary

- Requirements covered: 7/7 (R1–R7)
- Scenarios by class: edge 8 · perf 0 · frontend 8 · error 4
- Scenarios by level: L1 17 · L2 0 · L3 3 (F6, F7, X4)
- Scenarios by disposition: automated 20 · manual-only 0

## New infra needed

- X4 needs the docker e2e harness to spawn a headless RPC session into a temp cwd seeded with a `.pi/` resource in an untrusted state, then assert no-stall. The harness (`docker/` + `tests/e2e/`) can create the temp dir + `.pi/` and drive a spawn; the "untrusted" precondition may need a small harness helper (clear the dir from trusted state). Flagged, not blocking — F6/F7/X4 all reuse the existing Playwright + docker harness; only X4's trust-seed is new glue. Exemplar: `tests/e2e/anthropic-bridge-activation.spec.ts`.
