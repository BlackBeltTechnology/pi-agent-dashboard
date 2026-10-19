## Context

The bridge's EventBus forwarding is subscription-based:
- `registerEventBusForwarding` (`packages/extension/src/flow-event-wiring.ts:139`) subscribes once per channel returned by `forwardedBusChannels(extraMaps)` (`:120`). That set is the keys of `FLOW_EVENT_MAP` + `SUBAGENT_EVENT_MAP` + `extraMaps`.
- `bridge.ts` calls it with two arguments, so no `extraMaps` (`packages/extension/src/bridge.ts:2058`).
- No `pi.events.emit =` assignment exists anywhere in `packages/extension/src`.
- Plugin channels go through `PluginForwardRegistry` (`packages/extension/src/bridge.ts:2079`). Its channel-ownership check is `isCoreChannel` (`:2089`). Declarations are also shape-validated (`packages/shared/src/event-forward-declaration.ts`), but nothing rejects a probe channel name.
- Today the only declarer is `packages/subagents-plugin/src/bridge/index.ts:26-27` (`subagents:entry`, `subagents:delta`, `delivery: "stream"`).

RPC probes in the current tree each emit a mutable object and read back what handlers wrote:

| Channel | In-repo emit site | Handler site | Fill |
|---|---|---|---|
| `flow:list-flows` | `packages/extension/src/bridge.ts:228`, `packages/extension/src/command-handler.ts:1018`, `:1196`, `packages/flows-plugin/src/bridge/flow-files-reporter.ts:47` | pi-flows (external, unverified) | sync |
| `flow:get-agents` | `packages/flows-plugin/src/bridge/flow-files-reporter.ts:59` | pi-flows (external, unverified) | sync |
| `flow:get-available-models` | `packages/extension/src/provider-register.ts:774` | `packages/extension/src/provider-register.ts:1156` | sync |
| `model:resolve` | none in repo (pi-flows, external) | `packages/extension/src/provider-register.ts:1149` | async: `probe.model` / `probe.resolved` sync, `probe.auth` after `await` (`:1097-1102`) |
| `role:resolve-model` | none in repo (pi-dashboard-subagents, external) | `packages/extension/src/role-manager.ts:254` | sync |
| `roles:get-all` | `packages/roles-plugin/src/bridge/index.ts:63`, `packages/extension/src/bridge-handlers/dispatch.ts:208`, `:225`, `:242`, `:259`, `:279`, `:293`, `packages/extension/src/bridge-handlers/lifecycle.ts:695` | `packages/extension/src/role-manager.ts:274` | sync |
| `roles:set`, `roles:preset-load`, `roles:preset-save`, `roles:preset-delete`, `roles:remove` | `packages/extension/src/bridge-handlers/dispatch.ts:205`, `:222`, `:239`, `:256`, `:276` | `packages/extension/src/role-manager.ts:288`–`:367` (write `data.success`) | sync |
| `ui:list-modules` | `packages/extension/src/ui-modules.ts:95` | UI-module extensions | sync |

None of these is a core map key, so none is forwarded today. The live requirement "EventBus forwarding via per-channel subscription" already says so as a consequence, and already forbids wrapping emit. This change adds the prohibition on mapping a probe channel, and tests that fail on the two realistic regressions.

Stale emit-intercept wording remains after `fix-automation-run-lifecycle`:
- Code comments: `packages/extension/src/bridge.ts:1907`, `packages/extension/src/flow-event-wiring.ts:28-29`, `packages/extension/src/subagent-frame-buffer.ts:5`.
- AGENTS rows: `packages/extension/src/bridge-handlers/AGENTS.md` (`forwarders.ts` row) and `packages/extension/src/bridge.ts.AGENTS.md`.
- Requirements:
  - `flow-event-bridge`: "Event rename maps exported for intercept" and "Remove forwarding loops from flow-event-wiring".
  - `flow-event-bridge`: "Bridge captures flow lifecycle events from pi.events", which says "listen to all `flow:*` events … and forward them". That covers the `flow:list-flows` probe, so it contradicts both the live declared-set rule and this change.
  - `bridge-decomposition`: "Lifecycle handlers, event forwarders and inbound dispatch are importable".
  - `bridge-extension`: "Bridge listens to flow events on pi.events", whose text says "all `flow:*` event names" (same contradiction).
- Docs: `docs/architecture.md` "Relationship to existing capabilities" (`extension-ui-forwarding (catch-all pi.events.emit forwarding)`).
  - `subagent-live-detail-reliability`: "Subagent live frames buffered across a connection gap".
- `## Purpose` blocks (e.g. `catch-all-event-forwarding`, `flow-event-bridge`) cannot be edited by a delta, so they are out of scope.

## Goals / Non-Goals

**Goals**
- A test fails when a known probe channel becomes a key of the core maps.
- A test fails when bridge-side code assigns `events.emit`, which is the historical wrapper form, or passes `extraMaps` to `registerEventBusForwarding`.
- A spec requirement that keeps probe channels out of the core map.
- Remove the emit-intercept wording, and the "all `flow:*`" over-claims, from the requirements, comments, AGENTS rows and docs listed above.

**Non-goals**
- Any runtime change to forwarding.
- Refusing plugin declarations that name probe channels. That would need probe-name knowledge in the bridge, the denylist the original draft rejected, for a caller that does not exist.
- Detecting probe channels that are not yet known.
- Cleaning old `rawEvent` rows, or a pi-core `events.request` API.

## Decisions

### D1: Three L1 cases, one new test file
File: `packages/extension/src/__tests__/eventbus-rpc-probe-not-forwarded.test.ts`.

