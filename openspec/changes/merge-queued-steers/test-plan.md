# Test Plan — merge-queued-steers

Stage: design   Generated: 2026-11-20

No clarifications: every Triple below fills from `specs/**` + `design.md` (D1–D10).

Levels: L1 = vitest (`packages/*/src/**/__tests__/`), L3 = Playwright vs the docker harness (`tests/e2e/`, port from `.pi-test-harness.json`).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Held steers can be merged | EP (nominal) | L1 | automated | buffer `[1:"a", 2:"b"+1 png]` | `merge()` | returns `true`; one entry, id ∉ {1,2}; `views()` = `[{text:"a\n\nb", imageCount:1, mergedCount:2}]` |
| E2 | Held steers can be merged; Steer ids unique | state-transition | L1 | automated | buffer `[M(a,b), 3:"c"]` | `merge()` | one entry with id `M`, `mergedCount:3`, text `"a\n\nb\n\nc"` |
| E3 | Held steers can be merged (no-op) | decision table | L1 | automated | buffer ∈ {`[]`, `[1:"a"]`, `[M(a,b)]`} | `merge_steering_entries` via dispatch | `merge()` → `false`; buffer + ids unchanged; exactly 1 `queue_update`; no `command_feedback` |
| E4 | A merged steer can be split back | state-transition | L1 | automated | buffer `[x, M(1:"a"+p1, 2:"b"+png), y]` | `split("M")` | buffer `[x, 1, 2, y]`; `1` keeps `promptId:"p1"`, `2` keeps its png; no `mergedCount` on any view |
| E5 | A merged steer can be split back (refusals) | decision table | L1 | automated | buffer `[1, 2]` (after a split) | `split_steering_entry` with id ∈ {`"zz"` unknown, `"1"` plain held} | both: buffer unchanged + 1 `queue_update`; `"zz"` → feedback `split_steering_entry` "Steer already sent or cancelled"; `"1"` → no feedback |
| E6 | Held steers are cancellable (merged) | decision table | L1 | automated | buffer `[M(1+p1, 2+p2)]` | `remove_steering_entry` id ∈ {`"1"`, `"M"`}, then completed `turn_end` + settle | `"1"` → refused with feedback, `M` intact; `"M"` → buffer empty; no `prompt_received` with p1/p2 ever |
| E7 | Steer buffer enforces bounds (cap) | BVA | L1 | automated | 19 originals merged into one entry (cap 20) | push 20th, then 21st | 20th admitted; 21st refused whole, feedback `send_prompt` names cap |
| E8 | Steer buffer enforces bounds (bytes) | BVA | L1 | automated | merged originals totalling `maxBytes − N` (custom small `maxBytes`) | push N-byte steer, then 1-byte steer | `totalBytes()` before = Σ parts bytes; N admitted; next refused whole, feedback names ceiling |
| E9 | Auto-merge setting merges newly queued steers | state-transition | L1 | automated | `autoMerge=true`, empty buffer | admit `"a"`, `"b"`, `"c"` | after a: plain; after b: merged id `X`; after c: same id `X`, `mergedCount:3`; `emitQueueUpdate` called exactly once per admission |
| E10 | Auto-merge rule | decision table | L1 | automated | autoMerge {t,f} × splitPaused {t,f} × held-before {0, ≥1} | admit one steer | merge happens ONLY for (t, f, ≥1); all other 7 rows leave the new steer separate |
| E11 | Split pause lifecycle | state-transition | L1 | automated | autoMerge on, `[M(a,b)]` | split → admit c → manual merge → admit d; separately: split → empty via each of take / shift / removeById / clear / clear-on-empty → admit 2 | c stays separate; after manual merge d joins; after each empty path the next 2 admissions merge |
| E12 | Session change ends the pause | state-transition | L1 | automated | autoMerge on, paused, `["a","b"]` held | `session_start {reason:"new"}` | buffer empty; one `queue_update {steering:[]}`; next 2 admissions merge |
| E13 | Flip then admit (Q2) | state-transition | L1 | automated | separate `["a","b"]` held | `preferences_update {mergeQueuedSteers:true}`, then admit `"c"` | after update: buffer unchanged, no `queue_update`; after c: one merged `"a\n\nb\n\nc"` |
| E14 | Older server never resets the setting | EP | L1 | automated | `inst.mergeQueuedSteers=true` | `preferences_update` with field absent / `"yes"` / `false` | absent → true; `"yes"` → true; `false` → false |
| E15 | Merge/split frames for another session dropped | decision table | L1 | automated | current session `T`, buffer `[1,2]` | `merge_steering_entries {sessionId:"S"}`, `split_steering_entry {sessionId:"S"}` | buffer unchanged; no `queue_update`; no feedback |
| E16 | A merged steer reaches pi as one user message | EP | L1 | automated | `one-at-a-time`, buffer `[M(a,b+png,c,d)]` | completed `turn_end` | `sendUserMessage` called exactly once with content `[{text:"a\n\nb\n\nc\n\nd"}, {image png}]`, `{deliverAs:"steer"}`; buffer empty |
| E17 | Merged steer keeps its place | EP | L1 | automated | `one-at-a-time`, buffer `[x, M(a,b)]` | completed `turn_end` | only `x` sent; `M` still held |
| E18 | promptId ack per original | decision table | L1 | automated | `M(a+p1, b, c+p3)` | hand-off with `sendUserMessage` {returns, throws} | returns → `prompt_received` p1 then p3 after the send, none for b; throws → no ack, entry not re-pushed |
| E19 | Drain loop / held steers drain at settle (merged) | EP | L1 | automated | steer buffer `[M(a+p1, b+p2)]`, follow-up `["f"]`, idle, no pending | `agent_settled` | one `sendUserMessage("a\n\nb")` with NO options; acks p1, p2; `"f"` still held |
| E20 | Cancel/split during hand-off cannot reach a taken entry | state-transition | L1 | automated | `steeringMode:"all"`, buffer `[1, M(a,b)]` | `split_steering_entry {id:"M"}` handled during the yield after sending `1` | split refused with "already sent" feedback; `M` still sent once |
| E21 | Streaming steers buffered (auto-merge ordering) | EP | L1 | automated | autoMerge on, `["a"]` held | admit `"b"` with 1 valid + 1 oversized image | order: `command_feedback` (dropped image) → one `queue_update` whose single entry has `mergedCount:2`, `imageCount:1` |
| E22 | Server relays steer merge and split (tiers/scope) | EP | L1 | automated | `ws-message-tiers` + `ws-message-scope` maps | coverage tests re-derive the browser union | both new types tiered `control` and session-scoped; coverage tests pass |
| E23 | Server relays steer merge and split | decision table | L1 | automated | session `S` exists / unknown | browser sends `merge_steering_entries {S}`, `split_steering_entry {S, "M"}` | exists → `piGateway.sendToSession(S, <same frame>)`; unknown → nothing sent |
| E24 | ACP ignores both | EP | L1 | automated | ACP server-requests switch | both new frames | `ctx.ignored("merge_steering_entries")`, `ctx.ignored("split_steering_entry")`; no throw |
| E25 | Not advertised as MCP tools | EP | L1 | automated | MCP manifest | manifest invariants test | neither verb appears as a tool; both carry a denylist reason |
| E26 | Server relays the auto-merge setting (snapshot) | EP | L1 | automated | getter returns true / false | `buildPreferencesUpdate(store, {mergeQueuedSteers})` | snapshot carries `mergeQueuedSteers` equal to the getter, plus the existing `autoNameSessions` / `claudeSubscriptionCompat` |
| E27 | Setting survives a server restart | EP | L1 | automated | config file `{ mergeQueuedSteers: true }` / absent / `"yes"` | boot (`cli.ts` mapping) → bridge register | register-time `preferences_update.mergeQueuedSteers` = true / false / false |
| E28 | Config change reaches connected bridges | state-transition | L1 | automated | runtime config false, 2 bridges connected | `PUT /api/config {mergeQueuedSteers:true}`, then the same PUT again | first PUT: `GET /api/config` true without restart; exactly one `piGateway.broadcast` carrying `true` (assigned before broadcast); second PUT: no broadcast |
| E29 | Server caches queue state (mergedCount) | EP | L1 | automated | bridge `queue_update` with `{id:"M", text:"a\n\nb", imageCount:0, mergedCount:2}` | server handles it | `session_updated.pendingQueues.steering[0].mergedCount === 2` unmodified |
| E30 | Bus-client verbs | EP | L1 | automated | regenerated `generated/verbs.ts` | tsc7-wrapper regenerate-and-compare test | both verbs listed and mapped to their `…FromBrowserMessage` type names; generated file unchanged by regen |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Pending steer bubbles (group label) | decision table | L1 | automated | steering ∈ {`[1 plain]`, 4 plain, `[M mergedCount:2]`} | render `ChatView` | exactly one `pending-steer-group-label` reading `Steering` / `Steering · 4` / `Steering · merged` with spinner + "sends after this turn"; no bubble contains its own "Steering" header |
| F2 | Pending steer bubbles (control row) | decision table | L1 | automated | steering ∈ {`[a]`, `[a,b]`, `[M2]`, `[M2,c]`, `["a","b"]`, `["a",{id}]`}; also `[a,b]` with no `onMergeSteers` | render | `[a]`: no controls; `[a,b]`: Merge 2 + Clear all; `[M2]`: Split 2 only; `[M2,c]`: Merge 2 + Clear all, no Split; both legacy rows: no Merge; no handler: no Merge |
| F3 | Merge/Split clicks send frames | EP | L1 | automated | `useSessionActions` with selected session `S` | `mergeSteeringEntries()`, `splitSteeringEntry("M")` | sends `{type:"merge_steering_entries", sessionId:"S"}` and `{type:"split_steering_entry", sessionId:"S", id:"M"}` |
| F4 | normalizeSteering carries mergedCount | EP | L1 | automated | `[{id:"M",text:"x",imageCount:0,mergedCount:3}, "legacy"]` | `normalizeSteering` | `[{id:"M", mergedCount:3,…}, {key:"legacy:1", imageCount:0, no mergedCount}]` |
| F5 | Steering section on the Sessions page | state-transition | L1 | automated | config without `mergeQueuedSteers` | render Sessions page, toggle `settings-merge-queued-steers` on | section order …Session list, Steering, Lifecycle & recovery…; toggle starts off with the agreed hint; after toggle: Sessions page dirty marker; `computeConfigPartial` = `{ mergeQueuedSteers: true }` only |
| F6 | Merge flow end-to-end | state-convergence | L3 | automated | faux slow-tool turn streaming; 3 steers `s1`,`s2`,`s3` sent | click `pending-steer-merge` ("Merge 3"), wait for hand-off | converges to: one bubble + `Split 3` before hand-off; after hand-off the transcript holds exactly ONE user message containing `s1\n\ns2\n\ns3`, placed before the final answer; no pending bubble remains |
| F7 | Merge → Split → Merge → cancel | state-convergence | L3 | automated | faux slow-tool turn; 2 steers held | Merge, Split, Merge, ✕ on merged bubble | label sequence `Steering · 2` → `Steering · merged` → `Steering · 2` → `Steering · merged` → no label; final transcript has no user message containing either steer |
| F8 | Auto-merge setting end-to-end | state-convergence | L3 | automated | Settings → Sessions → Steering toggle ON + Save | start a faux slow-tool turn, send 2 steers | converges to one bubble labelled `Steering · merged` with `Split 2`, without any Merge click |
| F9 | Phone layout keeps touch targets | BVA (viewport) | L3 | automated | viewport 375×812; 2 held steers | render | `pending-steer-merge` and `pending-steer-clear-all` bounding boxes both ≥ 44px tall and wide; neither overflows the chat column |
| F10 | Grouped look matches the approved mock | visual/subjective | — | manual-only | live chat with 3 held steers, desktop + phone, all 4 themes | human compares with mock frames 1, 6 | [judgment: tight gap, label alignment and button pairing read as the approved mock — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Version skew (design Risks) | fault-injection (abort) | L1 | automated | bridge dispatch without the new handlers (`commandHandler.handle` default) | `merge_steering_entries` arrives | returns `undefined`; buffer unchanged; no throw (documents the accepted no-op) |
| X2 | Hand-off session switch (merged) | fault-injection (abort) | L1 | automated | session changes during the hand-off yield, `"all"` mode, taken `[1, M(a+p1,b+p2)]` | `sessionId` flips after sending `1` | `M` not sent; warning "steer(s) dropped"; no ack for p1/p2 |

---

## Coverage summary

- Requirements covered: 17/17 (mid-turn-prompt-queue ADDED 6 + MODIFIED 10, settings-panel ADDED 1 + MODIFIED 1 counted with F5)
- Scenarios by class: edge 30 · perf 0 · frontend 10 · error 2
- Scenarios by level: L1 37 · L2 0 · L3 4 · manual 1 (L1 = 30 E + 5 F + 2 X; L3 = F6–F9; manual = F10)
- Scenarios by disposition: automated 41 · manual-only 1

## New infra needed

- none (L3 reuses the `[[faux:slow-tool-steer]]` faux turn from `tests/e2e/steer-cancel.spec.ts`)
