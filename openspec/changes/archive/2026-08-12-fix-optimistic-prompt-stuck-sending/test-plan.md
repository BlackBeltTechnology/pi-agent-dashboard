# Test Plan — fix-optimistic-prompt-stuck-sending

Stage: apply   Generated: 2026-02-16

Source spec: `specs/optimistic-prompt/spec.md` (4 scenarios). Design decisions
D1–D7 in `design.md`. Two slots resolved by the user at design time:

- ack fast-settle window = **15s** (must be ≪ `TIMEOUT_MS` 30s, survives docker
  cold start) — used by F1/F2.
- failed-state surface = **failed bubble + retained `lastError` banner** (two
  surfaces, deliberate) — used by X1.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Ack settles the card (composer gate, D1) | decision-table | L1 | automated | `pendingPrompt.status="sent"`, `isWorking=false` | `CommandInput` renders | textarea + send button ENABLED (`pendingIdle=false`) |
| E2 | Ack settles the card (composer gate, D1) | decision-table | L1 | automated | `pendingPrompt.status="sending"`, `isWorking=false` | `CommandInput` renders | textarea + send button DISABLED |
| E3 | Send failure settles the card (D1+D4) | decision-table | L1 | automated | `pendingPrompt.status="failed"`, `isWorking=false` | `CommandInput` renders | textarea + send button ENABLED |
| E4 | Ack governs settlement (idempotency, D4) | state-transition (illegal edge) | L1 | automated | state with `pendingPrompt.status="failed"` | `applyPromptReceived(state, true)` | state returned UNCHANGED (`status` stays `failed`, same object identity contract as the existing `sent` guard) |
| E5 | Ack governs settlement (idempotency) | state-transition (illegal edge) | L1 | automated | state with `pendingPrompt.status="sent"` | `applyPromptReceived(state, true)` | state UNCHANGED (existing guard, non-regression) |
| E6 | Ack governs settlement (raced mid-turn) | state-transition | L1 | automated | state with `pendingPrompt.status="sending"` | `applyPromptReceived(state, false)` | `pendingPrompt === undefined`; `pendingQueues` untouched |
| E7 | Ack settles the card | state-transition (legal edge) | L1 | automated | state with `pendingPrompt.status="sending"` | `applyPromptReceived(state, true)` | `pendingPrompt.status === "sent"`, text + images preserved |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Faux E2E round-trip (plain-text) | state-convergence | L3 | automated | fresh spawned session in the docker harness (port from `.pi-test-harness.json#dashboardPort`), composer text `[[faux:plain-text]] go` | user presses send | within **15s**: optimistic card shows `sent` (never `failed`), composer re-enabled, scripted answer rendered; no card left in `sending` — `tests/e2e/faux-text.spec.ts` |
| F2 | Faux E2E round-trip (ask-select) | state-convergence | L3 | automated | fresh spawned session, composer text `[[faux:ask-select]] pick` | user presses send | within **15s**: card `sent`, composer enabled, interactive option BUTTON rendered; no `sending` card — `tests/e2e/faux-ask.spec.ts` |
| F3 | Send failure is visible (D4 render arm) | state-transition | L1 | automated | `SessionState.pendingPrompt = {text:"hi", status:"failed"}` | `ChatView` renders | failed affordance rendered (NOT the emerald `sent` tick), original text `hi` still visible |
| F4 | Reset/replay does not resurrect `sending` | state-transition | L1 | automated | state carrying `pendingPrompt.status="sending"` | `session_state_reset` and `event_replay` (reset branch) | resulting state has NO `sending` pendingPrompt |
| F5 | Reset/replay preserves settled carry (non-regression, `preserve-pending-prompt-across-replay`) | state-transition | L1 | automated | state carrying `pendingPrompt.status="sent"` | `session_state_reset` and `event_replay` (reset branch) | carried bubble survives with `status==="sent"` |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Send failure settles the card (timeout leg) | fault-injection (ack never arrives) | L1 | automated | ack + `message_start` both suppressed for the session | 30s (`TIMEOUT_MS`) elapse with `status="sending"`, timer not `paused` | `pendingPrompt.status === "failed"` with text preserved (NOT `undefined`); `lastError` banner ALSO set (chosen two-surface behaviour) |
| X2 | Failed state is durable (D4 arming fix) | state-transition (illegal re-entry) | L1 | automated | `pendingPrompt.status="failed"` | a further 30s elapse | timer does NOT re-arm; `pendingPrompt` still `failed` (not cleared) — the arming predicate is `status==="sending"`, not `!!pendingPrompt` |
| X3 | Send failure settles on the unsubscribed quick-send path | fault-injection (structurally unackable) | L1 | automated | `handleSendPromptToSession` writes `pendingPrompt` for a NON-selected session; no ack/`message_start` reaches this browser | timeout elapses | that session's `pendingPrompt.status === "failed"`, composer for it not left disabled |
| X4 | Mid-turn queue semantics unchanged (constraint) | decision-table | L1 | automated | session `isStreaming=true` | `handleSend` fires | NO `pendingPrompt` written; `pendingQueues` chip path unaffected |

### Manual-only

| id | requirement | technique | level | disposition | surface | trigger | expected observable |
|----|-------------|-----------|-------|-------------|---------|---------|---------------------|
| M1 | Failed bubble visual treatment | visual/subjective | — | manual-only | failed optimistic card + `lastError` banner shown together | human looks at a timed-out prompt in the running dashboard | [judgment: the two surfaces read as ONE failure, not duplicated noise; retry affordance is obvious] |

---

## Coverage summary

- Requirements covered: 4/4 spec scenarios (+ 2 design-derived invariants: E4/X2 idempotency+durability, X4 pendingQueues non-regression)
- Scenarios by class: edge 7 · perf 0 · frontend 5 · error 4 · manual 1
- Scenarios by level: L1 14 · L2 0 · L3 2
- Scenarios by disposition: automated 16 · manual-only 1

Perf class intentionally empty: the only latency constraint is F1/F2's 15s
fast-settle bound, asserted inside those L3 rows.

## New infra needed

none — `tests/e2e/faux-text.spec.ts` and `faux-ask.spec.ts` already exist
(currently red); every L1 row extends an existing sibling `*.test.ts`.
