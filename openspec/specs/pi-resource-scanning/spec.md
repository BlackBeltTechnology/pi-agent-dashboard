# pi-resource-scanning Specification

## Purpose

Discover pi extensions, skills, prompts, and agents available to a working
directory (local `.pi/`, global `~/.pi/agent/`, and installed packages) and
expose them via the dashboard REST API with scope-derived activation state.
## Requirements
### Requirement: Resource scanner function
The server SHALL expose a `scanPiResources(cwd: string)` function that discovers all pi extensions, skills, and prompts available for a given working directory, returning them grouped by source scope.

#### Scenario: Scan returns grouped results
- **WHEN** `scanPiResources("/path/to/project")` is called
- **THEN** the result SHALL contain `local`, `global`, and `packages` sections
- **AND** each section SHALL contain `extensions`, `skills`, and `prompts` arrays

### Requirement: Local resource discovery
The scanner SHALL discover resources from the project's `.pi/` directory.

#### Scenario: Local skills from SKILL.md directories
- **WHEN** `<cwd>/.pi/skills/code-review/SKILL.md` exists
- **THEN** it SHALL appear in `local.skills` with `name`, `description`, and `filePath`

#### Scenario: Local skills from root .md files
- **WHEN** `<cwd>/.pi/skills/my-skill.md` exists (a file, not a directory)
- **THEN** it SHALL appear in `local.skills`

#### Scenario: Local extensions from .ts files
- **WHEN** `<cwd>/.pi/extensions/my-ext.ts` exists
- **THEN** it SHALL appear in `local.extensions` with `name` derived from filename and `filePath`

#### Scenario: Local extensions from subdirectory index.ts
- **WHEN** `<cwd>/.pi/extensions/my-ext/index.ts` exists
- **THEN** it SHALL appear in `local.extensions` with `name` derived from directory name

#### Scenario: Local prompts from .md files
- **WHEN** `<cwd>/.pi/prompts/review.md` exists
- **THEN** it SHALL appear in `local.prompts` with `name` derived from filename (without `.md`) and `filePath`

#### Scenario: Missing .pi directory
- **WHEN** `<cwd>/.pi/` does not exist
- **THEN** `local` SHALL contain empty arrays for all resource types

### Requirement: Global resource discovery
The scanner SHALL discover resources from `~/.pi/agent/`.

#### Scenario: Global skills
- **WHEN** `~/.pi/agent/skills/my-skill/SKILL.md` exists
- **THEN** it SHALL appear in `global.skills`

#### Scenario: Global extensions
- **WHEN** `~/.pi/agent/extensions/my-ext.ts` exists
- **THEN** it SHALL appear in `global.extensions`

#### Scenario: Global prompts
- **WHEN** `~/.pi/agent/prompts/review.md` exists
- **THEN** it SHALL appear in `global.prompts`

#### Scenario: Missing global directory
- **WHEN** `~/.pi/agent/` does not exist
- **THEN** `global` SHALL contain empty arrays for all resource types

### Requirement: Package resolution from settings.json
The scanner SHALL read `packages[]` from both `<cwd>/.pi/settings.json` and `~/.pi/agent/settings.json`, resolving each entry to a filesystem path.

#### Scenario: npm package resolution
- **WHEN** a settings entry is `"npm:my-package"`
- **THEN** the scanner SHALL resolve it to the npm global modules directory + `my-package/`
- **AND** read `package.json` for `pi.extensions`, `pi.skills`, `pi.prompts`

#### Scenario: git package resolution
- **WHEN** a settings entry is `"git:github.com/user/repo"`
- **THEN** the scanner SHALL resolve it to `~/.pi/agent/git/github.com/user/repo/` (for global settings) or `<cwd>/.pi/git/github.com/user/repo/` (for local settings)

#### Scenario: Local path package resolution
- **WHEN** a settings entry is `"../my-package"` (relative path)
- **THEN** the scanner SHALL resolve it relative to the settings file location

#### Scenario: Absolute path package resolution
- **WHEN** a settings entry is `"/path/to/my-package"` (absolute path)
- **THEN** the scanner SHALL resolve it to the absolute path directly

#### Scenario: Package with pi manifest
- **WHEN** a resolved package has `package.json` with `pi.extensions`, `pi.skills`, or `pi.prompts`
- **THEN** the scanner SHALL resolve those paths relative to the package root and list the resources

#### Scenario: Package with conventional directories
- **WHEN** a resolved package has no `pi` manifest but has `extensions/`, `skills/`, or `prompts/` directories
- **THEN** the scanner SHALL discover resources from those conventional directories

#### Scenario: Package deduplication
- **WHEN** the same package appears in both local and global settings
- **THEN** the scanner SHALL include it only once (local wins)

