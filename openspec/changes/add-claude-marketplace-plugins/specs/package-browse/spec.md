# Spec Delta

## ADDED Requirements

### Requirement: Claude marketplaces browsing surface
The package browser SHALL offer a Claude marketplaces view alongside the npm package search, in both global and local scope. The view SHALL list registered marketplaces, let the user add, refresh and remove a marketplace, and list each marketplace's plugins with name, description and support status.

#### Scenario: Open the view
- **WHEN** the user switches the package browser to the Claude marketplaces view
- **THEN** registered marketplaces and their plugins are listed

#### Scenario: Add a marketplace
- **WHEN** the user enters `owner/repo` and confirms
- **THEN** the marketplace appears in the list after its catalogue is fetched, or an error with the reason is shown

#### Scenario: No marketplaces yet
- **WHEN** no marketplace is registered
- **THEN** the view shows an empty state with the add-marketplace control, and the marketplaces Claude Code already knows about as one-click adopt suggestions

### Requirement: Claude plugin cards show component badges
Each Claude plugin card SHALL show a badge per component kind present: skills, commands, agents, mcp, hooks, lsp. Unsupported kinds SHALL look different from supported ones. A plugin whose components are not yet known SHALL offer an Inspect action. A plugin with no supported component SHALL show an "Unsupported" state with its reason, and SHALL offer no install action.

#### Scenario: Supported plugin
- **WHEN** a plugin has skills and commands
- **THEN** its card shows `skills` and `commands` badges and an Install action

#### Scenario: Remote plugin not inspected
- **WHEN** a plugin's components are unknown because it is remote and not yet inspected
- **THEN** its card shows an Inspect action, and inspecting it shows its component badges

#### Scenario: LSP-only plugin
- **WHEN** a plugin's only component is an LSP server
- **THEN** its card shows a distinguished `lsp` badge, an "Unsupported" state with its reason, and no Install action

#### Scenario: Adopted plugin marker
- **WHEN** a listed plugin is already installed by Claude Code
- **THEN** its card shows that it can be adopted from Claude Code

### Requirement: Claude plugin install consent lists executable components
Before a Claude plugin is installed, the confirmation SHALL show its name, source, scope and component counts. It SHALL list each hook with its event, matcher, command, and whether its interpreter was found. It SHALL list each MCP server with its command or URL and the names of the environment variables its configuration expands. Hooks and MCP servers SHALL be labelled as third-party code run on this machine.

#### Scenario: Plugin with hooks
- **WHEN** the user installs a plugin declaring a `PreToolUse` hook that runs `node scripts/guard.js`
- **THEN** the confirmation lists that hook's event, matcher and command, labelled as running third-party code

#### Scenario: MCP secrets visible
- **WHEN** the plugin declares an HTTP MCP server whose headers expand `${GITHUB_PERSONAL_ACCESS_TOKEN}`
- **THEN** the confirmation shows the server URL and the variable name `GITHUB_PERSONAL_ACCESS_TOKEN`, and never its value

### Requirement: Claude plugin install consent lists narrowed and unsupported components
Before a Claude plugin is installed, the confirmation SHALL show, per agent: dropped tools, model mapping, inherit-all, or not imported. It SHALL also show skill and agent name collisions with installed packages, unsupported components with reasons, and, for adoptions, whether a snapshot copy is used.

#### Scenario: Agent narrowing shown
- **WHEN** the plugin contains an agent declaring `tools: Read, TodoWrite` and `model: sonnet`
- **THEN** the confirmation shows that `TodoWrite` is dropped and that the agent uses the coding role

#### Scenario: Agent inheriting all tools
- **WHEN** the plugin contains an agent that declares no tools
- **THEN** the confirmation names that agent as inheriting all tools

#### Scenario: Local scope with agents
- **WHEN** the user installs a plugin with agents at local scope
- **THEN** the confirmation states that its agents are available only when installed globally

#### Scenario: Cancel
- **WHEN** the user cancels the confirmation
- **THEN** any files fetched for inspection are discarded, and nothing is generated or installed

### Requirement: Imported Claude plugins appear in installed package lists
An installed Claude plugin SHALL appear in every installed-packages list that shows its scope, including Settings, with a marker identifying it as a Claude plugin and its marketplace. Update, uninstall and check-for-updates SHALL work as for any other installed package. Its details SHALL show:
- provenance and translation warnings;
- each agent as active or shadowed;
- whether this install is overridden by a local install.

#### Scenario: Installed row
- **WHEN** a Claude plugin `x` from marketplace `m` is installed globally
- **THEN** the Installed Packages section and the Settings package list both show `x` with a Claude-plugin marker naming `m`, and with update and uninstall actions

#### Scenario: Warnings visible
- **WHEN** the import of `x` produced translation warnings
- **THEN** opening `x`'s details shows each warning

## MODIFIED Requirements

### Requirement: Cross-scope installed badges SHALL be keyed by `source`

The `PackageBrowser`'s `installedInfo` map SHALL be keyed by `pkg.source` (the canonical source string from the server). Cross-scope detection SHALL work for every source shape, not only `npm:<name>`. For an imported Claude plugin, the map SHALL instead be keyed by the plugin's marketplace and name, because each install of the plugin has its own source. The npm-name regex extraction at `PackageBrowser.tsx:35-49` (pre-change) SHALL be removed.

#### Scenario: local-path installed in both scopes shows cross-scope badge

- **WHEN** the workspace settings.json has `packages: ["/abs/path/foo"]`
- **AND** the global settings.json also has `packages: ["/abs/path/foo"]`
- **AND** the user is viewing `PackageBrowser` with `scope="local"`
- **THEN** the `/abs/path/foo` row shows a "also installed in global" badge

#### Scenario: search-result row for a package installed in workspace shows local-scope badge

- **WHEN** the user searches `npm` and a result for `pi-flows` appears
- **AND** `pi-flows` is installed in the workspace (`source === "npm:pi-flows"`)
- **THEN** the search-result `PackageCard` shows the "installed locally" badge using a synthesized `npm:${pkg.name}` lookup against the source-keyed map

#### Scenario: Imported Claude plugin installed in both scopes

- **WHEN** plugin `x` from marketplace `m` is installed globally and locally for the viewed project
- **THEN** its row shows the cross-scope badge, although the two installs have different sources