1. **Static set.** `forwardedBusChannels()` contains no entry of a test-owned `RPC_PROBE_CHANNELS` literal (the table above, 12 channels), and does contain `flow:complete` (positive control against an emptied set).
   - Fails when a probe is added to `FLOW_EVENT_MAP` / `SUBAGENT_EVENT_MAP`.
2. **Round trip with positive control.** Use the two-facade host of `eventbus-foreign-emit-forwarding.test.ts`, extracting `makeHost` / `makeDeps` into `__tests__/helpers/` because they are file-local today. On one wiring with synchronous filling handlers:
   - emit `flow:list-flows` through the bridge facade;
   - emit `roles:get-all` through a foreign facade;
   - emit `flow:complete` through a foreign facade.
   Assert three things, which together keep the negative assertion from passing vacuously:
   - both probes were filled by their handlers (the emits reached the bus);
   - `sent` contains exactly the `flow:complete` frame (forwarding works);
   - `makeDeps` defaults stay ready + active + connected.
3. **Source guard.** Follow `bridge-name-provenance.test.ts` / `helpers/bridge-source.ts` (`readBridgeSource`). Over `bridge.ts` and every `bridge-handlers/*.ts`, assert:
   - **No emit rebinding.** On text with `//` and `/* */` comments stripped, nothing assigns `emit` on an events object. Forms covered: `events.emit =` / `events!.emit =` (not `==`/`===`), `events["emit"] =`, `defineProperty(<…events…>, "emit"`, `Object.assign(<…events…>, {…emit`.
   - **No `extraMaps`.** On comment-stripped `bridge.ts`, there is exactly one `registerEventBusForwarding(` call. Its argument list, extracted with a balanced-paren scan (the call body contains nested `(…)`), has exactly two top-level arguments.
   - **Merged map pinned.** `bridge.ts` defines `EVENT_BUS_MAP` as exactly `{ ...FLOW_EVENT_MAP, ...SUBAGENT_EVENT_MAP }`. This map drives the rename and `isCoreChannel`, and is invisible to case 1.
   - Register needles `registerEventBusForwarding(` and `const EVENT_BUS_MAP` (target `bridge.ts`) in `source-guards-not-vacuous.test.ts` `GUARDS`.
   - Fails on the historical wrapper form (`pi.events.emit = (channel, data) => …`, which forwarded the bridge's own probe emits), on an `extraMaps` addition, and on a probe merged into the local map.

No bridge-entry init test. The default export wraps `initBridge` in a try/catch that only logs (`bridge.ts:117-141`), so a failed init passes silently, and init has filesystem/env/process side effects. The source guard covers the same regressions deterministically, following the repo's established pattern (`helpers/bridge-source.ts`, `source-guards-not-vacuous.test.ts`).

### D2: The probe list lives in the test
`RPC_PROBE_CHANNELS` is test-owned. Production code gains no channel knowledge.

### D3: Async `model:resolve` is covered by the static set only
`model:resolve` fills `probe.auth` after an `await`. The round-trip case uses synchronous channels only.

### D4: Spec shape
- `catch-all-event-forwarding`: ADDED "RPC probe channels are kept out of the core forwarding map". It is a prohibition on map input and states its relation to "A channel added to the mapping is forwarded without further wiring" (that scenario describes what a map entry does; this one forbids probe entries). It does not restate the existing no-wrap or not-forwarded consequences of "EventBus forwarding via per-channel subscription". Plugin declarations are scoped out.
- Wording-only MODIFIED (no new obligation):
  - `flow-event-bridge` "Remove forwarding loops from flow-event-wiring".
  - `bridge-decomposition` "Lifecycle handlers, event forwarders and inbound dispatch are importable".
  - `subagent-live-detail-reliability` "Subagent live frames buffered across a connection gap".
  - These name no new function and say "per-channel EventBus subscription" rather than pinning implementation names.
- `flow-event-bridge`: RENAMED "Event rename maps exported for intercept" to "… exported for forwarding" (RENAMED is supported; see the archived `card-gradient-state-animation` delta), plus a MODIFIED body.
- Correction MODIFIED, narrowing an over-claim to the live contract (not wording-only):
  - `flow-event-bridge` "Bridge captures flow lifecycle events from pi.events"
  - `bridge-extension` "Bridge listens to flow events on pi.events"
  - Both change "all `flow:*`" to "every `flow:*` channel in `FLOW_EVENT_MAP`". `catch-all-event-forwarding` already forwards only declared channels, so no behaviour changes. The `bridge-extension` scenario still lists 10 of `FLOW_EVENT_MAP`'s 15 channels; it is illustrative and left unchanged.

## Risks / Trade-offs

| Risk | Disposition |
|---|---|
| A new probe channel is not added to `RPC_PROBE_CHANNELS` | Accepted trade-off. Runtime still forwards only declared channels. The list documents known probes and does not gate new ones. |
| A plugin declares a probe channel | Accepted residual risk. Nothing rejects it automatically; it requires a plugin author to name the channel deliberately in `dashboard:register-event-forward`. No in-repo declarer does. |
| A wrapper written in a form the regex misses (Proxy over `pi.events`, rebinding through an alias) | Accepted. The guard pins the historical form and the common rebinding forms. Exotic forms are a review concern. |
| The 12-channel list exists in both the ADDED scenario and `RPC_PROBE_CHANNELS` | Accepted. The test literal carries a comment pointing at the requirement. |

## Migration / Rollback

No migration. Rolling back means reverting the commit. Only tests, comments, AGENTS rows and spec text change.
