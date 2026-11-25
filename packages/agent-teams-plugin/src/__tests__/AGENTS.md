# DOX — packages/agent-teams-plugin/src/__tests__

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `manifest-contract.test.ts` | Task 1.14. Manifest id == `AGENT_TEAMS_PLUGIN_ID`; `emits` unique + namespaced; every `agent-teams:` literal, `AGENT_TEAMS_EVENT_*` constant and `emitEventToSession` call in the sources is listed in `emits` (and vice versa for the constants). |
| `harness.test.ts` | Harness self-tests: `FakeClock` boundaries/ordering, fake host ctx (configSchema defaults, recorded calls, scriptable spawn/shutdown), one real faux `pi --mode rpc` round trip (skipped when `pi` is absent). |
| `manifest.test.ts` | Task 13.107/13.108 (S102/S103): the real driver/ops emit only manifest-listed types (host `emits` gate simulated; failure names the type); no id/claim/lane/REST/data-dir collision with `team-plugin`. `agent-teams:changed` (UI bridge frame, broadcast) is in `emits` but not a driver emit. See change: add-agent-teams-ui. |
| `harness/` | → see `harness/AGENTS.md`. |
