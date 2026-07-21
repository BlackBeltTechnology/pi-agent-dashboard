## Why

The pi dependency was bumped `0.80.6 → 0.80.10` in `align-pi-080.10` — a mechanical dep/lockfile/docker bump that deliberately adopted **none** of the runtime feature surface pi accrued since the last real adaptation (`adopt-pi-071-072-073-features`, which stopped at pi 0.73). Between pi **0.74 and 0.80.10** a set of extension events and spawn flags shipped that the dashboard could consume but does not. This change closes that gap for the pieces that are (a) not already shipped and (b) low-risk-additive, matching the bundling precedent set by `adopt-pi-071-072-073-features`.

> **Scope note (post doubt-review).** An adversarial cross-model review of the first draft caught two mis-scoped pieces and they were removed: **`streamingBehavior` on input events is already shipped** (`surface-input-streaming-behavior` — `event-reducer.ts` already consumes `InputEvent.streamingBehavior`), and **RPC `get_entries`/`get_tree` hydration was dropped** — the RPC keeper is a fire-and-forget "dumb wire" that pipes pi's stdout to `/dev/null`, so response correlation would require a new stdout pipe + framing + reader (a much larger, riskier change). That work is deferred to its own future change (`adopt-pi-rpc-tree-hydration`). This proposal covers the five remaining low-risk adoptions.

**Version-gating model (not "no guard").** The floor is `0.78.0` and the pin is `0.80.10`. Some adopted events are *above the floor* — `agent_settled` is 0.80.4, `session_info_changed` is 0.80.3 — so a user on pi 0.78.0–0.80.3 will not receive them. Adoption is therefore **field/event-presence-gated**: when the event is absent, behavior is byte-identical to today. For `agent_settled` specifically the absence spans the entire sub-0.80.4 floor range, so a fallback path is **load-bearing**, not a rare edge (see design §1). The dashboard's own bundled pi is 0.80.10 (all events present); the gating protects users running an older floor-compatible pi.

The five pieces, grouped by where they land:

**Bridge event adoptions** (`packages/extension/src/`):

1. **`agent_settled` — accurate truly-idle signal** (pi 0.80.4). The bridge tracks streaming/idle via `agent_start`/`agent_end` plus a `cachedCtx.isIdle()` bounded-retry poll (`bridge.ts`). `agent_end` fires at the end of *one agent run* — retries, auto-compaction, and queued follow-ups can still be pending. pi 0.80.4 added `agent_settled` (verified: `agent-session.js::_emitAgentSettled` sets `_isAgentRunActive=false` and emits) that marks the run fully settled. Adopting it lets the dashboard mark a session "truly idle" without the premature-idle flicker `agent_end`-driven state produces during a retry/compact — **when the event is present**; a fallback covers floor-pi (design §1).

2. **`session_info_changed` — push renames without self-locking** (pi 0.80.3). The bridge's `auto-session-namer.ts` detects *external* renames by polling `pi.getSessionName()` on each terminal turn and distinguishing self-applied from external via `classifyNameChange(observed, lastSelfApplied)`. pi 0.80.3 added `session_info_changed` (verified: emitted inside `setSessionName`, payload `{type,name}` — **no provenance**). Because the bridge's own `pi.setSessionName(...)` auto-name *also* fires this event, the adoption MUST run the event-derived name through the same `classifyNameChange` self-vs-external filter before pushing — routing it blindly through `onObservedName` (which unconditionally sets `nameSource:"user"` + hard-stop) would permanently lock out the bridge's own auto-naming on its first name. Correctly filtered, the event lets the bridge push an *external* rename the moment it happens instead of waiting for the next turn boundary; self-applied echoes are ignored.

