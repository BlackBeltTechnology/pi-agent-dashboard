# Test Plan — restore-ask-user-tool-state-on-reconnect

Stage: design   Generated: 2026-08-05

One clarification was raised at the HARD gate and resolved before this catalog was written: the replay-exit recompute was unimplementable as specified (the fold had already overwritten the value it needed to preserve). Resolution: the fold applies to **live events only**. Rows R1–R4 below exist to pin that boundary.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | gateway read accessor | EP | L1 | automated | registry with 1 tracked prompt for `s1` | call `hasPendingPromptRequests("s1")` | returns `true` |
| E2 | gateway read accessor | BVA (empty boundary) | L1 | automated | registry where `s1`'s last prompt was just cleared | call `hasPendingPromptRequests("s1")` | returns `false`, and the session's inner map is deleted (no empty-map leak) |
| E3 | gateway read accessor | EP (never-seen) | L1 | automated | registry with no entry for `s9` | call `hasPendingPromptRequests("s9")` | returns `false`, no map allocated |
| E4 | precedence: live tool wins | decision-table | L1 | automated | `hasPendingPrompt: true` | extract `tool_execution_start{toolName:"bash"}` | update is `{currentTool:"bash"}` — registry not consulted |
| E5 | precedence: fold on empty | decision-table | L1 | automated | `hasPendingPrompt: true` | extract `agent_start` | update is `{status:"streaming", currentTool:"ask_user"}` |
| E6 | precedence: fold on empty | decision-table | L1 | automated | `hasPendingPrompt: true` | extract `agent_end` | update is `{status:"idle", currentTool:"ask_user"}` — status/tool pair now legal |
| E7 | precedence: fold on empty | decision-table | L1 | automated | `hasPendingPrompt: true` | extract `tool_execution_end` | update is `{currentTool:"ask_user"}` |
| E8 | R9 byte-identical | decision-table (negative half) | L1 | automated | `hasPendingPrompt: false`, each of the 5 handled event types | extract each | every update deep-equals the pre-change output |
| E9 | multi-prompt collapse | BVA (2→1 boundary) | L1 | automated | session with 2 tracked prompts | `prompt_cancel` clears one | `currentTool` stays `"ask_user"` |
| E10 | clear on last resolve | BVA (1→0 boundary) | L1 | automated | session with 1 tracked prompt, `currentTool:"ask_user"` | `prompt_dismiss` clears it | `currentTool` is `null` — literal `null`, not `undefined` |
| E11 | clear never stomps a tool | decision-table | L1 | automated | session with `currentTool:"bash"`, 1 tracked prompt | `prompt_dismiss` empties registry | `currentTool` remains `"bash"` |
| E12 | flow-raised prompt counts | EP | L1 | automated | session with no `ask_user` tool call, any `placement` | `prompt_request` arrives | `currentTool` becomes `"ask_user"`; no placement gating applied |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | R2 survives reconnect | state-transition (legal edge) | L1 | automated | session blocked on `ask_user`, 1 tracked prompt | replay `session_register` → `prompt_request` → `replay_complete` → synthetic `agent_start`, in that order | converges to `{status:"streaming", currentTool:"ask_user"}` |
| F2 | D2 ordering invariant | state-transition (illegal edge) | L1 | automated | same as F1 | the same four messages with `prompt_request` and `agent_start` **transposed** | converges to `currentTool:"ask_user"`, and the test documents the one spurious unread+reorder this ordering costs — pinning the bridge dependency |
| F3 | R5 no re-fire | state-transition | L1 | automated | session already at `currentTool:"ask_user"`, not viewed | synthetic `agent_start` arrives | unread flag unchanged; **no** `sessions_reordered` broadcast |
| F4 | R5 new prompt fires once | state-transition | L1 | automated | live session, `currentTool:null`, not viewed, `questionFirst` on | `prompt_request` arrives | marked unread exactly once **and** moved to front exactly once |
| F5 | R5 inverted arrival | state-transition (illegal edge) | L1 | automated | live session, `currentTool:null`, not viewed | `prompt_request` **then** `tool_execution_start{ask_user}` | triggers fire exactly once total, not zero and not twice |
| F6 | card reflects restored state | state-convergence | L3 | automated | harness session parked on `ask_user` | restart the dashboard server so the bridge re-registers | card converges to the "Needs you" label with input-stripes; header no longer reads "Thinking…" while the prompt dialog is rendered |
| F7 | D7 flow-prompt label | state-convergence | L3 | automated | harness session with a widget-bar-placed prompt and no `ask_user` tool call | prompt raised | card shows `⚡ ask_user`, not `Idle` — the accepted D7 outcome, asserted so it cannot regress silently |
| F8 | card clears on answer | state-transition | L3 | automated | harness session showing "Needs you" | answer the prompt in the dashboard | card leaves the needs-you state and `currentTool` clears |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | R3 recover from lost clear | fault-injection (drop) | L1 | automated | `prompt_dismiss` never delivered, leaving a stale registry entry | bridge reconnects and re-sends **no** `prompt_request` for it | at the replay exit the entry is dropped and `currentTool` becomes `null` |
| X2 | R3 retain still-pending | fault-injection (partial) | L1 | automated | 2 tracked prompts, only 1 re-sent | replay exit | the re-sent one is retained, the other dropped; `currentTool` stays `"ask_user"` |
| X3 | both exits reconcile | fault-injection (message loss) | L1 | automated | `replay_complete` never arrives | the 5s replay safety timeout fires | reconcile **and** recompute run on that path; a stale entry does not survive |
| X4 | two exits cannot race | race / interleaving | L1 | automated | safety timeout fires at T, late `replay_complete` at T+1s, a live `prompt_request` arrives between them | both exits run | the in-between prompt is **not** dropped; the second exit is a no-op |
| X5 | no duplicate replay | race / interleaving | L1 | automated | same interleaving as X4 | both exits run | subscribers receive exactly one `event_replay` — requires guarding `replay_complete` the way the timeout already is |
| X6 | live registry survives drain | fault-injection (state loss) | L1 | automated | session with a genuinely pending prompt | replay exit drains the collected set | the live registry keeps the entry; a browser refreshing afterwards still receives the prompt |
| X7 | registry cleared on death | resource-leak | L1 | automated | session holding a tracked prompt | session unregistered | `hasPendingPromptRequests` returns `false`; other sessions' prompts untouched |
| X8 | pre-existing UI-request leak | resource-leak | L1 | automated | session holding a tracked **extension-UI** request | session unregistered | `hasPendingUiRequest` returns `false` and the session becomes reapable — closes a leak live in production today |
| X9 | R11 idle gear | decision-table | L1 | automated | at-rest ephemeral session past idle timeout, PromptBus prompt tracked, `currentTool` forced to `null` | idle gear verdict evaluated | `skip("pending-ask")` — the veto does not depend on `currentTool` |
| X10 | R11 phantom gear | decision-table | L1 | automated | streaming ephemeral session past the hard ceiling, ~0-CPU, no children/subscriber, PromptBus prompt tracked | phantom force-reap evaluated | not reaped — `streamingGearVerdict` consults the union, which `currentTool` alone would not cover |
| X11 | R11 no regression | decision-table | L1 | automated | session with only a `pendingUiRequests` entry | both gears evaluated | pending-ask stays `true` exactly as before the union |
| X12 | R11 negative case | decision-table | L1 | automated | session with neither registry populated | both gears evaluated | verdicts identical to pre-change |

