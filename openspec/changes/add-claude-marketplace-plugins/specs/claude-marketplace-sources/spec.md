# Spec Delta

## Purpose

Lets the dashboard register Claude Code plugin marketplaces, read their plugin catalogues, resolve where each plugin's files and components come from, and discover what Claude Code has already installed, without the dashboard ever writing to Claude Code's own directories.

## ADDED Requirements

### Requirement: Register a marketplace
The server SHALL accept a marketplace registration whose location is a GitHub `owner/repo`, a git URL, or a local directory. A registration SHALL succeed only when the location contains `.claude-plugin/marketplace.json` that parses as JSON with a `name` and a `plugins` array. The registered marketplace SHALL persist across server restarts.

#### Scenario: GitHub shorthand registers
- **WHEN** the user registers `anthropics/claude-plugins-official`
- **THEN** the server fetches the repository, finds `.claude-plugin/marketplace.json`, and lists the marketplace under the name declared in that file

#### Scenario: Location without a manifest is rejected
- **WHEN** the user registers a git URL whose checkout has no `.claude-plugin/marketplace.json`
- **THEN** the registration fails with an error naming the missing file, and no marketplace is persisted

#### Scenario: Invalid manifest is rejected
- **WHEN** `.claude-plugin/marketplace.json` is not valid JSON or has no `plugins` array
- **THEN** the registration fails with a parse error, and no marketplace is persisted

#### Scenario: Registration survives restart
- **WHEN** a marketplace was registered and the server restarts
- **THEN** the marketplace is still listed with its last-fetched catalogue

### Requirement: Duplicate marketplace names are refused
The server SHALL refuse a registration whose declared marketplace name equals that of an already registered marketplace.

#### Scenario: Same name from a different location
- **WHEN** a marketplace named `acme` is registered and the user registers another location whose manifest also declares `acme`
- **THEN** the second registration fails with a duplicate-name error, and the first marketplace is unchanged

### Requirement: Refresh and remove a marketplace
The server SHALL refresh a registered marketplace on demand by re-fetching its location and re-parsing its catalogue. Removing a marketplace SHALL unregister it without uninstalling plugins already imported from it.

#### Scenario: Refresh picks up a new plugin
- **WHEN** the upstream manifest gains a plugin entry and the user refreshes the marketplace
- **THEN** the catalogue lists the new plugin

#### Scenario: Refresh failure keeps the previous catalogue
- **WHEN** a refresh fails because of a network or git error
- **THEN** the previous catalogue stays listed and the failure is reported with its reason

#### Scenario: Remove keeps installed plugins
- **WHEN** the user removes a marketplace from which a plugin is installed
- **THEN** the marketplace is no longer listed and the installed plugin keeps working

### Requirement: Catalogue entries carry source and component summary
Each catalogue entry SHALL expose: the plugin name, description, version when declared, its source shape, and a support status. For plugins whose files are available locally, it SHALL also expose the component kinds present: skills, commands, agents, mcp, hooks, lsp. Remote plugins SHALL show their components as unknown until inspected.

#### Scenario: Local plugin shows its components
- **WHEN** a catalogue entry has a relative-path source pointing at a directory with `skills/` and `.mcp.json`
- **THEN** the entry lists the component kinds `skills` and `mcp`

#### Scenario: Remote plugin before inspection
- **WHEN** a catalogue entry has a `url` source that has not been fetched
- **THEN** the entry shows its source shape and states that its components are unknown until inspected

### Requirement: Plugin source shapes are resolved
The server SHALL resolve these plugin `source` shapes to a plugin root:
- a relative path inside the marketplace, including `./` for the marketplace root;
- `url`, a git repository;
- `git-subdir`, a path inside a git repository;
- `github`, an `owner/repo`.

An optional ref SHALL be honoured. Any other shape SHALL be listed with the support status `unsupported` and the reason `unknown-source`.

#### Scenario: Marketplace root as plugin
- **WHEN** a plugin entry has `source: "./"`
- **THEN** the plugin root is the marketplace checkout's root directory

#### Scenario: git-subdir resolves the subdirectory
- **WHEN** a plugin source is `{source: "git-subdir", url, path: "plugins/x"}`
- **THEN** the resolved plugin root is the `plugins/x` directory of that repository

#### Scenario: Ref pinned to a commit
- **WHEN** a plugin source is `{source: "url", url, ref: "66682fb0513aec..."}` with a full commit hash
- **THEN** the resolved plugin root contains the files at that commit

