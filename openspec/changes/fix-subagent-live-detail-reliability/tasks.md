## 1. Reproduce & confirm scope (systematic-debugging)

- [ ] 1.1 Reproduce a live subagent whose detail panel stays empty while running; capture whether frames are dropped (WS backpressure) vs gated (`sessionReady` false) by instrumenting the `pi.events.emit` intercept in `packages/extension/src/bridge.ts`.
- [ ] 1.2 Confirm a cleanly *completed* subagent renders its detail via the reducer backfill (rules out a distinct completion-path bug). Record the verdict in design.md Open Questions.
- [ ] 1.3 Add a failing reducer unit test: a `subagent_started` frame with `details.entries: []` clobbers an existing 3-entry timeline (reproduces the empty-array overwrite).

## 2. Reducer empty-array guard (D3)

- [ ] 2.1 In `packages/client/src/lib/event-reducer.ts` `readSubagentDetails`, replace `entries` only when the incoming array is non-empty; an incoming `[]` preserves existing entries.
- [ ] 2.2 Apply the same non-empty guard in the `subagent_started`/`subagent_completed`/`subagent_failed` merge arms and the `tool_execution_end` backfill so it holds on every path.
- [ ] 2.3 Make the failing test from 1.3 pass; add the "non-empty frame replaces wholesale" companion test.

## 3. Subagent detail → ui:dialog (D4)

- [ ] 3.1 In `packages/client/src/components/tool-renderers/AgentToolRenderer.tsx` `CardControls`, replace the `window.open(popoutUrl, "_blank")` handler with opening the shell `ui:dialog` primitive.
- [ ] 3.2 Render `SubagentDetailView` in `popout` mode inside the dialog for the card's `agentId`/`sessionId`; open dialog `flush`/without a duplicate title; map the view's `onBack` → close.
- [ ] 3.3 Keep the affordance disabled when `agentId` is unresolved (no dialog opens). Preserve the inline expand path unchanged.
- [ ] 3.4 Update/extend the `AgentToolRenderer` tests (and inspector Playwright cases) to assert a dialog opens and no new browser tab is opened; assert Esc/overlay dismiss.

## 4. Bridge buffer-and-flush across not-ready window (D1)

- [ ] 4.1 In `packages/extension/src/bridge.ts`, when a `subagent_*`-mapped channel is emitted while `!(sessionReady && isActive())`, push the frame into a bounded per-`agentId` pending buffer (keep latest snapshot per agent) instead of dropping it.
- [ ] 4.2 Flush the buffer in emission order on the next `session_start`/re-register; clear on session change/shutdown.
- [ ] 4.3 Add bridge unit tests: frame emitted while not-ready is retained and forwarded after re-register; buffer bound keeps latest-per-agent.

## 5. Resync responder for running subagents (D2)

- [ ] 5.1 Add a minimal client→bridge resync request `{ agentId }`; bridge replies with the latest retained `AgentDetails` as a synthetic `subagent_started` `event_forward`; no-op for unknown/finished agents.
- [ ] 5.2 Trigger resync on client reconnect and when opening detail for a running subagent whose `entries[]` is empty.
- [ ] 5.3 Gate shipping D2 on the 1.1/1.2 evidence — if D1 alone eliminates the intermittency in the repro, mark 5.x deferred with rationale rather than merging speculative protocol surface.
- [ ] 5.4 Add tests for the resync request/response and the unknown-agent no-op.

## 6. Observability (observability-instrumentation)

- [ ] 6.1 Add a counter/log for dropped-vs-buffered subagent frames and resync requests in the bridge, so future intermittency is diagnosable at runtime (node-inspect-debugger recipe referenced in design).

## 7. Coordinated sibling-repo work (tracking only)

- [ ] 7.1 Track in `@blackbelt-technology/pi-dashboard-subagents`: emit a timeline entry on tool `start` (not only `end`) so in-flight/wedged tools are visible. Out of this repo's edit scope.
- [ ] 7.2 Track in the sibling repo: add a timeout to the synchronous `session.prompt()` spawn so a wedged subagent surfaces as an error instead of hanging silently. Out of this repo's edit scope.

## 8. Gates

- [ ] 8.1 `npm run quality:changed` green (biome `--changed` + `tsc --noEmit` + affected tests).
- [ ] 8.2 `openspec validate fix-subagent-live-detail-reliability` passes; run the advisory code-review gate on the diff before commit.
