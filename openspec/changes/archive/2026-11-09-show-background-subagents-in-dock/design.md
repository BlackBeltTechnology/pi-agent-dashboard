# Design

## Context

See proposal.md (Why). Current code facts:

- The producer (`pi-dashboard-subagents` v0.7.0) returns a background `Agent` call at once with details `{ background: true, id: "bg-…", status, counts }` and no `agentId` (`extensions/agent.ts:1592-1611` in that repo). The run's own snapshots carry `background` and `retries`, but not the `bg-` id (`extensions/agent.ts:1847`).
- The plugin builds subagent state in its own reducer slice. `created` and `started` spread the shared `readSubagentDetails` (`packages/subagents-plugin/src/client/sessionEventReducer.ts:51-76`). That helper whitelists fields and drops `background` (`packages/shared/src/dashboard-plugin/subagent-types.ts:150-192`).
- `AgentToolRenderer` picks a card from `details.status`. A background row has `status: "running"`, so it takes the running branch (`packages/subagents-plugin/src/client/AgentToolRenderer.tsx:576`) and shows a running card that never updates.
- The `Agent` row finalizer only touches rows that are still `running` and whose `agentId` matches (`packages/subagents-plugin/src/client/toolRowFinalizer.ts:79-87`). A background row is `complete` with no `agentId`, so it is never rewritten.
- No `tool_execution_update` reaches a background row after it returns: the detached run sends its updates to the background registry's sink, not to the parent tool call (`extensions/agent.ts:1546-1561` in the producer repo). So the row's `toolDetails` keep `background: true`.
- The `agent-tool-rendering` spec has a "Background agent launched" scenario for `toolDetails.status: "background"`; no code handles that status (`grep '"background"' packages/subagents-plugin/src/client` finds nothing). This change replaces it.
- `SubagentDockGroup` lists `created`/`running` subagents in one group with Open only (`packages/subagents-plugin/src/client/SubagentDockGroup.tsx:44-55`, `:99-111`).
- The dock keys each claim as `` `${pluginId}:${index}` `` (`packages/dashboard-plugin-runtime/src/slot-consumers.tsx:558`). It renders one heading per group from the group's reported noun when two or more groups have rows (`packages/client/src/components/chat/ProcessesLaneBody.tsx:126-147`). It builds the header from each entry's count and noun (`packages/client/src/components/chat/ProcessesLane.tsx:190-209`).
- Per-subagent stop: `requestSubagentStop` posts to `/api/plugins/subagents/stop` and keeps one pending, error or unconfirmed state per subagent in a module store (`packages/subagents-plugin/src/client/subagentStop.ts:24`, `:60`, `:93-123`). The card reads the same store and clears it on a terminal frame (`packages/subagents-plugin/src/client/AgentToolRenderer.tsx:313-318`).
- `SubagentDetailView` maps entries into `MinimalChatView`, which only knows `tool | text | thinking | error` (`packages/client-utils/src/minimal-chat/types.ts:38-48`). Unknown kinds become "(unknown entry)" (`packages/subagents-plugin/src/client/SubagentDetailView.tsx:75-100`).

## Goals / Non-Goals

**Goals:**
- All code in `packages/subagents-plugin/`. No change to `packages/client`, `packages/shared`, `packages/client-utils` or `packages/dashboard-plugin-runtime`.
- Work with producers older than 0.7.0 exactly as today.