3. **`project_trust` — unblock headless RPC sessions** (pi 0.79.0/0.79.1). Dashboard-spawned headless RPC sessions run in user-selected dirs, yet pi may raise a `project_trust` decision at startup/cwd-switch that a no-UI headless session cannot answer → the session can stall (pi's `resolveProjectTrusted` falls through to `false` for a no-UI session that leaves the decision unhandled). pi 0.79.0 added a `project_trust` extension event (verified: `types.d.ts`, `runner.js`). A bridge handler can auto-decide trust **narrowly** for dashboard-spawned headless sessions still in their original spawn cwd. The bridge already knows `dashboardSpawned` (from `PI_DASHBOARD_SPAWN_TOKEN`) and the live `ctx.cwd`; the handler captures the initial cwd at register and trusts only while `ctx.cwd` equals it (policy + threat model in design §2). `isHeadlessRpcSession` already exists in `bridge-context.ts`.

**Server spawn adoption** (`packages/shared/` + `packages/server/`):

4. **`--name` at spawn** (pi 0.78.0, verified present: `dist/cli/args.js:53`, `--name, -n <name>`). The dashboard spawns then auto-names post-hoc. When the spawn already knows an intended name (worktree/flow spawns), passing `--name` sets it at creation — no naming round-trip, no transient "Untitled" card. The flag is emitted by `sessionFlagsToArgv` in **`packages/shared/src/platform/spawn-mechanism.ts`** (the definition; `process-manager.ts` only imports it) and requires a `name` field on the `SessionFlags` type there.

**Client UI adoption** (`packages/client/src/`):

5. **Compaction `reason` / `willRetry` + post-compact token estimate** (pi 0.79.8/0.79.10). `session_compact`/`session_before_compact` now carry `reason` (`manual`/`threshold`/`overflow`) and `willRetry`, and compaction results carry an estimated post-compaction token count. The bridge already forwards `session_compact` (fields auto-serialize through `event-forwarder.ts`), but nothing consumes them. The compaction affordances (`ContextUsageBar.tsx` / `SessionActivityBar.tsx`) can show *why* a compaction happened and the approximate context reduction.

Each piece is small and defensive: a missing pi field falls through to today's behavior. Adoptions 1–2, 5 are additive event handling; 3 is a narrow policy decision (design §2); 4 is a one-field spawn-flag addition.

## What Changes

### Phase A — Bridge event adoptions

#### A.1 `agent_settled` truly-idle signal (bridge-normalized)
- **MODIFY** `packages/extension/src/bridge.ts`: add `"agent_settled"` to the enriched-event subscription list. Forward the real event and set `getBridgeState().isAgentStreaming = false`. On floor pi that does NOT emit it natively (pi < 0.80.4, from the version the bridge already sends in `session_register`), **synthesize** an `agent_settled` synchronously right after each forwarded `agent_end` — so the reducer always sees exactly one terminal `agent_settled` per run regardless of pi version. No `session_register` capability field, no reducer version logic (design §1).
- **MODIFY** `packages/client/src/lib/event-reducer.ts`: one uniform new arm — `agent_end` → the existing (currently-unassigned) `status:"ended"`; `agent_settled` (real or bridge-synthesized) → `"idle"`. No new `status` value; only `"streaming"` gates the spinner so `"ended"` turns it off exactly like `"idle"` does today. On floor pi the synthetic settle lands in the same dispatch batch, so the outcome is byte-identical to today's `agent_end`→idle. Preserve the existing `agent_end` side-effects (lastError extraction, retryState/pendingPrompt clearing) — only the `status="idle"` line moves to the settle arm.
- **NEW** tests: bridge forwards real `agent_settled`; bridge synthesizes one after `agent_end` on floor pi; reducer holds non-idle across `agent_start→agent_end→retry→agent_start→agent_end→agent_settled`; floor-pi synthetic path resolves idle equivalently to today.

#### A.2 `session_info_changed` push renames (self-filtered)
- **MODIFY** `packages/extension/src/bridge.ts`: register `pi.on("session_info_changed", ...)` (try/catch). On the event, call the existing `autoNamer.onObservedName(name)` — it already runs `classifyNameChange` internally and reports (via `reportUserRename`) ONLY when external, applying the same permanent-lockout semantics as the turn-end poll. No new namer API is needed (the first draft's `lastSelfApplied` export was over-coupled).
- **MODIFY** `packages/extension/src/auto-session-namer.ts`: normalize the recorded `lastSelfApplied` with pi's own sanitization (`replace(/[\r\n]+/g, " ").trim()`) so a multi-word title containing a newline still classifies as self when it echoes back through `session_info_changed` (pi sanitizes the name before the event carries `getSessionName()`); without this, the self-echo would false-classify external and self-lock the auto-namer.
- **NEW** tests: external rename → one push + lockout; the bridge's OWN auto-name (incl. a newline-bearing title) echoing back → NO push, auto-naming still active.

#### A.3 `project_trust` headless auto-decision (narrow, activation-cwd)
- **NEW** `packages/extension/src/project-trust.ts`: a handler that trusts (per-run) ONLY when `dashboardSpawned === true` AND `isHeadlessRpcSession(...)` AND `eventCwd === activationCwd`; otherwise defers. `eventCwd` is read from the handler's own per-event `ctx` argument inside try/catch (never `cachedCtx` — `ctx.cwd` throws after session replacement); a throw defers. Policy + threat model in design §2.
- **MODIFY** `packages/extension/src/bridge.ts`: capture `activationCwd = process.cwd()` at **activation** (NOT `session_start` — `project_trust` fires during resource-loader reload, before `session_start`, verified `resource-loader.js:222`); register the `project_trust` handler at activation (try/catch; no-op on older pi).
- **NEW** tests: headless + dashboardSpawned + `eventCwd===activationCwd` → trust; interactive/TUI → defer; headless with changed `eventCwd` → defer; non-dashboard-spawned → defer; `ctx.cwd` throw → defer.

### Phase B — Server spawn adoption

#### B.1 `--name` at spawn
- **MODIFY** `packages/shared/src/platform/spawn-mechanism.ts`: add `name?: string` to `SessionFlags`; `sessionFlagsToArgv` emits `["--name", flags.name]` when set (composes with existing `--session`/`--fork`/`--model`).
- **MODIFY** the server spawn call sites that already know an intended name (worktree/flow spawns) to populate `name`.
- **MODIFY** `packages/shared/src/platform/__tests__/spawn-mechanism.test.ts`: assert `--name` emission and non-emission.
- **NEW/UPDATE** integration test: the flag reaches `spawnKeeperFor` argv.

### Phase C — Client compaction UI

#### C.1 Compaction reason / willRetry / post-compact estimate
- **MODIFY** `packages/client/src/lib/event-reducer.ts`: capture `reason`, `willRetry`, and the estimated post-compaction token count from `session_compact` into session state (absent → unchanged).
- **MODIFY** `packages/client/src/components/ContextUsageBar.tsx` (and/or `SessionActivityBar.tsx`): show a compaction annotation — reason label (manual / auto-threshold / overflow-retry) and the approximate post-compaction reduction. Missing fields → today's bar.
- **NEW** tests: reducer stores the three fields; bar renders reason + reduction; absent fields render unchanged.

## Capabilities

### New Capabilities
(none — all work modifies existing capabilities)

### Modified Capabilities
- `bridge-extension`: subscribes to `agent_settled` (and synthesizes one after `agent_end` on floor pi that lacks it) and `session_info_changed` (self-filtered via the existing `autoNamer.onObservedName`); registers a narrow `project_trust` handler for dashboard-spawned headless sessions still in their activation cwd.
- `event-reducer`: session idle transition keys uniformly off `agent_settled` (real or bridge-synthesized) — `agent_end`→ended-pending-settle, `agent_settled`→idle; captures compaction `reason`/`willRetry`/post-compact token estimate.
- `headless-spawn`: `sessionFlagsToArgv` (in `shared/platform/spawn-mechanism.ts`) emits `--name` when a spawn carries an intended session name.
- `context-usage-bar` (and/or `session-activity-bar`): renders compaction reason + approximate post-compaction reduction.

## Impact
- **Files**: ~7 source files modified, 1 new (`project-trust.ts`), ~8 new/updated test files.
- **LOC**: A.1 ~40 (bridge synth + one reducer arm) · A.2 ~30 · A.3 ~65 · B.1 ~15 · C.1 ~40 ≈ **~190 LOC**.
- **Risk**:
  - A.1 touches the hot `event-reducer` idle path — the bridge normalizes to one terminal `agent_settled` per run (synthesizing on floor pi) so the reducer needs no version logic and floor-pi behavior is byte-identical; existing status-banner/retry tests MUST pass. No-flicker holds by construction (`agent_settled` fires once per run after the retry/compact loop drains, verified in pi source).
  - A.2's self-filter is the load-bearing correctness point (avoids the auto-namer self-lockout the review caught); covered by an explicit self-echo test.
  - A.3 makes a trust *decision* → security-sensitive. Policy is narrow (dashboardSpawned + headless + unchanged captured cwd) and defers otherwise; design §2 + a security-hardening pass + the defer tests cover it. Note: pi auto-trusts bare cwds (no `.pi`/resources) itself before emitting the event, so the handler only fires for resource-bearing cwds.
  - B.1 is a small additive flag in shared; unnamed spawns unchanged.
  - All adoptions are field/event-presence-gated: absent pi field/event → today's behavior.

## Out of Scope
- **`streamingBehavior` on input events** — already shipped (`surface-input-streaming-behavior`); nothing to do.
- **RPC `get_entries`/`get_tree` hydration** — deferred to its own change (`adopt-pi-rpc-tree-hydration`): the keeper is a fire-and-forget dumb wire (stdout→`/dev/null`), so correlation needs a new stdout pipe + newline-JSON framing + non-JSON tolerance + reconciliation with `PI_KEEPER_CAPTURE_PI_OUTPUT`. Too large/risky to bundle here.
- Extension-authoring niceties not needed by the dashboard (`before_provider_headers`, entry renderers, `InlineExtension`, `--exclude-tools`, `ctx.mode`, `ctx.getSystemPromptOptions()`). `--exclude-tools` may be added later as a spawn option.
- The 0.80.8 SDK `ModelRuntime` migration — the dashboard never imports pi's SDK `AuthStorage`/`ModelRegistry`; verified out of scope in `align-pi-080.10`.
- `piCompatibility` floor changes — the floor series owns that.
- Kimi/xAI/Fable/Sonnet-5 model-metadata items — inherited via the dep bump, no dashboard work.

## Discipline Skills
- `security-hardening` — A.3 `project_trust` auto-decision touches a trust boundary; threat-model the narrow "auto-trust captured spawn cwd" policy before it stands.
- `doubt-driven-review` — A.3 (trust decision) is the high-stakes step; stress-test before commit (cycle-1 already run at planning time; re-run on the implemented handler).
- `review-code` — every non-trivial bridge/reducer change before commit.
