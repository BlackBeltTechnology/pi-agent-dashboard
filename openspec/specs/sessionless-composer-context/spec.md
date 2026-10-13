# sessionless-composer-context Specification

## Purpose
Supply a composer that has no live pi session behind it — the folder home and ended sessions — with the folder's slash commands/skills and the model catalogue, and carry spawn- and resume-time model and thinking choices to pi.

## Requirements

### Requirement: Folder command list without a live session

The server SHALL answer `GET /api/pi-resources/commands?cwd=<absolute path>` without requiring a live session in that cwd. A missing or relative `cwd` SHALL be rejected with status 400. When at least one session whose pi bridge is currently connected, and whose cwd equals the requested cwd, has reported a non-empty command list, the answer SHALL be the most recently accepted such list with origin `live`. Otherwise the answer SHALL be derived from the folder's enabled skills and prompt templates as resolved for that cwd, with origin `scan`, or an empty list with origin `none` when there are none. Cwd equality SHALL compare absolute paths after removing trailing separators and resolving symlinks (using the path as given when it does not exist); a session in a subdirectory or worktree of the folder SHALL NOT count. A scan-derived skill SHALL appear as `skill:<name>` and a prompt template as `<name>`, each with its description and source path when known. Every returned command SHALL carry a scope: `folder` when it comes from the folder's own resources (including folder-scope packages), otherwise `global`; a command with no known source path SHALL be `global`. The route SHALL be governed by the same access road and the same access tier as `/api/pi-resources`.

#### Scenario: Live session supplies the list

- **GIVEN** a live session in `/p` has reported 173 commands
- **WHEN** the browser requests the command list for `/p`
- **THEN** the response SHALL contain those 173 commands with origin `live`

#### Scenario: Most recent live list wins

- **GIVEN** two live sessions in `/p`, where session B reported its list after session A
- **WHEN** the browser requests the command list for `/p`
- **THEN** the response SHALL contain session B's list

#### Scenario: No live session falls back to the scan

- **GIVEN** no live session exists in `/p` and `/p` resolves skills `doc-summarizer` and `xlsx` and prompt `weekly-review`
- **WHEN** the browser requests the command list for `/p`
- **THEN** the response SHALL contain `skill:doc-summarizer`, `skill:xlsx`, and `weekly-review` with origin `scan`

#### Scenario: Empty live list falls back to the scan

- **GIVEN** the only live session in `/p` reported an empty command list and `/p` resolves skill `xlsx`
- **WHEN** the browser requests the command list for `/p`
- **THEN** the response SHALL contain `skill:xlsx` with origin `scan`

#### Scenario: Crashed session does not count as live

- **GIVEN** a session in `/p` reported commands and its pi process died without unregistering
- **WHEN** the browser requests the command list for `/p`
- **THEN** the response origin SHALL NOT be `live`

#### Scenario: Ended sessions do not count as live

- **GIVEN** the only session in `/p` is ended and had reported a command list
- **WHEN** the browser requests the command list for `/p`
- **THEN** the response origin SHALL be `scan` or `none`

#### Scenario: Disabled skills are excluded from the scan

- **GIVEN** no live session in `/p` and skill `xlsx` is turned off for `/p`
- **WHEN** the browser requests the command list for `/p`
- **THEN** `skill:xlsx` SHALL NOT be in the response

#### Scenario: Live session in a subdirectory does not count

- **GIVEN** the only live session runs in `/p/sub`
- **WHEN** the browser requests the command list for `/p`
- **THEN** the response origin SHALL NOT be `live`

#### Scenario: Trailing separator is ignored

- **GIVEN** a live session in `/p` has reported its commands
- **WHEN** the browser requests the command list for `/p/`
- **THEN** the response origin SHALL be `live`

#### Scenario: Symlinked path matches its target

- **GIVEN** `/link` is a symlink to `/p` and a live session in `/p` has reported its commands
- **WHEN** the browser requests the command list for `/link`
- **THEN** the response origin SHALL be `live`

#### Scenario: Missing cwd is rejected

- **WHEN** the browser requests the command list without a `cwd`
- **THEN** the server SHALL respond with status 400

#### Scenario: Relative cwd is rejected

- **WHEN** the browser requests the command list for `cwd=p`
- **THEN** the server SHALL respond with status 400

#### Scenario: Commands carry their scope

- **GIVEN** no live session in `/p`, folder skill `/p/.pi/skills/document-organizer` and global skill `xlsx`
- **WHEN** the browser requests the command list for `/p`
- **THEN** `skill:document-organizer` SHALL carry scope `folder`
- **AND** `skill:xlsx` SHALL carry scope `global`