**Non-Goals:**
- Showing the `bg-` id in the dock (the run frames don't carry it).
- Keeping a finished background run in the dock until its result is read.
- Showing a message stream in the dock. The full-screen view (Open) is where a run is watched.
- Any change to the producer.

## Decisions

### D1. The plugin reducer keeps the background flag

`created` and `started` merge a plugin-local reader after `readSubagentDetails`. It sets `background: true` only when `details.background === true` and never clears it. Every later writer spreads the existing state first, so the flag survives frames that omit it: step frames (`sessionEventReducer.ts:98-99`), the terminal write (`toolRowFinalizer.ts:158-159`) and tick hydration (`toolRowFinalizer.ts:215-219`). Task 1.1 pins this with tests. The state type is a plugin-local intersection, `SubagentState & { background?: true }`, stored in the same map. Readers inside the plugin narrow to it.
- *Alternative:* add `background` to the shared `readSubagentDetails` whitelist and `SubagentState`. Rejected: that is subagent code in core.

### D2. Started card: an early branch in `AgentToolRenderer`

When `details.background === true`, the renderer returns before every other branch: fallback, queued, running, completed, error/aborted and stopped. It renders `ui:agent-card` with status `pending` (neutral glyph, no yellow border) and a `ui:status-pill` (`muted`) reading "Started in background", plus the `bg-` id from the row's own details and "In Processes". It renders no stop line, no activity row, no Details/Popout and no resync. The row has no `agentId`, so those features have nothing to bind to. Open lives on the dock row.
- *Alternative:* join the row to the live subagent by `toolCallId` in the reducer and keep it running. Rejected during mock review (the chat should only say "started"), and it would need core reducer changes.

### D3. Two dock claims, one shared row

`package.json` declares a second `composer-dock-process-group` claim on the same module, pointing at a new `BackgroundSubagentDockGroup` export. Both components share one row component and one hook that lists live subagents and filters by the D1 flag. Manifest order puts foreground first: claims sort by plugin `priority` then `pluginId` (`slot-registry.ts:228-233`), both claims tie, and `Array.prototype.sort` is stable (ES2019), so ties keep registration order, which is manifest order. `priority` is per plugin (`packages/shared/src/dashboard-plugin/manifest-types.ts:326-330`), so it cannot order the two. Task 3.2 verifies the order in the manifest and in the regenerated registry. `packages/client/src/generated/plugin-registry.tsx` is a build output ("Regenerated by viteDashboardPluginsPlugin on every build"), not hand-edited core code. Each claim reports its own `{ count, noun }`, with the noun matching the count: `subagent` / `subagents` and `background subagent` / `background subagents` (the dock prints the noun verbatim, `ProcessesLane.tsx:98-112`). The shell already renders headings and the header from those (see Context).
- *Alternative:* one claim that renders its own sub-headings. Rejected: it would copy the shell's heading style, and the header would count everything under one noun.

### D4. Stop on every dock row, through the existing stop store

The row adds a Stop button before Open when the subagent is `created`/`running` with `stoppable: true`. The visible label is "Stop". The aria label is `Stop subagent {name}`, or `Remove subagent {name} from queue` while the subagent is `created` or has `queuePosition > 0`. That is the dock's queued predicate (`SubagentDockGroup.tsx:39-42`): the map never carries status `queued`, so the chat row's `agentStopLabel` test (`toolDetails.status === "queued"`, `subagentStop.ts:177-183`) does not apply. The chat keys `stopSubagent` / `stopRemoveFromQueue` have no `{name}`, so the dock adds new named keys in all three plugin catalogs. Clicking calls `requestSubagentStop(session.id, sub.id)`. The row meta reads `Stopping…` (button disabled), `Still running` (unconfirmed after 10 s) or `Stop failed` (refused) from `useSubagentStopState`; otherwise it shows `type · N steps`. The button's classes match the shell's Kill button (`ProcessesLaneBody.tsx:49-50`), copied into the plugin because the shell constant isn't exported. `ComposerDockRow` already enforces the target size. The row leaves when the subagent turns terminal (existing filter).

A background subagent has no live card to clear its stop entry on the terminal frame, as the card does for foreground runs (`AgentToolRenderer.tsx:313-318`). Each group's always-mounted `"summary"` instance therefore clears the store entry of every subagent of its own kind whose map status is terminal (`completed`, `failed` or `stopped`). The signal is the map status, not a row disappearing, so collapsing the lane clears nothing. Each group only clears its own kind, so there is a single clearer per subagent.
- *Alternative:* a new stop endpoint or a session abort. Rejected: the existing per-subagent route already exists and an abort ends the turn.

### D5. `retry` entries map to the existing error step

`mapSubagentEntries` gets a `retry` case that returns `{ kind: "error", text: "Retry {attempt}/{maxAttempts} in {delay}: {text}" }`. Delay format is a verbatim copy of the producer's `formatRetryDelay` (`extensions/events.ts:277-286` in the producer repo): `0s` for a non-finite or non-positive value, otherwise round to whole seconds with a minimum of `1s`, then `Ns`, `Nm Ns` / `Nm`, `Nh Nm` / `Nh`. The plugin keeps a local copy because the producer is not a dependency of the client. Each part is emitted only when its field is valid (`N/M` for positive-integer attempt and budget, `in <delay>` for a finite `delayMs`, `: <text>` for a non-empty string), so a malformed entry reads `Retry` plus what is present and never falls back to unknown entry. The producer's entry union is widened locally in the plugin (`SubagentTimelineEntry | RetryEntry`). The backoff text on the activity line needs no code: the producer already sends it as `details.activity`, which existing slots show. Accepted in mock `2026-11-06-subagent-retry-plugin-only`.
- *Alternative:* a generic warning entry kind in `client-utils`. Rejected: core change.

### D6. Session end needs no plugin code

When the session ends with a background subagent still running, the server already sends a synthesized `subagent_failed` with `healedBy: "session_ended"` and error "parent session ended" for every subagent created or started without a terminal event (`openspec/specs/session-end-orphan-heal/spec.md:77-92`). That also covers background ones, because the scan keys on subagent events, not on the Agent row. The existing failed arm sets the status, the dock's terminal filter drops the row, and the D1 mark is kept because the write spreads the existing state. The background started card ignores the map (D2). The view shows the existing failed presentation with that error; there is no separate "ended" state. Post-fold collateral, verified unaffected: the heal guards (`dashboard-plugin-loader` "Tool-row finalizers keep the session-end heal guards") and the healed-card rule (`subagent-live-timeline` "The healed Agent card SHALL show the subagent result") act only on Agent rows a heal finalized. A background run's row is closed by its real end, so neither applies and the plugin never reopens a background subagent from a row tick. Two plugin groups fit `composer-dock` "Processes lane lists running work in three groups", which puts all contributed groups first.

## Risks / Trade-offs

- [The shared `countSteps` counts a retry entry as a step, so the dock's `N steps` includes retries] → Accepted. A retry is a streamed timeline step like any other, so the no-shrink guard in `setSubagentState` compares like with like.
- [A retry renders as a red error step, also after the run recovered] → Accepted in mock review (`2026-11-06-subagent-retry-plugin-only`). A warning look needs a new `MinimalChatView` entry kind, which is core. `bridge-retry-observability` covers the main session only and does not render subagent timelines, so nothing double-renders.
- [When a session ends, the server heals a still-running background subagent to failed; the dock row leaves but the chat card still reads "started"] → Intended: the card only records that the run was started. Open on the dock row (while listed) and the full-screen view show the outcome.
- [An older producer sends no `background`, so a background run would still look like a foreground row] → Only possible with producer < 0.7.0, which has no background runs. No action.
- [A user cannot tell which dock row belongs to which started card: the dock shows no `bg-` id] → Accepted product decision. The row shows the same name and task as the card, and Open shows the full run.
- [Copied Kill-button classes can drift from the shell] → A test asserts that Stop and Kill share their hover and disabled tokens. The class string is listed in the plugin's AGENTS.md row.

## Migration Plan

None. Client-only plugin change; rollback reverts the plugin commit. No stored data changes shape (the flag lives only in in-memory state).
