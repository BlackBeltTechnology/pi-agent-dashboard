# agent-proactive-push Specification

## Purpose
TBD - created by archiving change per-session-push-bell. Update Purpose after archive.
## Requirements
### Requirement: Extension registers push_notify_user tool keyed to bell state

At `session_start` and on every session state broadcast update from the server, the bridge extension SHALL check the session's `PushPrefs.notifyCompletion`. The extension SHALL receive `pushPrefs` via the existing session state broadcast (the server includes `pushPrefs` in subscribe replay and update broadcasts).

Based on `notifyCompletion` value:
- **Auto**: tool SHALL be registered via `pi.registerTool()` with proactive description.
- **On** or **Off**: tool SHALL NOT be registered.

On transition away from Auto (via state broadcast), any previously registered `push_notify_user` tool SHALL be unregistered.

#### Scenario: Auto mode registers proactive tool at session_start
- **WHEN** session bell is Auto at session_start
- **THEN** `pi.registerTool` SHALL be called with `push_notify_user` name and proactive description

#### Scenario: Off mode does not register tool at session_start
- **WHEN** session bell is Off at session_start
- **THEN** `pi.registerTool` SHALL NOT be called for `push_notify_user`

#### Scenario: On mode does not register tool at session_start
- **WHEN** session bell is On at session_start
- **THEN** `pi.registerTool` SHALL NOT be called for `push_notify_user`

#### Scenario: Live bell change Off → Auto registers tool
- **WHEN** session state broadcast shows `pushPrefs.notifyCompletion` changed from `"off"` to `"auto"`
- **THEN** `pi.registerTool` SHALL be called for `push_notify_user`

#### Scenario: Live bell change Auto → On unregisters tool
- **WHEN** session state broadcast shows `pushPrefs.notifyCompletion` changed from `"auto"` to `"on"`
- **THEN** any registered `push_notify_user` tool SHALL be unregistered

### Requirement: Tool description for Auto mode

The registered tool's `description` field SHALL instruct the agent to proactively decide when to push. The description SHALL include:

- When to call: completed significant work, encountered unfixable errors, need user input
- Context: user has enabled auto-push and expects to be interrupted
- How: call `POST /api/push/send` with title and body

#### Scenario: Agent sees proactive instruction in Auto mode
- **WHEN** agent inspects available tools in Auto mode
- **THEN** `push_notify_user` SHALL appear with description containing "SHOULD proactively call"

### Requirement: Tool handler sends push via dashboard API

The tool handler SHALL:
1. Read dashboard port and auth secret from `~/.pi/dashboard/config.json`
2. POST to `http://localhost:<port>/api/push/send` with `{ title, body, url }` from tool args
3. Return success/failure message to agent

The tool SHALL handle all failure modes with descriptive messages.

#### Scenario: Successful push from tool
- **WHEN** agent calls `push_notify_user({ title: "Done", body: "Refactoring complete" })`
- **THEN** tool SHALL POST to `/api/push/send` and return success message

#### Scenario: Dashboard unreachable from tool
- **WHEN** dashboard is not running
- **THEN** tool SHALL return error "Dashboard not reachable"

#### Scenario: Auth failure from tool
- **WHEN** endpoint returns 401
- **THEN** tool SHALL return error "Auth failed — check dashboard config"

#### Scenario: Push disabled from tool
- **WHEN** endpoint returns 404
- **THEN** tool SHALL return error "Push notifications not enabled on this server"

#### Scenario: Push misconfigured from tool
- **WHEN** endpoint returns 503
- **THEN** tool SHALL return error "Push misconfigured — missing contactEmail"

#### Scenario: No devices from tool
- **WHEN** endpoint returns 200 with empty results array
- **THEN** tool SHALL return "No devices registered for push notifications"

#### Scenario: Rate limited from tool
- **WHEN** endpoint returns 429
- **THEN** tool SHALL return error "Rate limited — wait before sending another push"

### Requirement: Skill removal

The `.pi/skills/push-notify-user/` directory, `packages/extension/package.json` skill reference, and `AGENTS.md` Key Files row SHALL be removed. The `push-notify-user` capability is now provided by the extension-registered tool in Auto mode.

#### Scenario: Skill directory does not exist
- **WHEN** project files are inspected
- **THEN** `.pi/skills/push-notify-user/` SHALL NOT exist

#### Scenario: Extension package.json has no skill reference
- **WHEN** extension `package.json` is inspected
- **THEN** the `skills` array SHALL NOT contain `push-notify-user`

#### Scenario: AGENTS.md has no push-notify-user row
- **WHEN** AGENTS.md is inspected
- **THEN** no row SHALL reference `push-notify-user`

