## MODIFIED Requirements

### Requirement: Dashboard-relay recipe for logged-in browsing

The skill SHALL ship `references/dashboard-relay.md` describing how to drive the user's real Chrome profile through the dashboard browser relay:
1. Probe `GET /api/browser/status`.
2. Discover profiles via `GET /api/browser/profiles`.
3. Obtain a CDP URL via `POST /api/browser/connect?profile=<profileDirectory>`. The agent keeps the returned `cdpUrl` for the task; there is no lookup endpoint.
4. Run `agent-browser connect <cdpUrl>` and proceed with the ordinary web recipe.

The recipe SHALL state:
- the deny-list behavior: denied verbs fail loud and are never retried with a different browser, while `Browser.setDownloadBehavior` is acknowledged without effect;
- the tab-group isolation model;
- that the agent calls `browser_show_in_pane` to show its tab to the user, and `browser_await_human` when a page needs the user (login, consent, challenge), continuing only when that tool returns `done`.

#### Scenario: Relay reachable and profile connected

- **WHEN** the task needs logged-in state, `GET /api/browser/status` reports `enabled: true` and `canOpenChrome: true`, and `POST /api/browser/connect?profile=<profileDirectory>` returns a `cdpUrl`
- **THEN** the skill SHALL instruct `agent-browser connect <cdpUrl>` and continue with `references/web.md` commands unchanged

#### Scenario: Login wall on the relay browser

- **WHEN** a page driven through the relay requires the user to sign in
- **THEN** the skill SHALL instruct calling `browser_await_human {instanceId, reason}` and, on `done`, re-snapshotting the same tab; on `cancelled` it SHALL stop and report

#### Scenario: Extension not installed in the chosen profile

- **WHEN** `connect` returns 409 `{reason: "not-installed"}`
- **THEN** the skill SHALL tell the user to install the Playwright Chrome Extension in that profile and halt; it SHALL NOT fall back to the bundled browser for a task that requires login state

#### Scenario: Profile busy

- **WHEN** `connect` returns 409 `{reason: "busy", instanceId}`
- **THEN** the skill SHALL report the live instance and ask the user whether to disconnect it or use another profile; it SHALL NOT tell the user to install anything

#### Scenario: Relay unavailable

- **WHEN** the dashboard is down, `GET /api/browser/status` is 404, or it reports `enabled: false` or `canOpenChrome: false`
- **THEN** the skill SHALL route to `references/own-browser.md` (legacy) only if that provider reports ready, otherwise halt with a clear message