#### Scenario: Unknown source shape
- **WHEN** a plugin source has `source: "svn"`
- **THEN** the plugin is listed as unsupported with the reason `unknown-source`, and it cannot be installed

### Requirement: Git operations time out
Every git operation the dashboard runs to fetch a marketplace or a plugin SHALL be aborted after 120 seconds. The operation SHALL then be reported as timed out, naming the location. Any partially fetched directory SHALL be deleted. Previously fetched state SHALL stay unchanged.

#### Scenario: Remote stalls during refresh
- **WHEN** a marketplace refresh's git fetch receives no data for longer than 120 seconds
- **THEN** the refresh is reported as timed out, the previous catalogue stays listed, and no partial checkout remains

#### Scenario: Remote stalls during inspection
- **WHEN** inspecting a remote plugin stalls for longer than 120 seconds
- **THEN** the inspection is reported as timed out, no consent dialog opens, and the staging directory no longer exists

### Requirement: Component locations follow Claude's resolution
A plugin's components SHALL be the union of three sources:
- the default locations: `skills/`, `commands/`, `agents/`, `hooks/hooks.json`, `.mcp.json`, `.lsp.json`;
- paths declared in the plugin's `.claude-plugin/plugin.json`;
- components declared inline in its marketplace entry, whatever the entry's `strict` value.

When the entry sets `strict: false`, the marketplace entry SHALL be authoritative and `plugin.json` SHALL be ignored.

#### Scenario: Skills at a custom path
- **WHEN** a marketplace entry declares `skills: ["./local-ai-use"]` for a plugin with no `skills/` directory
- **THEN** the plugin's skill list contains the skills under `./local-ai-use`

#### Scenario: Inline LSP declaration without strict
- **WHEN** a marketplace entry with no `strict` key declares `lspServers`, and the plugin directory has no `.lsp.json`
- **THEN** the entry lists the component kind `lsp`

### Requirement: Resolved paths stay inside allowed roots
Every path derived from a marketplace manifest, plugin manifest, or plugin source SHALL resolve inside its plugin root. Each plugin root SHALL itself resolve inside the marketplace checkout, the dashboard's Claude plugin store, or, for an in-place adoption, the install location Claude Code recorded for that plugin. Containment SHALL be checked on real paths, after following symbolic links. A path that escapes SHALL be rejected.

#### Scenario: Traversal in a relative source
- **WHEN** a plugin entry has `source: "../../etc"`
- **THEN** the plugin is listed as unsupported with a path-escape reason, and no file outside the allowed roots is read

#### Scenario: Symlink escape inside a plugin
- **WHEN** a plugin's `skills/` directory is a symbolic link to a directory outside the plugin root
- **THEN** that component is rejected with a path-escape reason

### Requirement: Existing Claude Code installs are discoverable
The server SHALL list the marketplaces and installed plugins recorded by Claude Code in the user's Claude plugins directory, with each installed plugin's scope. A user-scope install SHALL be offered for adoption at global scope. A project-scope install SHALL be offered at local scope for its project. A listed marketplace SHALL be adoptable without fetching it again.

#### Scenario: Discover known marketplaces
- **WHEN** Claude Code has marketplaces recorded in its plugins directory
- **THEN** the discovery listing shows each one with its name, source and checkout location

#### Scenario: Adopt a marketplace in place
- **WHEN** the user adopts a discovered marketplace
- **THEN** it is registered as adopted, reads its catalogue from Claude Code's existing checkout, and no new fetch occurs

#### Scenario: Project-scope Claude install
- **WHEN** Claude Code has plugin `x` installed at project scope for `/work/app`
- **THEN** discovery offers `x` for adoption at local scope for `/work/app`

#### Scenario: No Claude Code installation
- **WHEN** the Claude plugins directory does not exist
- **THEN** the discovery listing is empty and no error is raised

### Requirement: Dashboard operations never write Claude Code directories
The dashboard SHALL NOT create, modify, or delete any file under Claude Code's plugins directory. This applies to every dashboard operation, including registration, refresh, discovery, adoption, install, update, and removal.

#### Scenario: Refresh of an adopted marketplace
- **WHEN** the user refreshes an adopted marketplace
- **THEN** the dashboard re-reads Claude Code's checkout without running any git operation in it, and no file under the Claude plugins directory changes
