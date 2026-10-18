## MODIFIED Requirements

### Requirement: Dashboard-relay recipe for logged-in browsing

The skill SHALL ship `references/dashboard-relay.md` describing how to obtain a logged-in browser through the dashboard. The login-state override in `SKILL.md` SHALL route to it first when the session runs on the dashboard host.

Primary recipe:
1. Call `browser_connect {}` (or with a `target` when the user names a browser).
2. When the result names `browser: "dedicated"` or `"profile"`, run `agent-browser connect <cdpUrl>` and proceed with the ordinary web recipe; when `liveView` is true, do not call `browser_show_in_pane` for the first tab. When it names `browser: "headless"` and the task needs login state, stop and tell the user that no logged-in browser is available; otherwise use the bundled agent-browser.
3. When the result is `unavailable` with `options`, ask the user with `ask_user` which option to use and call `browser_connect` again with that `target`; when it carries `stopped: true`, stop and report the reason.

Fallback recipe, for sessions without the `browser_connect` tool:
1. Probe `GET /api/browser/status`.
2. When `enabled` and `dedicated.available` are true, obtain a CDP URL via `POST /api/browser/dedicated/connect`; otherwise discover profiles via `GET /api/browser/profiles` and use `POST /api/browser/connect` with body `{profileDirectory}`. The agent keeps the returned `cdpUrl` for the task; there is no lookup endpoint.
3. Run `agent-browser connect <cdpUrl>`.

The recipe SHALL state:
- that every result names the browser used and the agent reports it to the user;
- the deny-list behavior: denied verbs fail loud and are never retried with a different browser, while `Browser.setDownloadBehavior` is acknowledged without effect;
- the isolation model: tab groups for Chrome profiles; one session at a time for the dedicated profile;
- that a Chrome profile running a password manager disconnects the agent on pages with a password field, so sign-ins belong in the dedicated profile;
- that the user signs in to the dedicated profile in a hidden sign-in tab ("Open to sign in" in Settings, or `POST /api/browser/dedicated/open {url}` from the agent), never in the agent's tab and never by giving the agent a password;
- that the dedicated profile is not protected from programs running as the same OS user, and that the agent SHALL NOT read, copy or launch a browser on the dedicated profile directory, nor read the dedicated downloads directory unless its task names a file there;
- that `browser_connect` never uses Panerelay; `references/own-browser.md` applies only when the dashboard browser is unavailable;
- that the agent calls `browser_show_in_pane` to show its tab to the user; in a Chrome profile it calls `browser_await_human` when a page needs the user (login, consent, challenge), continuing only when that tool returns `done`; in the dedicated profile a sign-in goes through `dedicated/open` and `ask_user` instead, while other human steps (consent, challenge) use `browser_await_human`.

#### Scenario: Dedicated profile connected

- **WHEN** the task needs logged-in state and `browser_connect {}` returns `{browser: "dedicated", cdpUrl}`
- **THEN** the skill SHALL instruct `agent-browser connect <cdpUrl>` and continue with `references/web.md` commands unchanged

#### Scenario: Relay reachable and profile connected

- **WHEN** the task needs logged-in state and `browser_connect {target: <profileDirectory>}` (or the REST fallback `POST /api/browser/connect {profileDirectory}`) returns a `cdpUrl`
- **THEN** the skill SHALL instruct `agent-browser connect <cdpUrl>` and continue with `references/web.md` commands unchanged

#### Scenario: Login wall on the relay browser

- **WHEN** a page driven through a Chrome profile requires the user to sign in
- **THEN** the skill SHALL instruct calling `browser_await_human {instanceId, reason}` and, on `done`, re-snapshotting the same tab; on `cancelled` it SHALL stop and report

#### Scenario: Login wall in the dedicated profile

- **WHEN** a page driven through the dedicated profile requires the user to sign in
- **THEN** the skill SHALL instruct opening the sign-in URL with `POST /api/browser/dedicated/open {url}`, asking the user with `ask_user` to sign in there, and reloading the agent's tab after the answer; it SHALL NOT ask the user to type credentials in the agent's tab

#### Scenario: Headless result for a login task

- **WHEN** the task needs login state and `browser_connect` returns `{browser: "headless"}`
- **THEN** the skill SHALL stop and report that no logged-in browser is available

#### Scenario: Unavailable with ask

- **WHEN** `browser_connect` returns `{unavailable, options}`
- **THEN** the skill SHALL ask the user to choose among `options` and SHALL NOT connect any browser before the answer

#### Scenario: Extension not installed in the chosen profile

- **WHEN** a Chrome-profile connect returns 409 `{reason: "not-installed"}`
- **THEN** the skill SHALL tell the user to install the Playwright Chrome Extension in that profile and halt; it SHALL NOT fall back to the bundled browser for a task that requires login state

#### Scenario: Profile busy

- **WHEN** a connect returns 409 `{reason: "busy", instanceId}`
- **THEN** the skill SHALL report the live instance and ask the user whether to disconnect it or use another browser; it SHALL NOT tell the user to install anything

#### Scenario: Password-manager detach

- **WHEN** the CDP connection to a Chrome-profile instance closes after loading a page with a password field and `GET /api/browser/audit` shows a `detach` entry with detail `closed:` or `extension:` for that instance
- **THEN** the skill SHALL explain the password-manager limit and suggest the dedicated profile; it SHALL NOT retry the same page in that profile

#### Scenario: Relay unavailable

- **WHEN** the dashboard is down, `GET /api/browser/status` is 404, or it reports `enabled: false`, or neither the dedicated profile nor `canOpenChrome` is available
- **THEN** the skill SHALL route to `references/own-browser.md` (legacy) only if that provider reports ready, otherwise halt with a clear message

#### Scenario: User asks for their own computer's browser

- **WHEN** the user asks to use the browser on their own computer, `GET /api/browser/status` reports `operatorHosts: true`, and `GET /api/browser/profiles` lists exactly one online operator host with an installed profile
- **THEN** the skill SHALL call `connect` with that `host` and profile, and continue as for the dashboard host

#### Scenario: Older server

- **WHEN** `GET /api/browser/status` lacks `operatorHosts: true`
- **THEN** the skill SHALL NOT pass `host`, and SHALL tell the user that this dashboard cannot drive the browser on their computer

#### Scenario: Operator denies the connect

- **WHEN** `connect` returns 403 `{reason: "operator-denied"}`
- **THEN** the skill SHALL report that the user declined on their computer and halt; it SHALL NOT retry or fall back to the dashboard host's Chrome
