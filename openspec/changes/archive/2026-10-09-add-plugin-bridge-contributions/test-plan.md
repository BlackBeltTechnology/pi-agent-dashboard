# Test Plan — add-plugin-bridge-contributions

Stage: design   Generated: 2026-10-09

No clarifications needed: every bound is numeric in the delta specs (2000 msgs / 2 MiB per key, 64 keys, 32 / 256 channels, 12 roles, 256 KiB ceiling).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | plugin-event-forwarding: declared channel forwarded | EP | L1 | automated | declaration `subagents:entry → subagent_entry, stream, key agentId`; session ready+connected | fake bus emits `subagents:entry {agentId:"a"}` | exactly one `sendEventForward("subagent_entry", payload)` |
| E2 | plugin-event-forwarding: idempotent declaration | state | L1 | automated | same declaration emitted twice | one emission | one subscription (`events.on` called once for channel), one forward |
| E3 | plugin-event-forwarding: conflict first-wins | decision-table | L1 | automated | core-mapped `subagents:started` + plugin declares it with `as: x_y` | emission | forwarded as `subagent_started`; conflict counter = 1; no throw |
| E4 | plugin-event-forwarding: validation | BVA | L1 | automated | channels `Bad Name`, 64-char vs 65-char names, no-colon name, `as: "message_update"`, missing key for stream, pluginId `Bad!` | declare | only valid entries subscribed; rejection counter equals invalid count; bad pluginId rejects whole declaration |
| E5 | plugin-event-forwarding: caps | BVA | L1 | automated | 32 vs 33 channels from one plugin; 256 vs 257 total | declare | 33rd and 257th rejected and counted |
| E6 | plugin-event-forwarding: key value validation | EP | L1 | automated | stream channel not forwardable; `agentId` = object, 129-char string, `"__proto__"`, 7 | emit then flush | object/129-char not retained (counted); `__proto__` and 7 retained and flushed; `Object.prototype` unchanged |
| E7 | plugin-event-forwarding: latest per key | state | L1 | automated | latest channel, disconnected | 3× key a, 1× key b, reconnect | forwards newest a and b only, in order |
| E8 | plugin-event-forwarding: stream order across channels | state | L1 | automated | two stream channels same plugin, not ready | delta, delta, entry, delta for agent a; ready | flushed in exactly that order |
| E9 | subagent-live-timeline: entry placement | EP | L1 | automated | entries index 0,2 then 1; duplicate index 1 | reduce | entries [0,1,2] once each; no raw rows in messages |
| E10 | subagent-live-timeline: terminal does not shrink | decision-table | L1 | automated | 10 streamed entries | terminal frame `entries: []`, `entryCount: 10`; and frame with 3 entries | 10 entries remain both cases; legacy frame with 12 entries replaces |
| E11 | subagent-live-timeline: delta assembly | BVA | L1 | automated | pieces offset 0 "Let me ", offset 7 "check", covered dup offset 3 "me", gap offset 20 "x" | reduce | text `Let me check`, dup ignored, gap flag set before `x` |
| E12 | subagent-live-timeline: tombstones | state-transition | L1 | automated | block 4 closed by entry; agent terminal | delta blockId 4; delta blockId 5 after terminal | no liveBlock in either case |
| E13 | subagent-live-timeline: entry before final piece | state-transition | L1 | automated | liveBlock 2 | entry blockId 2, then final piece blockId 2 | entry shown, liveBlock absent |
| E14 | in-memory-event-buffer: elision complete set | decision-table | L1 | automated | over-ceiling `subagent_completed` entryCount 300 with resident entries 0..299 | insert | stored `entries: []`, `entryCount: 300`, size ≤ ceiling+const, no `steps hidden` text anywhere |
| E15 | in-memory-event-buffer: missing step blocks elision | decision-table | L1 | automated | same but index 150 missing | insert | entries not `[]`; generic path bound; no sentinel |
| E16 | in-memory-event-buffer: invalid entryCount | EP | L1 | automated | entryCount -1, 2.5, NaN, 1e9 | insert over-ceiling | no elision; generic path |
| E17 | in-memory-event-buffer: no false positive | EP | L1 | automated | over-ceiling non-subagent event with `details.entries` + numeric entryCount | insert | not elided; generic path |
| E18 | in-memory-event-buffer: no mutation | invariant | L1 | automated | over-ceiling streamed frame object shared with caller | insert | caller `details.entries` unchanged; returned event is new object |
| E19 | subagent-live-timeline: delta storage | BVA | L1 | automated | `subagent_delta` text 100,000 chars; text > 256 KiB | insert + replay reduce | 100k text stored verbatim; oversized stored as envelope `text:""`, `omittedLength`, replay shows gap until entry |
| E20 | subagent-live-timeline: delta collapse + accounting | state | L1 | automated | 5 deltas block 2, 3 deltas block 3 | insert entry blockId 2; then `subagent_completed` | block-2 deltas gone then all gone; `buf.bytes`/`globalBytes` drop by their bytes; seq of others unchanged; `storeTrim` counts |
| E21 | minimal-chat-view: output unwrap | EP | L1 | automated | output string; `{content:[{type:"text",text:"a\nb"}],structuredContent}`; `{foo:1}` | render tool entry expanded | `a`/`b` lines for envelope; string as-is; JSON for other |
| E22 | subagent-live-timeline: healed card | decision-table | L1 | automated | row healedBy superseded / session_ended / real end; `sub.result` set / empty | render AgentToolRenderer collapsed | healed+result → sub.result + recovered badge; healed+no result → sentinel; real end → tool result |
| E23 | role-agent-guidance: guideline content | EP | L1 | automated | roles {fast: anthropic/claude-haiku-4-5, review: openai-codex/gpt-6-sol}; 14 roles; built-ins with "" values | fire `before_agent_start` with Agent tool | one bullet listing @fast/@review sorted; 14 → first 12 sorted; empty-valued → no bullet |
| E24 | role-agent-guidance: no Agent tool / no listener | decision-table | L1 | automated | Agent tool absent; no `roles:get-all` listener | before_agent_start | `toolGuidelines` unchanged |
| E25 | role-agent-guidance: enablement predicate | decision-table | L1 | automated | plugin enabled true / false / unset with defaultEnabled false / unset with defaultEnabled true | registerAllPluginBridges | registered only for true and unset+defaultEnabled true; disabled removes both registry entries |
| E26 | subagent-live-timeline: subagents-plugin bridge declaration | EP | L1 | automated | fake pi events | activate(); then emit `dashboard:bridge-ready` | two declarations with exact channel specs; re-declared on ready |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | plugin-event-forwarding: stream bound | soak (bounded) | L1 | automated | 2,500 messages one key while not forwardable; 10,000 distinct keys latest | retained ≤ 2000 msgs and ≤ 2 MiB per key; ≤ 64 keys; drop counters = excess | single run |
| P2 | subagent-live-timeline: stored deltas after completion | threshold | L3 | automated | `[[faux:subagent-reasoning]]` run to completion | `/api/health` store: 0 `subagent_delta` rows retained for that agent after terminal (via collapse counter delta ≥ deltas emitted) | one run |
| P3 | in-memory-event-buffer: resident scan cost | timed | L1 | automated | session buffer 50,000 events, over-ceiling terminal frame | elision decision < 50 ms | single run |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | subagent-live-timeline: steps visible during run | convergence | L3 | automated | `[[faux:subagent-spawn]]` multi-step run | open inspector while running | ≥ 1 tool row and ≥ 1 finished step visible while card status is running |
| F2 | subagent-live-reasoning: block grows past tail | convergence | L3 | automated | `[[faux:subagent-reasoning]]` with > 280-char thinking | inspector open, sample live block text every 250 ms | text length non-decreasing within a block and exceeds 280; first sampled prefix still present at end of block |
| F3 | subagent-live-timeline: reload mid-run | state-transition | L3 | automated | running faux subagent with ≥ 2 steps | page reload, reopen inspector | same steps restored; in-progress block present if open |
| F4 | in-memory-event-buffer: no steps-hidden in UI | invariant | L3 | automated | faux subagent with > 20 steps completed | expand inspector | no text matching `steps hidden` in the page |
| F5 | subagent-live-reasoning: card ticker unchanged | regression | L3 | automated | existing F2 row of subagent-inspector.spec.ts | run | card height constant (existing assertion stays green) |
| F6 | subagent-live-reasoning: growing block looks like main chat | visual | — | manual-only | live inspector | human compares with main-chat reasoning block | [judgment: styling parity] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | plugin-event-forwarding: handshake late bridge | fault-injection (order) | L1 | automated | plugin activates before main bridge listener | main bridge init emits `dashboard:bridge-ready` | plugin re-declares; channel forwarded; one subscription |
| X2 | plugin-event-forwarding: bridge reload | state-transition | L1 | automated | registry disposed and recreated | new instance emits ready | channels forwarded again; no duplicate forwards per emission; old subscriptions released |
| X3 | plugin-event-forwarding: disconnect gap | fault-injection (abort) | L1 | automated | connection down during 50 stream messages | reconnect | all 50 forwarded in order; none duplicated |
| X4 | subagent-live-timeline: legacy producer | compatibility | L1 | automated | event stream recorded from producer 0.2.x (entries on ticks, no entry/delta events) | reduce | timeline equals current behaviour; liveTail fallback used |
| X5 | subagent-live-timeline: raw vs compacted replay | equivalence | L1 | automated | stored run with entries + open-block deltas | replay raw and via replay-compaction | identical subagent state (entries, liveBlock) |
| X6 | plugin-event-forwarding: health counters | observability | L1 | automated | 2 declared channels, 1 rejected, 3 stream drops | read bridge health payload / `/api/health` | declared 2, rejected 1, dropped 3 |
| X7 | role-agent-guidance: probe throws | fault-injection (abort) | L1 | automated | `roles:get-all` listener throws | before_agent_start | no guideline, no throw, run continues |

---

## Coverage summary

- Requirements covered: 19/19 (plugin-event-forwarding 5, subagent-live-timeline 7, role-agent-guidance 2, catch-all-event-forwarding 3, in-memory-event-buffer 1, minimal-chat-view 1, subagent-live-reasoning 1 — modified requirements counted once)
- Scenarios by class: edge 26 · perf 3 · frontend 6 · error 7
- Scenarios by level: L1 35 · L2 0 · L3 6 · — 1
- Scenarios by disposition: automated 41 · manual-only 1

## New infra needed

- none (faux scenarios `subagent-spawn` / `subagent-reasoning` exist in `qa/fixtures/faux-scenarios.ts`; docker image must carry `pi-dashboard-subagents` ≥ 0.4.0 — verify in `docker/` build, bump if pinned)
