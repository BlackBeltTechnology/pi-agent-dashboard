# Proposal

## Why

The subagents producer (`pi-dashboard-subagents` v0.7.0) can now run a subagent in the background: `Agent({ run_in_background: true })` returns at once with a `bg-` id and the run continues detached, so the parent keeps working. The dashboard was not built for this. The chat card is drawn from the early result (`details.status: "running"`, no `agentId`) and looks like a running subagent that never moves. The dock lists background and foreground subagents mixed under one heading. And nothing in the UI can stop a background run: its chat row is already complete, so it has no stop control.

## What Changes

- **Chat: a background `Agent` call shows a "started" card.** The card is neutral (`ui:agent-card`, not running). It shows the description, a "Started in background" pill, the `bg-` id and "In Processes". It has no spinner, no live stats and no stop control, and it does not change when the run progresses or ends.
- **The plugin records which subagents run in the background.** Its own session reducer reads `details.background` from the `subagents:*` frames and keeps it on the subagent state. The shared `readSubagentDetails` whitelist does not carry this field, so the plugin must store it itself.
- **Dock: background subagents get their own group.** The plugin contributes two `composer-dock-process-group` groups: foreground (`subagent(s)`) and background (`background subagent(s)`). The dock shows each group under its own heading and counts both in the Processes header. Rows keep today's style for both groups: name, task, `type · N steps` and elapsed time. They show no message stream. Background rows do not show the `bg-` id, because the run frames do not carry it (only the chat card's own early result does).
- **Dock: every stoppable subagent row gets Stop.** The label is "Stop". The aria label is "Stop subagent {name}", or "Remove subagent {name} from queue" while it waits. It uses the plugin's existing per-subagent stop (`requestSubagentStop`) and the shared stop state: `Stopping…` while the stop is pending (Stop disabled), then `Still running` or `Stop failed`. The row leaves when the stopped frame arrives. It never aborts the turn.
- **Dock: Open stays.** Open opens the full-screen subagent page (`/session/:sid/subagent/:aid`). This is how the user watches a background subagent's live stream.
- **Inspector: `retry` steps render.** The producer's new `retry` timeline entries render as a step in the inspector (attempt, budget, delay, error). Today they map to "(unknown entry)".
- **No subagent code in core.** All code changes are in `packages/subagents-plugin/`. The dock shell already supports several contributions from one plugin, plugin-provided row actions and per-group headings. No change to `packages/client`, `packages/shared` or `packages/dashboard-plugin-runtime`.
- Mockup: mockups/2026-11-06-background-subagent-chat (in this change)
- Mockup: mockups/2026-11-06-subagent-retry-plugin-only (in this change)

## Capabilities

### New Capabilities

- `background-subagent-display`: how the dashboard presents subagents that run in the background. Covers the started card in chat, the background flag kept on the subagent state, and background subagents in their own Processes-lane group.

### Modified Capabilities

- `composer-dock`: a subagent row offers Stop as well as Open (Stop is per subagent and never aborts the turn). One plugin may contribute more than one process group, each with its own heading. The "Kill and Stop are worded differently" scenario applies to background-process rows.
- `subagent-stop-control`: the dock row adds a second per-subagent stop surface next to the chat row. The card still has no stop control of its own.
- `subagent-live-timeline`: `retry` steps from the producer render in the timeline; a pending backoff shows on the activity line.
- `agent-tool-rendering`: the stale "Background agent launched" scenario (`status: "background"`, never implemented) becomes the started card, and a background card has no detail affordance.

## Discipline Skills

None apply. The change is client-only inside the subagents plugin. The new dock Stop calls the existing authenticated stop route (`POST /api/plugins/subagents/stop`); more buttons reach it, but the server-side checks (`subagent-stop-control`: authenticated, validated, scoped to the session's own subagent) are unchanged. It adds no endpoint, reads only a boolean flag from frames already parsed today, and has no latency budget or irreversible step. `review-code` runs inline before commit as usual.

## Impact

- `packages/subagents-plugin/src/client/sessionEventReducer.ts`: keep `details.background` on the subagent state.
- `packages/subagents-plugin/src/client/AgentToolRenderer.tsx`: background branch renders the started card.
- `packages/subagents-plugin/src/client/SubagentDockGroup.tsx`: split into foreground and background groups; add Stop to every row.
- `packages/subagents-plugin/package.json`: a second `composer-dock-process-group` claim.
- `packages/subagents-plugin/src/client/SubagentDetailView.tsx`: map `retry` entries.
- `packages/subagents-plugin/src/i18n.ts`: new strings (group noun, Stop, started card).
- Tests in `packages/subagents-plugin/src/client/__tests__/` and `packages/subagents-plugin/src/client/AGENTS.md` rows.
- Depends on producer `pi-dashboard-subagents` ≥ 0.7.0 for background runs. Older producers send no `details.background`, so no started card and no background group appear. Dock Stop needs `stoppable: true` (producer ≥ 0.6.0); without it the row stays Open-only, as today.
