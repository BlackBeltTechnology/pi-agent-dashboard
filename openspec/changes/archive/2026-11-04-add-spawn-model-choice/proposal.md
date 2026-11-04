## Why

Only one spawn surface (the folder home composer) lets the user choose the model and thinking level of a new session. The worktree spawn dialog, the folder "New Session" button, the OpenSpec board, sibling spawns, the bridge's own "new session", `POST /api/session/spawn`, the MCP `spawn_session` tool, the bus client and the `pi-dashboard` skill all spawn with pi's default model. No road accepts an `@role` reference, although roles are the user's primary way of naming models. An agent or a user who wants "a worktree session on `@planning`" has to spawn first and switch the model afterwards.

## What Changes

- **One server-side spawn-choice resolver** for every spawn road (browser WS, REST, plugin `spawnSession` hook, bridge `spawn_new_session`). It accepts `model` as `provider/id`, `provider/id:<level>`, `@role` or `@role:<level>`, plus an optional `thinkingLevel`. `@role` is resolved ONCE at spawn time against `~/.pi/agent/providers.json#roles`. The spawned session runs on the concrete model and does not follow later role edits. For `@role` refs the precedence is explicit `thinkingLevel` > ref `:<level>` suffix > role-assigned level. Literal refs keep today's rules (an explicit `thinkingLevel` disables suffix splitting). A thinking-only choice keeps today's pairing with the Settings default model.
- **`POST /api/session/spawn`** gains `model`, `thinkingLevel`, `initialPrompt` and `attachProposal`, matching the WS `spawn_session` message. The whole body is validated before any side effect. An invalid model, an unresolvable role, or `agent` combined with a model choice returns `400`. The WS / plugin / MCP roads keep drop-and-warn. The pending registries gain `withdraw(cwd, value)`, so a failed spawn removes only its own queued prompt and attach.
- **WS `spawn_result`** gains an optional `choiceWarning` string when a model/role/thinking choice was dropped, including one ignored because an ACP agent was chosen. The web client shows it as a warning toast; the bus client passes it to an `onWarning` callback.
- **`PluginSpawnOptions`** gains `thinkingLevel`. `model` accepts `@role`. Literal models keep today's pass-through, so trusted callers are unaffected.
- **MCP `spawn_session`** tool input gains `model`, `thinkingLevel` and `initialPrompt`.
- **Bus client** `SpawnOptions` gains `model`, `thinkingLevel` and `onWarning` (`spawn()` still returns the id string). `dashboard-bus.ts spawn` gains `--model <ref>` and `--thinking <level>`.
- **Bridge `spawn_new_session`** carries the current session's model and thinking level, so a terminal pi's "new session" inherits them.
- **Worktree spawn dialog** gains one merged model · thinking chip with a Role tab. It is preselected from the parent folder's remembered choice, else the Settings default, and applies to both "existing worktree" and "create new". It is hidden when the host already owns the choice (folder home composer).
- **Folder "New Session" split button** (`AgentSpawnPicker`): the chevron is always present. Its menu offers the agent choice (when ACP agents exist) and the model · thinking chip. The choice is remembered per folder next to the agent memory. Quick spawns in that folder (folder button, OpenSpec board spawn via `useAgentAwareSpawn`, Initialize project) use the remembered choice, falling back to the Settings default field by field. The spawn chips store `@role` verbatim, and the server resolves it once at spawn time.
- **Sibling spawn** (card "New session", keyboard shortcut) reuses the source session's `model` and `thinkingLevel`, as it already reuses the agent. "Initialize project" still always spawns pi.
- **Skill docs**: the duplicate `packages/claude-plugin/skills/pi-dashboard-control/` (SKILL.md + `references/api-reference.md`) is updated in step with `pi-dashboard`. `pi-dashboard` `SKILL.md`, `references/api-reference.md`, `recipes.md` and `commands/dashboard-session-spawn.md` document the new fields, `@role`, and the `--model`/`--thinking` flags.
- Mockup: mockups/model-thinking-picker (in this change). It is the design direction for the merged spawn chip (`roleMode: once`, default chip = Settings default). The board's other surfaces (settings, automation, roles, plugins) stay out of scope here and remain a follow-up.

## Capabilities

### New Capabilities
- `spawn-model-choice`: cross-road contract for the spawn-time model / thinking / `@role` choice: the resolver, role precedence, dropped-choice reporting, the browser warning toast, and bridge inheritance.

### Modified Capabilities
- `dashboard-server`: "Session spawn REST endpoint" gains the optional fields; new requirement that invalid choices are rejected before any side effect.
- `shared-protocol`: `spawn_result` gains `choiceWarning`.
- `session-card-subcards`: the sibling `spawn_session` payload gains the parent's `model` / `thinkingLevel`.
- `plugin-spawn-scope`: plugin spawn gains `thinkingLevel` and `@role` resolution.
- `worktree-spawn-dialog`: dialog offers the model · thinking · role choice.
- `acp-agent-sessions`: "Agent picker at spawn entry points". With no agents configured, spawn controls show no agent menu, but may show the model choice. Siblings also inherit model and thinking level.
- `dashboard-bus-client`: `spawn` carries `model` / `thinkingLevel` and surfaces `choiceWarning`.
- `dashboard-mcp-server`: `spawn_session` tool accepts `model` / `thinkingLevel` / `initialPrompt`.
- `pi-dashboard-skill`: the API reference and the spawn command document the spawn choice.
- `model-selector`: "Session model pickers SHALL resolve a role once" is scoped so spawn-choice chips (worktree dialog, folder menu) are not session pickers.
- `sessionless-composer-context`: "Spawn-time model and thinking reach pi". `@role` refs are resolved instead of ignored, and dropped choices set `spawn_result.choiceWarning`.

## Impact

- **Server**: `packages/server/src/browser-handlers/spawn-choice.ts` (resolver), `session-action-handler.ts` (WS road), `session/session-api.ts` (REST road; needs the pending attach / initial-prompt registries wired in), `server.ts` (plugin hook), `event-wiring.ts` (`spawn_new_session`).
- **Shared**: `rest-api.ts` `SpawnSessionRequest`, `browser-protocol.ts` `SpawnResultBrowserMessage.choiceWarning`, `protocol.ts` `SpawnNewSessionMessage`.
- **Plugin runtime**: `PluginSpawnOptions.thinkingLevel` and the `pluginSpawnToSessionOptions` mapping.
- **Extension**: `bridge.ts` `spawnNew`.
- **Clients**: `bus-client`, the `mcp-server-plugin` manifest and generated tools, the `pi-dashboard` skill scripts and docs.
- **Web client**: `WorktreeSpawnDialog`, `AgentSpawnPicker` / `FolderSpawnButtons`, a new per-folder spawn-choice memory next to `lib/acp/agent-memory.ts`, sibling spawn in `SessionList` / `App.tsx`, and the OpenSpec board spawn.
- **Compatibility**: every new field is optional. Old servers ignore the new WS and bridge fields; old REST servers ignore unknown body fields and spawn with the default model, which is today's behaviour. No persisted-data migration. Rollback = revert. The localStorage spawn-choice keys are inert without the client code.

## Discipline Skills

- `security-hardening`: model / role strings arrive from untrusted callers (REST, MCP, bus, plugins) and become pi argv. Validation must stay discrete-argv and charset-restricted. `@role` resolution reads only the fixed `providers.json`.
- `observability-instrumentation`: new `console.warn` lines and `spawn_result.choiceWarning` on dropped choices, so silent default-model spawns are diagnosable.
- `doubt-driven-review`: the REST `400` versus WS drop-and-warn asymmetry is a public-API contract decision.
