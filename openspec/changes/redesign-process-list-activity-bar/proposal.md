## Why

The session card's PROCESS subcard today is a flat dump of every PGID child the bridge's `ps`-scanner finds. It answers *"what's in this session's process tree?"* — useful as a safety net for leaked dev servers, but rarely what the user actually wants.

What the user usually wants is **"stop what the agent is doing right now."** That action's target lives in a totally different place: it's the in-flight `bash` toolCall rendered by `ChatView` as a streaming `bashOutput` row. Today the ✕ on a ProcessList row maps to `killProcess(pgid)` — SIGTERM→SIGKILL on the OS process tree — not to the agent's `abortToolCall`. The agent sits hanging until its tool returns "killed," producing confused turn state.

Result: two unrelated surfaces ("OS process inventory" and "agent's current activity") share one subcard with one verb, and neither is well-served.

## What Changes

Reorganize the PROCESS subcard into two stacked rows with different roles:

- **Activity bar (top, new).** When the event-reducer has an in-flight `bash` toolCall for the session, render a single prominent line: `⏵ <command>   <elapsed>   [⏹]`. The `⏹` invokes `abortToolCall(toolCallId)`, not PGID kill. Disappears when no bash tool is in flight. Multi-bash sessions render up to N=2 stacked rows (cap, then a "+N more" chip).
- **Background processes drawer (bottom, repurposed).** Today's `ProcessList` becomes a collapsible drawer titled `⚠ N background processes`. Holds PGID-scanner output **minus** PGIDs already represented by activity-bar rows (Phase 2 — Phase 1 ships without dedup). Drawer opens by default when activity bar is empty (pure-orphan state); collapses when activity bar has rows.
- **Mobile compact layout.** Activity bar lines render full-width; drawer collapses to a tappable count chip (`⚠2`) that opens a sheet listing background processes.

Phase 2 (tracked as separate change) wires `bash` toolCalls to the spawned PGID so the drawer can honestly dedup. Phase 1 accepts that an active bash may appear in both rows — documented as known cosmetic issue.

## Capabilities

### New Capabilities

- `session-activity-bar`: Renders an in-flight-tool indicator at the top of the PROCESS subcard. Driven by the event reducer's unresolved-toolCall set, filtered to `bash`. Stop button invokes the abort path (not PGID kill). Up to 2 visible rows with overflow chip. Hidden when no bash tool is in flight.

### Modified Capabilities

- `session-process-tracking`: The bridge-side PGID scanner is unchanged. The client-side render becomes a collapsible drawer ("background processes") that defaults open when the activity bar above is empty and collapses otherwise. The MIN_SLOTS=5 row-floor padding is removed (drawer height bounces are acceptable; activity bar provides the stable surface). The per-row ✕ stays as PGID kill. Overflow tail behavior preserved.
- `session-card-subcards`: The PROCESS subcard composition is documented as `<ActivityBar /> + <BackgroundProcessesDrawer />` with the existing empty-hide rule applying to both rows independently. Subcard remains hidden only when BOTH rows are empty.

## Impact

**Code touched:**
- `packages/client/src/components/SessionActivityBar.tsx` — **new**. Pure component: takes the session's in-flight bash toolCalls (id, command, startedAt), renders rows with stop buttons. Stop button calls a passed `onAbort(toolCallId)` callback.
- `packages/client/src/components/ProcessList.tsx` — refactor to "BackgroundProcessesDrawer." Remove MIN_SLOTS skeleton padding. Add collapsed/expanded state (controlled prop). Rename header from `Processes` to `N background processes`. Keep `computeVisibleRows` export (still used).
- `packages/client/src/components/SessionCard.tsx` — PROCESS subcard renders `<SessionActivityBar />` over `<BackgroundProcessesDrawer />`. Subcard hides only when both have nothing.
- `packages/client/src/hooks/` — new selector `useInflightBashTools(sessionId)` reading from the event-reducer state.
- Wiring to existing abort path — investigate which client→server message aborts a single toolCall (may already exist; otherwise an open thread for design.md).
- Tests: `SessionActivityBar.test.tsx`, update `ProcessList.test.tsx`, update `SessionCard.test.tsx` snapshots.

**Not touched (Phase 1):**
- `src/extension/process-scanner.ts`, `src/extension/bridge.ts` — bridge stays scan-only; no new metadata on the wire.
- `packages/server/src/event-wiring.ts`, `browser-handlers/session-action-handler.ts` — server unchanged; abort path is reused, not introduced.
- `packages/shared/src/browser-protocol.ts` — Phase 1 ships using existing protocol surface.

**Explicitly deferred to Phase 2 (separate change):**
- Tagging `bash` toolCall with spawned PGID so the drawer can dedup honestly.
- Decision on whether the drawer's per-row ✕ should disappear once abort reliably reaps the PGID.

## Phase 2 Follow-up

A separate change (to be authored after this one archives) will:

- Tag every `bash` toolCall on the wire with its spawned PGID (extension-side change to `process-scanner.ts` + `bridge.ts` + `browser-protocol.ts`).
- Use that PGID server-side / client-side to dedup: PGIDs reported by the `ps` scanner that match a known in-flight `bash` toolCall are filtered out of the BackgroundProcessesDrawer so an active bash never appears in both surfaces.
- Add a per-`toolCall` abort message (`AbortToolCallToBrowserMessage { type: "abort_tool_call"; sessionId; toolCallId }`) so the activity bar's `[⏹]` button can stop a single tool without aborting the whole agent run (Phase 1 falls back to session-level `abort` per Q2 path b).

This Phase 1 change ships without those wire-protocol changes by design; the proposal's "known cosmetic issue" note documents the gap.

## Open Questions (to resolve in design.md before tasks start)

1. **Abort semantics:** when `abortToolCall` fires on a `bash`, does the underlying child PGID actually die? If yes, Phase 2's PGID-on-toolCall wiring removes the drawer row automatically. If no, every stopped bash leaks an orphan into the drawer. Needs a 30-min extension-side spike.
2. **Existing abort wire:** does the dashboard already expose a per-toolCall abort message, or only session-level abort? If the latter, Phase 1 either degrades the activity bar's stop button to session-abort (heavy hammer) or this proposal grows to add the protocol message.
3. **Concurrent bash cap:** is N=2 the right ceiling for visible activity-bar rows, or should it be 3? Inspect recent session traces to find real-world max concurrent bash count.
