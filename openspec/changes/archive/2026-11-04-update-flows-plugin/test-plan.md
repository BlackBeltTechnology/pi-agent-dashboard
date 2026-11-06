# Test Plan — update-flows-plugin

Stage: design   Generated: 2026-11-04

Hard gate run without operator questions, per the run instruction. Each spec gap below is recorded as a GAP with the most conservative assumption consistent with design.md. Rows that rest on an assumption are marked `(assumed, G#)`. Revisit those rows if a GAP is answered differently.

### Spec gaps and the assumptions used

- **G1 — valid `flowName`.** The spec says "a `flowName` that is not a valid flow id" is rejected, but never defines a valid id. `FLOW_ID_RE` (`automation-actions.ts:74`) needs a colon, which would reject the spec's own `flowName: "research"` example. Assumption: valid = a non-empty trimmed string with no `/`, `\`, `..` or control character. Invalid test values: `""`, `"   "`, `42`, `"../x"`, `"a/b"`, `"x\ny"`. Valid: `"research"`, `"batch:apply"`.
- **G2 — health counter names.** Task 1.7 / 2.4 and design D1 / D3 add `/api/health` counters for replayed plugin entries, declared replay types and rejected plugin actions, but don't name them. They also don't say which existing counter an `as`-type conflict increments. Assumptions:
  - an `as` conflict increments `pluginEventForward.conflicts`;
  - the new counters are named in task 1.7;
  - tests assert exact deltas, not names.
- **G3 — ACP refusal on the WS path.** `plugin_action` has no reply channel, so "refused with `UNSUPPORTED_FOR_ACP`" has no defined browser-visible form. Assumption:
  - zero relays;
  - a `logger.warn` line containing `unsupported_for_acp`;
  - the rejected-action counter goes up by 1;
  - no client message is asserted.
- **G4 — REST status codes other than ACP.** Only the ACP answer is pinned (409 + `unsupported_for_acp`, matching `session-api.ts:548`). Assumptions, taken from the old route and the obs-studio `host-gates` precedent:
  - unknown action → 400;
  - unknown session → 404;
  - observe bearer → 403 `insufficient_scope`;
  - trusted-network caller with no credentials → 403 from the operate predicate.
- **G5 — how a disabled plugin's entries stay hidden.** The two specs pull in different directions:
  - `plugin-entry-replay` says undeclared plugin entries "SHALL NOT render as a generic custom card";
  - `custom-entry-rendering` says an undeclared custom type replays as `custom_entry`;
  - D3 says hidden, but core may not name `flow-event`.

  Assumption: types declared in the manifests of discovered but disabled plugins form an exclude-only set. They are kept out of the generic paths but not replayed.
- **G6 — malformed `replayEntryTypes`.** Behaviour for a malformed value (non-array, non-string elements) is not specified. Assumption: the plugin contributes nothing from that field, and the loader does not throw.
- **G7 — zero-count state pills.** The spec doesn't say whether a state pill with count 0 shows in the Agent cards header. Tests assert only the non-zero pills.
- **G8 — branch without `to`.** An object-form YAML branch with no `to` is not specified. Assumption: no edge and no throw.
- **G9 — relay not delivered.** The response when `emitEventToSession` returns false is not specified. Assumption: keep the old route's behaviour (200 `{ success: true }`, delivery not checked) and log `delivered=false`.
- **G10 — one plugin, two channels, same `as`.** Not specified. Assumed allowed (only a different `pluginId` is rejected). No row.
- **G11 — item rerun.** A second `flow_agent_started` for the same `itemIndex` has no defined rerun semantics. No row.
- **G12 — L3 harness version.** The L3 harness pins pi-flows 0.8.1 (`docker/Dockerfile:128`), so 0.10 fan-out and decision events cannot come from the real engine in docker. See New infra. Real-engine flow specs are quarantined under issue #683, so F4 / F5 / F7 may land as `fixme` siblings.
- **G13 — no performance thresholds.** The spec has none, and the proposal says performance-optimization does not apply. The P rows are BVA on the existing `StreamForwardBuffer` bounds (64 keys, 2000 messages / key, 2 MiB / key) named in the design's Risks.
- **G14 — session driver lookup.** The plugin server needs to read a session's `driver` for the ACP refusal; no plugin-context accessor is named. Assumption: the server context exposes the session `driver` (absent means pi).
- **G15 — existing L3 specs.** `tests/e2e/helpers/flow-card-grid.ts` `openIdleGrid` and `flow-card-grid-geometry.spec.ts` measure cards that will now sit inside a collapsed Agent cards section. They must open the section first. Folded into F1.
- **G16 — edit-mode emit condition (found by the post-fold collateral scan).** Two specs disagree:
  - `flows-plugin` "Set edit-mode accepts a boolean only" and `flow-event-bridge` "Edit-mode request forwarded to pi.events" read as an unconditional emit;
  - the unmodified `flows-edit-mode-settings` "Explicit per-project edit-mode action" (and `handleSetEditMode`) emits only when the desired value differs from the current effective value, and broadcasts an error state when delivery fails.

  Assumption: the `flows-edit-mode-settings` rule holds for both the `plugin_action` and REST paths. E33 and E37 set a differing current state; E37 adds a same-value case that emits nothing.

### Levels used by this change

