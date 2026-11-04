# Design

## Context

See proposal.md for the motivation. The current state:

- **Producer `@blackbelt-technology/pi-dashboard-subagents` 0.6.0** (published 2026-11-04):
  - `AgentDetails` carries `queuePosition`, `activeSlots` and `maxConcurrent` while queued, `slotGrantedAt` once running, and `stoppable` / `stopReason` (`extensions/events.ts:125-135`).
  - It listens for `subagents:stop { agentId }` (`extensions/agent.ts:741-792`). A queued subagent is removed without a slot; a running one aborts only that child. Either ends `status: "stopped"` with `stopReason` on `subagents:completed`, with a non-error tool result. The first reason wins against a parent abort.
  - Queue changes re-push one queued frame per waiter per task. A changed `maxConcurrent` applies to waiters within about 1 s. Granting is FIFO-fair, and the limit is clamped to 0–64.
  - Earlier producers send only `status` and `durationMs`.
- **Renderer.** `packages/subagents-plugin/src/client/AgentToolRenderer.tsx:101-104` maps `queued` to `running`, and `:481` renders both through `AgentCardShell status="running"`.
- **Finalizer.**
  - `packages/subagents-plugin/src/client/toolRowFinalizer.ts:132` maps every `subagent_completed` to `completed`, and `isTerminal` (`:65-66`) knows only `completed|failed`. `finalizeRowFromSubagent` synthesizes a `tool_execution_end` without the producer status.
  - `SubagentState.status` (`packages/shared/src/dashboard-plugin/subagent-types.ts:47`) has no `stopped`.
  - Core forces `completed` on healed ends (`packages/client/src/lib/chat/event-reducer.ts:2731-2741`).
- **Row.**
  - `packages/client/src/components/chat/ToolCallStep.tsx:66` limits `status` to `running|complete|error|elided`.
  - Stop goes through `useToolStopState({onAbort})` (`:160`), and a burst `stopController` wins over the row's own (`:95`, `ToolBurstGroup.tsx:336,414`).
  - The session abort is `handleAbort` (`useSessionActions.ts:77`).
- **Claim predicate precedent.** `resultPending` is wired in `packages/dashboard-plugin-runtime/src/vite-plugin/index.ts:512,542,600`, `packages/client/src/lib/plugins/runtime-plugin-loader.ts:37,194` and `packages/shared/src/dashboard-plugin/manifest-types.ts:228`, and evaluated exception-safely at `ToolCallStep.tsx:40-50`.
- **Relay.**
  - `ServerPluginContext.emitEventToSession` (`packages/dashboard-plugin-runtime/src/server/server-context.ts:149-153`) becomes bridge `plugin_emit_event`, then `pi.events.emit` (`packages/extension/src/bridge-handlers/dispatch.ts:388-395`).
  - The seam refuses event types not in the manifest `emits` (`packages/server/src/plugin-event-seam.ts`) and requires plugin `priority <= 100` (`:116`); the subagents plugin is `100`.
  - The bridge forwards `subagents:*` only via `SUBAGENT_EVENT_MAP` (`packages/extension/src/flow-event-wiring.ts:96-101`), so `subagents:stop` is not echoed back.
  - Operate authority is `ctx.identity?.hasOperateAuthority` (`server-context.ts:1317,1366-1372`, usage `packages/obs-studio-plugin/src/server/index.ts:60`), and the session lookup is `ctx.sessionManager.getSession`.
- **Settings mirror.** `packages/subagents-plugin/src/server/producer-file.ts` and `server/index.ts` mirror `inheritContext` to the producer settings file. `SubagentsSettings.tsx` registers `useSettingsDraftSource({ id: "plugin:subagents", isDirty, commit, reset })`, which is the global save state.
- **Admission gate (to remove).**
  - `maxConcurrentSubagents` (default 2, `packages/shared/src/config.ts:1769`) drives `FanoutAdmissionGate` (`packages/extension/src/subagent-fanout-admission.ts`, wired at `bridge.ts:1925-1944`). It *refuses* calls in pre-execution, is read once per bridge (`bridge.ts:973`), and narrows to 1 under saturation.
  - It came from `bound-subagent-fanout-under-host-pressure`, which could not touch the producer.
