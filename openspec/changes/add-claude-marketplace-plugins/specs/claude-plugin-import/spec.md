# Spec Delta

## Purpose

Turns a Claude Code plugin from a registered marketplace into an installed pi package at a chosen scope, without modifying the plugin's own files. Covers inspection before consent, adoption of Claude Code installs, component classification, subagent translation, and the install, update and remove lifecycle.

## ADDED Requirements

### Requirement: Install registers the plugin as a pi package at one scope
Installing a Claude plugin SHALL register it as a pi package at the scope the user chose: global, or local to one project. After install, the plugin SHALL appear in that scope's installed packages, and connected sessions SHALL reload as for any pi package install.

#### Scenario: Global install
- **WHEN** the user installs plugin `x` from marketplace `m` at global scope
- **THEN** `x` appears among installed global packages, and a new session in any directory can use its skills

#### Scenario: Local install
- **WHEN** the user installs plugin `x` at local scope for a project
- **THEN** `x` appears among that project's installed packages only

### Requirement: Installs at different scopes are independent
Each install of a plugin (plugin × scope) SHALL have its own plugin files and generated files. Removing or updating one install SHALL NOT change, disable, or delete the files another install of the same plugin uses. The plugin's data directory is shared by all its installs, as in Claude Code.

#### Scenario: Remove local keeps global
- **WHEN** plugin `x` is installed globally and locally for project A, and the user removes the local install
- **THEN** sessions in other directories still use the global install of `x` unchanged

#### Scenario: Update in one project
- **WHEN** plugin `x` is installed locally for projects A and B, and the user updates it in project A
- **THEN** project B's install of `x` keeps its previous content

### Requirement: Remote plugins are inspected before consent
Installing a plugin whose files are not local SHALL first fetch them into a staging area and classify them. The consent dialog SHALL then show the actual components. Cancelling SHALL discard the staged files, and nothing SHALL be generated or installed.

#### Scenario: Inspect then cancel
- **WHEN** the user starts installing a `url`-sourced plugin and cancels at the consent dialog
- **THEN** the staged fetch is deleted, and the plugin is not installed at any scope

### Requirement: Plugin files are never modified
Install, update and remove SHALL NOT modify any file of a fetched or adopted plugin. All translated content SHALL be generated as separate files owned by the dashboard.

#### Scenario: Upstream file unchanged after install
- **WHEN** a plugin whose skill contains `${CLAUDE_PLUGIN_ROOT}` is installed
- **THEN** that skill file is byte-identical before and after install

### Requirement: Content-only adopted plugins are used in place
A plugin is content-only when it has no hooks, no MCP servers, no inline shell in its commands, and no executable or script files. Adopting a content-only plugin that Claude Code has installed SHALL use Claude Code's current copy without copying or fetching it. The copy in use SHALL follow Claude Code's recorded install location. A changed version SHALL be re-classified before use. If that location no longer exists, the plugin SHALL contribute nothing and SHALL report one error naming it.

#### Scenario: Adopt a content-only plugin
- **WHEN** the user adopts a Claude-installed plugin whose files are only markdown skills, commands without inline shell, and agents
- **THEN** it is installed as a pi package whose skills are read from Claude Code's copy, and no fetch or copy occurs

#### Scenario: Claude Code bumps the version
- **WHEN** Claude Code updates the adopted plugin to a new version in a new directory, and a new session starts without a dashboard restart
- **THEN** the session uses the new version's skills and agents

#### Scenario: New version is no longer content-only
- **WHEN** Claude Code updates an in-place adopted plugin to a version that adds a hook, and a new session starts
- **THEN** the plugin contributes nothing, and the user is notified that it must be re-adopted to review the new components

#### Scenario: Claude Code uninstalls the plugin
- **WHEN** Claude Code removes its copy of an adopted read-only plugin and a new session starts
- **THEN** the plugin contributes nothing, and one error names the plugin

### Requirement: Executable adopted plugins are snapshot-copied
Adopting a Claude-installed plugin that is not content-only SHALL copy its files into the dashboard's store after consent. Every plugin root, data directory, and path variable given to that plugin's code SHALL point into the dashboard's store, never into Claude Code's directory. Checking for updates SHALL detect a newer version recorded by Claude Code and offer to re-copy it.

#### Scenario: Hook plugin adopted
- **WHEN** the user adopts a Claude-installed plugin with a `SessionStart` hook
- **THEN** the hook receives a `CLAUDE_PLUGIN_ROOT` inside the dashboard's store

#### Scenario: Skill with a bundled script adopted
- **WHEN** the user adopts a plugin whose skill ships `scripts/run.sh`
- **THEN** the plugin is snapshot-copied, and the skill's resolved script path is inside the dashboard's store