### Replay-boundary (the resolved clarification)

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| R1 | fold is live-only | state-transition | L1 | automated | replaying session with a tracked prompt | stored `agent_end` processed during replay | `currentTool` is `null` from the event alone — the fold does not run |
| R2 | fast path not folded | state-transition | L1 | automated | replaying session in `skipReplayInsert` with a tracked prompt | `agent_start` on that path | no reconciliation applied; the replay exit establishes the value |
| R3 | recompute preserves a live tool | BVA | L1 | automated | last replayed event was `tool_execution_start{toolName:"Read"}`; reconciled registry empty | replay exit recompute | `currentTool` stays `"Read"` — not reset to `null` |
| R4 | recompute yields null honestly | BVA | L1 | automated | last replayed event was `agent_end`; reconciled registry empty | replay exit recompute | `currentTool` is `null` — the contaminated `"ask_user"` of the rejected design would fail here |
| R5 | mid-turn keeps derived state | state-transition | L1 | automated | mid-turn session, genuinely pending prompt, recompute produced `"ask_user"` | trailing synthetic `agent_start` | `currentTool` remains `"ask_user"` — proves the live fold covers the post-exit event |
| R6 | R10 no new broadcast site | invariant | L1 | automated | `prompt_request` arrives for a replaying session | message handled | no `session_updated` broadcast for that message; the subsequent `replay_complete` broadcast carries `currentTool:"ask_user"` |
| R7 | live prompt is published | invariant | L1 | automated | `prompt_request` for a session that is **not** replaying | message handled | the `currentTool` change reaches browser subscribers |

### Manual-only

| id | requirement | technique | level | disposition | surface | trigger | expected observable |
|----|-------------|-----------|-------|-------------|---------|---------|---------------------|
| M1 | cross-adapter dismissal | — | — | manual-only | TUI + dashboard side by side | answer a prompt **in the TUI** | dashboard card clears too. [judgment: requires a real interactive TUI attached to a live bridge; no automatable harness signal] |
| M2 | reported-session repair | — | — | manual-only | the live dashboard | restart the server and let session `019fcec6-4587-7e2c-bcec-f8e61bc0ce1b` re-register | the originally reported session shows "Needs you". [judgment: one-off verification against a specific live session, not reproducible in CI] |

---

## Coverage summary

- Requirements covered: 12/12 (8 in `prompt-derived-tool-state`, 1 modified in `event-status-extraction`, 1 added in `embed-session-lifecycle`, plus the 2 cross-cutting invariants R9/R10)
- Scenarios by class: edge 12 · perf 0 · frontend 8 · error 12 · replay-boundary 7 · manual 2
- Scenarios by level: L1 36 · L2 0 · L3 3 · manual-only 2
- Scenarios by disposition: automated 39 · manual-only 2

**Why no performance scenarios.** The change adds one `Map.get` per forwarded event on a path that already performs an event-store insert and a broadcast. No latency or throughput budget exists in the spec, and inventing a threshold to justify a row would be exactly the fabrication this skill forbids. The soak risk it *does* introduce — unbounded registry growth — is covered as a correctness scenario (X7, X8) rather than a timed one, because the failure mode is a leak, not a slowdown.

**Why no L2 (qa VM smoke) scenarios.** Nothing here is install-, spawn-, or OS-dependent; it is server-internal state derivation plus three rendered-UI assertions, which belong to L3 by the level boundary.

## New infra needed

- **F6 needs a bridge-reconnect trigger in the docker e2e harness.** Restarting the dashboard server mid-session is the natural trigger; confirm `docker/test-up.sh` exposes a restart that keeps the pi session alive, otherwise F6 needs a harness affordance before it can be authored. Read the port from `.pi-test-harness.json` (`dashboardPort`) — never hardcode `:18000`.
- Everything else reuses existing infra: `packages/server/src/__tests__/` (vitest) for L1, `tests/e2e/` for L3.