- **Harness.** `docker/Dockerfile:134` pins `PI_DASHBOARD_SUBAGENTS_VERSION=0.5.0`.

## Goals / Non-Goals

**Goals:**
- Surface the producer's queue info, stop and limit in the dashboard.
- Have one subagent concurrency limit.
- Keep core subagent-agnostic.

**Non-Goals:**
- Queue reordering.
- A generic `abortToolCall` for arbitrary tools.
- Changing the composer Stop or the burst-group header stop.
- A collapsed queue strip (mockup variant C was rejected).

## Decisions

### D1. Producer fields drive the queued card; older producers degrade
- **Queued card:** reads `queuePosition`, `activeSlots` and `maxConcurrent` directly. It shows the slot reading only when both slot fields are present and `maxConcurrent > 0`. Without `queuePosition` it shows `Queued`.
- **Timers:** wait time is the ticked `durationMs` while queued. Run time is `now - (slotGrantedAt ?? startedAt-equivalent)`, which falls back to today's `durationMs` timer.
- *Alternative:* derive the position client-side. Rejected now that the producer sends it.

### D2. Generic claim seams `rowStatus`, `stop`, `stopLabel`
All three are named-export refs, wired like `resultPending` (codegen, loader, `manifest-types.ts`).
- `rowStatus(toolDetails, session) => { state: "queued" | "stopped"; label?: string } | undefined`:
  - `queued` applies only to a running row (static clock, label in place of `ElapsedBadge`);
  - `stopped` applies only to a non-error terminal row (neutral stop glyph in place of the check);
  - error and elided rows are never overridden.
- `stop({ sessionId, toolCallId, toolDetails }) => boolean` is consulted **before** `onAbort` and before an enclosing burst `stopController`. `true` consumes the click; otherwise today's path runs. `stopLabel(toolDetails) => string | undefined` supplies the accessible label.
- Every call is wrapped in try/catch and logged once per plugin, following `ToolCallStep.tsx:45-50`.
- *Alternative:* let the plugin draw its own row. Rejected, because the row chrome is core-owned and shared by every tool.

### D3. Stop request path
- **Manifest:** `packages/subagents-plugin/package.json` declares `"emits": ["subagents:stop"]`.
- **Route** `POST /api/plugins/subagents/stop {sessionId, agentId}`:
  - `ctx.identity?.hasOperateAuthority?.(req) === true`, else 403;
  - both ids are non-empty, at most 128 characters and contain no control characters, else 400;
  - `ctx.sessionManager.getSession(sessionId)` exists, else 404;
  - `emitEventToSession(sessionId, "subagents:stop", { agentId })`: the type is fixed and only that key is forwarded; a `false` return gives 503;
  - each request is logged with its outcome.
- **Client handler:** the claim `stop` returns `false` unless `toolDetails.stoppable === true` and `agentId` is set. Otherwise it starts the POST and returns `true`.
- **Feedback** is the plugin's own: "stopping…" until the terminal frame; on a non-2xx, an inline reason and the control re-enabled; after 10 s with no terminal frame, "stop not confirmed" and the control re-enabled. There is **no** fallback to a session abort, because silently escalating to "kill everything" is worse than a visible failure.
- *Alternatives:* a core WS message (rejected because it puts subagent knowledge in core), or `registerBrowserHandler` (rejected because the plugin kit has no client WS-send API).

