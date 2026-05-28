## Purpose

Defines the bridge-shipped composite `browser` skill that ships inside `@blackbelt-technology/pi-dashboard-extension` and is auto-registered in every pi session via the extension's `pi.skills[]` mechanism. Replaces the prior project-local `browser-visual-debug` skill and the pre-installed `pi-agent-browser` dependency with an on-demand, documentation-only skill covering both generic web automation and Electron-app automation (including a worked example targeting the Pi Dashboard Electron app via `--debug-cdp`). The CLI itself (`agent-browser` / `pi-agent-browser`) is NOT bundled — the skill's Step-0 preflight checks for it on PATH and instructs the user to install it on demand.

## Requirements

### Requirement: Skill is delivered by the bridge extension to every session

The dashboard bridge extension SHALL ship a composite skill named `browser` such that every pi session loading the bridge automatically registers the skill via pi's extension `pi.skills[]` mechanism. No project-local `.pi/skills/` directory and no manual install SHALL be required.

#### Scenario: Skill registered at session start

- **WHEN** a pi session loads the dashboard bridge extension (`@blackbelt-technology/pi-dashboard-extension`)
- **THEN** the skill `browser` SHALL appear in `pi.getCommands()` output with `source === "skill"`

#### Scenario: Skill visible in slash-command autocomplete

- **WHEN** an agent types `/skill:` or `/browser` in a dashboard session
- **THEN** the `browser` skill SHALL appear in autocomplete

### Requirement: Composite skill structure

The skill SHALL be a single composite skill (one entry in autocomplete) covering two recipes — general web automation and Electron-app automation — via internal reference docs.

The skill SHALL ship at `packages/extension/.pi/skills/browser/` with this layout:

- `SKILL.md` — top-level orchestrator with YAML frontmatter (`name: browser`, descriptive `description:` covering both recipes' trigger phrases, `allowed-tools: Bash(agent-browser:*), Bash(npx agent-browser:*)`)
- `references/web.md` — vendored adaptation of upstream `agent-browser` `core` skill
- `references/electron.md` — vendored adaptation of upstream `agent-browser` `electron` skill, including a worked example targeting the Pi Dashboard Electron app via `--debug-cdp`
- `UPSTREAM.md` — provenance record (upstream repo URL, commit SHA, CLI version, refresh date)
- `LICENSE` — attribution per upstream `agent-browser` license terms

#### Scenario: Required files present

- **WHEN** the bridge extension package is installed
- **THEN** all five files above SHALL exist under `node_modules/@blackbelt-technology/pi-dashboard-extension/.pi/skills/browser/`

#### Scenario: SKILL.md frontmatter declares allowed tools

- **WHEN** the agent reads `SKILL.md`
- **THEN** the `allowed-tools:` frontmatter field SHALL include `Bash(agent-browser:*)` and `Bash(npx agent-browser:*)`

### Requirement: Step-0 preflight checks for the agent-browser CLI

The skill's `SKILL.md` SHALL instruct the agent to verify that the `agent-browser` CLI is on `PATH` as Step 0 before attempting any browser-automation work. If the CLI is missing, the skill SHALL halt with a clear instruction to install it via `pi install npm:pi-agent-browser`, and SHALL NOT attempt automatic installation.

#### Scenario: CLI present

- **WHEN** the agent invokes the skill and `command -v agent-browser` exits 0
- **THEN** the skill SHALL proceed to recipe routing (Step 1)

#### Scenario: CLI missing

- **WHEN** the agent invokes the skill and `command -v agent-browser` exits non-zero
- **THEN** the skill SHALL emit "agent-browser CLI not installed. Run: pi install npm:pi-agent-browser" and halt
- **AND** the skill SHALL NOT attempt `npm install`, `pi install`, or any other side-effecting command on the agent's behalf

### Requirement: Electron recipe includes Pi Dashboard worked example

`references/electron.md` SHALL include a worked example demonstrating how to attach `agent-browser` to the Pi Dashboard Electron app via the `--debug-cdp` flag introduced by this change. The example SHALL cover: launching the app with the flag, calling `agent-browser connect 9222`, listing tabs (main window, wizard window, doctor window), and taking a screenshot.

#### Scenario: Worked example present

- **WHEN** the agent reads `references/electron.md`
- **THEN** the document SHALL contain a section titled "Worked example: Pi Dashboard" (or equivalent) showing the launch command, connect command, tab listing, and screenshot capture
- **AND** the example SHALL reference the `--debug-cdp` flag (or `PI_DEBUG_CDP` env var) introduced in this change

### Requirement: Upstream provenance is recorded

The skill SHALL include an `UPSTREAM.md` file documenting the source of vendored content so future maintainers can detect drift mechanically. The file SHALL record at minimum: upstream repository URL, commit SHA (or tag), `agent-browser` CLI version the content was extracted from, and the date of last refresh.

#### Scenario: UPSTREAM.md contents

- **WHEN** the agent (or a maintainer) reads `UPSTREAM.md`
- **THEN** it SHALL contain entries for `source`, `commit` (or `tag`), `agent-browser version`, and `refreshed` (ISO date)

### Requirement: Skill is composable with user-local skills

If a user has their own skill named `browser` at `<cwd>/.pi/skills/browser/`, pi's local > extension skill precedence SHALL apply and the user's skill SHALL win. The bridge-shipped skill does NOT preempt user-local skills.

#### Scenario: User-local override

- **WHEN** a pi session is opened in a directory containing `.pi/skills/browser/SKILL.md`
- **THEN** that local skill SHALL be the one resolved by `/skill:browser`, not the bridge-shipped skill

### Requirement: No CLI is bundled

The bridge extension package SHALL NOT add `agent-browser`, `pi-agent-browser`, or any Chromium binary as a runtime dependency. The skill is documentation only; the CLI is installed on demand by the user per Step 0 instructions.

#### Scenario: No agent-browser dependency

- **WHEN** `packages/extension/package.json` is inspected
- **THEN** neither `dependencies`, `peerDependencies`, nor `optionalDependencies` SHALL contain `agent-browser` or `pi-agent-browser`
