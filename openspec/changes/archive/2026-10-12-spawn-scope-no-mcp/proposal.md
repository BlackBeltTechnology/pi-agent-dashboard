## Why

pi 1.0.4 changed `--tools`: an allowlist now **keeps MCP tools** unless an entry starts with `mcp__`, and a new `--no-mcp` turns the built-in MCP support off for one run. On the author's machine, dashboard sessions already run the global pi 1.1.0 (`PI_KEEPER_PI_CMD` → nvm global `dist/cli.js`; an operator-machine observation that depends on the environment). A team persona spawned with `--tools read,grep,find,ls` on pi ≥ 1.0.4 keeps pi's built-in MCP support on: it connects every Pi-global MCP server the operator configured, including stdio processes started with the operator's env, and declares their direct-exposure tools. The team guard still blocks every `mcp__*` call before it runs (`packages/team-plugin/src/extension/guard.ts:113-116`), so nothing executes. The servers still connect, though, with their side effects, for tools the persona can never use.

## What Changes

- `PluginSpawnOptions.scope` gains `noMcp?: boolean`, mapped 1:1 to pi's `--no-mcp` through `pluginSpawnToSessionOptions` → `SessionOptions` → `SessionFlags` → `sessionFlagsToArgv`. It is absent by default, so argv without a scope stays byte-identical.
- Team sessions (`packages/team-plugin/src/server/conversations.ts`) always spawn with `scope.noMcp: true`. The guard's deny-first name gate stays as defence in depth. The new `team-agent-sessions` requirement is the authority for the team MCP surface. "Persona injection per turn" keeps listing the other scope fields and is not modified (design D4).
- **Team sessions no longer connect the per-session `pi-dashboard` MCP server.** The bridge's `pi.registerMcpServer("pi-dashboard", …)` is still accepted (pi 1.1.0 `dist/core/extensions/loader.js:376-394` does not check whether built-in MCP is disabled), but nothing connects it. No capability is lost, because the guard already blocks every `mcp__pi-dashboard__*` call in team sessions. `dashboard-mcp-server` gains this exemption.
- The `plugin-spawn-scope` spec documents that, on pi ≥ 1.0.4, a `tools` allowlist alone does not remove MCP tools.
- Cwd-policy composition does not read or change `noMcp`, matching `appendSystemPrompt`, `noContextFiles`, `noProjectTrust` and `sessionDir`. `registerCwdPolicy` has no in-repo caller. Making `noMcp` a policy field is a non-goal here.
- `--no-mcp` needs pi ≥ 1.0.4. **Fail-closed below that:** pi 1.0.0 collects an unclaimed `--no-mcp` into `unknownFlags`, reports it as an `Unknown option: --no-mcp` error diagnostic (`dist/core/agent-session-services.js:39-44`) and exits 1 (`dist/main.js:743-751`). A team spawn on a below-floor pi therefore fails visibly and never runs with MCP on.
- **Ordering:** land together with, or after, `update-pi-core-1-1-adopt-apis`, which raises the floor to 1.1.0. Then there is no supported pi below 1.0.4. (pi 1.0.4 introduced `--no-mcp`: pi `CHANGELOG.md:59,65`.)

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `plugin-spawn-scope`: the `scope` block gains `noMcp`, the flag table maps it to `--no-mcp`, and an allowlist is documented as not removing MCP tools.
- `team-agent-sessions`: team sessions spawn without pi's built-in MCP support.
- `dashboard-mcp-server`: sessions spawned with `--no-mcp` are exempt from "Session reaches /mcp without configuration".

## Impact

- `packages/dashboard-plugin-runtime/src/server/server-context.ts`: the `scope.noMcp` type and the mapper line.
- `packages/shared/src/platform/spawn-mechanism.ts`: `SessionFlags.noMcp`, and `scopeFlags()` emits `--no-mcp`.
- `packages/server/src/spawn-process/process-manager.ts`: the `SessionOptions.noMcp` passthrough.
- `packages/team-plugin/src/server/conversations.ts`: `noMcp: true` in the spawn scope.
- Tests: `spawn-mechanism.test.ts`, `plugin-spawn-scope-mapper.test.ts`, team `conversations.test.ts`.
- No migration, and no persisted state. Rollback: revert. Team personas then connect MCP servers again, and the guard still blocks the calls.

## Discipline Skills

- `security-hardening`: the change touches the team-session isolation boundary (multi-user personas, operator MCP credentials).
