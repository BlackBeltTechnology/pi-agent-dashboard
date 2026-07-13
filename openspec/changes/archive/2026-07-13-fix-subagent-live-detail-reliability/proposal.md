## Why

The subagent inspector's live timeline streams intermittently — "sometimes the details stream live, sometimes not." Root cause: the running-subagent map is fed only by best-effort, fire-and-forget `event_forward` frames (gated on `sessionReady && isActive()`, throttled, no sequence numbers, no replay), while only the *completed* case has a durable, replayable source (the reducer backfill from the embedded `tool_execution_end` result). A dropped/gated frame leaves the detail panel empty or stale until the next tick — or until completion. Two secondary defects compound it: the reducer overwrites a populated `entries[]` with an empty array, and the subagent detail opens via `window.open` popout instead of the `ui:dialog` primitive the sibling `flow-agent-detail` spec already mandates (broken on Electron/PWA/mobile).

## What Changes

- Treat the running-subagent timeline as reconcilable state, not fire-and-forget: buffer/queue subagent `event_forward` frames emitted while `!sessionReady` (reconnect, discovery, `/reload`) and flush them on re-register, so a transient connection gap self-heals instead of dropping frames.
- Add a resync path so the client can recover a running subagent's current timeline after a detected gap or reconnect (snapshot-on-demand / last-frame replay), not only after completion.
- Reducer merge guard: an incoming `entries: []` SHALL NOT overwrite an already-populated `entries[]` for a subagent (empty-array overwrite hazard in `readSubagentDetails`).
- Subagent detail opens in the shell `ui:dialog` primitive (parity with `flow-agent-detail`), retiring the `window.open(..., "_blank")` popout button on the subagent card.
- Coordinated (sibling `pi-dashboard-subagents` package, separate repo): emit a timeline entry on tool `start` (not only `end`) so in-flight/wedged tools are visible; add a timeout to the synchronous `session.prompt()` spawn so a wedged subagent surfaces as an error instead of hanging silently. Tracked here for traceability; landed in that package.

## Capabilities

### New Capabilities
- `subagent-live-detail-reliability`: The running-subagent timeline is reconcilable, not fire-and-forget — frames emitted during a connection gap are buffered and flushed on re-register, a resync path recovers current state after a gap/reconnect, and a populated `entries[]` is never clobbered by an empty-array frame. Live detail streaming reaches parity with the durable completed-case backfill.

### Modified Capabilities
- `agent-tool-rendering`: The subagent detail affordance opens the timeline in the shell `ui:dialog` primitive instead of a `window.open` popout, mirroring `flow-agent-detail`'s dialog contract.

## Impact

- **Bridge transport** — `packages/extension/src/bridge.ts` (the `pi.events.emit` intercept → `connection.send("event_forward")`): buffer-while-not-ready + flush-on-register for the `subagent_*` channels; add a resync responder.
- **Event reducer** — `packages/client/src/lib/event-reducer.ts` (`readSubagentDetails` + `subagent_started`/`subagent_completed` arms): empty-array overwrite guard.
- **Subagent card** — `packages/client/src/components/tool-renderers/AgentToolRenderer.tsx` (`CardControls` popout button) → `ui:dialog` wrapping `SubagentDetailView` in `popout` mode; `onBack` → close.
- **Subagents plugin client** — `packages/subagents-plugin/src/client/` (`SubagentDetailView`, possibly retiring/repurposing `SubagentPopoutPage`/`SubagentPopoutClaim` route usage).
- **Specs referenced** — `flow-agent-detail` (dialog pattern precedent), `subagents-plugin-state` (`useSessionSubagents` primitive), `shared-timeline-view` (`MinimalChatView`).
- **Sibling repo** — `@blackbelt-technology/pi-dashboard-subagents` (`extensions/agent.ts`, `extensions/events.ts`): tool-start entry emission + spawn timeout (coordinated, out of this repo's edit scope).

## Discipline Skills

- `systematic-debugging` — confirm the completed-case renders (rule out a second bug) and reproduce the drop/gap deterministically before changing the transport.
- `observability-instrumentation` — the whole defect is invisibility of subagent state; add gap/drop detection and a resync trigger with runtime signals.
- `node-inspect-debugger` — inspect the live bridge `event_forward` path and reducer merge at runtime (jiti server + WS closures) to verify buffering/flush behavior.
