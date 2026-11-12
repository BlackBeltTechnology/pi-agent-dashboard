# Test Plan — bridge-owned-cancellable-steer

Stage: design   Generated: 2026-11-12

Constants used below: steer buffer cap = `FOLLOWUP_QUEUE_CAP` (20), byte ceiling = `FOLLOWUP_BUFFER_MAX_BYTES` (32 MiB) (`packages/extension/src/followup-buffer.ts:42,53`). Late-cancel feedback text: "already sent or cancelled".

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Streaming steers are buffered in the bridge | state | L1 | automated | `isAgentStreaming=true`, empty buffers | `send_prompt {text:"focus on auth", delivery:"steer", images:[png]}` via command-handler | `pi.sendUserMessage` called 0×; steer buffer has 1 entry; one `queue_update` with `steering:[{id, text:"focus on auth", imageCount:1}]` |
| E2 | Capture-before-send streaming gate | state-transition | L1 | automated | `isAgentStreaming=false`; fake pi flips it true inside `sendUserMessage` | `send_prompt {text:"hello", delivery:"steer"}` | `sendUserMessage("hello",{deliverAs:"steer"})` 1×; steer buffer empty; no `queue_update` with a chip |
| E3 | Capture-before-send — slash fallback | state | L1 | automated | streaming; slash-route `sessionPrompt` fallback | fallback delivers a steer | entry in steer buffer; `pi.sendUserMessage` 0× |
| E4 | Routing split (D3) | decision-table | L1 | automated | delivery ∈ {steer, followUp} × streaming ∈ {true,false} | `send_prompt` for each of 4 combos | steer+stream → steer buffer only; followUp+stream → `bridgeFollowUp` only; idle × both → direct send, both buffers untouched |
| E5 | A steer's promptId is acknowledged when it reaches pi | state-transition | L1 | automated | streaming; `promptId:"p1"` | send steer → hand-off at completed `turn_end` | ack #1 `prompt_received{fresh:false}` without `promptId`; ack #2 at hand-off `{fresh:false, promptId:"p1"}` |
| E6 | promptId — cancelled | state | L1 | automated | held steer with `promptId:"p1"` | `remove_steering_entry` then `turn_end` + settle | no `prompt_received` ever carries `"p1"` |
| E7 | Steer buffer enforces the follow-up bounds — count | BVA | L1 | automated | 19 / 20 held entries | push 20th / 21st | 20th admitted; 21st refused whole, `command_feedback` for `send_prompt`; `bridgeFollowUp` unaffected |
| E8 | Steer buffer enforces the follow-up bounds — bytes | BVA | L1 | automated | buffer at ceiling − N bytes | push entry of exactly N / N+1 bytes | N admitted; N+1 refused whole (images not stripped), feedback names the limit |
| E9 | Image validated at admission | EP | L1 | automated | streaming steer with 1 valid + 1 oversized image | admission | entry carries 1 image; `command_feedback` for `send_prompt` names the dropped image |
| E10 | Steer ids unique across bridge lifetimes | EP | L1 | automated | two `createSteerBuffer` instances (different nonce), 3 pushes each | compare ids | 6 distinct ids; ids within an instance strictly ordered |
| E11 | Hand-off at turn_end | decision-table | L1 | automated | outcome ∈ {completed, aborted, error} × `steeringMode` ∈ {"one-at-a-time","all",undefined} × held ∈ {0,1,2} | fire `turn_end` | completed+one/undefined → oldest sent, rest held; completed+all → all sent; aborted/error → 0 sends, buffer unchanged; held=0 → 0 sends, no `queue_update` |
| E12 | Hand-off — all-mode order + single update | state | L1 | automated | `"all"`, held `a`,`b` | completed `turn_end` | exactly one `queue_update` (empty steering) BEFORE first send; send order `a` then `b`; ≥1 macrotask between sends |
| E13 | Hand-off — images ride | EP | L1 | automated | held entry text + 2 images | completed `turn_end` | `sendUserMessage` content = `[text, img1, img2]`, `deliverAs:"steer"` |
| E14 | Cancel during hand-off cannot reach a taken entry | state-transition | L1 | automated | `"all"`, held `1`,`2` | `remove_steering_entry{id:"2"}` dispatched during the yield after sending `1` | feedback "already sent or cancelled"; `2` still sent |
| E15 | Held steers are cancellable — remove | state | L1 | automated | held `1`,`2` | `remove_steering_entry{id:"2"}` | buffer `[1]`; one `queue_update`; no pi method called |
| E16 | Held steers are cancellable — unknown id | EP | L1 | automated | held `1` | `remove_steering_entry{id:"zz"}` | buffers unchanged; `command_feedback` for `remove_steering_entry` "already sent or cancelled" |
| E17 | Held steers are cancellable — clear all | state | L1 | automated | held `1`,`2`,`3`; `bridgeFollowUp` `[b]` | `clear_steering_entries` | steer buffer empty; `bridgeFollowUp` `[b]`; one `queue_update` |
| E18 | message_start never touches held steers | state | L1 | automated | held `"hello"` | user `message_start` content `"hello"` | steer buffer still `["hello"]`; no `queue_update` |
| E19 | Held steers drain at settle — ordering | state-transition | L1 | automated | held `a` (promptId p2), `bridgeFollowUp` `[b]`; idle, no pending | `agent_settled` ×2 | settle 1 sends `a` (fresh prompt, no `deliverAs`) + ack `promptId:"p2"`, `b` kept; settle 2 sends `b` |
| E20 | Held steers drain at settle — gates | decision-table | L1 | automated | held `a`; `isIdle` ∈ {t,f} × `hasPendingMessages` ∈ {t,f} | `agent_settled` | only idle∧¬pending sends `a`; other 3 combos send nothing and keep `a` |
| E21 | Held steer after abort drains at settle | state-transition | L1 | automated | held `a`; abort issued | `agent_settled{aborted:true}` | `a` handled identically to a follow-up in the same position (same send / no-send verdict as `forwarders-followup-drain` abort case) |
| E22 | Abort preserves queues | state | L1 | automated | held `a`, `bridgeFollowUp` `[b]` | `abort` command | both buffers unchanged; no `queue_update` from abort path |
| E23 | Bridge maintains buffers — session change | state-transition | L1 | automated | both buffers non-empty, one with images | `session_start{reason:"resume"}` | both empty; byte totals 0; exactly one `queue_update{steering:[],followUp:[]}` |
| E24 | Bridge re-announces its queues on register | state | L1 | automated | fresh bridge, empty buffers | register / re-register | `queue_update{steering:[],followUp:[]}` emitted on each register |
| E25 | Contract — pi drains after turn_end | state | L1 | automated | installed `@earendil-works/pi-agent-core` loop with stub stream (1 tool turn, then text) and a recording `finishTurn` that enqueues a steer | run loop | steer delivered as a user message before the 2nd LLM call; for a stub that ends `stopReason:"aborted"`, `getSteeringMessages` not called after `turn_end` |
| E26 | Pi ExtensionAPI exposes no queue-mutation methods | EP | L1 | automated | `packages/extension/src` | grep + router dispatch of `clear_steering_queue`, `clear_followup_slot`, `edit_followup_slot` | zero `pi.clear*Queue(` calls; the 3 deleted types fall through with no pi call, no `queue_update` |
| E27 | Server relays steer mutations | EP | L1 | automated | session `S` with connected bridge | browser sends `remove_steering_entry{sessionId:"S",id:"2"}` and `clear_steering_entries{sessionId:"S"}` | bridge of `S` receives both unchanged; no other bridge receives them |
| E28 | Server registers new message types | EP | L1 | automated | `ws-message-scope.ts`, `ws-message-tiers.ts` | coverage tests re-derive the browser-message union | both new types present in scope + tier maps; tests pass |
| E29 | Server caches queue state verbatim | EP | L1 | automated | `queue_update` with `steering:[{id:"1",text:"a",imageCount:2}]`, then one with `steering:["legacy"]` | event-wiring handles each | `pendingQueues.steering` equals each payload exactly; broadcast has no image `data` field |
| E30 | Pending steer bubbles — controls | EP | L1 | automated | `steering:[{id:"1",text:"x",imageCount:0},{id:"2",text:"y",imageCount:2}]` | render `ChatView` | `pending-steer-cancel-1` and `-2` present; `pending-steer-attachments` only in bubble 2 showing `2`; header `STEERING` |
| E31 | Pending steer bubbles — clear-all boundary | BVA | L1 | automated | 0 / 1 / 2 entries | render | `pending-steer-clear-all` absent at 0 and 1, present at 2 |
| E32 | Pending steer bubbles — cancel dispatch | state | L1 | automated | one entry `id:"1"`; `window.confirm` spy | click `pending-steer-cancel-1`; click clear-all with 2 entries | WS sends `remove_steering_entry{sessionId,id:"1"}` / `clear_steering_entries{sessionId}`; `confirm` called 0× |
| E33 | Client tolerates legacy string entries | EP | L1 | automated | `steering:["focus on X", {id:"2",text:"y",imageCount:0}]` | render | 2 `STEERING` bubbles; cancel control only on the object entry |
| E34 | Live arrival keyed by id | EP | L1 | automated | two entries with identical text, ids `1`,`2` | `live-arrival` arrival map + render | two distinct keys/bubbles; no React duplicate-key warning |
| E35 | Bridge follow-up drain loop — empty-buffer gate (MODIFIED) | decision-table | L1 | automated | held steer `s`, `bridgeFollowUp` empty, idle, no pending | `agent_settled` | drain sends `s` (no `deliverAs`); with both buffers empty the drain bails before the idle check |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|