### D4. `stopped` through every terminal path
- `SubagentState.status` gains `"stopped"`, plus optional `stopReason` and the queue fields.
- Every site keyed on `completed|failed` treats `stopped` as terminal: snapshot eviction, the bridge frame buffer bound, resync, `agentSessionId` dual-index, backfill, live-tick revival, turn settle and the finalizer (spec delta `subagent-live-detail-reliability`).
- A later heal (`healedBy:"session_ended"`) must not override `stopped` on the row; this is guarded by a test.
- The UI never shows "stopped by you" when the parent abort won the race. The subagent then ends `aborted` and renders as it does today.
- Any terminal frame for the agent clears a pending "stopping…" or "stop not confirmed" state, including one that arrives late.
- `toolRowFinalizer`:
  - maps `subagent_completed` with `details.status === "stopped"` to `stopped`;
  - adds `stopped` to `isTerminal`, so `settleLateTick` cannot reopen it;
  - passes `status` and `stopReason` into the synthesized end's details, so a row healed before the real end shows stopped, not a check.
- The dock, detail view and popout render `stopped` neutrally.
- The producer ends a stop with a real `tool_execution_end`, which `session-end-orphan-heal` never reopens.

### D5. "Max parallel subagents" setting on the global save state
- **Schema:** `configSchema.json` gains `maxConcurrent` (integer, 0 to 64, default 4), and its description covers both keys.
- **Reconcile:** startup reconcile clamps the producer-file value to 0–64, matching producer 0.6.0. A file holding 100 shows 64, and the file is not rewritten unless the user saves.
- **Write-through:** mirrors `maxConcurrent` only when it is explicit in the persisted plugin config, so an unrelated save never writes a default over a hand-set value.
- **Draft:** `useSettingsDraftSource({ id: "plugin:subagents" })` becomes `{ inheritContext, maxConcurrent }`:
  - per-field baseline and an OR'd `isDirty`;
  - `reset` restores both;
  - `commit` posts both keys in one `POST /api/config/plugins/subagents`. While the field is invalid, `commit` throws (precedent: `SubagentsSettings.tsx:58-88`): this section's save fails with the inline error and writes nothing, while other dirty sections still commit, because the host draft API has no validate hook (`settings-draft-context.tsx:23-46`).
  There is no section save button and no write-on-change.
- **Heap warning:** read-only `GET /api/plugins/subagents/limits` returns `heapCeilingMb` (`sessionHeap.maxOldSpaceMb` via `loadConfig()`, precedent `packages/automation-plugin/src/server/automation-schema.ts:13,253`). The field warns when `subagentHeapBudget(heapCeilingMb, value).warn` is true, or when `value === 0` with a ceiling set.
- **Help text:** "Applies immediately, including to waiting subagents." This relies on producer 0.6.0's live limit.