- **L1** — vitest, beside its sibling `__tests__` (`packages/*/src/**/__tests__`, `scripts/__tests__`). The spec's hermetic "L2" flow suite (`flow-plugin-e2e`) is a vitest file, so it routes here.
- **L3** — Playwright `tests/e2e/*.spec.ts` against the docker harness on its hash-derived port (`.pi-test-harness.json` `dashboardPort`).
- **L2 / ci** — not used. No install, spawn or multi-OS behaviour changes, and the boundary gate runs in CI through `scripts/__tests__/check-plugin-boundary.test.mjs` (the vitest `scripts` project).
- **manual-only** — visual fidelity to the approved mockup, and the screen-reader feel.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | plugin-event-forwarding: declarations validated (flow_* not reserved) | EP | L1 | automated | Declaration `pluginId: "flows"`, `"flow:flow-started": { as: "flow_started", delivery: "stream", key: "flowName" }`; control entry `"flows:x": { as: "message_update", delivery: "live" }`; session ready+connected | Emit the declaration, then `flow:flow-started { flowName: "research" }` | `flow_started` entry accepted; rejected counter +1 (only the `message_update` entry); exactly one `event_forward` `flow_started` with the emitted data |
| E2 | plugin-event-forwarding: single owning plugin | decision table | L1 | automated | (a) `flows` declares `flow:decision → flow_decision` (stream, stepId), then `other` declares `other:x → flow_decision`; (b) reversed order | Emit each declaration, then emit `flow:decision { stepId: "t" }` and `other:x { stepId: "t" }` | (a) `other` entry rejected; `pluginEventForward.conflicts` +1 (assumed, G2); one `flow_decision` forward from `flow:decision`, none from `other:x`. (b) the `flows` entry is rejected and counted; `other:x` forwards. In both orders, the rest of the losing declaration still applies |
| E3 | plugin-event-forwarding: same-plugin re-declare is idempotent | state | L1 | automated | `flows` declaration with `flow:decision → flow_decision` | Emit the declaration twice (activation + `dashboard:bridge-ready`), then one `flow:decision` | Rejected and conflicts counters unchanged; `events.on` called once for `flow:decision`; exactly one `event_forward` |
| E4 | flow-event-bridge: flows bridge declares the run channels | EP | L1 | automated | Fake `pi.events` recording emits | Activate the flows plugin bridge; then emit `dashboard:bridge-ready` | Two `dashboard:register-event-forward` emits, `pluginId: "flows"`, deep-equal. Each holds exactly 16 channels: 9 `stream`/`stepId` (`agent-started`, `agent-complete`, `agent-error`, `subagent-tool-call` → `flow_tool_call`, `subagent-tool-result` → `flow_tool_result`, `assistant-text`, `thinking-text`, `loop-iteration`, `decision`); 2 `stream`/`flowName` (`flow-started` → `flow_started`, `complete`); 1 `stream`/`agentName` (`auto-decision`); 4 `live` keyless (`summary-started`, `summary-ready`, `summary-dismissed`, `autonomous-mode-changed` → `flow_autonomous_changed`). 16 ≤ 32 cap |
| E5 | flow-event-bridge: lifecycle data forwarded verbatim | invariant | L1 | automated | Real `PluginForwardRegistry` + flows declaration; ready+connected; payloads `{ stepId: "s", nodeKind: "code-decision" }`, `{ stepId: "s", outcome: "soft" }`, `{ stepId: "s", outcome: "hard" }`, `{ stepId: "s" }` (no nodeKind) | Emit `flow:agent-started` / `flow:agent-complete` with each | Each `event_forward.data` deep-equals the emitted payload; no `nodeKind` is synthesized on the bare one |
| E6 | plugin-event-forwarding: `dashboard:commands-changed` | EP | L1 | automated | Core bridge wiring with a stub `pi.getCommands()` | Emit `dashboard:commands-changed` with `{ x: 1 }`, then with `undefined` | `commands_list` sent exactly 2 times; no outbound message carries `x: 1`; no `event_forward` for the channel |
| E7 | bridge-decomposition / session-skill-registry: core holds no flow listener | decision table | L1 | automated | Core bridge with flows plugin bridge NOT registered (`plugins.flows.enabled = false`) | Emit `flow:rediscover`, then `flow:complete { flowName: "r" }` | 0 `commands_list` sends; `pi.events.on` was never called with a `flow:` channel by core modules |
| E8 | flow-event-bridge: flows bridge requests a commands resend | EP | L1 | automated | Flows plugin bridge active, fake bus | Emit `flow:rediscover`; then `flow:complete { flowName: "r" }` | `dashboard:commands-changed` emitted exactly once per trigger (2 total); no flow list message is sent |
| E9 | plugin-entry-replay: manifest declares owned types | decision table | L1 | automated | Manifests: flows enabled with `replayEntryTypes: ["flow-event"]`; flows disabled; fixture plugin with `replayEntryTypes: "flow-event"` (string); fixture with `[1, "ok-type"]` | Compute the declared replay set | Enabled → contains `flow-event`. Disabled → does not. String-valued field → contributes nothing; array with a non-string → contributes nothing (assumed, G6). No throw in any case |
| E10 | plugin-entry-replay / on-demand-session-replay: seq-ordered replay | EP | L1 | automated | Declared set `{ "demo-event" }`; JSONL `custom` entries `demo-event` with `seq` 2, 0, 1 → `flow_tool_call`, `flow_started`, `flow_agent_started`; one undeclared `customType: "other-event"` entry | `replayEntriesAsEvents(entries, declared)` | `event_forward`s in order `flow_started`, `flow_agent_started`, `flow_tool_call`, each `data` deep-equal to its record; 0 `event_forward` for `other-event` |
| E11 | plugin-entry-replay: malformed records skipped | EP | L1 | automated | Declared `demo-event` records: no `eventType`; `eventType: 42`; `eventType: null`; then one valid `{ seq: 3, eventType: "flow_complete", data: {} }` | Replay | Exactly one `event_forward` (`flow_complete`); no throw |
| E12 | plugin-entry-replay: extra fields ignored | EP | L1 | automated | Record `{ seq: 0, eventType: "flow_started", data: { flowName: "research" }, flowRunId: "run-1" }` | Replay with `flow-event` declared | One `event_forward` with `eventType: "flow_started"`, data `{ flowName: "research" }`; no `flowRunId` anywhere in the output |
| E13 | plugin-entry-replay / custom-entry-rendering: declared types excluded from the generic paths | invariant | L1 | automated | JSONL: 2 `message`, 1 `model_change`, 1 `custom_message` (`display` omitted), 1 declared `flow-event`, 1 undeclared `e2e:note` | Replay with and without the `flow-event` entry present | Message, `model_change`, custom-message and `e2e:note` `custom_entry` output deep-equal across both runs; 0 `custom_entry` with `customType: "flow-event"` |
| E14 | plugin-entry-replay / flows-plugin: undeclared plugin entries stay hidden | decision table | L1 | automated | Flows disabled: replay set empty, exclude-only set `{ "flow-event" }` (assumed, G5); JSONL with 3 `flow-event` entries | Replay | 0 `flow_*` `event_forward`; 0 `custom_entry` for them; other replay output unchanged |
| E15 | plugin-entry-replay / custom-entry-rendering: no live generic forward | decision table | L1 | automated | Declared `{ "flow-event", "my-ext:run" }` | `entry_appended` for `customType` `flow-event`, `my-ext:run`, `e2e:note` | `null`, `null`, `{ customType: "e2e:note", data, entryId }` |
| E16 | custom-entry-rendering: client reducer refuses declared types | decision table | L1 | automated | Client reducer given the declared set `{ "demo-event" }` | Reduce `message_end` role `custom` and `custom_entry` events with `customType` `demo-event`, then `e2e:note` | 0 `role: "custom"` rows for `demo-event`; 1 row each for `e2e:note` |
| E17 | custom-event-groups: declared types are never grouped | decision table | L1 | automated | Declared `{ "flow-event", "my-ext:run" }`; groups include `other` and shipped `flows` (`^pi-flows-help$`) | Resolve `flow-event`, `my-ext:run`, `pi-flows-help`, `zzz:unknown` | `undefined`, `undefined`, `flows`, `other` |
| E18 | flows-plugin: fan-out items render as a group | state-transition | L1 | automated | `flow_started` steps `[{ id: "review" }]` | `flow_agent_started` `stepId: "review"` with `itemIndex` 0, 1, 2 | `groups.review` = item cards `review[0]`, `review[1]`, `review[2]`; the pre-listed `review` card is the group parent; no card has `isRerun` |
| E19 | flows-plugin: item-indexed events target the item | invariant | L1 | automated | Group `review` with items 0 and 1 running | (a) `flow_tool_call`, `flow_assistant_text`, `flow_thinking_text` with `itemIndex: 1`; (b) `flow_tool_result` then `flow_agent_complete` with `itemIndex: 0`; (c) `flow_assistant_text` without `itemIndex` | (a) only `review[1]` changes (`review[0]` and the parent deep-equal before/after). (b) only `review[0]` changes. (c) only the parent `review` changes |
| E20 | flows-plugin: item error appends without status change | state-transition | L1 | automated | `review[2]` `running`, `detailHistory.length = n` | `flow_agent_error` `stepId: "review"`, `itemIndex: 2`; then one without `itemIndex` | `review[2].detailHistory.length = n + 1`, status still `running`; the second appends to the parent's `detailHistory` |
| E21 | flows-plugin: group parent status precedence | decision table | L1 | automated | Item status pairs: (running, error-soft); (started-pending, complete); (error-soft, complete); (error-soft, error-hard); (blocked, complete); (blocked, error-soft); (skipped, skipped); zero items; (complete, complete) | Derive the parent | running; running; error/soft, rollup 1 ok 1 failed; error/hard; blocked; error/soft; skipped; skipped, rollup 0/0; complete, rollup 2 ok 0 failed |
| E22 | flows-plugin: failure is not hidden by order | invariant | L1 | automated | Group `review`, items 0 and 1 | Sequence A: item 0 fails soft, then item 1 succeeds. Sequence B: the reverse | Both: parent `error` / `soft`, rollup 1 ok 1 failed |
| E23 | flows-plugin: `flow_decision` stores routes, unchosen targets skipped | decision table | L1 | automated | Decision `triage` with branches → `fix`, `doc`; both `pending` | `flow_decision { stepId: "triage", labels: ["bug"], routes: [{ branch: "fix" }] }` | `triage` stores `labels`/`routes`; `doc` = `skipped`; `fix` still `pending` |
| E24 | flows-plugin: loop re-entry scope | state-transition | L1 | automated | `doc` `complete` from an earlier iteration; `report` (not a `triage` target) `complete` | New `flow_decision` for `triage` choosing `fix` | `doc` = `skipped`; `report` = `complete` |
| E25 | flows-plugin: route error marks nothing | decision table | L1 | automated | `fix`, `doc` `pending` | `flow_decision { stepId: "triage", routeError: "for_each must resolve to an array" }` (no routes) | `fix`, `doc` still `pending`; `triage.routeError` equals the text |
| E26 | flows-plugin: empty multi-route choice | BVA | L1 | automated | `fix`, `doc` `pending` | `flow_decision { stepId: "triage", labels: [], routes: [] }` (no `routeError`) | `fix` and `doc` both `skipped` |
| E27 | flows-plugin: skipped never downgraded | state-transition | L1 | automated | `doc` `skipped`, `build` `running`, `x` `pending` | `flow_complete { status: "error" }` | `doc` still `skipped`; `build` and `x` take the same terminal statuses the reducer gave before this change |
| E28 | flows-plugin: rejected `flow_complete` | state-transition | L1 | automated | (a) flow `research` running; (b) no flow slice | `flow_complete { status: "rejected", reason: "A flow is already running" }` | (a) slice status `running`, every card status unchanged. (b) no slice created |
| E29 | flows-plugin: flow types owned by the plugin; `flow_started` seeds the plugin slice | EP + static | L1 | automated | `flow_started { flowName: "research", task: "Find bugs", steps: [r (agent researcher), d (agent developer, blockedBy ["r"])] }`; source of `packages/shared/src/types.ts` | Reduce through the plugin's session-event reducer; scan the source | Plugin slice: `flowName: "research"`, 2 `pending` agents, developer `blockedBy: ["r"]`; `SessionState` has no flow key; the source has 0 `export` of `FlowState`, `FlowAgentState`, `FlowAgentStatus`, `FlowAgentCardConfig`, `NodeKind` |
| E30 | flows-plugin / flow-card-status: graph status words | BVA | L1 | automated | Nodes: fan-out 3 items 0 failed; 3 items 1 failed; 1 item 0 failed; step `doc` skipped; decision `triage` chose `fix`; decision chose `fix` + `doc` | Render `FlowGraph` from `flowStateToGraphSteps` | Text: `review` … `x3`; `review` … `x3 (1 failed)`; `x1`; `doc` … `skipped` with the pending style class; `triage` … `fix`; `triage` … `fix` and `doc`. The step name is the first text in every node |
| E31 | flow-card-status: graph stays minimal | invariant | L1 | automated | Item output `RESULT-XYZ`, decision label `bug found`, per-item results | Render `FlowGraph` | Graph text contains none of `RESULT-XYZ`, `bug found`; no `flow-ref` node; `flowRefSteps` never read |
| E32 | flows-plugin: static YAML keeps object branches | EP | L1 | automated | `branches: { bug: { to: fix, means: "bug found" }, many: { to: review, for_each: "{{items}}" }, legacy: doc, broken: { means: "x" } }` | `parseFlowYaml` → edges | Edges to `fix` (`bug`), `review` (`many`), `doc` (`legacy`); none for `broken` (assumed, G8); no throw |
| E33 | flows-plugin: `plugin_action` six actions | decision table | L1 | automated | pi session `s1` (driver absent); `emitEventToSession` spy | `flow.abort`; `flow.toggle-autonomous`; `flow.dismiss-summary`; `flow.delete { flowName: "batch:apply" }`; `flow.run { flowName: "research", task: "Find bugs" }`; `flow.set-edit-mode { enabled: true }` (current state off) | Exact emits, in order: `flow:abort` then `flow:architect-abort`; only `flow:toggle-autonomous`; only `flow:summary-dismissed`; `flow:delete-request { flowName }` then `flow:notify`; only `flow:run { flowName: "research", task: "Find bugs" }`; only `flow:set-edit-mode { enabled: true }` |
| E34 | flows-plugin: invalid payloads emit nothing | EP | L1 | automated | `flow.set-edit-mode` `enabled` `"true"`, `1`, missing; `flow.delete` / `flow.run` `flowName` `""`, `"   "`, `42`, `"../x"`, `"a/b"`, `"x\ny"` (assumed, G1) | Dispatch each | 0 emits for each; one `logger.warn` and +1 rejected-plugin-action counter per invalid `flowName` / payload (assumed, G2) |
| E35 | flows-plugin: unknown action, foreign plugin, missing session | decision table | L1 | automated | `{ pluginId: "flows", action: "flow.rename" }`; `{ pluginId: "other", action: "flow.abort" }`; `{ pluginId: "flows", action: "flow.abort" }` with no `sessionId` | Dispatch each | 0 emits for all three; a warn naming `flow.rename` and the rejected counter +1 for the first; no warn or counter for `other` |
| E36 | flows-plugin: ACP refused before relay | decision table | L1 | automated | Session `a1` with `driver: "acp"` (assumed seam, G14); session `p1` driver absent | Each of the 6 actions for `a1`; `flow.abort` for `p1` | `a1`: 0 emits for all 6, warn containing `unsupported_for_acp`, rejected counter +6 (assumed, G3). `p1`: abort emits 2 |
| E37 | flows-plugin: flow control plugin route | decision table | L1 | automated | Real tier gate + network guard + operate predicate; operate / observe bearers; trusted-network caller with no credentials; pi session `p1`; ACP session `a1` | POST `/api/plugins/flows/control`: abort `p1` (operate); run `research` / `Find bugs`; set-edit-mode `enabled: false` while the effective mode is on; set-edit-mode `enabled: false` while it is already off; `action: "flow.rename"`; observe bearer abort; no-cred abort; abort `a1`; abort `sessionId: "nope"` | 200 `{ success: true }` + 2 emits; `flow:run { flowName: "research", task: "Find bugs" }`; `flow:set-edit-mode { enabled: false }`; 0 emits for the already-off case (assumed, G16); 400 + 0 emits; 403 `insufficient_scope` + 0; 403 + 0; 409 `code: "unsupported_for_acp"` + 0; 404 + 0 (status codes other than ACP assumed, G4) |
| E38 | flows-plugin / flow-trigger: manifest `emits` and claims | EP | L1 | automated | Real `packages/flows-plugin/package.json` through the real seam + emits gate | Load the manifest; `emitEventToSession` each of the 8 events | `emits` ⊇ {`flow:run`, `flow:set-edit-mode`, `flow:abort`, `flow:architect-abort`, `flow:toggle-autonomous`, `flow:summary-dismissed`, `flow:delete-request`, `flow:notify`}; 0 emits-refusal warnings; `replayEntryTypes` = `["flow-event"]`; `claims[]` has no `slot: "command-route"` with `command` starting `/flows` |
| E39 | flow-controls: header Abort / Auto dispatch | EP | L1 | automated | `FlowDashboard` with running flow, `autonomousMode: true` from `flow_started`; send spy | Click Abort; click Auto | Auto renders active (`aria-pressed="true"`) before the click; sent `{ type: "plugin_action", pluginId: "flows", action: "flow.abort", sessionId }` then `…"flow.toggle-autonomous"…`; 0 messages with `type` `flow_control` / `flow_management`; no Abort button when no flow is active |
| E40 | flows-running-status-pill: Abort dispatch + visibility | decision table | L1 | automated | `flowState` running `custom:test` 1/3 done; then status `success`, `error`, `aborted`; then `null` | Render the FLOWS subcard; click Abort while running | Running: pill text `custom:test · 1/3 agents` + spinner; click sends `plugin_action` `flow.abort` with `sessionId` via `usePluginSend`, no `flow_control`. success/error/aborted: no Abort button. `null`: no pill |
| E41 | flows-plugin: remaining client actions use `plugin_action` | EP | L1 | automated | `FlowSummary` (completed flow); `useFlowActions` run + delete; `SessionFlowActions` edit-mode toggle | Click Dismiss; run `research`; delete `batch:apply`; toggle edit mode | Sent `action`s: `flow.dismiss-summary`; `flow.run { flowName: "research" }`; `flow.delete { flowName: "batch:apply" }`; `flow.set-edit-mode { enabled: <bool> }`; all `pluginId: "flows"`; 0 `flow_control` / `flow_management` |
| E42 | flows-plugin: gates send nothing on mount | invariant | L1 | automated | Session with `flows:*` commands, empty catalog, edit mode on; menu never opened | Mount the action-bar claim and the dock chip; re-render 3× | 0 sent messages of any `flow.set-edit-mode` `plugin_action` or `flow_management`; menu offers only **New flow…** |
| E43 | dashboard-server / shared-protocol: generated surfaces regenerated | static | L1 | automated | Regenerated MCP tools manifest, `verb-tiers.generated.ts`, bus-client `generated/verbs.ts` | Run the generated-freshness and verb-completeness suites | Freshness passes; 0 entries named `flow_control` / `flow_management` in all three |
| E44 | dashboard-server: skill commands call the plugin route | static | L1 | automated | `packages/extension/.pi/skills/pi-dashboard/**` | Scan `commands/dashboard-flow-abort.md`, `dashboard-flow-auto.md`, `scripts/dashboard-api.sh`, `scripts/dashboard-bus.ts`, `references/*` | Both command files exist under unchanged names and reference `/api/plugins/flows/control`; 0 occurrences of `/flow-control` or `flow_control` |
| E45 | plugin-core-boundary / dashboard-shell-slots: literal gate | decision table + BVA | L1 | automated | tmp tree: `"flow:complete"` in `packages/extension/src/bridge.ts`; `case "flow_control":` in `packages/server/src/pairing/browser-gateway.ts`; `"flow-event"` in `packages/shared/src/x.ts`; `'pi-flows'` in `packages/client/src/y.ts`; `// flow:complete` comment; `"flow-event"` in `packages/shared/src/__tests__/state-replay.test.ts`; literal in `packages/client/src/generated/plugin-registry.tsx`; allowlisted `"pi-flows"` in `recommended-extensions.ts`; `"flow:x"` in `packages/flows-plugin/src/a.ts`; `"overflow:hidden"`, `"workflow-x"`, `"flow"` | `node scripts/check-plugin-boundary.mjs --root <tmp>` per case | The first four: non-zero exit, each reported with file, line and literal. Every other case: exit 0, nothing reported |
| E46 | plugin-core-boundary: real tree clean | static | L1 | automated | The cleaned repo tree + `scripts/plugin-boundary-allowlist.json` | Run the gate on the real tree; read `DEBUG_TOOL_NAMES` | Exit 0. Allowlist rows cover exactly `recommended-extensions.ts`, `custom-event-groups.ts` (`pi-flows-help`) and `provider-auth-routes.ts` (`flow_input`). `state-replay.ts` / `custom-entry-forward.ts` hold no `flow-event` literal. `DEBUG_TOOL_NAMES` = {`resources_discover`} |
| E47 | hide-debug-events: pi-flows tools are not debug tools | decision table | L1 | automated | Debug toggle off; completed tool results `flow_agents`, `flow_results`, `resources_discover` | Render `ChatView` | `flow_agents` and `flow_results` steps render; `resources_discover` hidden; toggle on → all 3 render |
| E48 | catch-all-event-forwarding: probe channel renamed | EP | L1 | automated | `provider-register` handler; forwarding wiring ready+connected | Emit `models:get-available` with a probe; emit `flow:get-available-models` with a probe | First probe filled by the handler, 0 `event_forward`; second probe untouched; core forwarded set contains neither |
| E49 | catch-all-event-forwarding / flow-event-bridge: core map holds only subagents | decision table | L1 | automated | Core wiring; flows plugin disabled vs enabled (declaration emitted) | Inspect exports; emit `subagents:created`, `flow:flow-started` | `SUBAGENT_EVENT_MAP` exported; no `FLOW_EVENT_MAP` export; every core key starts `subagents:`. Disabled: `subagent_created` forwarded, `flow:flow-started` not forwarded, no error. Enabled: exactly one `flow_started` (plugin path) |
| E50 | flow-plugin-e2e: contract-pinned hermetic suite | EP | L1 | automated | Event types read from the flows bridge declaration constant (`as` values) | Reduce started → agent-started → agent-complete → complete from null; reduce every declared type against a seeded state | Status reaches `complete`, agents terminal; no throw for any type; types without a case leave state reference-equal; the source imports nothing from `packages/extension` |
| E51 | flows-plugin: automation `flows.run` finalizes | state | L1 | automated | Automation run on session `s1` started with flow `research` | `flow_complete { flowName: "research", status: "success" }` delivered through the plugin-declared `stream` channel | Automation run finalizes once with success |
| E52 | flow-panel-collapse-persistence: `cards` kind | EP + fault | L1 | automated | Sessions A, B; then a `localStorage` that throws on get/set | `flowCollapseKey("cards", "A")`; read the default; set A open; remount; toggle with the throwing storage | Key `dashboard:flow-cards-collapsed:A`; default collapsed (true); A reads open after remount, B still collapsed; with the throwing storage the toggle flips in memory and nothing throws |
| E53 | flow-card-grid: Agent cards header summary | EP | L1 | automated | 5 steps, one a fan-out of 3 items; 2 done, 1 running, 1 failed, 1 skipped | Render the expanded `FlowDashboard`, section collapsed | Header shows `5` steps; pills done 2, running 1, failed 1, skipped 1 (zero pills not asserted, G7); button `aria-expanded="false"`; `aria-controls` names an element id present in the DOM |
| E54 | flow-card-grid: node click / reduced motion / re-click | state-transition | L1 | automated | Section collapsed; `scrollIntoView` spy; `matchMedia('(prefers-reduced-motion: reduce)')` false, then true | Click node `build`; click `build` again; with reduced motion click node `review` (fan-out) | 1st: `aria-expanded="true"`, `build` selected, spy called with `block: "nearest"` on `build`'s card. 2nd: selection cleared, still expanded. Reduced motion: called on the `review` group element with `behavior` ≠ `"smooth"` |
| E55 | flow-card-grid / flow-panel-collapse-persistence: graph-first panel | state-transition | L1 | automated | Session with no stored collapse state | `flow_started`; expand the panel; then complete + dismiss the summary | After start: header only. Expanded: graph visible, Agent cards section collapsed, no agent card visible. After dismiss: `FlowDashboard` absent |
| E56 | flows-plugin: group, decision and skipped cards | EP | L1 | automated | Group `review` with 3 items (1 failed); decision `triage` chose `fix` (not `doc`); step `doc` skipped | Render `FlowAgentCard`s | `review` card holds 3 item cards plus pills showing 2 ok and 1 failed; `triage` shows route pill `fix` and a "not taken" chip `doc`; `doc` card shows the text `skipped` |
| E57 | flow-summary-view: frozen cards from the plugin slice | invariant | L1 | automated | Completed flow, 3 agents in the plugin slice, one with empty card content | Mount `FlowSummary`; then reduce a late `flow_agent_complete` | 2 cards + 3 summary lines with cards above the lines; eye popover reaches tool history; cards unchanged after the late event; no throw |
| E58 | shared-protocol: plugin-declared types stored and broadcast | EP | L1 | automated | Memory event store + subscribed browser stub | `event_forward` with `eventType: "flow_decision"` (new type) and `"flow_started"` | Both stored and broadcast as `EventMessage` with `eventType` and data unchanged |
| E59 | flow-browser-protocol / shared-protocol: WS tables drop flow types | static | L1 | automated | `ws-message-scope`, `ws-road-classification`, `ws-message-tiers` tables | Read each table | No `flow_control` / `flow_management` key; `plugin_action` present in each |
| E60 | command-routing: typed flow command rides extension dispatch | decision table | L1 | automated | `pi.getCommands()` includes `{ name: "deploy-prod", source: "extension" }` | `send_prompt` `/deploy-prod fix it` (idle, then streaming) | `pi.sendUserMessage("/deploy-prod fix it", { expandPromptTemplates: true, deliverAs })` once each; 0 `flow:list-flows` emits |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | flow-event-bridge: reconnect retention (stream per-key bound, G13) | BVA | L1 | automated | Bridge disconnected; fan-out items of `stepId: "review"` emit 1999 / 2000 / 2001 `flow:assistant-text` frames (one shared key) | Flushed count = 1999 / 2000 / 2000; the 2001 case drops exactly the oldest frame; `pluginEventForward.dropped` +0 / +0 / +1 | One disconnect → reconnect |
| P2 | flow-event-bridge: stream key budget shared with subagent streams (design Risks) | BVA | L1 | automated | Disconnected; subagents plugin stream keys `a1`…`a59` then flows `stepId` keys `s1`…`s5` (64), then `s6` (65) | At 64 keys: 0 evicted. At 65: `evictedKeys` = 1 (`a1`, the oldest); remaining 64 keys flushed in global seq order | One disconnect → reconnect |
| P3 | flow-event-bridge: stream byte bound | BVA | L1 | automated | Disconnected; one `stepId` key; `flow:thinking-text` frames of 1 MiB × 3 | Retained bytes for the key ≤ 2 MiB after each push; the newest frame is always retained; `dropped` +1 at the third frame | One disconnect → reconnect |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | flow-panel-collapse-persistence / flow-card-grid: Agent cards section persists per session | state-transition | L3 | automated | `openIdleGrid` fixture (6-step attached flow) in session A; second fresh session B | Expand the panel; read the section; open it; `page.reload()`; reselect A; open B's panel | A before opening: disclosure `aria-expanded="false"`, 0 visible agent cards. After opening + reload: still open, 6 cards visible. B: section collapsed |
| F2 | flow-card-grid: node click reveals the card | state-transition | L3 | automated | `openIdleGrid` panel, section collapsed, pane height so the `bare` card starts out of view | Click the graph node `bare`; click it again | First click: section `aria-expanded="true"`, `bare` card has the selected marker, and its bounding box lies inside the scroll container's visible rect. Second click: no selected marker, section still open |
| F3 | flow-card-grid: disclosure hit target | BVA | L3 | automated | `openIdleGrid` panel | Measure the disclosure button at viewport 375 px and 1280 px (applied after the panel opens) | Height ≥ 44 px at 375; ≥ 32 px at 1280 |
| F4 | flows-plugin / flow-event-bridge: real pi-flows 0.10 fan-out, decision, skipped (New infra) | convergence | L3 | automated | Harness with pi-flows 0.10.0 and a baked `e2e:fanout` flow: multi decision `triage` routes `fan` (`for_each` over 3 items, faux agents, 1 item fails soft) and leaves `doc` untaken | Run the flow from the FLOWS chip; open the Agent cards section | Converges to: `fan` group card with 3 item cards and 1 failed; graph node `fan` shows `x3 (1 failed)`; `doc` node and card show `skipped`; `triage` node shows `fan` as its chosen route; flow reaches a terminal status |
| F5 | plugin-entry-replay / on-demand-session-replay: replay after the flush | convergence | L3 | automated | Fresh session; `sendPrompt` `[[faux:…]]` so pi has an assistant message; run `e2e:synthetic` to completion | Snapshot agent names and statuses; `page.reload()`; reselect the session | After reload, the same agent names and statuses render in the flow summary; 0 `custom-entry-card` elements for `flow-event` |
| F6 | flows-plugin / plugin-entry-replay: disabled plugin hides persisted runs | state-transition | L3 | automated | Session from F5's setup (persisted `flow-event` entries) | POST `/api/plugins/flows/toggle { enabled: false }`; reload; select the session; restore `enabled: true` afterward | 0 `flow-dashboard`, FLOWS subcard, `FlowSummary` or `FlowAgentDetail`; 0 `custom-entry-card` for the flow entries; no page error |
| F7 | flow-controls / flow-trigger / flows-running-status-pill: Abort end-to-end | convergence | L3 | automated | `e2e:synthetic` running, WS frames recorded | Click the panel header Abort | Outgoing frame `{ type: "plugin_action", pluginId: "flows", action: "flow.abort" }`; 0 outgoing `flow_control`; the panel converges to the aborted status |
| F8 | flows-plugin: group / decision / skipped cards match mockup frame 1 | visual / subjective | — | manual-only | `mockups/2026-11-04-flows-plugin-update/` frame 1 next to a live 0.10 fan-out run | A human compares them | [judgment: the group card, route pills, "not taken" chips and skipped state read like the approved mock in light and dark themes — no automatable observable] |
| F9 | flow-card-grid: graph-first panel matches mockup frame 3 and reads well to a screen reader | visual / accessibility | — | manual-only | Expanded panel on desktop and on a 375 px phone; VoiceOver | A human compares with frame 3 and walks the disclosure with VoiceOver | [judgment: the graph stays readable with the status words, and the disclosure announces as "Agent cards, collapsed" with its step count — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | flow-event-bridge: events during a reconnect | fault-injection (abort) | L1 | automated | Bridge socket down | Emit `flow:agent-started { stepId: "build" }`, `flow:agent-complete { stepId: "build" }`, `flow:decision { stepId: "triage" }`, `flow:complete { flowName: "research" }`, `flow:summary-ready {}`; reconnect | Forwards exactly `flow_agent_started`, `flow_agent_complete`, `flow_decision`, `flow_complete` in emission order, each data unchanged; `flow_summary_ready` neither forwarded nor retained |
| X2 | flow-event-bridge: frame missing its key | fault-injection | L1 | automated | Socket down; pre-0.10 style `flow:agent-started` with no `stepId` | Emit it, then reconnect | Not retained; `keyRejected` +1; nothing flushed for it; no throw |
| X3 | flow-browser-protocol: old tab sends `flow_control` | illegal transition | L1 | automated | Browser socket from an un-reloaded tab | Gateway receives `{ type: "flow_control", sessionId: "s1", action: "abort" }` | `piGateway.sendToSession` not called; no plugin handler invoked; socket stays open; no throw |
| X4 | bridge-message-pump: retired `flow_control` inbound | illegal transition | L1 | automated | Bridge inbound pump with the serialized lane busy | Deliver `{ type: "flow_control", action: "abort" }` | Queued on the serialized lane in wire order; on dispatch: 0 `pi.events.emit`, 0 `connection.send`, bridge state unchanged |
| X5 | dashboard-server / flows-plugin: REST cutover on the real server | fault-injection (removed route) | L3 | automated | Docker harness server, operate credentials of the `request` fixture | POST `/api/session/<sid>/flow-control { action: "abort" }`; POST `/api/plugins/flows/control { sessionId: <sid>, action: "flow.rename" }` | First: 404 JSON (API not-found shape). Second: 400 (assumed, G4) — the plugin route is registered and answers |
| X6 | flows-plugin: relay not delivered | fault-injection (abort) | L1 | automated | `emitEventToSession` returns `false` (bridge gone) | `plugin_action flow.abort`; POST route abort | No throw; info log with `delivered=false`; route answers 200 `{ success: true }` (assumed, G9) |
| X7 | plugin-entry-replay: offline session replays from the manifest set | fault-injection (no bridge) | L1 | automated | Ended session, no live bridge; flows manifest discovered + enabled; JSONL with 3 `flow-event` records | Server cold-load replay | 3 `flow_*` `event_forward`s in seq order; set taken from the manifest, not from a runtime declaration |
| X8 | plugin-entry-replay: KNOWN BLOCKER (not yet flushed) | fault-injection | L1 | automated | Session JSONL with `message` entries but 0 `flow-event` entries (flow started before the first assistant message) | Replay with `flow-event` declared | 0 `flow_*` `event_forward`; message replay unchanged; no throw |
| X9 | observability: health counters | invariant | L1 | automated | 1 declared replay type; replay of 3 declared entries; 2 rejected `plugin_action`s; 1 `as` conflict | GET `/api/health` | Declared-replay-types counter = 1, replayed-plugin-entries +3, rejected-plugin-actions +2, `pluginEventForward.conflicts` +1 (names per task 1.7, G2); existing `pluginEventForward` keys unchanged |
| X10 | flows-plugin: pre-0.10 producer | fault-injection (older peer) | L1 | automated | pi-flows 0.9-shape events: no `itemIndex`, no `flow_decision`, no `skipped` | Reduce a 2-step lifecycle | One card per step, `groups` empty, final state deep-equal to the pre-change reducer for the same sequence |

---

## Coverage summary

- Requirements covered: 58/58 ADDED + MODIFIED. The 13 REMOVED requirements are covered by absence checks (E43, E46, E49, E59, X3, X4, X5).
  - flows-plugin (15):
    - types E29;
    - fan-out group E18;
    - item-indexed E19, E20;
    - parent status E21, E22;
    - decision E23–E26;
    - skipped E27;
    - graph E30;
    - YAML E32;
    - `plugin_action` E33–E36, X6;
    - emits E38;
    - route E37, X5;
    - `flow_started` E29;
    - `flow_complete` E27, E28;
    - disable E14, E49, F6;
    - gates E42.
  - plugin-entry-replay (8):
    - manifest E9;
    - seq order E10, E13;
    - malformed E11;
    - exclusion E13, E15, E16;
    - hidden E14, F6;
    - no literal E46;
    - persisted only X8, F5;
    - extra fields E12.
  - flow-event-bridge (5):
    - declaration E4, X1, X2, P1–P3, F4;
    - resend E8;
    - exports E49;
    - nodeKind E5;
    - edit-mode E33, E34.
  - plugin-event-forwarding (3): commands-changed E6; single owner E2, E3; validation E1.
  - catch-all-event-forwarding (3): E48, E49.
  - custom-entry-rendering (3): E13, E15, E16.
  - flow-card-grid E53–E55, F1–F3. flow-panel-collapse-persistence E52, E55, F1.
  - flow-card-status E30, E31. flow-controls (2) E39, F7. flows-running-status-pill E40, F7. flow-trigger E38, F7.
  - flow-plugin-e2e E50. flow-summary-view E57. hide-debug-events E47. on-demand-session-replay E10, E11, E14, X7.
  - plugin-core-boundary E45, E46. dashboard-shell-slots E45, E46, E29.
  - bridge-decomposition (2) E6, E7, E49, X4. bridge-message-pump X4. browser-gateway-decomposition X3.
  - custom-event-groups E17. session-skill-registry E7. shared-protocol E58, E59. command-routing E60.
- Scenarios by class: edge 60 · perf 3 · frontend 9 · error 10 (82 total).
- Scenarios by level: L1 72 · L2 0 · L3 8 · ci 0 · manual-only 2.
- Scenarios by disposition: automated 80 · manual-only 2.

## New infra needed

- **F4:** the docker harness pins `PI_FLOWS_VERSION=0.8.1` (`docker/Dockerfile:128`). F4 needs:
  - a bump to `0.10.0`, the design's producer floor;
  - a baked `e2e:fanout` fixture flow under `docker/fixtures/sample-git/.pi/flows/flows/e2e/` (a multi decision routing a 3-item `for_each` fan-out with one faux item failing soft, plus one untaken branch);
  - faux scenarios for those agents.

  The other real-engine flow specs (`flow-roundtrip`, `flow-live-no-double-render`) are quarantined under #683. F4, F5 and F7 may land as `fixme` in the same way until #683 is resolved.
- **F1:** `tests/e2e/helpers/flow-card-grid.ts` `openIdleGrid` must open the Agent cards section, or offer a variant that does. The existing `flow-card-grid-geometry.spec.ts` rows must use it (G15).
