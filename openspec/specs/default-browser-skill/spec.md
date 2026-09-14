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

### Requirement: Interactive challenge pauses the task and preserves the session

The skill SHALL ship `references/challenge.md`, an authored (not vendored) reference that instructs the agent what to do when a page presents an interactive anti-bot challenge (Cloudflare Turnstile, hCaptcha, reCAPTCHA, browser-check interstitials, or equivalent) that withholds the requested content. `SKILL.md` SHALL reference it from the execute step, and `UPSTREAM.md` SHALL list it among the files an upstream refresh must not overwrite.

On a challenge, the agent SHALL stop driving the page, SHALL surface the URL and the blocking condition to the user, SHALL hand completion to the user on the browser the task is already using, and SHALL resume that same browser session (same `--session` name, same `--profile`, or same connected CDP target) after the user reports completion. The agent SHALL NOT switch to a different session name, profile, or browser provider mid-task, SHALL NOT run `close --all` or close sessions other than the task's own, and SHALL NOT re-navigate to the challenged URL hoping it passes. A session-scoped `close` and a re-`open` of the challenged URL are permitted only as the headed relaunch described below. On a challenge, `references/challenge.md` takes precedence over any recipe's troubleshooting advice (e.g. own-browser's "re-run under a fresh `--session`", which addresses provider resolution, not challenges).

The reference SHALL NOT describe or link to CAPTCHA-solving services, challenge-token or clearance-cookie injection, copying cookies between browser identities, proxy rotation, user-agent / header / device-emulation changes made in response to a challenge, launch flags whose purpose is to hide automation (e.g. `--disable-blink-features=AutomationControlled`), or JavaScript whose purpose is to falsify automation signals.

#### Scenario: Challenge detected mid-task

- **WHEN** the page withholds the requested content and `read`, a snapshot, `get url`, `get title`, or a Bash `agent-browser eval` of iframe `src` attributes matches a challenge signature listed in `references/challenge.md` (the list is marked non-exhaustive; e.g. an iframe from `challenges.cloudflare.com`, `hcaptcha.com`, or `google.com/recaptcha`, or text such as "Verify you are human" / "Checking your browser")
- **THEN** the agent SHALL halt interaction with that page, report the URL, challenge kind, and — for bundled-browser tasks — the session name it has been driving (the `--session` value or `AGENT_BROWSER_SESSION` it used; `default` if neither) to the user, and SHALL NOT issue `close --all`, a different `--session`, a different `--profile`, or a different provider for that task

#### Scenario: Signature text on an ordinary page

- **WHEN** challenge-signature text appears on a page that is still serving the requested content (documentation, forum post, search result)
- **THEN** the agent SHALL NOT treat it as a challenge and SHALL continue the task

#### Scenario: User completes the challenge where they can see the browser

- **WHEN** the task runs through the dashboard relay, the own-browser recipe, or an Electron/CDP-connected window (the user already sees the browser window)
- **THEN** the agent SHALL ask the user to complete the challenge in that window and, on confirmation, re-snapshot the same page and continue the task in the same session

#### Scenario: Challenge in a headless bundled-browser session

- **WHEN** the task runs in the bundled headless browser and the user confirms they are at the machine running the browser (the agent SHALL ask rather than infer from `$DISPLAY`, which is empty on macOS)
- **THEN** the agent SHALL itself, from Bash (the MCP `browser` tool shares the same daemon and session), run a session-scoped `close` with the same session/namespace flags it launched with (a failed `close` because the daemon already exited is tolerated), then re-run its original launch flags verbatim plus `--headed` with `open <challenged URL as reported at pause time>`; SHALL ask the user to complete the challenge in the visible window and confirm; and SHALL then continue driving that same session — now headed — for the remainder of the task, SHALL NOT close it again, and SHALL NOT start a different session name. The reference SHALL state that a session launched without `--restore`/`--profile`/`--state` starts the headed relaunch with empty cookies

#### Scenario: Headless session on a host without a display

- **WHEN** the task runs in the bundled headless browser and the user says they are not at that machine (Docker harness, SSH, service context)
- **THEN** the agent SHALL stop, report that the site requires a human on a host with a visible browser, and offer the relay / own-browser route or running the task from a desktop host; it SHALL NOT attempt `--headed`, a virtual display, or any bypass

#### Scenario: Daemon exited during the pause

- **WHEN** the user's completion takes longer than the daemon idle timeout and the session is gone on resume
- **THEN** the agent SHALL relaunch the same session headed as above (original flags + `--headed`) and SHALL NOT switch names or providers

#### Scenario: Challenge reappears after resume

- **WHEN** the same challenge is presented again immediately after resuming
- **THEN** the agent SHALL stop and report to the user that the site is not accepting the session, and SHALL NOT loop on retries or switch identity

#### Scenario: Challenge reference files present

- **WHEN** the bridge extension package is installed
- **THEN** `references/challenge.md` SHALL exist and be non-empty under the skill directory, `SKILL.md` SHALL contain the string `references/challenge.md`, and `UPSTREAM.md` SHALL name `challenge.md` as not vendored