### D6. Remove the admission gate
- **Extension:** delete `subagent-fanout-admission.ts` and `subagent-saturation.ts` (its only user) with their tests. Remove their `tool_call` registration and sampler (`bridge.ts`), `inst.fanoutAdmission` (`bridge-handlers/instance.ts`) and the heartbeat counters (`bridge-handlers/lifecycle.ts:924`). Repoint `pi-version-tracker.test.ts:407`, which reads the deleted file from disk.
- **Shared config:** remove `maxConcurrentSubagents`, `DEFAULT_MAX_CONCURRENT_SUBAGENTS`, `resolveMaxConcurrentSubagents` and `subagentSaturation` from `packages/shared/src/config.ts`. A leftover key in `config.json` is ignored.
- **Heap limits:** rename the `subagentHeapBudget` parameter to `maxConcurrent` (`heap-limits.ts`), keeping the formula.
- **Event groups:** **keep** the `diagnostics` group (`custom-event-groups.ts`, `custom-event-groups` spec). Old transcripts still contain `subagent-admission-refused` entries, and the group keeps hiding them by default. No new entries are written. Only its comment changes. The `custom-event-groups` requirements stay true, since the type still occurs in old transcripts, so that spec needs no delta.
- **Settings and tests:** remove the Settings → Sessions field, its validation, its heap warning and its `hu` / `zh-CN` i18n keys (`settings.maxConcurrentSubagents`, `settings.subagentCap.*`, the heap-coupling hint).
  - Delete `tests/e2e/subagent-fanout-admission.spec.ts`, `subagent-fanout-measurement.spec.ts` and the shared `config-subagent-admission.test.ts`.
  - Update `config-heap-limits.test.ts`, `settings-heap-fields.test.tsx` and `session-heap-settings.spec.ts` (#E24) to the producer limit.
  - Prune `scripts/test-selection/timings.json` and the AGENTS rows.
- **Docs:** `docs/heap-limits.md`, `docs/architecture.md`, `docs/faq.md`, `docs/security/tool-call-guards.md` (TOOL-17), `docs/security-map.md` and `docs/research/unified-context-manager-exploration.md`, plus their sidecars. The `CHANGELOG.md` history stays as it is.
- **In-flight changes:** `add-supervised-tool-approval` (gate ordering, permit window) and `unify-context-manager` reference the admission gate. Their owners are told, and their artifacts are updated when this change merges first.
- **Completeness gate:** `git grep` over `packages docs tests qa scripts docker` for the removed symbols (`maxConcurrentSubagents`, `FanoutAdmissionGate`, `fanoutAdmission`, `resolveAdmissionConfig`, `decideAdmission`, `subagentCap`, `subagent-saturation`, `SaturationSampler` and the like) returns nothing, except the one leftover-key config test. The base `openspec/specs` change at archive through this change's deltas; `CHANGELOG.md` keeps its history.
- **Why it is safe:**
  - The producer semaphore (default 4, clamped to 64) bounds running children and queues the rest.
  - The heap warning moves to the field that bounds them.
  - The tick throttle from the same incident stays.
  - What is lost is the automatic narrowing to 1 under host saturation. Constrained hosts lower the limit instead.
- *Alternative:* keep only the saturation narrowing. Rejected, because it needs a cap and fails calls the producer would have queued.

### D7. Visuals and harness
- **Visuals:** `--severity-neutral-{bg,fg,border}` (`packages/client/src/index.css:212-214`) for the queued and stopped cards, with a dashed border while queued. Add a `queued` clock icon to `statusIconDefs` (`packages/client-utils/src/agent-card-utils.ts`). No raw colours (`scripts/theme-token-guard.mjs`).
- **Harness:** bump `docker/Dockerfile` `PI_DASHBOARD_SUBAGENTS_VERSION` to `0.6.0`, so the L3 scenarios run against the real producer.

## Risks / Trade-offs

- [Effective default rises from 2 (admission) to 4 (producer) for users who never changed it] → `floor(512/5)=102` MB per child stays at or above the 100 MB guidance, so no heap warning. Users on constrained hosts lower the limit. CHANGELOG states it.
- [Losing saturation narrowing could re-expose the fan-out stall on loaded hosts] → The default limit is 4, the heap warning is on the field, and the tick throttle stays. Docs tell constrained hosts to lower the limit.
- [Users relying on `maxConcurrentSubagents`] → The key is ignored. CHANGELOG (BREAKING) and FAQ point to the plugin field.
- [Stop click races with completion] → The producer resolves it (first reason wins, a terminal stop is a no-op, logged as ignored). The route cannot tell stopped from ignored, so the UI relies on the terminal frame, and an ignored stop on an already-finished agent clears as soon as its terminal frame is present.
- [The relay as an event injector] → The type is fixed, only `agentId` is forwarded, the emit allowlist applies, and operate authority is required.
- [The plugin API surface grows] → The fields are optional, ignored by older hosts, and documented in the slot taxonomy.

## Migration Plan

Ship the dashboard. Producer 0.6.0 is recommended; older producers degrade (D1, D3). A leftover `maxConcurrentSubagents` key is ignored. Rollback: revert, which restores the gate with whatever value is still in the config.