No performance requirement in the spec; none designed.

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Pending steer bubbles — image marker | async-convergence | L3 | automated | session streaming `[[faux:slow-stream]]` | send steer with 2 images via composer (Steer mode) | converges to 1 `pending-steer-card` with `pending-steer-attachments` = `2` and `pending-steer-cancel-*` |
| F2 | Held steers are cancellable (UI) | state-transition | L3 | automated | `[[faux:slow-stream]]`; 3 steers `s-a`,`s-b`,`s-c` sent | click ✕ on `s-b`, then `pending-steer-clear-all` | converges to 2 → 0 cards; after settle the transcript contains none of `s-a`,`s-b`,`s-c` |
| F3 | Held steers drain at settle (UI) | async-convergence | L3 | automated | `[[faux:slow-stream]]` single turn; steer `s-late` held | stream ends, run settles | 0 `pending-steer-card`; exactly one user bubble `s-late`, positioned below the slow-stream assistant text |
| F4 | Hand-off at turn_end (UI) | async-convergence | L3 | automated | new faux scenario: slow tool turn → text turn | send steer `s-mid` during the tool turn | `pending-steer-card` gone; user bubble `s-mid` appears BEFORE the final assistant text in DOM order (same boundary) |
| F5 | Bridge re-announces its queues on register (UI) | state-transition | L3 | automated | steer held during `[[faux:slow-stream]]` | reload the session's bridge | converges to 0 `pending-steer-card` (no stale bubble) |
| F6 | Pending steer bubbles — ✕ alignment (mockup round-2 defect) | geometry invariant | L3 | automated | 2 held steers, one with images | render | each ✕ button's right edge within 1 px of its own bubble's right padding edge; identical offset in both bubbles |
| F7 | Pending steer bubbles — visual parity with accepted mock | visual/subjective | — | manual-only | chat tail with 2 steers + dock, dark and light | human compares to `mockups/2026-11-12-steer-cancel-images` | [judgment: matches accepted mock, controls read as follow-up controls] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Hand-off at turn_end (D4 trade-off) | fault-injection (abort) | L1 | automated | fake `pi.sendUserMessage` whose internal prompt rejects asynchronously | completed `turn_end` with held `a` | handler resolves without throwing; buffer already empty; no retry send; no unhandled rejection escapes the bridge |
| X2 | Hand-off — handler errors contained | fault-injection (abort) | L1 | automated | `pi.getSettings` throws | completed `turn_end` with held `a` | falls back to `"one-at-a-time"`; `a` sent; other `turn_end` work (usage drain) still runs |
| X3 | Server relays steer mutations — no bridge | fault-injection (abort) | L1 | automated | session `S` bridge disconnected | browser sends `remove_steering_entry{sessionId:"S",id:"1"}` | no throw; nothing forwarded; no broadcast |
| X4 | ACP sessions drop steer mutations | fault-injection | L1 | automated | ACP session | `remove_steering_entry` arrives at `acp-bridge/server-requests.ts` | dropped silently; ACP queue unchanged |
| X5 | Malformed mutation | EP (invalid) | L1 | automated | `remove_steering_entry` with missing / non-string `id` | bridge dispatch | buffers unchanged; no throw; no pi call |

---

## Coverage summary

- Requirements covered: 15/15 delta requirements (MODIFIED 4, ADDED 11); REMOVED 4 covered by replacement/negative rows E18, E26, E30
- Scenarios by class: edge 35 · perf 0 · frontend 7 · error 5
- Scenarios by level: L1 40 · L2 0 · L3 6
- Scenarios by disposition: automated 46 · manual-only 1

## New infra needed

- F4: a faux scenario in `qa/fixtures/faux-scenarios.ts` that streams one slow tool-call turn (e.g. `read` with `FAUX_TPS`-paced text) followed by a text turn, so a steer can be sent mid-turn and handed off at a real `turn_end`. Extends existing faux infra; no new harness.
- E25: a contract test driving the installed `pi-agent-core` agent loop with a stub stream function (extends existing pi-contract tests; no new harness).