#### Scenario: Missing or unreadable package
- **WHEN** a package path does not exist or is unreadable
- **THEN** the scanner SHALL skip it silently without failing the overall scan

### Requirement: Metadata parsing
The scanner SHALL parse metadata from resource files.

#### Scenario: SKILL.md YAML frontmatter
- **WHEN** a SKILL.md file contains YAML frontmatter with `name` and `description` fields
- **THEN** the skill resource SHALL include those values

#### Scenario: Prompt YAML frontmatter
- **WHEN** a prompt .md file contains YAML frontmatter with a `description` field
- **THEN** the prompt resource SHALL include that description

#### Scenario: Prompt without frontmatter
- **WHEN** a prompt .md file has no YAML frontmatter
- **THEN** the `description` SHALL be the first non-empty line of the file

#### Scenario: Extension metadata from package
- **WHEN** an extension belongs to a package with `name` and `description` in `package.json`
- **THEN** the extension resource SHALL include the package name and description

### Requirement: REST endpoint
The server SHALL expose `GET /api/pi-resources?cwd=<path>` returning scanned resources.

#### Scenario: Successful scan
- **WHEN** a request is made with a valid `cwd` that matches a known session directory
- **THEN** the response SHALL be `{ success: true, data: { local: {...}, global: {...}, packages: [...] } }`

#### Scenario: Missing cwd parameter
- **WHEN** `cwd` is not provided
- **THEN** the response SHALL be `{ success: false, error: "cwd parameter required" }` with HTTP 400

#### Scenario: Localhost only
- **WHEN** a request originates from a non-loopback address
- **THEN** the request SHALL be rejected with HTTP 403

### Requirement: Polling integration
The scanner results SHALL be polled periodically and cached.

#### Scenario: Polling interval
- **WHEN** DirectoryService polling is running
- **THEN** pi resources SHALL be re-scanned alongside OpenSpec polling (every 30 seconds)

#### Scenario: Cache hit
- **WHEN** `GET /api/pi-resources` is called between polls
- **THEN** the cached result SHALL be returned without re-scanning

#### Scenario: Manual refresh
- **WHEN** a refresh is triggered for a directory
- **THEN** the pi resources cache SHALL be invalidated and re-scanned

### Requirement: npm global root caching
The scanner SHALL cache the npm global root path.

#### Scenario: Cache npm root
- **WHEN** the scanner first resolves an npm package
- **THEN** it SHALL call `npm root -g` once and cache the result for the server lifetime

#### Scenario: Cached npm root reuse
- **WHEN** subsequent npm packages are resolved
- **THEN** the cached npm root SHALL be reused without shelling out again

### Requirement: Agent resource discovery

The scanner SHALL discover subagents as a resource of `type: "agent"` from
`agents/*.md` files at both scopes: local `<cwd>/.pi/agents/` and global
`~/.pi/agent/agents/`, plus agents contributed by installed packages. Each
`PiResourceScope` returned by the scanner SHALL include an `agents` array
alongside `extensions`, `skills`, and `prompts`. A missing `agents/` directory
SHALL yield an empty array without error, matching the behavior for a missing
`skills/` directory.

#### Scenario: Local agents from agents/*.md

- **GIVEN** `<cwd>/.pi/agents/Explore.md` and `<cwd>/.pi/agents/react-expert.md` exist
- **WHEN** `scanPiResources("<cwd>")` is called
- **THEN** the `local.agents` array SHALL contain two resources with `type: "agent"`
- **AND** their `name` values SHALL be `Explore` and `react-expert`

#### Scenario: Global agents

- **GIVEN** `~/.pi/agent/agents/doc-writer.md` exists
- **WHEN** the scanner runs
- **THEN** `global.agents` SHALL contain a resource with `type: "agent"` and `name: "doc-writer"`

#### Scenario: Missing agents directory

- **GIVEN** no `agents/` directory exists at a scope
- **WHEN** the scanner runs
- **THEN** that scope's `agents` array SHALL be empty and no error SHALL be raised

### Requirement: Agent metadata parsing

For each discovered agent, the scanner SHALL parse `name`, `description`,
`model`, and `tools` from the agent file's YAML frontmatter. `model` and `tools`
SHALL be optional; when absent the corresponding fields SHALL be omitted.

#### Scenario: Agent frontmatter with model and tools

- **WHEN** an agent `.md` file contains frontmatter with `model: sonnet` and `tools: [edit, read]`
- **THEN** the agent resource SHALL include `model: "sonnet"` and a `tools` summary derived from the frontmatter value

#### Scenario: Agent without model or tools

- **WHEN** an agent `.md` file omits `model` and `tools` in its frontmatter
- **THEN** the agent resource SHALL omit `model` and `tools` and still include `name`/`description`

