## 1. Shared contract

- [x] 1.1 Add `packages/shared/src/event-forward-declaration.ts`: `EventForwardDeclaration`, `EventForwardChannelSpec` (`as?`, `delivery: "live"|"latest"|"stream"`, `key?`), channel constants `REGISTER_EVENT_FORWARD_CHANNEL = "dashboard:register-event-forward"`, `BRIDGE_READY_CHANNEL = "dashboard:bridge-ready"`, and pure `validateDeclaration()` per design D3 (name regexes, reserved core types, per-plugin 32 / total 256 caps)
- [x] 1.2 Export from the shared barrel; add the row to `packages/shared/src/AGENTS.md`

## 2. Core bridge registry

- [x] 2.1 Generalise `packages/extension/src/flow-event-wiring.ts`: a forwarding registry holding core maps + accepted plugin channels; `declare(decl)` subscribes each new channel once via `events.on`, first-wins on conflict, counts rejections/conflicts; dispose releases all
- [x] 2.2 Add `packages/extension/src/stream-forward-buffer.ts`: `latest` (per channel+key) and `stream` retention in ONE buffer keyed by `(pluginId, key value)` preserving cross-channel emission order (stream bound 2000 msgs / 2 MiB per key; ONE 64-key budget shared by latest+stream, drop-oldest, counters), key-value validation (string or finite number, max 128 chars), `Map` storage, ordered `drain()`; wire into `forwardBusEvent` for plugin-declared channels (core subagent channels keep `SubagentFrameBuffer`)
- [x] 2.3 In `bridge.ts` `initBridge`: attach the `dashboard:register-event-forward` listener next to `registerEventBusForwarding` (bridge.ts:3066), then emit `dashboard:bridge-ready`; flush the stream buffer where subagent frames are flushed on ready
- [x] 2.4 Report registry/buffer counters in the bridge health payload and surface them in `/api/health`

## 3. Plugin bridges

- [x] 3.1 Add `packages/subagents-plugin/src/bridge/index.ts`: declare `subagents:entry` → `subagent_entry` and `subagents:delta` → `subagent_delta` (`stream`, key `agentId`) on activate and on every `dashboard:bridge-ready`; add manifest `bridge` field
- [x] 3.2 Add `packages/roles-plugin/src/bridge/index.ts`: on `before_agent_start`, probe `roles:get-all`; filter to roles with a non-empty `provider/model[:level]` value; when any remain and `Agent` tool is present, append one bullet to `systemPromptOptions.toolGuidelines["Agent"]` (≤ 12 roles, sorted, `@name → provider/model`); add manifest `bridge` field
- [x] 3.3 `packages/server/src/server.ts` (~4064-4071) + `plugin-bridge-register.ts`: register bridges only when `resolvePluginEnabled(pluginCfg, manifest.defaultEnabled)`; deregister (both registries) for disabled ones at startup via `syncPluginBridges` (toggle route already returns `restartRequired`)

## 4. Server storage

- [x] 4.1 `memory-event-store.ts`: remove `reduceSubagentEvent` / head+tail path and its constants; over-ceiling subagent carrier only: scan the session's resident buffer for that agent's `subagent_entry` indices; `details.entryCount` safe integer `>= 0` AND one pass finds distinct valid indices in `[0, entryCount)` equal to `entryCount` → clone with `entries: []`, then generic path; else generic path
- [x] 4.2 `memory-event-store.ts`: exempt `subagent_delta.text` from the per-string cap (per-event ceiling still applies, no fragmentation); an over-ceiling delta is stored as its envelope with `text: ""` + `omittedLength` (bypassing the generic path); on insert of `subagent_entry` with `blockId`, drop stored `subagent_delta` of the same `(agentId, blockId)`; on `subagent_completed`/`subagent_failed`, drop that agent's remaining deltas; update `buf.bytes` + `globalBytes`, never renumber `seq`, count in `storeTrim`
- [x] 4.3 `packages/server/src/session/replay-compaction.ts`: keep raw-vs-replay reducer equivalence for `subagent_entry` / `subagent_delta` (pass-through unless proven equivalent)

## 5. Client

