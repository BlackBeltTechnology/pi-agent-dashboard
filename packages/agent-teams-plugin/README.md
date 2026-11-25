# @blackbelt-technology/pi-dashboard-agent-teams-plugin

Agent teams core for pi-dashboard (plugin id `agent-teams`). A lead session
spawns visible teammate sessions and coordinates them through a shared task list
and a mailbox; every host call goes through `ServerPluginContext`.

Not to be confused with `packages/team-plugin` (the personas/conversations
plugin) — unrelated.

| Entry | Path |
|-------|------|
| Server | `src/server/index.ts` — store, lane handlers, REST reads, dispatcher, member driver |
| Bridge | `src/bridge/index.ts` — team tools + teammate-scope guard (pi extension) |
| Client | `src/client/index.tsx` — i18n catalog only; the core change claims no slots |
| Config | `src/configSchema.json` — limits, rates, timeouts, TTLs, `autoDispatch`, `extraCwdRoots` |

Manifest `emits`: `agent-teams:mail`, `agent-teams:team_closed` (the manifest
contract test fails when the server emits a type not listed there).

Spec: `openspec/changes/add-agent-teams-core/`.

## Tests

- `npx vitest run packages/agent-teams-plugin/src` (via `HOME=$(mktemp -d) …`, see `npm run test:parallel`) — unit + faux-pi-rpc harness.
- `src/__tests__/harness/` — injected clock, fake host `ctx`, faux `pi --mode rpc` driver.

## Teammate limits (advisory with `bash`)

A teammate runs behind a guard (tool allowlist, skill allowlist, sleep-poll and git-write guards, spawn-time `PI_EXT_AGENT_TEAMS_*` policy). The tool and skill allowlists are **advisory while the teammate has the `bash` tool**: a shell can still read files or run commands outside them (`bash -c "git commit"`, `$(…)` indirection and scripts are not chased). For a stricter limit give the teammate a `tools` list without `bash`. `blockSleepPolling` and `blockGitWrite` (both default true) are plugin settings.
