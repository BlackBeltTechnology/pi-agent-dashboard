# pi-resource-scanning Specification

## Purpose

Discover pi extensions, skills, prompts, and agents available to a working
directory (local `.pi/`, global `~/.pi/agent/`, and installed packages) and
expose them via the dashboard REST API with scope-derived activation state.
## Requirements
### Requirement: Resource scanner function
The server SHALL expose a `scanPiResources(cwd: string)` function that discovers all pi extensions, skills, prompts, and themes available for a given working directory, returning them grouped by source scope.

#### Scenario: Scan returns grouped results
- **WHEN** `scanPiResources("/path/to/project")` is called
- **THEN** the result SHALL contain `local`, `global`, and `packages` sections
- **AND** each section SHALL contain `extensions`, `skills`, `prompts`, `agents`, and `themes` arrays

#### Scenario: Extensions and agents remain scanner-discovered
- **GIVEN** pi's `RESOURCE_TYPES` contains no `agents` entry
- **WHEN** the scan result is assembled
- **THEN** `agents` SHALL continue to be discovered by the scanner
- **AND** `extensions` SHALL continue to be discovered by the scanner

#### Scenario: Result reports whether it came from the resolver
- **WHEN** `scanPiResources()` returns
- **THEN** the result SHALL indicate whether skills, prompts, and themes were sourced from pi's resolver or from the degraded filesystem fallback

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
- **AND** this SHALL hold for prompts sourced from the resolver as well as from the fallback walk

#### Scenario: Extension metadata from package
- **WHEN** an extension belongs to a package with `name` and `description` in `package.json`
- **THEN** the extension resource SHALL include the package name and description

#### Scenario: Unparseable skill frontmatter does not fail the scan
- **WHEN** a resolved skill path has frontmatter that cannot be parsed
- **THEN** the resource SHALL be omitted from the skills list
- **AND** the scan SHALL complete successfully

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

### Requirement: Skills, prompts, and themes SHALL be sourced from pi's resolver

The scanner SHALL derive skills, prompts, and themes from the `ResolvedPaths` returned by `resolveActivation()` — pi's own `DefaultPackageManager.resolve()` output — rather than from an independent filesystem walk. Each `ResolvedResource` provides `path`, `enabled`, and `metadata` carrying `source`, `scope`, and `origin`.

While the resolver is available the scanner SHALL NOT apply its own discovery rules to these three resource types. This constraint does not extend to `extensions` or `agents`, which have no resolver equivalent for `agents` and are out of scope for `extensions`.

The scanner's package resolution, `npm root -g` caching, and package metadata reading remain in use for building the package rows themselves; only skill, prompt, and theme *discovery* moves to the resolver.

#### Scenario: Resolved skills populate the scan result

- **WHEN** `resolveActivation()` returns skills for a working directory
- **THEN** the scan result SHALL contain one skill per resolved entry that passes the load gate
- **AND** each SHALL carry the resolved `path` as its `filePath`

#### Scenario: Scope and origin become per-resource attributes

- **GIVEN** resolved entries with `metadata.scope` of `project` and `user`, and `metadata.origin` of `top-level` and `package`
- **WHEN** the scan result is assembled
- **THEN** `project` entries SHALL carry a `local` scope attribute
- **AND** `user` entries SHALL carry a `global` scope attribute
- **AND** `package`-origin entries SHALL carry package provenance derived from `metadata.source`

#### Scenario: Temporary scope is treated as local

- **GIVEN** a resolved entry with `metadata.scope` of `temporary`
- **WHEN** the scan result is assembled
- **THEN** it SHALL carry the `local` scope attribute

#### Scenario: Unmatched package source is still reported

- **GIVEN** a `package`-origin entry whose `metadata.source` matches no known package row
- **WHEN** the scan result is assembled
- **THEN** the resource SHALL still be reported
- **AND** it SHALL be labelled with the raw `metadata.source` value
- **AND** it SHALL NOT be dropped

#### Scenario: Manifest-excluded package resources are absent

- **GIVEN** a package whose manifest patterns exclude one of its own resources
- **AND** that resource is therefore absent from `ResolvedPaths`
- **WHEN** the scan result is assembled
- **THEN** the resource SHALL NOT be reported
- **AND** the scan SHALL NOT synthesise a disabled entry for it

#### Scenario: Activation state comes from the resolver

- **GIVEN** a resolved entry with `enabled: false`
- **WHEN** the scan result is assembled
- **THEN** that resource SHALL be reported as disabled
- **AND** its state SHALL NOT be recomputed by a separate derivation

#### Scenario: Reference and documentation files are never reported

- **GIVEN** a skill directory containing `SKILL.md` alongside `UPSTREAM.md`, `dox-doctrine.md`, or a `references/` subtree
- **WHEN** the scan result is assembled from the resolver
- **THEN** only the `SKILL.md` entry SHALL be reported

#### Scenario: Ignored and out-of-tree files are never reported

- **GIVEN** `SKILL.md` files beneath `.worktrees/` and inside a built Electron bundle
- **WHEN** the scan result is assembled from the resolver
- **THEN** none of them SHALL be reported

#### Scenario: Themes are reported

- **WHEN** `resolveActivation()` returns theme entries
- **THEN** they SHALL appear in the scan result as theme resources

### Requirement: pi's load gate SHALL be applied to resolved skills

A resolved skill path whose frontmatter has no non-empty `description` SHALL NOT be reported as a skill, matching pi's `loadSkillFromFile`, which returns no skill in that case.

No name-based exclusion rule SHALL be used to achieve this.

#### Scenario: Resolved path without a description is not a skill

- **GIVEN** `resolveActivation()` returns `.pi/skills/AGENTS.md`
- **AND** that file has no frontmatter `description`
- **WHEN** the scan result is assembled
- **THEN** it SHALL NOT be reported as a skill

#### Scenario: A described file at the same location is a skill

- **GIVEN** a resolved bare `.md` path whose frontmatter declares a non-empty `description`
- **WHEN** the scan result is assembled
- **THEN** it SHALL be reported as a skill

#### Scenario: Name falls back to the containing directory

- **GIVEN** a resolved `SKILL.md` with a `description` and no `name`
- **WHEN** the scan result is assembled
- **THEN** the reported name SHALL be the containing directory's basename

### Requirement: The scanner SHALL degrade safely when the resolver is unavailable

When `resolveActivation()` returns `null`, the scanner SHALL fall back to its filesystem walk and SHALL mark the result as degraded so the payload is not presented as authoritative.

#### Scenario: Resolver unavailable

- **WHEN** `resolveActivation()` returns `null`
- **THEN** the scan SHALL still return results from the filesystem walk
- **AND** the result SHALL be marked degraded

#### Scenario: Resolver succeeds but returns nothing

- **GIVEN** `resolveActivation()` returns successfully with empty resource arrays
- **AND** the filesystem fallback finds resources at that location
- **WHEN** the scan result is assembled
- **THEN** the result SHALL be marked degraded
- **AND** it SHALL NOT be presented as an authoritative empty list

#### Scenario: Degraded results are not treated as pi's answer

- **GIVEN** a degraded scan result
- **WHEN** the resources payload is built
- **THEN** it SHALL carry the degraded marker
- **AND** no skill SHALL be labelled as not loaded