- [x] 5.1 `event-reducer.ts`: `subagent_entry` arm (place at `index`, dedupe), `subagent_delta` arm (per-agent live block: append/ignore-covered/gap, new `blockId` replaces, entry with same `blockId` or terminal clears; tombstones `closedBlockMax` + terminal ignore late deltas); terminal/tick `entries` never shrink the streamed list; neither type reaches the `default` raw-row arm
- [x] 5.2 Subagent state type (`packages/subagents-plugin/src/client/types.ts`): add `liveBlock?: { blockId; kind; text; gap }`
- [x] 5.3 `SubagentDetailView.tsx`: pass `liveBlock` (full text) as `liveEntry` when present, else `liveTail` fallback with the existing held-tail logic; `MinimalChatView.tsx` live entry renders growing text (main-chat thinking/text styling, gap marker)
- [x] 5.4 `MinimalChatView.tsx:121-125`: unwrap `{content:[{type:"text",text}]}` tool output to joined text
- [x] 5.5 `event-reducer.ts` `tool_execution_end` arm (~2551-2561): stamp any synthesized `healedBy` (`superseded`, `session_ended`) onto `toolDetails.healedBy`, clear only on a real end. `AgentToolRenderer.tsx`: when the row is healed (`toolDetails.healedBy` set: superseded or session_ended) and `sub?.result`, render `sub.result` (keep recovered badge)
- [x] 5.6 `useSubagentResyncCadence.ts`: stop re-firing once `entries.length >= entryCount` for a streamed producer

## 6. Docs and records

- [ ] 6.1 Update `AGENTS.md` rows for every touched/new file (extension, shared, server persistence, client, subagents-plugin, roles-plugin)
- [ ] 6.2 Delegate `docs/architecture.md` EventBus Forwarding section + plugin authoring note (`dashboard:register-event-forward`, delivery modes, handshake) to DocScribe
- [ ] 6.3 CHANGELOG `## [Unreleased]` entry

## 7. Verification

- [ ] 7.1 `npm test` green; `npm run quality:changed`
- [ ] 7.2 Rebuild + restart (client build, server restart, `npm run reload`) and verify with a live deepseek subagent in the browser: steps and growing block visible during the run; no `steps hidden`; Read output as text

## 8. Tests (folded from test-plan.md)

### 8a. Bridge registry — L1 `packages/extension/src/__tests__/plugin-event-forwarding.test.ts` (exemplar: `packages/extension/src/__tests__/eventbus-foreign-emit-forwarding.test.ts`)

