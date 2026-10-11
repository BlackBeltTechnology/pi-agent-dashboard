# Test Plan — spawn-scope-no-mcp

Stage: design   Generated: 2026-10-11

No open clarifications: every Triple below is filled from the specs.

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | plugin-spawn-scope: noMcp maps to --no-mcp | EP | L1 | automated | `SessionFlags { noMcp: true }` | `sessionFlagsToArgv()` | argv contains exactly one bare `--no-mcp`, after the name/model flags |
| E2 | plugin-spawn-scope: mapper copies only `=== true` | EP | L1 | automated | `scope.noMcp` = `true` / `false` / `"true"` / `1` / `null` / absent | `pluginSpawnToSessionOptions()` | result has `noMcp: true` only for `true`; the key is absent in every other case; no throw |
| E3 | plugin-spawn-scope: absent scope is byte-identical | EP | L1 | automated | spawn options with no `scope` and with `scope: {}` | build argv | argv equals the pre-change snapshot; no `--no-mcp` |
| E4 | plugin-spawn-scope: partial scope emits no MCP flag | EP | L1 | automated | `scope: { tools: ["read"] }` | mapper + argv | argv has `--tools read` and no `--no-mcp` |
| E5 | plugin-spawn-scope: noMcp is not read by cwd-policy composition | decision-table | L1 | automated | options `{ noMcp: true, tools: ["read","ls"] }` merged with policy `{ tools: ["read"], noTools: true }` | `mergeCwdPolicy()` | merged keeps `noMcp: true`, `tools: ["read"]`, `noTools: true`; a policy carrying `noMcp` is ignored |
| E6 | team-agent-sessions: every preset spawns with noMcp | decision-table | L1 | automated | personas with presets `chat`, `files`, `full` | conversation start (fake host `spawnSession`) | each captured scope has `noMcp: true` and its preset `tools` |
| E7 | team-agent-sessions: resume keeps noMcp | state-transition | L1 | automated | existing conversation with a session file | reopen → resume spawn | captured scope has `resume.sessionFile` and `noMcp: true` |
| E8 | team-agent-sessions: guard still blocks MCP names | EP | L1 | automated | policy for each preset; tool names `mcp__docs__search`, `mcp__pi-dashboard__list_sessions` | `decideToolCall()` | `allow: false` for both names under every preset |
| E9 | headless/tmux strategies inherit the flag | EP | L1 | automated | `SessionOptions { noMcp: true }` | headless, interactive and tmux argv builders (`process-manager.ts`) | each built command contains `--no-mcp` (tmux: inside the shell-escaped pi command) |

### Error-handling

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | below-floor pi fails closed | fault-injection | L1 | automated | pi 1.0.0 argument parsing (installed baseline dist) with argv `--mode rpc --no-mcp` | parse + build runtime diagnostics (or spawn pi 1.0.0 `--no-mcp --version`-free path in a temp dir) | an error diagnostic `Unknown option: --no-mcp` is produced / the process exits 1; no session starts |
| X2 | dashboard-mcp-server: --no-mcp session registers without connecting | fault-injection | L3 | automated | docker harness; team persona conversation started (pi 1.1.0, `--no-mcp`) | bridge credential delivery | no `mcp/registration-unavailable` message logged for that session; `pi mcp list --json` in that session's context lists no connected `pi-dashboard` |
| X3 | dashboard-mcp-server: normal sessions still connect | state-transition | L3 | automated | docker harness; ordinary dashboard-spawned session (no `noMcp`) | credential delivered | `pi-dashboard` server connected and a `pi-dashboard` tool call authenticates as that session (existing exemplar assertion stays green) |

## Coverage

| Requirement | Scenarios |
|---|---|
| plugin-spawn-scope: typed scope block | E2, E3, E4 |
| plugin-spawn-scope: fields map 1:1 to flags | E1, E4, E5, E9 |
| team-agent-sessions: run without built-in MCP | E6, E7, E8, X2 |
| dashboard-mcp-server: registered per session (exemption) | X2, X3 |
| floor / fail-closed premise | X1 |

## Exemplars

- E1, E3, E4: `packages/shared/src/platform/__tests__/spawn-mechanism.test.ts`
- E2: `packages/dashboard-plugin-runtime/src/__tests__/plugin-spawn-scope-mapper.test.ts`
- E5: `packages/server/src/spawn-process/__tests__/cwd-policy.test.ts`
- E6, E7: `packages/team-plugin/src/server/__tests__/conversations.test.ts`
- E8: `packages/team-plugin/src/extension/__tests__/guard.test.ts`
- E9: `packages/server/src/__tests__/plugin-spawn-scope-env.test.ts`
- X1: `packages/server/src/__tests__/pi-version-skew.test.ts` (reads the installed pi dist)
- X2, X3: `tests/e2e/mcp-session-token.spec.ts`, `tests/e2e/mcp-builtin-registration.spec.ts`

## New infra needed

None.