#### Scenario: Newer Claude version
- **WHEN** Claude Code records a newer version of an adopted snapshot plugin and the user checks for updates
- **THEN** the plugin is shown as updatable, and updating re-copies the newer version

### Requirement: Components are classified before install
The dashboard SHALL classify each component of a plugin as supported or unsupported before install, with a reason for each unsupported one. Supported: skills, commands, agents, MCP servers, and hooks for the Claude events the runtime handles. Unsupported:
- LSP servers, output styles, monitors, `bin/`, plugin `settings.json`;
- required `userConfig`;
- hooks with any other event key.

A plugin with no supported component SHALL NOT be installable.

#### Scenario: Mixed plugin
- **WHEN** a plugin has `skills/` and `.lsp.json`
- **THEN** skills are classified supported, LSP is classified unsupported with a reason, and the plugin is installable

#### Scenario: LSP-only plugin
- **WHEN** a plugin's only component is an LSP server
- **THEN** the plugin is listed as unsupported and the install action is unavailable

#### Scenario: Non-Claude hook key
- **WHEN** a plugin's `hooks.json` contains the key `pi:TurnEnd`
- **THEN** that hook is classified unsupported with the reason `unknown-hook-event`

### Requirement: The dashboard's own Claude plugin is not importable
The plugin that publishes pi-dashboard itself to Claude marketplaces SHALL be classified unsupported with the reason `native-equivalent`.

#### Scenario: Self-import attempt
- **WHEN** the pi-agent-dashboard marketplace is registered and its `pi-dashboard` plugin is listed
- **THEN** the plugin shows as unsupported with the reason `native-equivalent`, and has no install action

### Requirement: Installed plugins never change when their marketplace changes
An install SHALL use its own copy of the plugin's files, taken at install or update time. Refreshing, editing or removing the marketplace it came from SHALL NOT change what an installed plugin contains.

#### Scenario: Marketplace refresh after install
- **WHEN** plugin `x` with a relative source is installed, and the marketplace is refreshed to a commit that changes `x`
- **THEN** the installed `x` keeps its previous content until the user updates it

### Requirement: Orphaned installs are cleaned up
When an imported plugin's package entry disappears from its scope's settings by any route other than the dashboard's remove action, the install's generated files SHALL be deleted. Routes include package cleanup, the pi command line and manual edits. Files no longer used by any install SHALL then be deleted. An install whose project directory no longer exists SHALL be kept and reported as an orphan candidate.

#### Scenario: Entry removed outside the dashboard
- **WHEN** a global imported plugin's entry is deleted from the global settings file by hand, and the server next starts
- **THEN** that install's generated files are deleted

#### Scenario: Project directory gone
- **WHEN** the project of a local install has been deleted
- **THEN** the install is kept and reported as an orphan candidate

### Requirement: Same plugin name from two marketplaces is refused
Installing plugin `x` from one marketplace SHALL be refused while plugin `x` from a different marketplace is installed at an overlapping scope. Overlapping means the same scope, or global versus any local scope. The error SHALL name the installed one.

#### Scenario: Name already installed globally
- **WHEN** `code-review` from marketplace A is installed globally and the user installs `code-review` from marketplace B locally
- **THEN** the install is refused with an error naming marketplace A's `code-review`

### Requirement: Agent tool lists never widen
For each imported agent that declares tools, the generated definition SHALL restrict it to the mapped pi tools. This applies whether the source gives a comma-separated string or a list. Unmappable names SHALL be dropped and reported. An agent whose declared tools are all unmappable SHALL NOT be imported, with the reason `no-mappable-tools`. It SHALL never fall back to all tools.

#### Scenario: Comma-string tools become a restricted list
- **WHEN** a Claude agent declares `tools: Read, Grep, Glob`
- **THEN** the imported agent is restricted to the pi tools mapped from those names, and does not inherit any other tool

#### Scenario: Scoped tool form is not widened
- **WHEN** a Claude agent declares `tools: Read, Bash(git:*)`
- **THEN** the imported agent's tools are `read` only, and the import reports a warning naming `Bash(git:*)`

#### Scenario: Unmappable tool dropped with warning
- **WHEN** a Claude agent declares `tools: Read, TodoWrite`
- **THEN** the imported agent's tools are `read` only, and the import reports a warning naming `TodoWrite`

#### Scenario: All tools unmappable
- **WHEN** a Claude agent declares `tools: TodoWrite, NotebookEdit`
- **THEN** the agent is not imported, and the plugin's details show it as unsupported with the reason `no-mappable-tools`

