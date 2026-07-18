## Phase A — Bridge event adoptions

### A.1 agent_settled truly-idle signal (bridge-normalized)
- [x] A.1.1 In `packages/extension/src/bridge.ts`, add `"agent_settled"` to the enriched-event subscription list (near `agent_end`). Forward the real event and set `getBridgeState().isAgentStreaming = false`.
- [x] A.1.2 On floor pi (version < 0.80.4, from the version the bridge already reports in `session_register`), synthesize an `agent_settled` synchronously immediately after each forwarded `agent_end`, so the dashboard always gets exactly one terminal `agent_settled` per run. No `session_register` capability field.
- [x] A.1.3 In `packages/client/src/lib/event-reducer.ts`, add ONE uniform arm: `agent_end`→intermediate ended-pending-settle; `agent_settled` (real or synthesized)→`idle`. NO timer, NO version/capability branch. Preserve existing `agent_end` side-effects (last-error extraction, `retryState`/`pendingPrompt` clearing); move only the `status="idle"` line to the settle arm.
- [x] A.1.4 Test (bridge): native forward (no synth) on pi≥0.80.4; one synthesized settle after `agent_end` on pi<0.80.4.
- [x] A.1.5 Test (reducer): no-idle across `agent_start→agent_end→auto_retry→agent_start→agent_end→agent_settled`; floor-pi synthetic path resolves idle in the same batch as `agent_end`; `agent_end` side-effects preserved.
- [x] A.1.6 Run existing status-banner / retry / idle reducer tests — confirm no regressions.

### A.2 session_info_changed push renames (self-filtered)
- [x] A.2.1 In `auto-session-namer.ts`, normalize the recorded self-applied name with pi's sanitization (`replace(/[\r\n]+/g, " ").trim()`) so a newline-bearing self-title still matches the sanitized name pi carries in the event.
- [x] A.2.2 In `bridge.ts`, register `pi.on("session_info_changed", ...)` (try/catch) and call the existing `autoNamer.onObservedName(name)` (it classifies + reports external only). No new namer API. Keep the turn-end poll as fallback.
- [x] A.2.3 Test: external rename → one push + lockout; the bridge's OWN auto-name (incl. a newline-bearing title) echoing through `session_info_changed` → NO push, auto-naming still active (self-lockout regression guard).

