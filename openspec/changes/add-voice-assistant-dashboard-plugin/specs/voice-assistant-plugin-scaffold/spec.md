## ADDED Requirements

### Requirement: Plugin package structure
The system SHALL provide a `packages/voice-assistant-plugin` workspace whose `pi-dashboard-plugin` manifest declares `client` and `server` entries, a `configSchema`, and a host-trusted priority (required for spawning copilot sessions), and SHALL NOT declare a `bridge` entry. The package SHALL ship two pi extensions — transcriber and copilot — loaded only into the sessions the plugin spawns, and SHALL depend on `@blackbelt-technology/pi-dashboard-video-transcription` for STT key resolution, async diarization and speaker naming.

#### Scenario: Manifest is discoverable by the plugin loader
- **WHEN** the dashboard server scans workspaces for `pi-dashboard-plugin` manifests
- **THEN** it discovers `packages/voice-assistant-plugin` and registers its claims without a load-time error

#### Scenario: No bridge entry, no global extension
- **WHEN** the manifest and package are inspected
- **THEN** there is no `bridge` field and no `pi` extension entry that pi would load into every session

#### Scenario: Copilot spawn is permitted
- **WHEN** the plugin calls `spawnSession` for a meeting
- **THEN** the host treats it as trusted and performs the spawn

### Requirement: Vendored set-copilot engine surface only
The system SHALL vendor, from a pinned upstream SHA, the import closure of `config.ts`, `capture.ts`, `poll.ts`, `copilot-prompt.ts`, `transcript-writer.ts`, `transcript-build.ts`, `transcript-stitch-run.ts`, `recovery-ledger.ts`, `runtime-dir.ts`, `handover.ts`, `config-preflight.ts`, `config-migrate.ts`, and `knowledge/*` into `packages/voice-assistant-plugin/src/vendor/set-copilot/`. The system SHALL NOT vendor `cli.ts`, `doctor.ts`, `diagnostics.ts`, `mirror-*.ts`, `skill-install.ts`, `replay*.ts`, `meeting.ts`, `detach.ts`, `project-registry.ts`, the wall server or `wall/public/*`, `.claude/skills/`, or `hooks/`. The only modification to vendored source SHALL be the `captureFactory` source seam in `capture.ts`, shipped as a named patch.

#### Scenario: Plugin builds without an upstream set-copilot dependency
- **WHEN** `packages/voice-assistant-plugin`'s `package.json` dependencies are inspected
- **THEN** it does not list `set-copilot` (nor a `github:tatargabor/set-copilot` reference) as a dependency

#### Scenario: No Claude-Code-coupled modules are vendored
- **WHEN** the vendored file tree under `src/vendor/set-copilot/` is inspected
- **THEN** it contains no `cli.ts`, no `mirror-*.ts`, no wall server or wall UI, and no `.claude/skills`/`hooks` directories

#### Scenario: Only the named patch differs from upstream
- **WHEN** the vendored tree is diffed against the pinned SHA
- **THEN** the only difference is `capture-source.patch`

#### Scenario: Vendored provenance is documented
- **WHEN** a maintainer opens `packages/voice-assistant-plugin/README.md` or `NOTICE`
- **THEN** it states the upstream repository, license (MIT), the upstream commit SHA vendored, and the explicit list of excluded (Claude-Code-specific) files

### Requirement: Workspace registration
The package SHALL be picked up by the existing `packages/*` workspace glob and SHALL complete the repo's new-plugin registrations (the `add-new-plugin-package-checklist`) so contract and CI tests recognise it.

#### Scenario: Workspace install includes the new package
- **WHEN** `pnpm install` runs at the repo root
- **THEN** `packages/voice-assistant-plugin` is resolved as a workspace member with no edit to `pnpm-workspace.yaml`
