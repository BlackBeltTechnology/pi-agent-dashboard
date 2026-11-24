# DOX — packages/agent-teams-plugin/src/shared

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `plugin-id.ts` | `AGENT_TEAMS_PLUGIN_ID` ("agent-teams", = manifest id) and the `AGENT_TEAMS_EVENT_*` constants (= manifest `emits`). |
| `clock.ts` | `Clock` interface (`now`/`setTimeout`/`clearTimeout`) + `systemClock`. Every plugin timer goes through it so tests inject `FakeClock`. |
