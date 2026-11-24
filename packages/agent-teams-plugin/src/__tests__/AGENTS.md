# DOX — packages/agent-teams-plugin/src/__tests__

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `manifest-contract.test.ts` | Task 1.14. Manifest id == `AGENT_TEAMS_PLUGIN_ID`; `emits` unique + namespaced; every `agent-teams:` literal, `AGENT_TEAMS_EVENT_*` constant and `emitEventToSession` call in the sources is listed in `emits` (and vice versa for the constants). |
| `harness.test.ts` | Harness self-tests: `FakeClock` boundaries/ordering, fake host ctx (configSchema defaults, recorded calls, scriptable spawn/shutdown), one real faux `pi --mode rpc` round trip (skipped when `pi` is absent). |
| `harness/` | → see `harness/AGENTS.md`. |