- [x] 8.1 Declared channel forwarded: declaration `subagents:entry → subagent_entry, stream, key agentId`, ready+connected · fake bus emits `subagents:entry {agentId:"a"}` · exactly one `sendEventForward("subagent_entry", payload)` (test-plan #E1)
- [x] 8.2 Idempotent declaration: same declaration twice · one emission · `events.on` called once for the channel and one forward (test-plan #E2)
- [x] 8.3 Conflict first-wins: core `subagents:started` re-declared by a plugin as `x_y` · emission · forwarded as `subagent_started`, conflict counter 1, no throw (test-plan #E3)
- [x] 8.4 Validation: `Bad Name`, 64- vs 65-char names, no-colon name, `as: "message_update"`, stream without key, pluginId `Bad!` · declare · only valid entries subscribed, rejection counter equals invalid count, bad pluginId rejects whole declaration (test-plan #E4)
- [x] 8.5 Caps: 32 vs 33 channels per plugin, 256 vs 257 total · declare · 33rd and 257th rejected and counted (test-plan #E5)
- [x] 8.6 Key value validation: stream channel not forwardable, `agentId` object / 129-char / `"__proto__"` / 7 · emit then flush · object and 129-char not retained (counted), `__proto__` and 7 flushed, `Object.prototype` unchanged (test-plan #E6)
- [x] 8.7 Latest per key: latest channel disconnected · 3× key a, 1× key b, reconnect · newest a and b only, in order (test-plan #E7)
- [x] 8.8 Stream order across channels: two stream channels, not ready · delta, delta, entry, delta for agent a, then ready · flushed in exactly that order (test-plan #E8)
- [x] 8.9 Stream and key bounds: 2,500 messages for one key; 10,000 distinct latest keys, not forwardable · flush · ≤ 2000 msgs and ≤ 2 MiB per key, ≤ 64 keys, drop counters equal the excess (test-plan #P1)
- [x] 8.10 Handshake late bridge: plugin activates before the main bridge listener · main bridge init emits `dashboard:bridge-ready` · plugin re-declares, channel forwarded, one subscription (test-plan #X1)
- [x] 8.11 Bridge reload: registry disposed and recreated · new instance emits ready · channels forwarded again, no duplicate forward per emission, old subscriptions released (test-plan #X2)
- [x] 8.12 Disconnect gap: connection down during 50 stream messages · reconnect · all 50 forwarded in order, none duplicated (test-plan #X3)
- [x] 8.13 Health counters: 2 declared channels, 1 rejected, 3 stream drops · read bridge health payload and `/api/health` (exemplar `packages/server/src/__tests__/health-compatibility.test.ts`) · declared 2, rejected 1, dropped 3 (test-plan #X6)

### 8b. Plugin bridge entries — L1 (exemplar: `packages/context-mode-settings-plugin/src/bridge/__tests__/bridge-entry.test.ts`)

- [x] 8.14 subagents-plugin bridge (`packages/subagents-plugin/src/bridge/__tests__/bridge-entry.test.ts`): fake pi events · `activate()` then emit `dashboard:bridge-ready` · two declarations with the exact channel specs, re-declared on ready (test-plan #E26)
- [x] 8.15 roles-plugin guideline content (`packages/roles-plugin/src/bridge/__tests__/bridge-entry.test.ts`): roles {fast, review}; 14 roles; built-ins with "" values · fire `before_agent_start` with Agent tool · one bullet listing @fast/@review sorted; 14 → first 12 sorted; empty-valued → no bullet (test-plan #E23)
- [x] 8.16 roles-plugin no Agent tool / no listener: Agent tool absent; no `roles:get-all` listener · `before_agent_start` · `toolGuidelines` unchanged (test-plan #E24)
- [x] 8.17 roles-plugin probe throws: `roles:get-all` listener throws · `before_agent_start` · no guideline, no throw, run continues (test-plan #X7)
- [x] 8.18 Bridge registration follows enablement (`packages/shared/src/__tests__/plugin-bridge-register.test.ts`, exemplar same file): enabled true / false / unset+defaultEnabled false / unset+defaultEnabled true · registerAllPluginBridges path · registered only for true and unset+defaultEnabled true; disabled removes both registry entries (test-plan #E25)

### 8c. Server store — L1 `packages/server/src/__tests__/memory-event-store.test.ts` (exemplar: same file; replay rows exemplar `packages/server/src/__tests__/collapse-replay-equivalence.test.ts`)

- [x] 8.19 Elision with complete set: over-ceiling `subagent_completed` entryCount 300 with resident entries 0..299 · insert · stored `entries: []`, `entryCount: 300`, size ≤ ceiling+const, no `steps hidden` text (test-plan #E14)
- [x] 8.20 Missing step blocks elision: same with index 150 absent · insert · entries not `[]`, generic path bound, no sentinel (test-plan #E15)
- [x] 8.21 Invalid entryCount: -1, 2.5, NaN, 1e9 · insert over-ceiling · no elision, generic path (test-plan #E16)
- [x] 8.22 No false positive: over-ceiling non-subagent event with `details.entries` + numeric entryCount · insert · not elided, generic path (test-plan #E17)
- [x] 8.23 No mutation: over-ceiling streamed frame shared with caller · insert · caller `details.entries` unchanged, returned event is a new object (test-plan #E18)
- [x] 8.24 Delta storage: `subagent_delta` text 100,000 chars; text > 256 KiB · insert + replay reduce · 100k stored verbatim; oversized stored as envelope `text:""` + `omittedLength`, replay shows gap until the entry (test-plan #E19)
- [x] 8.25 Delta collapse + accounting: 5 deltas block 2, 3 deltas block 3 · insert entry blockId 2, then `subagent_completed` · block-2 deltas removed then all removed; `buf.bytes`/`globalBytes` drop by their bytes; other seqs unchanged; `storeTrim` counts (test-plan #E20)
- [x] 8.26 Resident scan cost: session buffer 50,000 events, over-ceiling terminal frame · insert · elision decision < 50 ms (test-plan #P3)
- [x] 8.27 Raw vs compacted replay (`collapse-replay-equivalence.test.ts`): stored run with entries + open-block deltas · replay raw and via replay-compaction · identical subagent state (entries, liveBlock) (test-plan #X5)

### 8d. Client — L1 (reducer exemplar: `packages/client/src/__tests__/event-reducer.test.ts`; heal exemplar: `packages/client/src/lib/__tests__/event-reducer.superseded-heal.test.ts`)

- [x] 8.28 Entry placement (`packages/client/src/lib/__tests__/event-reducer.subagent-stream.test.ts`): entries index 0, 2, then 1, duplicate 1 · reduce · entries [0,1,2] once each, no raw rows (test-plan #E9)
- [x] 8.29 Terminal does not shrink (same file): 10 streamed entries · terminal `entries: []` + `entryCount: 10`; frame with 3 entries; legacy frame with 12 · reduce · 10 remain for the first two, 12 replace for legacy (test-plan #E10)
- [x] 8.30 Delta assembly (same file): pieces offset 0 "Let me ", 7 "check", covered 3 "me", gap 20 "x" · reduce · `Let me check`, dup ignored, gap flag before `x` (test-plan #E11)
- [x] 8.31 Tombstones (same file): block 4 closed by entry; agent terminal · delta blockId 4; delta blockId 5 after terminal · no liveBlock (test-plan #E12)
- [x] 8.32 Entry before final piece (same file): liveBlock 2 · entry blockId 2, then final piece blockId 2 · entry shown, liveBlock absent (test-plan #E13)
- [x] 8.33 Legacy producer (same file): recorded producer 0.2.x stream · reduce · timeline equals current behaviour, liveTail fallback used (test-plan #X4)
- [x] 8.34 Healed card (`packages/client/src/components/tool-renderers/__tests__/AgentToolRenderer.test.tsx`, exemplar same file): healedBy superseded / session_ended / real end × sub.result set / empty · render collapsed · healed+result → sub.result + recovered badge; healed+empty → sentinel; real end → tool result (test-plan #E22)
- [x] 8.35 Output unwrap (`packages/client-utils/src/minimal-chat/__tests__/MinimalChatView.test.tsx`, exemplar same file): output string; `{content:[{type:"text",text:"a\nb"}],structuredContent}`; `{foo:1}` · render expanded · envelope → `a`/`b` lines, string as-is, other → JSON (test-plan #E21)

### 8e. E2E — L3 `tests/e2e/subagent-live-timeline.spec.ts` (exemplar: `tests/e2e/subagent-inspector.spec.ts`)

- [x] 8.36 Steps visible during run: `[[faux:subagent-spawn]]` multi-step run · open inspector while running · ≥ 1 tool row and ≥ 1 finished step visible while the card is running (test-plan #F1)
- [x] 8.37 Block grows past tail: `[[faux:subagent-reasoning]]` with > 280-char thinking · sample live block every 250 ms · length non-decreasing within a block and > 280; first prefix still present at block end (test-plan #F2)
- [x] 8.38 Reload mid-run: running faux subagent with ≥ 2 steps · page reload + reopen inspector · same steps restored, open block present if open (test-plan #F3)
- [x] 8.39 No steps-hidden in UI: faux subagent with > 20 steps completed · expand inspector · no text matching `steps hidden` (test-plan #F4)
- [x] 8.40 Stored deltas after completion: `[[faux:subagent-reasoning]]` to completion · read `/api/health` (port from `baseURL`) · zero retained `subagent_delta` for the agent (collapse counter covers all emitted deltas) (test-plan #P2)
- [x] 8.41 Card ticker regression: existing F2 row in `tests/e2e/subagent-inspector.spec.ts` · run · card height constant stays green (test-plan #F5)

### 8f. Manual

- [ ] 8.42 Growing inspector block styling matches the main-chat reasoning block (test-plan: manual-only) (test-plan #F6)
