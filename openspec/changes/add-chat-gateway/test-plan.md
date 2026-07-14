# Test Plan — add-chat-gateway

Stage: apply (soft gate)   Generated: 2026-07-13

## ✓ Clarifications resolved (8/8)

All gaps resolved and folded into `specs/chat-gateway/spec.md` + `design.md`. Decisions:

- **C1** allowedRoots containment → **real-path (symlink-resolved) prefix match**; rejects `..`/symlink escape.
- **C2** spawn correlation → **reuse `automation-run-lifecycle` correlation token** (not cwd+recency).
- **C3** tool-approval timeout → **fail closed** (unanswered = blocked).
- **C4** >2000-char reply → **chunk into a new message** (edit tail chunk); never truncate.
- **C5** Discord 3s ack → **defer immediately, edit deferred reply on response**.
- **C6** pairing code → **15-minute TTL / 10-attempt lockout**.
- **C7** mid-stream delivery → **`followUp` default; `!` prefix forces `steer`**.
- **C8** edit throttle → **≥ ~1000ms between edits; zero-429; p95 edit latency < 1.5s**.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | input | trigger | expected observable |
|----|-------------|-----------|-------|-------|---------|---------------------|
| E1 | R4 allowedRoots | BVA (in-range) | L1 | `cwd=/repos/proj` ∈ allowedRoots | bind channel | binding persisted; spawn issued with that cwd |
| E2 | R4 allowedRoots | BVA (out-range) | L1 | `cwd=/etc` ∉ allowedRoots | bind attempt | NO spawn call; in-channel "path not permitted" reply |
| E3 | R4 allowedRoots | boundary (empty set) | L1 | `allowedRoots=[]` | spawn-based bind | spawn refused; operator-facing message; no spawn |
| E4 | R4 allowedRoots | BVA (traversal/symlink) | L1 | symlink `/repos/link→/etc`; also `cwd=/repos/proj/../../etc` | bind attempt | real-path resolves outside allowedRoots → binding rejected, no spawn |
| E5 | R4 attach source (a) | EP (valid) | L1 | live session, `cwd ∈ allowedRoots` from `GET /api/sessions` | bind by attach | subscribes + routes to existing `sessionId`; NO spawn |
| E6 | R4 attach source (a) | EP (invalid) | L1 | live session, `cwd ∉ allowedRoots` | bind by attach | attach refused (allowedRoots applies to all sources) |
| E7 | R4 resolver precedence | decision-table | L1 | channel with {persisted?, fixedMap?, default?} flags | resolve cwd | persisted > fixedMap > default > interactive; one row per reachable combo |
| E8 | R4 spawn correlation | EP (unique cwd) | L1 | single spawn in an otherwise-idle allowedRoot | spawn + `session_register` | correlated `sessionId` == the spawned session |
| E9 | R4 spawn correlation | state (race) | L1 | two concurrent spawns, same cwd, distinct correlation tokens | both register | each channel binds to its own session via its token; never cross-bound |
| E10 | R3 sticky routing | state-transition | L1 | already-bound channel | 2nd inbound message | routed to same `sessionId` via `send_prompt`; no new spawn |
| E11 | R3 thread granularity | state-transition | L1 | bound channel, new thread | message in new thread | independent binding resolved for the thread |
| E12 | R7 authorization | decision-table | L1 | (allowlisted ∈ {y,n}) × (admin ∈ {y,n}) × action ∈ {talk, bind} | message/bind | talk needs allowlisted; bind needs admin; deny rows produce no session effect |
| E13 | R7 pairing code | BVA (TTL/attempts) | L1 | code used at 15:01; 11th wrong attempt | pair attempt | pairing refused + code invalidated (TTL 15m / lockout 10) |
| E14 | R9 config secrecy | EP | L1 | configured bot token | read config back via any surface | token absent from response (no plaintext) |

### Performance

| id | requirement | technique | level | workload | metric + threshold | window |
|----|-------------|-----------|-------|----------|--------------------|--------|
| P1 | R5 throttled edit | tail-latency + rate-limit | L2 | rapid `text_delta` burst on one channel; ≥1000ms edit throttle | zero Discord 429; p95 edit latency < 1.5s | 5 min |
| P2 | R1/R5 fan-out | tail-latency | L2 | 20 bound channels streaming concurrently | p95 chat-delivery latency < 2s; RSS flat (no growth) | 10 min |

