## Context

See proposal.md — Why. Verified state (two adversarial review rounds re-checked each line):

- Card status: `AgentToolRenderer.tsx:84-118` `mapStatus(details, status)` reads `toolDetails.status` first; unknown values (including `"failed"`) fall to `running`. Error branch (`:516-540`) shows `details.error`. It never reads `session.subagents` for status.
- Row and `toolCalls` go terminal only in the `tool_execution_end` arm (`event-reducer.ts:2560-2640`).
  - Heal guard: a `healedBy` end finalizes only a `running` `toolCalls` entry and is rejected when the entry is absent (`:2567-2575`).
  - A real end overwrites the row and strips `healedBy` (`:2628-2633`).
  - A healed end with `details` merges `{...row.toolDetails, ...endDetails, status}` (`:2606-2610`).
  - `result ? truncate(result) : row.result` (`:2637`), so an empty or undefined result keeps the last progress text.
- The `tool_execution_update` arm (`:2474-2545`) replaces `toolDetails` wholesale and overwrites `result` on every tick, with no terminal guard. Its subagent-map hydration never regresses a terminal subagent (`:2521-2526`).
- The `subagent_completed`/`subagent_failed` arm (`:3014-3043`) updates `session.subagents` only.
  - Data: `id`, `result`, `error`, `durationMs`, `tokens` (`{input,output}` object), `toolUses`, `details`; there is no `toolCallId`.
  - The link to the card is the row's `toolDetails.agentId`.
  - The arm early-breaks for a `healedBy` event on an already-terminal subagent.
- Measured live ordering (3 parallel agents, raw WS capture): `subagent_completed` arrives about 10 ms BEFORE the parent `tool_execution_end` on every call.
- The bridge tick throttle discards a held tick on `tool_execution_end`, not on `subagents:completed` (`subagent-tick-throttle.ts:20-25`). A trailing `running` tick can therefore land between the two.
- `agent_settled` (`:1796`) is pi's terminal settle per live run; `agent_end` fires per attempt.
  - Transcript replay (`packages/shared/src/state-replay.ts`) emits no `agent_settled` and no `subagent_*`. Its orphan-close emits `tool_execution_end{healedBy:"session_ended"}` for calls without a result, which may still be running.
  - The open change `preserve-agent-lifecycle-across-replay-gaps` will carry a gap's `agent_settled` to the head→tail boundary of a windowed replay.
- Background Agent calls end their tool call immediately (`toolDetails.status:"background"`, `openspec/specs/agent-tool-rendering/spec.md:28-30`), so they never stay running.
- Badges: `ToolCallStep.tsx:100-103` badges only `superseded` and `result_evicted`, although `subagent-live-timeline` already requires the recovered indicator for `session_ended` too.

## Goals / Non-Goals

**Goals:**
- A stopped subagent's card stops spinning as soon as a stop signal reaches the client.
- A card whose subagent is known to be finished stays finished.

**Non-Goals:**
- Recovering a shed end's authoritative body or timing (needs seq-gap backfill or a richer tool-result API; separate change).
- `currentTool` / session-status correctness for parallel calls.
- Finalizing non-`Agent` rows.
- The stale `agent_settled` wording in `event-reducer/spec.md:665-669`.

## Decisions

### D1. Heal by synthesizing an end through the existing end arm
A trigger reduces a synthetic `tool_execution_end` for the row's `toolCallId`. This reuses the running-only guard, the `toolCalls` transition, nested-call closing and real-end overwrite.
- *Alt: have `mapStatus` read `sub.status`.* Rejected: the burst header, the stale reconcile and `toolCalls` would still disagree with the card.

Synthetic event fields:
- `timestamp`: the TRIGGER event's timestamp (never `Date.now()`), so the same stream gives the same `duration`.
- `toolName: "Agent"`.
- `healedBy`: the trigger's own `healedBy` when present (e.g. the server's `session_ended` `subagent_failed`), else `"subagent_stopped"` / `"turn_settled"`.
- `isError`: true on failure.
- `details`: `{agentId, status, error?, durationMs?, toolUses?}`.
  - `status` uses the renderer's vocabulary: completed → `"completed"`, failed → `"error"`.
  - `tokens` is NOT copied: the card expects a display string there, and the subagent carries an object.
- `result`:
  - completed: `sub.result`, or the literal `SUBAGENT_DONE_NO_RESULT = "subagent finished"` when that is empty;
  - failed: the error text, or `"subagent failed"` when empty;
  - neutral settle: `SUBAGENT_STOPPED_SENTINEL_BODY = "subagent stopped — result not received"`.

  Never empty, so the end arm can't keep a stale progress line.

### D2. Eligibility
A row is eligible when it is a top-level `toolResult` row with `toolName === "Agent"`, row `toolStatus === "running"`, and a `toolCalls` entry that is `running`. Rows that are `elided`, backfilled without a `toolCalls` entry, or already terminal are skipped.