### A.3 project_trust headless auto-decision (narrow, activation-cwd)
- [x] A.3.1 In `bridge.ts`, capture `activationCwd = process.cwd()` at bridge **activation** (NOT `session_start` — `project_trust` fires during resource-loader reload, before `session_start`; verified `resource-loader.js:222`).
- [x] A.3.2 Create `packages/extension/src/project-trust.ts`: read `eventCwd` from the handler's own per-event `ctx` argument inside try/catch (never `cachedCtx` — `ctx.cwd` throws after session replacement). Decide "trust this run" ONLY when `dashboardSpawned === true` AND `isHeadlessRpcSession(...)` AND `eventCwd === activationCwd`; else (incl. a throw) defer. Use `ctx.isProjectTrusted()` for logging only.
- [x] A.3.3 In `bridge.ts`, register the `project_trust` handler at activation (try/catch; no-op on older pi).
- [x] A.3.4 Tests: dashboardSpawned+headless+`eventCwd===activationCwd` → trust; interactive/TUI → defer; headless with changed `eventCwd` → defer; non-dashboard-spawned → defer; `ctx.cwd` throw → defer.
- [x] A.3.5 Invoke `security-hardening`: threat-model the activation-cwd trust policy (incl. pi's bare-cwd auto-trust short-circuit + the pre-session_start ordering); record findings + mitigations.

## Phase B — Server spawn adoption

### B.1 --name at spawn (shared spawn-mechanism)
- [x] B.1.1 In `packages/shared/src/platform/spawn-mechanism.ts`, add `name?: string` to `SessionFlags` and make `sessionFlagsToArgv` emit `["--name", flags.name]` when set (composing with `--session`/`--fork`/`--model`).
- [x] B.1.2 Thread `name` from the server spawn call sites that already know an intended name (worktree/flow spawns).
- [x] B.1.3 In `packages/shared/src/platform/__tests__/spawn-mechanism.test.ts`, assert `--name` emission (set), non-emission (unset), AND composition (present alongside `--fork`/`--session` and `--model` across all three return paths).
- [x] B.1.4 Integration test: the `--name` flag reaches `spawnKeeperFor` argv.

## Phase C — Client compaction UI

### C.1 compaction reason / willRetry / post-compact estimate
- [x] C.1.1 In `event-reducer.ts`, capture `reason`, `willRetry`, `estimatedPostCompactionTokens` from `session_compact` into session state (absent → unchanged).
- [x] C.1.2 In `ContextUsageBar.tsx` (and/or `SessionActivityBar.tsx`), render a compaction annotation: reason label (manual / auto-threshold / overflow-retry) + approximate reduction. Missing fields → today's bar.
- [x] C.1.3 Tests: reducer stores the three fields; bar renders reason + reduction; absent fields render unchanged.

## Validation
- [x] V.1 `review-code` pass on the full diff (bridge + reducer + shared + client) before commit.
- [x] V.2 `npm test` green; new tests cover every scenario in the delta specs.
- [x] V.3 `openspec validate adopt-pi-074-080-features --strict` passes.
- [x] V.3b Docker E2E harness (built from local source) — lifecycle-sensitive subset (smoke, faux-text, optimistic-prompt, session-spawn, error-lifecycle) green EXCEPT two PRE-EXISTING failures (`faux-ask` + `error-lifecycle:78` ask_user select-widget-mount) that reproduce identically on the stashed baseline (origin/develop) → not caused by this change. X4 spec loads + skips (opt-in).
- [x] V.4 (DEFERRED — deploy-time manual, verified post-merge) Full rebuild + restart + reload per the 3-component matrix; smoke a named headless spawn (name at creation, no trust stall) and a retry/compaction (no idle flicker). Not run in the worktree (per AGENTS.md, full-rebuild = deploy to the local running instance, not a worktree step).

## Tests (folded from test-plan.md — one task per automated scenario)

### Bridge L1 (see `packages/extension/src/__tests__/bridge-thinking-level-select.test.ts`; namer parts see `auto-session-namer.test.ts`)
- [x] E1 pi version `0.80.4` (boundary) · run ends · bridge forwards native `agent_settled`, NO synth (test-plan #E1)
- [x] E2 pi version `0.80.3` · `agent_end` forwarded · bridge synthesizes exactly one `agent_settled` synchronously after it (test-plan #E2)
- [x] F8 modern pi single run · native `agent_settled` fires once after loop · exactly one `agent_settled` forwarded + `isAgentStreaming=false`, no synth (test-plan #F8)
- [x] F4 auto-name `"Foo"` then external rename · `session_info_changed{name:"Bar"}` · one `session_name_update{nameSource:"user"}` + lockout (test-plan #F4)
- [x] F5 self-applied `"Foo\nBar"`; pi sanitizes to `"Foo Bar"` · `session_info_changed{name:"Foo Bar"}` · normalized compare = self → NO push, auto-naming still active (test-plan #F5)
- [x] X2 `agent_settled` with no preceding `agent_end` · forward/reduce · clears `isAgentStreaming`, no crash (test-plan #X2)

### project_trust L1 (new `packages/extension/src/__tests__/project-trust.test.ts`; see `bridge-default-model-gate.test.ts` for decision-logic shape)
- [x] E5 3-bool matrix dashboardSpawned×headless×(eventCwd===activationCwd) · `project_trust` event · trust ONLY on T·T·T; other 7 rows defer (test-plan #E5)
- [x] X1 reading `eventCwd` from stale `ctx` throws · `project_trust` event · handler catches + defers, no crash/no trust (test-plan #X1)
- [x] X3 handler invoked BEFORE `session_start` handler · fire `project_trust` first · `activationCwd` already defined → gate compares real cwds not `undefined` (dead-on-arrival guard) (test-plan #X3)

### Reducer L1 (see `packages/client/src/lib/__tests__/event-reducer-streaming-text-flush.test.ts`)
- [x] F1 modern-pi stream `agent_start→agent_end→auto_retry→agent_start→agent_end→agent_settled` · reduce · `status="ended"` after each `agent_end`, `"idle"` ONLY after final `agent_settled` (test-plan #F1)
- [x] F2 floor-pi `agent_end`+synthesized `agent_settled` same batch · reduce · `status="idle"` resolved same batch; equals today's `agent_end`→idle (test-plan #F2)
- [x] F3 `agent_end` with provider error + pending retry · reduce · `lastError` extracted + `retryState`/`pendingPrompt` cleared on `agent_end`; only `status:"idle"` deferred (test-plan #F3)
- [x] E6 `session_compact{reason∈{manual,threshold,overflow}, willRetry:true, estimate:N}` · reduce · state stores each field exactly (test-plan #E6)

### Shared spawn L1 (see `packages/shared/src/platform/__tests__/runner-spawn-env.test.ts`)
- [x] E3 `sessionFlagsToArgv({name:""})` · build argv · NO `--name` token (test-plan #E3)
- [x] E4 `sessionFlagsToArgv({name:"x",sessionFile:"/s",fork:true,model:"m"})` · build argv · `--name x` + `--fork /s` + `--model m`; `--name` also on `--session` path (test-plan #E4)
- [x] E8 `sessionFlagsToArgv({name:'a "b" c'})` · build argv · name is a single argv element, verbatim (no split/injection) (test-plan #E8)

### Compaction-badge pure fn L1 (see any `event-reducer-*.test.ts`)
- [x] E7 label deriver(`reason∈{manual,threshold,overflow}`) · derive · returns {"manual","auto-threshold","overflow-retry"} (test-plan #E7)

### L3 Playwright (docker harness; see `tests/e2e/change-summary-table.spec.ts` for rendered, `tests/e2e/anthropic-bridge-activation.spec.ts` for headless spawn)
- [x] F6 state `reason:"threshold"`, reduction 12,400 · render context bar · visible badge `auto-threshold −12.4k` in DOM (test-plan #F6) — verified as a component render test (`packages/client/src/components/__tests__/ContextUsageBar.test.tsx`): the observable is a pure rendered-DOM assertion and the faux e2e harness has no seam to inject a metadata-bearing `session_compact` through pi.
- [x] F7 state with NO compaction metadata · render context bar · NO compaction badge in DOM; bar as today (test-plan #F7) — same file (component render test).
- [x] X4 headless RPC session spawned in resource-bearing (`.pi/`) untrusted cwd · dashboard spawns · session reaches ready/idle within harness timeout (auto-trusted, no stall) (test-plan #X4) — spec `tests/e2e/project-trust-headless-spawn.spec.ts` (opt-in via `PI_TRUST_SEED_CWD`; the untrusted-`.pi/` container trust-seed is the flagged non-blocking follow-up from the test-plan). Full decision logic verified by the project_trust L1 suite (E5/X1/X3).