#### Scenario: Agent without tools inherits, and says so
- **WHEN** a Claude agent declares no `tools`
- **THEN** the imported agent inherits the parent's tools, and the install consent lists it as inheriting all tools

### Requirement: Agent model aliases map to roles resolved at spawn
An imported agent's `model` SHALL be mapped to a role reference resolved when the agent is spawned: `sonnet` to the coding role, `opus` to the planning role, `haiku` to the fast role. `inherit`, an absent model, or any other value SHALL leave the model unset, and a non-alias value SHALL add a warning. The consent SHALL warn when a mapped role has no model assigned at install time.

#### Scenario: Sonnet agent
- **WHEN** a Claude agent declares `model: sonnet` and the coding role has a model assigned when the agent is spawned
- **THEN** the imported agent runs on the model bound to the coding role at that moment

#### Scenario: Role reassigned after install
- **WHEN** the coding role is bound to a different model after the plugin was installed
- **THEN** the next spawn of the imported agent uses the newly bound model

#### Scenario: Role not assigned at spawn
- **WHEN** a Claude agent declares `model: haiku` and the fast role has no model assigned when it is spawned
- **THEN** the spawn fails with an error naming the fast role

### Requirement: Imported agents resolve at global scope below local definitions
Agents of a globally installed plugin SHALL be resolvable by agent name in any session, unless a project, user or bundled agent, or another installed package's agent, of the same name takes precedence. The consent and details SHALL show each agent as active or shadowed, with what shadows it, for the scope being viewed. For a local install, they SHALL state that its agents are available only when installed globally.

#### Scenario: Spawn imported agent
- **WHEN** plugin `x` with agent `reviewer` is installed globally, no other `reviewer` agent exists, and a session spawns subagent type `reviewer`
- **THEN** the imported `reviewer` definition is used

#### Scenario: Shadowed agent
- **WHEN** the project defines its own `reviewer` agent
- **THEN** the project's agent is used, and plugin `x`'s details show its `reviewer` as shadowed by the project agent

#### Scenario: Shadowed by another plugin
- **WHEN** plugins `x` and `y` are both installed globally, and both define agent `code-reviewer`
- **THEN** one plugin's details show its `code-reviewer` as shadowed by the other plugin

#### Scenario: Local install warns about agents
- **WHEN** a plugin with agents and skills is installed at local scope
- **THEN** the installed-plugin details show that its agents are unavailable at local scope

#### Scenario: Agent-only plugin at local scope
- **WHEN** the user tries to install, at local scope, a plugin whose only supported components are agents
- **THEN** the local install is not offered, and global install is offered instead

### Requirement: Import records provenance and warnings
Each install SHALL record:
- its marketplace and source;
- the fetched ref, commit or version;
- whether it was adopted in place or snapshot-copied;
- its classified components;
- every translation warning.

The installed-plugin details SHALL show this record.

#### Scenario: Details show warnings
- **WHEN** an import dropped an unmappable agent tool
- **THEN** the installed-plugin details list that warning with the agent name

### Requirement: Remove and update use the standard package actions
Uninstall, update and check-for-updates on an imported plugin SHALL use the same package actions as any other package.
- Update SHALL refresh the plugin's files and regenerate its translated files at the same scope.
- Removing an install SHALL delete its generated files.
- Plugin files and the plugin data directory SHALL be deleted once no install uses them.
- Removal SHALL never touch Claude Code's copy.

#### Scenario: Update keeps scope
- **WHEN** a locally installed plugin is updated
- **THEN** it stays installed at local scope for the same project, with refreshed content

#### Scenario: Remove an adopted plugin
- **WHEN** the user removes an in-place adopted plugin
- **THEN** it disappears from installed packages, and Claude Code's copy still exists unchanged

#### Scenario: Last install removed
- **WHEN** the only install of plugin `x` is removed
- **THEN** `x`'s fetched files and its plugin data directory no longer exist

### Requirement: Runtime link survives dashboard upgrades
Imported plugins SHALL keep loading after the dashboard is upgraded or relocated, without reinstalling. That includes sessions started while the dashboard server is not running. When an imported plugin cannot reach the runtime compatibility layer, it SHALL register nothing and SHALL report one error naming the plugin, and the session SHALL start normally.

#### Scenario: Dashboard upgrade
- **WHEN** the dashboard is upgraded to a version installed at a different path
- **THEN** previously imported plugins load in new sessions without user action, whether or not the server has restarted

#### Scenario: Runtime unreachable
- **WHEN** a session loads an imported plugin whose runtime is missing
- **THEN** the session starts normally, the plugin contributes nothing, and one error naming the plugin is reported
