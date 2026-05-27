## ADDED Requirements

### Requirement: Bridge extension ships a universal `browser` skill

The bridge extension's `package.json` SHALL declare a `browser` skill in its `pi.skills[]` array, pointing at `.pi/skills/browser`. The extension's `files[]` array SHALL include `.pi/skills/browser/` so the directory ships in the published npm tarball.

The skill content (SKILL.md, references, UPSTREAM.md, LICENSE) is specified by the `default-browser-skill` capability; this requirement covers only the registration mechanics.

#### Scenario: pi.skills[] declares the skill

- **WHEN** `packages/extension/package.json` is parsed
- **THEN** the `pi.skills` array SHALL contain the entry `.pi/skills/browser`

#### Scenario: Skill files ship in the published package

- **WHEN** `packages/extension/package.json` is parsed
- **THEN** the `files` array SHALL contain `.pi/skills/browser/` (or an equivalent glob that includes it)

#### Scenario: Skill loads in real sessions

- **WHEN** a pi session installs the bridge extension and starts
- **THEN** `pi.getCommands()` SHALL include an entry with `name === "browser"` and `source === "skill"`

### Requirement: Bridge does not auto-install agent-browser

The bridge extension SHALL NOT attempt to install the `agent-browser` or `pi-agent-browser` package automatically at session start or during skill registration. The user remains in control of installing the CLI; the skill's Step-0 preflight handles the missing-CLI case by instructing the user.

#### Scenario: No install side-effects at registration

- **WHEN** the bridge extension registers the `browser` skill at session start
- **THEN** the bridge SHALL NOT spawn `npm install`, `pi install`, or any equivalent install command
- **AND** the bridge SHALL NOT modify the user's `.pi/settings.json` or `~/.pi/agent/settings.json` to add either package