#### Scenario: Observer may read the folder command list

- **GIVEN** a principal permitted to read `/api/pi-resources`
- **WHEN** it requests the command list for `/p`
- **THEN** the request SHALL be permitted

#### Scenario: Unsupported server leaves the list empty

- **GIVEN** a server that does not provide the commands route
- **WHEN** a sessionless composer loads
- **THEN** the composer SHALL offer an empty folder command list without error

### Requirement: Sessionless list marks its origin

A composer using a folder command list with origin `scan` SHALL indicate in its `/` popover that the list comes from disk.

#### Scenario: Scan origin is labelled

- **GIVEN** the folder command list has origin `scan`
- **WHEN** the user types `/`
- **THEN** the popover SHALL show a "from disk" indication

### Requirement: Ended session composer has commands and models

When the selected session is ended, its composer SHALL offer the folder command list for the session's cwd and the global model catalogue. The model chip SHALL show the user's pending pick when one exists, otherwise the session's last known model (or `pi default` when unknown); the thinking chip likewise shows the pending pick or the last known thinking level. When the session becomes live again, the composer SHALL switch to that session's own command list once it arrives and SHALL NOT show an empty list in between.

#### Scenario: Slash lists skills on an ended session

- **GIVEN** an ended session in `/p` and `/p` resolves skill `doc-summarizer`
- **WHEN** the user types `/` in that session's composer
- **THEN** the popover SHALL list `skill:doc-summarizer`

#### Scenario: Model chip renders on an ended session

- **GIVEN** an ended session whose last model was `anthropic/claude-opus-5-5`
- **WHEN** the session view renders
- **THEN** the composer SHALL show a model chip reading `anthropic/claude-opus-5-5`

#### Scenario: No empty flash on resume

- **GIVEN** an ended session whose composer shows the folder command list
- **WHEN** the session resumes and its own command list has not yet arrived
- **THEN** the composer SHALL keep offering the folder command list

### Requirement: Resume applies a picked model and thinking level

A model or thinking level picked in an ended session's composer SHALL be applied to the pi process that resumes the session, whether resumed by sending a prompt or by the resume action in continue mode. Each field SHALL be independent: an unpicked field SHALL keep the session's existing value. Pick fields arriving on a fork-mode resume SHALL be ignored. The values SHALL be validated as for spawn-time choices. The pick SHALL be ignored for a live session and for a fork, and SHALL be cleared once the session is live again or when the model or thinking level is changed on the live session. Concurrent resumes of different sessions in the same folder SHALL NOT receive each other's picks.

#### Scenario: Picked model applies on prompt-triggered resume

- **GIVEN** an ended session and the user picked model `deepseek/deepseek-flash` in its composer
- **WHEN** the user sends a prompt that auto-resumes the session
- **THEN** the resumed pi process SHALL start with that model

#### Scenario: Picked thinking level applies on resume action

- **GIVEN** an ended session and the user picked thinking level `low`
- **WHEN** the user activates Resume (continue)
- **THEN** the resumed pi process SHALL start with thinking level `low`

#### Scenario: No pick keeps the session model on resume

- **GIVEN** an ended session and the user did not pick a model
- **WHEN** the user sends a prompt that auto-resumes the session
- **THEN** the resumed pi process SHALL keep the session's existing model

#### Scenario: Model-only pick keeps the session thinking level

- **GIVEN** an ended session with thinking level `high` and the user picked only model `deepseek/deepseek-flash`
- **WHEN** the session resumes
- **THEN** the resumed pi process SHALL run `deepseek/deepseek-flash` with thinking level `high`

#### Scenario: Invalid resume pick is ignored

- **WHEN** the server receives `send_prompt` for an ended session carrying `model: "--help/x"`
- **THEN** the session SHALL resume without a model argument

#### Scenario: Fork ignores pick fields

- **WHEN** the server receives `resume_session { mode: "fork", model: "deepseek/deepseek-flash" }`
- **THEN** the forked pi process SHALL be started without that model argument

#### Scenario: Pick cleared after resume

- **GIVEN** an ended session resumed with a picked model
- **WHEN** the session is live and later ends and resumes again without a new pick
- **THEN** the second resume SHALL NOT carry the earlier pick

#### Scenario: Picks do not cross sessions in one folder

- **GIVEN** ended sessions A and B in `/p`, A with pick `deepseek/deepseek-flash` and B with no pick
- **WHEN** both resume concurrently
- **THEN** A SHALL resume with `deepseek/deepseek-flash`
- **AND** B SHALL keep its existing model

### Requirement: Model catalogue without a session

