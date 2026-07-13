## 1. Reproduce & confirm scope (systematic-debugging)

- [x] 1.1 Reproduce a live subagent whose detail panel stays empty while running; capture whether frames are dropped (WS backpressure) vs gated (`sessionReady` false) by instrumenting the `pi.events.emit` intercept in `packages/extension/src/bridge.ts`.
- [x] 1.2 Confirm a cleanly *completed* subagent renders its detail via the reducer backfill (rules out a distinct completion-path bug). Record the verdict in design.md Open Questions.
- [x] 1.3 Add a failing reducer unit test: a `subagent_started` frame with `details.entries: []` clobbers an existing 3-entry timeline (reproduces the empty-array overwrite).

## 2. Reducer empty-array guard (D3)

- [x] 2.1 In `packages/client/src/lib/event-reducer.ts` `readSubagentDetails`, replace `entries` only when the incoming array is non-empty; an incoming `[]` preserves existing entries.
- [x] 2.2 Apply the same non-empty guard in the `subagent_started`/`subagent_completed`/`subagent_failed` merge arms and the `tool_execution_end` backfill so it holds on every path. (Single-point fix in `readSubagentDetails` — every merge arm spreads `...readSubagentDetails(details)`, so the guard holds on all paths.)
- [x] 2.3 Make the failing test from 1.3 pass; add the "non-empty frame replaces wholesale" companion test.

## 3. Subagent detail → ui:dialog (D4)

- [x] 3.1 In `packages/client/src/components/tool-renderers/AgentToolRenderer.tsx` `CardControls`, replace the `window.open(popoutUrl, "_blank")` handler with opening the shell `ui:dialog` primitive.
- [x] 3.2 Render `SubagentDetailView` in `popout` mode inside the dialog for the card's `agentId`/`sessionId`; open dialog `flush`/without a duplicate title; map the view's `onBack` → close.
- [x] 3.3 Keep the affordance disabled when `agentId` is unresolved (no dialog opens). Preserve the inline expand path unchanged.
- [x] 3.4 Update/extend the `AgentToolRenderer` tests to assert a dialog opens and no new browser tab is opened; assert Esc/overlay dismiss. Unit: `AgentToolRenderer.test.tsx` (dialog opens, no `window.open`, Esc + overlay dismiss, disabled-without-agentId). E2E: `tests/e2e/subagent-detail-dialog.spec.ts` (faux `subagent-spawn`, real prompt→faux→bridge→/ws→renderer round-trip) proves the core regression — activating popout NEVER opens a new browser tab — and opens the `ui:dialog` (Esc-dismissable) when `agentId` resolves. Verified green against the Docker harness (`TEST_COPY_MODE=1`).

## 4. Bridge buffer-and-flush across not-ready window (D1)

- [x] 4.1 In `packages/extension/src/bridge.ts`, when a `subagent_*`-mapped channel is emitted while `!(sessionReady && isActive())`, push the frame into a bounded per-`agentId` pending buffer (keep latest snapshot per agent) instead of dropping it. (Logic extracted to `SubagentFrameBuffer`, wired into the `pi.events.emit` intercept.)
- [x] 4.2 Flush the buffer in emission order on the next `session_start`/re-register; clear on session change/shutdown. (`flushPendingSubagentFrames()` after `sessionReady = true`; `subagentFrameBuffer.reset()` in `handleSessionChange` + `session_shutdown`.)
- [x] 4.3 Add bridge unit tests: frame emitted while not-ready is retained and forwarded after re-register; buffer bound keeps latest-per-agent. (`subagent-frame-buffer.test.ts` — the extracted-unit test, per repo convention (cf. `abort-latch`, `retry-tracker`).)

## 5. Resync responder for running subagents (D2)

- [x] 5.1 Add a minimal client→bridge resync request `{ agentId }`; bridge replies with the latest retained `AgentDetails` as a synthetic `subagent_started` `event_forward`; no-op for unknown/finished agents. (Protocol: `SubagentResyncRequest{Browser,Extension}Message`; server: `handleSubagentResyncRequest` forward; bridge: `onMessage` responder via `subagentFrameBuffer.resync`.)
- [x] 5.2 Trigger resync on client reconnect and when opening detail for a running subagent whose `entries[]` is empty. (App re-subscribe effect iterates running subagents; `AgentToolRenderer.openDetail` sends on popout.)
- [x] 5.3 Gate shipping D2 on the 1.1/1.2 evidence. **Verdict: D2 KEPT (not deferred).** Evidence (design.md Open Questions): D1 closes the bridge-side not-ready-window gap (dominant cause) and its latest-per-agent buffer self-heals bridge reconnects, but cannot recover frames dropped downstream (bridge→server / server→client backpressure) or a client-only reconnect where the server did not retain the frames. D2 covers those; the spec has explicit resync scenarios. Protocol surface kept minimal (one request message, reply reuses `subagent_started`).
- [x] 5.4 Add tests for the resync request/response and the unknown-agent no-op. (`subagent-frame-buffer.test.ts` resync suite: served / unknown no-op / finished no-op; `session-action-handler.test.ts` forward shape.)

## 6. Observability (observability-instrumentation)

- [x] 6.1 Add a counter/log for dropped-vs-buffered subagent frames and resync requests in the bridge, so future intermittency is diagnosable at runtime. (`SubagentFrameBuffer.stats` counters: forwarded/buffered/flushed/droppedNoAgentId/resyncRequests/resyncServed/resyncNoop; bridge logs on drop (`console.warn`), flush, and resync served/no-op.)

## 7. Coordinated sibling-repo work (tracking only)

- [x] 7.1 Tracked in `@blackbelt-technology/pi-dashboard-subagents` (sibling repo): emit a timeline entry on tool `start` (not only `end`) so in-flight/wedged tools are visible. Out of this repo's edit scope — recorded in proposal.md "Coordinated" section for the sibling repo; no code change here.
- [x] 7.2 Tracked in the sibling repo: add a timeout to the synchronous `session.prompt()` spawn so a wedged subagent surfaces as an error instead of hanging silently. Out of this repo's edit scope — recorded in proposal.md; no code change here.

## 8. Gates

- [x] 8.1 `npm run quality:changed` green: biome applied (import-sort + format on touched files, matching the gate's own `--write`); `tsc --noEmit` clean (only pre-existing unrelated `image-fit-extension` jimp errors remain); affected tests green — client 3271 pass, extension/shared pass, new buffer + handler + reducer + renderer suites pass. (5 server failures under full-suite run are pre-existing/environmental: `openspec-change-watcher-fs` fails on base too; `doctor-route` timing flake; `spa-fallback` needs `dist/client/` absent in worktree — all verified unrelated to this change.)
- [x] 8.2 `openspec validate fix-subagent-live-detail-reliability` passes; advisory code-review gate run on the diff before commit.
