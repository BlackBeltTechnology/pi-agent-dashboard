## ADDED Requirements

### Requirement: Server-only plugin package structure
The system SHALL provide a `packages/voice-assistant-plugin` workspace with a `pi-dashboard-plugin` manifest at the top level of its `package.json`, declaring `client` and `server` entries and a `configSchema`. The manifest SHALL NOT declare a `bridge` entry.

#### Scenario: Manifest is discoverable by the plugin loader
- **WHEN** the dashboard server starts and scans installed workspaces for `pi-dashboard-plugin` manifests
- **THEN** it discovers `packages/voice-assistant-plugin`'s manifest and registers its declared claims without a load-time error

#### Scenario: No bridge entry is declared
- **WHEN** the manifest is inspected
- **THEN** it has no `bridge` field and no pi-extension code is loaded into any pi session on account of this plugin

### Requirement: Vendored set-copilot library surface only
The system SHALL vendor exactly the modules `set-copilot`'s own `src/index.ts` re-exports (config, capture, poll, copilot-prompt, knowledge adapter/keyword-matcher, transcript writer/build/stitch, wall server/types) plus their direct internal imports, into `packages/voice-assistant-plugin/src/vendor/set-copilot/`. The system SHALL NOT vendor `cli.ts`, `doctor.ts`, `mirror-follow.ts`, `mirror-policy.ts`, `config-migrate.ts`, `.claude/skills/`, or `hooks/`.

#### Scenario: Plugin builds without an upstream set-copilot dependency
- **WHEN** `packages/voice-assistant-plugin`'s `package.json` dependencies are inspected
- **THEN** it does not list `set-copilot` (nor a `github:tatargabor/set-copilot` reference) as a dependency

#### Scenario: No Claude-Code-coupled modules are vendored
- **WHEN** the vendored file tree under `src/vendor/set-copilot/` is inspected
- **THEN** it contains no `cli.ts`, no `mirror-follow.ts`/`mirror-policy.ts`, and no `.claude/skills`/`hooks` directories

#### Scenario: Vendored provenance is documented
- **WHEN** a maintainer opens `packages/voice-assistant-plugin/README.md` or `NOTICE`
- **THEN** it states the upstream repository, license (MIT), the upstream commit SHA vendored, and the explicit list of excluded (Claude-Code-specific) files

### Requirement: Workspace registration
The system SHALL register `voice-assistant-plugin` as a workspace package so it builds and installs alongside the other dashboard packages.

#### Scenario: Workspace install includes the new package
- **WHEN** `pnpm install` runs at the repo root
- **THEN** `packages/voice-assistant-plugin` is resolved as a workspace member with its dependencies installed
