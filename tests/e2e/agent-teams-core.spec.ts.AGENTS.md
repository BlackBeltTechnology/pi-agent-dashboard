# agent-teams-core.spec.ts — index

L3 (add-agent-teams-core, test-plan S133/S134): a faux-scripted lead (`agent-teams-lead-spawn`/`-task`) creates a team + teammate `alice`; S133 alice is an ordinary openable session card, busy while parked on `ask-select`, no auto-claim until idle, converges to `idle:alice`; S134 cards survive `/api/restart` and the REST snapshot converges (no `disconnected`). Skips when `/api/plugins/agent-teams/teams` is 404. Port from the `page` baseURL, never `:18000`.
