## Context

- pi 1.0.4 `--tools` keeps MCP tools unless an entry starts with `mcp__`. `--no-mcp` disables built-in MCP for one run: no servers connect, no MCP tools, no `/mcp` (pi `docs/cli.md`, "Resource options"). `--no-mcp` does not affect a third-party extension that replaces built-in MCP.
- The scope mapper is `pluginSpawnToSessionOptions` (`packages/dashboard-plugin-runtime/src/server/server-context.ts:458`). Booleans copy only when `=== true` (`:484-485`, `:488`, `:496-497`).
- The argv builder is `scopeFlags()` (`packages/shared/src/platform/spawn-mechanism.ts:176-190`).
- The pass-through type is `SessionOptions` (`packages/server/src/spawn-process/process-manager.ts:203-217`). Passthrough is structural. `server.ts` spreads `{ ...sessionOptions, spawnToken }`, and the headless, interactive and tmux builders all hand options to `sessionFlagsToArgv` (`process-manager.ts:536,544,582`). So only the two interfaces need the new field, and tmux spawns inherit `--no-mcp` automatically. `mergeCwdPolicy` spreads options (`packages/server/src/spawn-process/cwd-policy.ts:125-129`), so `noMcp` survives a policy merge unchanged.
- Team spawn: `conversations.ts:544-575` uses `scope.tools = PRESET_TOOLS[persona.tools]`, `noSkills`, `noContextFiles` and `noProjectTrust`. `noProjectTrust` (`--no-approve`) already keeps the project `.pi/mcp.json` out. The Pi-global `~/.pi/agent/mcp.json` still loads.
- The team guard blocks every non-preset tool name before execution, `mcp__*` included (`decideToolCall`, `packages/team-plugin/src/extension/guard.ts:113-116`, presets at `:13-17`; test `extension/__tests__/guard.test.ts:40-48`).
- The bridge registers the per-session `pi-dashboard` MCP server through `pi.registerMcpServer` (`packages/extension/src/mcp-token-delivery.ts`; spec `dashboard-mcp-server` "registered per session by the bridge"). In pi 1.1.0, `registerMcpServer` validates and records the server without checking whether built-in MCP is enabled (`dist/core/extensions/loader.js:376-394`). Under `--no-mcp` the registration therefore succeeds, raising no `registration-unavailable`, but nothing connects.
- Below-floor parsing: pi 1.0.0 puts an unclaimed `--no-mcp` in `unknownFlags` (`dist/cli/args.js:226-240`), `agent-session-services.js:39-44` turns it into an `Unknown option` error, and `main.js:743-751` exits 1. This fails closed.
- (Operator-machine observation, environment-dependent.) Dashboard sessions on the author's machine already run pi 1.1.0: the keeper log for session `14c0e7b8...` shows `PI_KEEPER_PI_CMD` → `~/.nvm/versions/node/v24.15.0/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js`.

## Goals / Non-Goals

**Goals:** give plugins a typed way to turn off built-in MCP, and make team personas use it.

**Non-Goals:**
- `noMcp` in `PluginCwdPolicy` / `mergeCwdPolicy`. There is no production caller, and it can be added later as a sticky-OR.
- Changing what a `tools` allowlist means. The dashboard forwards pi's flag unchanged.
- Covering third-party MCP adapters (`pi-mcp-adapter`). The guard name gate stays the backstop.

## Decisions

**D1: `--no-mcp`, not `--exclude-tools 'mcp__*'`.** pi offers two ways to stop MCP servers connecting. `--no-mcp` works per run (`docs/cli.md`, "Resource options"). `-builtin:mcp` in settings is persistent operator config (`docs/mcp.md:266`). Team sessions need per-run isolation that doesn't depend on, or change, the operator's settings, so the per-run flag is the right one. `--exclude-tools` is documented only as removing tools from the selection (`docs/cli.md:138`). Whether servers still connect under the exclude pattern is `unverified`, and it doesn't matter, because `--no-mcp` is strictly stronger. Considered and rejected: appending `mcp__*` to `excludeTools`.

**D2: Boolean `noMcp` in the existing flat scope.** It follows the `noTools` / `noSkills` / `noContextFiles` convention: emitted only when `true`, with absent-scope argv byte-identical. It is not read by cwd-policy composition, same treatment as `noContextFiles`.

**D3: Team sessions always set it, for every preset (`chat`, `files`, `full`).** Team personas never get MCP tools, because the guard name gate only allows the preset names. Connecting servers that can never be called only adds side effects.

**D5: `dashboard-mcp-server` gets an explicit exemption.** "Session reaches /mcp without configuration" promises a connected `pi-dashboard` server for every dashboard-connected session. A `--no-mcp` session can't satisfy it, and loses nothing, because the team guard already blocks those tools. The requirement is MODIFIED to exempt sessions spawned with `--no-mcp`. The bridge keeps registering, which is harmless and keeps the bridge free of spawn-scope knowledge.

**D6: Resumed transcripts that mention MCP tools.** A team conversation started before this change may have `mcp__*` tool calls in its history (blocked calls). On resume, pi renders calls to unregistered tools with its fallback renderer (1.0.1 `registerToolRenderer` / resumed-session fix). That is benign, and needs no task.

**D4: The ADDED requirement in `team-agent-sessions` is separate from "Tool presets and file confinement".** That requirement is one very long paragraph. A MODIFIED copy would put unrelated prose under review and risk drift. The new requirement only states the MCP surface.

## Risks / Trade-offs

- [pi < 1.0.4 receives `--no-mcp`] → pi exits 1 with `Unknown option: --no-mcp` (fail-closed, see Context). The team spawn surfaces a spawn error and never runs with MCP on. The sibling bump raises the floor to 1.1.0. Accepted.
- [Team sessions lose the `pi-dashboard` MCP connection] → Intended (D5). The guard already blocks `mcp__pi-dashboard__*`, so no capability is lost. The bridge keeps registering, harmlessly.
- [A future plugin needs MCP in a restricted session] → It leaves `noMcp` unset. The `tools` allowlist then keeps MCP tools (pi ≥ 1.0.4 semantics), which the scope spec documents.

## Migration Plan

None. Nothing is persisted. Rollback = revert. Personas then connect MCP servers again, still guarded.