### Frontend-quirk (Discord-rendered → L3 Playwright/bot-harness)

| id | requirement | technique | level | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------|---------|---------------------------------|
| F1 | R6 select | state-transition | L3 | `prompt_request{type:select, options}` | user taps an option | `prompt_response` carries chosen value; session proceeds |
| F2 | R6 cross-surface dismiss | convergence | L3 | same prompt open on web + Discord | web UI answers first | Discord receives `prompt_dismiss`; controls disabled — converges to answered |
| F3 | R6 multiselect | state-transition | L3 | `prompt_request{type:multiselect}` | user selects two, confirms | `prompt_response` carries both values |
| F4 | R6 batch | state-transition | L3 | `prompt_request{type:batch, metadata.questions}` | user answers each | sub-prompts sequenced; index-aligned answers returned |
| F5 | R6 interaction ack | timing | L3 | button tap; session round-trip > 3s | interaction fires | deferred-ack sent immediately; deferred reply edited on response; no "interaction failed" |
| F6 | R5 long reply | boundary | L3 | assistant reply grows past 2000 chars mid-stream | stream continues | overflow continues in a NEW message (chunked); nothing truncated |
| F7 | R5 in-place edit | invariant | L3 | 30 `text_delta` events | stream | exactly ONE Discord message id, edited repeatedly — not 30 posts |

### Error-handling

| id | requirement | technique | level | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------|---------|---------------------|
| X1 | R5 unreachable | fault (dependency down) | L3 | bound session has no bridge (502) | inbound message | in-channel error reply; not silent |
| X2 | R8 hard deny | state (guard) | L1 | policy denies `bash` | spawned session attempts `bash` | `{block:true}` returned; tool never executes |
| X3 | R8 approval | state-transition | L3 | policy marks tool "approval" | spawned session attempts it | in-channel yes/no; deny→blocked, allow→executes |
| X4 | R8 approval timeout | fault (no response) | L3 | user never answers approval | PromptBus timeout elapses | tool fails closed — blocked (denied), never auto-allowed |
| X5 | R8 attach ungated | illegal-edge | L1 | session bound via attach (source a) | any tool call | guard NOT loaded; no block/approval applied |
| X6 | R5 mid-stream input | state-transition | L1 | agent already streaming; msg with/without `!` prefix | 2nd inbound chat message | plain → `delivery:followUp`; `!`-prefixed → `delivery:steer` |
| X7 | R3 persistence | fault (restart) | L2 | gateway process restarts | message on previously-bound channel | persisted binding reused (attach/resume); no re-create |
| X8 | R4 spawn failure | fault (abort) | L1 | `POST /spawn` returns 500 | bind attempt | in-channel error; NO dangling binding recorded |
| X9 | R2 adapter drop | fault (abort) | L2 | Discord socket drops mid-session | reconnect | adapter reconnects; no duplicate delivery of the in-flight message |
| X10 | R7 unauthorized | fault (security) | L1 | user ∉ allowlist | inbound message | never delivered to any session; no `send_prompt` emitted |

---

## Coverage summary

- Requirements covered: 9/9 (R1 headless via E5/F2/F7/P2; R2 adapter via E5-context/X9; R3
  routing E10/E11/X7; R4 binding E1–E9; R5 streaming F6/F7/P1/X1/X6; R6 interactive F1–F5;
  R7 auth E12/E13/X10; R8 guard X2–X5; R9 config E14).
- Scenarios by class: edge 14 · perf 2 · frontend 7 · error 10 (33 total).
- Scenarios by level: L1 17 · L2 5 · L3 11.
- Blocked by clarification: 0 (all 8 resolved — E4, E9, E13, P1, F5, F6, X4, X6 now concrete).

## New infra needed

- **L3 Discord bot harness.** The `tests/e2e/` Playwright layer targets the rendered web UI
  (docker :18000). Discord-rendered scenarios (F1–F7, X1, X3, X4) need a bot-side test
  driver (a test Discord app + a scripted client, or a mocked adapter that records
  `sendMessage`/`editMessage`/`sendInteractive` calls). Decide: real Discord test guild vs
  an adapter-level fake. The **adapter-level fake** keeps most F/X rows at L1/L2 and avoids a
  live-Discord dependency in CI — recommended; reserve one real-guild smoke for X9.
