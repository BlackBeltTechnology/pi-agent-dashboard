## Why

Claude Code marketplaces already list hundreds of plugins: 348 across the five marketplaces on the maintainer's machine, 315 of them in `claude-plugins-official`. Most of their content is skills, slash commands, subagents and MCP servers, and pi has a native equivalent for each. pi-dashboard can only consume pi packages from npm, so this whole catalogue is unreachable, and porting a plugin by hand means copying and editing files.

This is the reverse of the archived `2026-10-13-add-claude-code-plugin`. That change published pi-dashboard *as* a Claude plugin; this one lets pi-dashboard *install* Claude plugins.

## What Changes

- **Marketplace sources.** The user can add a Claude marketplace: a GitHub `owner/repo`, a git URL, or a local directory containing `.claude-plugin/marketplace.json`. The server fetches it and parses its catalogue. It resolves the documented plugin `source` shapes: relative path (including `./`), `url`, `git-subdir` and `github`. It also honours components declared inline in the marketplace entry (`strict: false`) or at custom paths in `plugin.json`.
- **Adopt existing Claude installs.** The server can list marketplaces and plugins already present under `~/.claude/plugins/` (`known_marketplaces.json`, `installed_plugins.json`).
  - Content-only plugins (no hooks, no MCP, no inline shell in commands, no scripts) are adopted **in place**, so Claude Code's updates flow through.
  - All other plugins are **snapshot-copied** into the dashboard store. Their code then runs against the dashboard's copy and never against Claude Code's directory.
- **Import as a pi package.** Each install, meaning one plugin at one scope, gets its own generated overlay directory under `~/.pi/claude-plugins/installed/<scope>/<marketplace>/<plugin>/`. It holds:
  - a `package.json` with a unique name, whose `pi` manifest lists one stub extension;
  - translated agents;
  - a provenance record.

  The overlay is installed through the existing pi-package install path as a local-path source. Fetched plugin files live separately under `payloads/` as immutable copies; they are never modified, and refreshing a marketplace does not change them. Remote plugins are fetched into a staging area for inspection before the consent dialog; Cancel discards the fetch.
- **Package routes delegate for Claude plugins.** The generic remove, update, check-for-updates and move routes hand Claude-plugin sources to the import module.
  - Move re-imports the plugin at the destination scope.
  - Installs whose settings entry vanished outside the dashboard are garbage-collected.
  - The client contract (`pkg.source` verbatim) is unchanged.
  - Imported skills are shown in the Resources view as read-only rows managed by their Claude plugin.
- **Agent translation at import.** `agents/*.md` are rewritten into the overlay:
  - `tools:` always becomes a non-empty list of mapped pi tool names. An agent whose declared tools are all unmappable is not imported, so it can never silently inherit every tool.
  - `model: sonnet|opus|haiku|inherit` is mapped to dashboard roles.
- **Runtime compatibility extension `claude-compat`.** It is a new workspace package, copied into the store at server boot and loaded by each overlay's fail-closed stub. At most one instance of each plugin is active per session; a local install wins over a global one. In a session it:
  - contributes the plugin's skills (via `resources_discover`);
  - resolves `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_SKILL_DIR}` at runtime, per plugin;
  - registers commands as `/<plugin>:<command>`, plus a bare alias when unique. Commands support `!` inline bash and `@file`, and arguments are substituted last and literally. A command run while the agent is busy is handed to the bridge's follow-up queue;
  - registers MCP servers from either `.mcp.json` shape, expanding environment variables;
  - provides `CLAUDE_*` env vars to child processes;
  - **phase 2:** runs command hooks for Claude's hook events. It maps them to pi events and rewrites pi tool inputs into Claude's `tool_input` shape.
