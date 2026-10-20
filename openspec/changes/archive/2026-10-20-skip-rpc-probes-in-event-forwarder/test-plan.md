# Test Plan — skip-rpc-probes-in-event-forwarder

Stage: design   Generated: 2026-10-20

No clarification gaps: every requirement resolves to a concrete Triple.

Shared fixtures (L1, `packages/extension/src/__tests__/eventbus-rpc-probe-not-forwarded.test.ts`):
- `RPC_PROBE_CHANNELS` lists 12 channels: `flow:list-flows`, `flow:get-agents`, `flow:get-available-models`, `model:resolve`, `role:resolve-model`, `roles:get-all`, `roles:set`, `roles:remove`, `roles:preset-load`, `roles:preset-save`, `roles:preset-delete`, `ui:list-modules`.
- Two-facade host + deps are extracted from `eventbus-foreign-emit-forwarding.test.ts` into `__tests__/helpers/`. Deps default to ready + active + connected.
- Source-guard predicates are pure functions over a source string, so each one can be run against both the real `readBridgeSource(...)` text and an inline mutant snippet.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | catch-all ADDED "RPC probe channels are kept out of the core forwarding map" / scenario "Known probe channels are absent…" | EP (probe vs mapped class) | L1 | automated | `forwardedBusChannels()` with default args | compute set | contains none of the 12 `RPC_PROBE_CHANNELS`; contains `flow:complete` and `subagents:completed` (non-empty positive control) |
| E2 | catch-all ADDED / scenario "Probe emitted by the bridge itself is not forwarded" | state-convergence (sync bus) | L1 | automated | `registerEventBusForwarding(bridgeFacade, deps)`; foreign facade registers `flow:list-flows` handler setting `probe.flows = [{name:"x"}]`; probe `{}` | `bridgeFacade.emit("flow:list-flows", probe)`, then `foreignFacade.emit("flow:complete", {status:"success"})` | `probe.flows` deep-equals `[{name:"x"}]`; `sent.map(s=>s.channel)` equals exactly `["flow:complete"]` |
| E3 | catch-all ADDED / scenario "Probe emitted by a foreign extension is not forwarded" | state-convergence (sync bus) | L1 | automated | same wiring; bridge facade registers `roles:get-all` handler setting `data.roles = {fast:"a/b"}`; probe `{}` | `foreignFacade.emit("roles:get-all", probe)` | `probe.roles` deep-equals `{fast:"a/b"}`; `sent` has length 0 |
| E4 | catch-all ADDED: all 12 probe channels | EP (whole class) | L1 | automated | same wiring; one filling handler per channel (each sets `probe.filled = channel`) | emit every `RPC_PROBE_CHANNELS` entry through the foreign facade, then once through the bridge facade | every probe has `filled === channel`; `sent` has length 0 |
| E5 | flow-event-bridge MODIFIED "Bridge captures flow lifecycle events…" (only `FLOW_EVENT_MAP` `flow:*` channels forwarded) | EP (`flow:*` mapped vs unmapped) | L1 | automated | same wiring | foreign facade emits `flow:run` `{flowName:"f"}` and `flow:agent-error` `{agentName:"a"}` | `sent` channels equal exactly `["flow:agent-error"]` |
| E6 | catch-all ADDED: merged `EVENT_BUS_MAP` holds no probe | mutation (source guard) | L1 | automated | `readBridgeSource("bridge.ts")`; mutant: same text with `"roles:get-all": "x",` inserted into the `EVENT_BUS_MAP` literal | `assertEventBusMapPinned(src)` | real source passes (map is exactly `{ ...FLOW_EVENT_MAP, ...SUBAGENT_EVENT_MAP }`); mutant fails with a message naming `EVENT_BUS_MAP` |
| E7 | catch-all ADDED: no extra map passed to forwarding wiring | mutation (source guard, balanced-paren arg count) | L1 | automated | comment-stripped `readBridgeSource("bridge.ts")`; mutant: the `registerEventBusForwarding(` call with a third argument `, [{ "flow:list-flows": "x" }]` appended before its closing `)` | `countForwardingCallArgs(src)` | real source: exactly 1 call, 2 top-level args (nested `(channel) => …` parens not miscounted); mutant: 3 args, so the guard fails |
| E8 | catch-all live "EventBus forwarding via per-channel subscription" (SHALL NOT wrap emit), pinned by this change | mutation (source guard) | L1 | automated | comment-stripped text of `bridge.ts` + every `bridge-handlers/*.ts`; mutants: `pi.events.emit = (c, d) => {}`, `pi.events!.emit = f`, `pi.events["emit"] = f`, `Object.defineProperty(pi.events, "emit", {})`, `Object.assign(pi.events, { emit: f })` | `findEmitRebinding(src)` | real sources return no hit; each of the 5 mutants returns ≥1 hit; `pi.events.emit("x", y)`, `a.emit === b` and a `// pi.events.emit = old` comment return no hit |
| E9 | guard non-vacuity (repo convention) | regression | L1 | automated | `source-guards-not-vacuous.test.ts` `GUARDS` with new rows `["eventbus-rpc-probe-not-forwarded.test.ts", "bridge.ts", "registerEventBusForwarding("]` and `[…, "bridge.ts", "const EVENT_BUS_MAP"]` | run suite | both rows pass (needle present in `bridge.ts`, guard file names `bridge.ts`) |

### Performance

None. No latency, throughput or memory requirement.

### Frontend-quirk

None. No UI surface.

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | catch-all ADDED (definition covers async fill) | fault-injection (delay: async handler) | L1 | automated | foreign facade registers `async (p) => { await Promise.resolve(); p.auth = {ok:true}; }` on `model:resolve` | `foreignFacade.emit("model:resolve", probe)`, then `await new Promise(r => setTimeout(r, 0))` | after the flush, `probe.auth` deep-equals `{ok:true}`; `sent` has length 0 both immediately after emit and after the flush |
| X2 | helper extraction must not regress the existing suite | regression | L1 | automated | `eventbus-foreign-emit-forwarding.test.ts` switched to import the extracted host/deps helper | run that file | all 7 existing cases pass, with the same case count as before |

---

## Coverage summary

- Requirements covered: 7/7. Plain ADDED; `flow-event-bridge` captures; the live no-wrap rule via E8; the 4 wording-only MODIFIED requirements change no behaviour and are covered by existing suites, kept green by X2 and the full run.
- Scenarios by class: edge 9 · perf 0 · frontend 0 · error 2
- Scenarios by level: L1 11 · L2 0 · L3 0
- Scenarios by disposition: automated 11 · manual-only 0

## New infra needed

- None. The work extracts the existing two-facade host into `packages/extension/src/__tests__/helpers/` and reuses `helpers/bridge-source.ts`.
