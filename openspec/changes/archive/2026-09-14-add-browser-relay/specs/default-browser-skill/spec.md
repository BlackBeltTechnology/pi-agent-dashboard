## ADDED Requirements

### Requirement: Dashboard-relay recipe for logged-in browsing

The skill SHALL ship `references/dashboard-relay.md` describing how to drive the user's real Chrome profile through the dashboard browser relay: probe `GET /api/browser/status`, discover profiles via `GET /api/browser/profiles`, obtain a CDP URL via `POST /api/browser/connect?profile=<profileDirectory>` (the agent keeps the returned `cdpUrl` for the task; there is no lookup endpoint), then `agent-browser connect <cdpUrl>` and proceed with the ordinary web recipe. The recipe SHALL state the deny-list behaviour (denied verbs fail loud; never retry with a different browser) and the tab-group isolation model.

#### Scenario: Relay reachable and profile connected

- **WHEN** the task needs logged-in state, `GET /api/browser/status` reports `enabled: true` and `canOpenChrome: true`, and `POST /api/browser/connect?profile=<profileDirectory>` returns a `cdpUrl`
- **THEN** the skill SHALL instruct `agent-browser connect <cdpUrl>` and continue with `references/web.md` commands unchanged

#### Scenario: Extension not installed in the chosen profile

- **WHEN** `connect` returns 409 `{reason: "not-installed"}`
- **THEN** the skill SHALL tell the user to install the Playwright Chrome Extension in that profile and halt; it SHALL NOT fall back to the bundled browser for a task that requires login state

#### Scenario: Profile busy

- **WHEN** `connect` returns 409 `{reason: "busy", instanceId}`
- **THEN** the skill SHALL report the live instance and ask the user whether to disconnect it or use another profile; it SHALL NOT tell the user to install anything

#### Scenario: Relay unavailable

- **WHEN** the dashboard is down, `GET /api/browser/status` is 404, or it reports `enabled: false` or `canOpenChrome: false`
- **THEN** the skill SHALL route to `references/own-browser.md` (legacy) only if that provider reports ready, otherwise halt with a clear message

## MODIFIED Requirements

### Requirement: Composite skill structure

The skill SHALL be a single composite skill (one entry in autocomplete) covering three recipes — general web automation, Electron-app automation, and logged-in browsing via the dashboard relay — via internal reference docs.

The skill SHALL ship at `packages/extension/.pi/skills/browser/` with this layout:

- `SKILL.md` — top-level orchestrator with YAML frontmatter (`name: browser`, descriptive `description:` covering all recipes' trigger phrases, `allowed-tools: Bash(agent-browser:*), Bash(npx agent-browser:*), Bash(npx @panerelay/setup:*), Bash(curl:*)`)
- `references/web.md` — vendored adaptation of upstream `agent-browser` `core` skill
- `references/electron.md` — vendored adaptation of upstream `agent-browser` `electron` skill, including a worked example targeting the Pi Dashboard Electron app via `--debug-cdp`
- `references/dashboard-relay.md` — authored recipe for the dashboard browser relay (real Chrome profile over CDP)
- `references/own-browser.md` — authored legacy recipe (Panerelay), reached only when the relay is unavailable
- `UPSTREAM.md` — provenance record (upstream repo URL, commit SHA, CLI version, refresh date)
- `LICENSE` — attribution per upstream `agent-browser` license terms

#### Scenario: Required files present

- **WHEN** the bridge extension package is installed
- **THEN** all files above SHALL exist under `node_modules/@blackbelt-technology/pi-dashboard-extension/.pi/skills/browser/`

#### Scenario: SKILL.md frontmatter declares allowed tools

- **WHEN** the agent reads `SKILL.md`
- **THEN** the `allowed-tools:` frontmatter field SHALL include `Bash(agent-browser:*)`, `Bash(npx agent-browser:*)`, `Bash(npx @panerelay/setup:*)`, and `Bash(curl:*)`

#### Scenario: Routing prefers the relay for logged-in tasks

- **WHEN** the task intent requires the user's existing login state
- **THEN** Step 0b SHALL route to `references/dashboard-relay.md` before considering `references/own-browser.md`, and SHALL never route to `references/web.md` for that intent