- **Browse UI.** A "Claude marketplaces" view next to the npm package browser. It lists marketplaces and plugins with component badges (skills/commands/agents/mcp/hooks/lsp).
- **Install consent.** Before install, a consent dialog lists every component: per-agent dropped tools and model mapping, and agents that are not imported. It marks hooks and MCP commands as executable third-party code.
- **Name collisions.** Installing a plugin whose name is already installed from another marketplace at an overlapping scope is refused.
- **Explicit non-goals (this change):**
  - LSP servers (`.lsp.json`);
  - output styles, monitors, `bin/`, plugin `settings.json`, `plugin.json` `userConfig` prompting;
  - publishing pi packages *to* Claude marketplaces;
  - pi-specific hook events beyond Claude's set (`pi:*` mapped events, `bus:<channel>` on `pi.events`). These are deferred to a follow-up change; see design.md Non-Goals.

  Plugins that contain only non-goal components are listed but marked unsupported.

## Capabilities

### New Capabilities
- `claude-marketplace-sources`: register, fetch, refresh and remove Claude marketplaces; parse `marketplace.json`; resolve plugin sources; discover existing `~/.claude/plugins` installs.
- `claude-plugin-import`: covers:
  - per-install overlays and the payload store, inspection before consent, and adoption (in place or snapshot);
  - agent translation (tool and model aliasing), component classification, and the cross-marketplace name refusal;
  - the install, update and remove lifecycle through delegated package routes, and the runtime link.
- `claude-plugin-runtime-compat`: the `claude-compat` pi extension, which covers:
  - skill contribution and per-plugin path variables;
  - one instance per plugin per session;
  - command registration;
  - MCP registration;
  - command preprocessing (`!` bash, `@file`);
  - `CLAUDE_*` environment;
  - hook execution with event and tool-input translation (phase 2).

### Modified Capabilities
- `package-browse`: adds a Claude-marketplace browsing surface with component badges, the extended install-consent dialog, and identity-keyed scope badges for Claude plugins.
- `package-management`: move of an imported Claude plugin re-imports it at the destination scope instead of rewriting its path.
- `pi-resource-scanning`: the scanner also reports skills recorded in an imported Claude plugin's import record, marked as managed by that plugin. Those skills are contributed at runtime, not through pi's resolver.
- `pi-resources-view`: skill rows from imported Claude plugins are read-only, with no per-resource toggle.
- `mid-turn-prompt-queue`: the bridge accepts follow-up handoff from other extensions on `pi.events`, and announces user-originated prompts there, so `UserPromptSubmit` hooks run only for real user prompts.

## Impact

- **Server:**
  - new `packages/server/src/claude-marketplace/` (catalogue fetch/parse, source and component resolver, staging, overlay generator, agent translator, realpath containment helper);
  - new REST routes under `/api/claude-marketplaces/*`;
  - a delegation branch in the existing package routes for Claude-plugin sources (remove, update, check, move), plus overlay GC;
  - a resource-scanner addition for imported skills;
  - reuses `package-manager-wrapper.ts` for the local-path install itself.
- **New package:** `packages/claude-compat`, the runtime extension, copied into `~/.pi/claude-plugins/runtime/<version>/` at server boot.
- **Bridge** (`packages/extension/src/bridge.ts`): a `pi.events` follow-up handoff listener, plus a user-prompt announcement before delivery.
- **Client:** new marketplace view in the package browser (`packages/client/src/components/...`) plus the consent dialog.
- **Shared:** protocol types for marketplace, plugin and component descriptors.
- **Subagents plugin:** imported agents land in the existing package tier, which is user scope only. No change to that repo in this change.
- **Filesystem:** new store root `~/.pi/claude-plugins/`. The dashboard's own operations never write `~/.claude/plugins/`, and no plugin root handed to plugin code points there (see design.md D9 for the hard-coded-path caveat).
- **Security:** imported hooks and MCP stdio servers run arbitrary third-party commands. Project-scoped imports respect pi project trust.
- **Dependencies:** none expected beyond git (already required for `git:` packages).

## Discipline Skills

- `security-hardening`: untrusted third-party content (hooks, MCP commands, skills that instruct shell execution); path handling in the materializer (no escape from the store root); consent and trust gating.
- `doubt-driven-review`: before fixing the store layout and generated-manifest contract, which become persistent on-disk state that later upgrades must migrate.
- `observability-instrumentation`: new endpoints and external fetches (git/GitHub), plus hook-execution outcomes that must be diagnosable.