A sessionless composer SHALL list models from the global model catalogue, with favorites, independent of any session's model list. When the catalogue is unavailable and no default model is configured, the folder-home model chip SHALL read `pi default` and the spawn SHALL carry no model.

#### Scenario: Catalogue unavailable degrades

- **GIVEN** the model catalogue request fails and Settings has no default model
- **WHEN** the user sends from the folder home
- **THEN** the session SHALL spawn
- **AND** the `spawn_session` message SHALL NOT carry `model`

### Requirement: Spawn-time model and thinking reach pi

A `spawn_session` carrying `model` and/or `thinkingLevel` SHALL start pi with that model and thinking level, and the dashboard's configured default model and default thinking level SHALL NOT override either value; when only `thinkingLevel` is carried and a default model is configured, the session SHALL run that default model with the carried thinking level. When no `thinkingLevel` field is carried, a `model` ending in `:<level>` for a valid thinking level SHALL be treated as that model plus that thinking level; when a `thinkingLevel` field is carried, the model SHALL be used as given. The server SHALL accept `model` only as a `provider/id` string of at most 200 characters from a restricted character set (letters, digits, `.`, `_`, `-`, and in the id also `:`, `@`, `/`, `+`), with a non-empty provider and id and no `/`-separated segment empty or starting with `-`, and `thinkingLevel` only from `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. An invalid value SHALL be ignored and the spawn SHALL proceed without it. Values SHALL never be interpreted by a shell: they SHALL be passed as discrete arguments or, where a launch path builds a command string, escaped per argument.

#### Scenario: Valid choices start pi with them

- **WHEN** the server receives `spawn_session { cwd: "/p", model: "anthropic/claude-sonnet-5", thinkingLevel: "high" }`
- **THEN** pi SHALL be started in `/p` with model `anthropic/claude-sonnet-5` and thinking level `high`

#### Scenario: Multi-segment model id is accepted

- **WHEN** the server receives `spawn_session { cwd: "/p", model: "openrouter/meta-llama/llama-4" }`
- **THEN** pi SHALL be started with model `openrouter/meta-llama/llama-4`

#### Scenario: Shell-shaped model is ignored

- **WHEN** the server receives `spawn_session { cwd: "/p", model: "x; rm -rf /" }`
- **THEN** pi SHALL be started in `/p` without a model argument

#### Scenario: Flag-shaped model is ignored

- **WHEN** the server receives `spawn_session { cwd: "/p", model: "--help/x" }`
- **THEN** pi SHALL be started in `/p` without a model argument

#### Scenario: Unknown thinking level is ignored

- **WHEN** the server receives `spawn_session { cwd: "/p", thinkingLevel: "turbo" }`
- **THEN** pi SHALL be started in `/p` without a thinking argument

#### Scenario: Thinking suffix on the model is split

- **WHEN** the server receives `spawn_session { cwd: "/p", model: "anthropic/claude-sonnet-5:high" }`
- **THEN** pi SHALL be started with model `anthropic/claude-sonnet-5` and thinking level `high`

#### Scenario: Explicit thinking level field disables suffix splitting

- **WHEN** the server receives `spawn_session { cwd: "/p", model: "anthropic/claude-sonnet-5:high", thinkingLevel: "low" }`
- **THEN** pi SHALL be started with model `anthropic/claude-sonnet-5:high` and thinking level `low`

#### Scenario: Slash-less model is ignored

- **WHEN** the server receives `spawn_session { cwd: "/p", model: "sonnet" }`
- **THEN** pi SHALL be started in `/p` without a model argument

#### Scenario: Dash-led id segment is ignored

- **WHEN** the server receives `spawn_session { cwd: "/p", model: "a/b/--x" }`
- **THEN** pi SHALL be started in `/p` without a model argument

#### Scenario: Model value is not shell-interpreted on tmux

- **GIVEN** the tmux spawn strategy
- **WHEN** a `spawn_session` carries a valid model containing shell-significant characters such as `@` or `+`
- **THEN** the pane command SHALL pass the model as one escaped argument

#### Scenario: Thinking without a model is not overridden by the default

- **GIVEN** the dashboard default model is `anthropic/claude-opus-5-5` with default thinking level `medium`
- **WHEN** the server receives `spawn_session { cwd: "/p", thinkingLevel: "high" }`
- **THEN** the started session SHALL run `anthropic/claude-opus-5-5` with thinking level `high`

#### Scenario: Explicit thinking beats the configured default

- **GIVEN** the dashboard default thinking level is `medium`
- **WHEN** the server receives `spawn_session { cwd: "/p", model: "anthropic/claude-sonnet-5", thinkingLevel: "high" }`
- **THEN** the started session SHALL run with thinking level `high`