### D3. Subagent-stop trigger (two entry points)
- **(a)** In the `subagent_completed`/`subagent_failed` arm, after the existing subagent-state update and not when the existing early-break fires: finalize the eligible row whose `toolDetails.agentId` matches, newest first.
- **(b)** In the `tool_execution_update` arm: when a tick gives an eligible row an `agentId` whose subagent is already terminal in `session.subagents`, finalize it with the same helper. This covers the case where the stop arrived before the row learned its agent id.

### D4. Settle trigger
In the `agent_settled` arm, finalize every eligible Agent row.
- **Known terminal subagent** (via `toolDetails.agentId`): its status, result and error. Marker `turn_settled`, no badge.
- **Otherwise (neutral):** row `toolStatus: "complete"`, `toolDetails.status: "completed"`, sentinel body, marker `turn_settled`, `details.resultMissing: true`.
  - The `toolCalls` entry STAYS `running` (`awaitingRealEnd: true`). This is deliberate: the row stops spinning, but the existing stale reconcile (`useStaleToolReconcile.ts`, which selects running `toolCalls`) keeps probing `GET …/tool-result/:id`.
    - A 200 is applied as a real end (no `healedBy`); its apply guard already requires `tc.status === "running"`. It replaces the neutral body, removes the marker and `resultMissing`, and drops the badge.
    - 404s fall through to the existing supersede heal (2×404 + a later inference), which is semantically the same "recovered" outcome.
    - Whatever reads `toolCalls` running for other purposes is unaffected or desired: `hasLaterAssistantInference` and the stale reconcile want it; the burst header, the stop control and the card read the row.
  - The end arm's Agent backfill is skipped, so an unknown subagent is NOT recorded as completed.
  - Implementation: reduce the synthetic end, then restore that `toolCalls` entry to `running`, or have the helper write the row directly. Pick in implementation; spec-neutral.

### D5. A finished subagent's card can't be reopened
In the `tool_execution_update` arm, when the target is an `Agent` row whose `toolStatus` is not `running` AND either (a) `session.subagents` holds its agent id as `completed`/`failed`, or (b) the row's `healedBy` is `turn_settled` (a foreground call cannot outlive the settle, so a later `running` tick is stale):
- apply the tick as today (wholesale `toolDetails` replace, so the server's update-collapse premise "the newer update subsumes the older" still holds);
- then re-assert the row's terminal fields from before the tick: `toolDetails.status`, `healedBy`, `error`, `resultMissing`, and the row `result`.

Otherwise the update applies exactly as today. That includes the pre-existing behaviour where a replay orphan-close (`session_ended`) of a still-running call is reopened by a live tick; that half-terminal state is out of scope.
- Needs a MODIFIED delta to `agent-tool-rendering` "Structured partialResult handling".

### D5b. Real end clears heal-only fields
Wherever the end arm strips `healedBy` on a real end, it also strips `resultMissing` and an `error` that came from the heal, i.e. present only because the row was heal-marked. Done via a shared `HEAL_ONLY_DETAIL_KEYS` list.

### D5c. Resync cadence stops on a finalized card
`AgentToolRenderer`'s `useSubagentResyncCadence` `running` input additionally requires the row status to be `running` when relying on `sub?.status === "running"`. A neutral-healed card with an unknown subagent therefore stops polling.

### D6. Recovered indicator
`ToolCallStep` shows the existing recovered badge when `toolDetails.resultMissing === true` and no subagent result is known. Its tooltip says "Result not received — the subagent stopped but its result never reached this browser." The same helper also badges `healedBy:"session_ended"`, closing the existing gap against `subagent-live-timeline`. `subagent_stopped`, and `turn_settled` with a known result, carry the real result and get no badge.

## Risks / Trade-offs

- **[Stop signals are shed by the same gateway]** → the triggers cut latency when either signal survives. When end, completion and settle are all shed, nothing here helps; the existing stale reconcile and supersede heal still apply.
- **[Neutral settle heal]** → the row is terminal but its `toolCalls` entry stays running by design (D4), so the existing HTTP reconcile still recovers the authoritative result. This intentional row/map split is limited to `turn_settled` rows with `resultMissing`.
- **[Late `subagent_failed` after a neutral settle]** → the row stays green "completed" with the sentinel. The card already prefers `sub.result`, and the badge drops once a result is known. Since a foreground subagent ended before settle, this only happens with a delayed or replayed frame. Accepted.
- **[Contract: live vs transcript replay]** → transcript replay is a different event stream (no `subagent_*`, no `agent_settled`, synthetic orphan ends), so "same end state" across the two was never an invariant. The invariant kept is "same event stream → same state".
- **[Normal-path double transition]** → the subagent-stop heal lands about 10 ms before the real end, which then overwrites it. The burst flash fires once (on the burst's running→done edge); `duration` ends up as the real end's.
- **[Windowed replay with the carried `agent_settled`]** (once `preserve-agent-lifecycle-across-replay-gaps` lands) → head-segment Agent rows whose ends lie in the gap may be finalized neutrally instead of shown as running. Rows already stamped `elided` are excluded by D2. Coordinate in that change's tests.
- **[Agent id reuse]** → ids are per-spawn UUIDs and there is no resume path. Accepted.
