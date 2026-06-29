## MODIFIED Requirements

### Requirement: Visible sessions persist across restarts
The system SHALL persist session metadata in per-session `.meta.json` sidecar files next to each session's `.jsonl` file. On startup, the system SHALL discover sessions by scanning the **resolved pi sessions directory** (`resolvePiSessionsDir()`) for `*/` session folders and restoring from `.meta.json` cached data. The resolved directory SHALL follow this precedence (high → low): (1) dashboard `config.json#piSessionsDir`; (2) `PI_CODING_AGENT_SESSION_DIR` environment variable inherited by the dashboard process; (3) the `PI_CODING_AGENT_DIR` environment variable's `sessions` subdirectory (mirroring pi-core's agent-dir resolution). When none are set, the resolved directory SHALL be `~/.pi/agent/sessions`, preserving existing behaviour.

#### Scenario: Server restarts with ended sessions
- **WHEN** the server has ended sessions with `.meta.json` files and the server restarts
- **THEN** those sessions SHALL be discovered by scanning the resolved pi sessions directory and appear in the session list with `dataUnavailable: true`

#### Scenario: Server restarts with no session files
- **WHEN** the server starts and no `.meta.json` files exist under the resolved pi sessions directory
- **THEN** the server SHALL start with an empty session list (no errors)

#### Scenario: Active session bridge reconnects after restart
- **WHEN** a session is restored from `.meta.json` on startup and the bridge later reconnects with the same session ID
- **THEN** the bridge registration SHALL overwrite the stale cached entry with live data and clear `dataUnavailable`

#### Scenario: Default resolution unchanged
- **WHEN** neither `config.json#piSessionsDir` nor `PI_CODING_AGENT_SESSION_DIR` nor `PI_CODING_AGENT_DIR` is set
- **THEN** the resolved pi sessions directory SHALL be `~/.pi/agent/sessions`

#### Scenario: Dashboard config override wins
- **WHEN** `config.json#piSessionsDir` is set to a non-blank absolute path
- **THEN** the server SHALL scan that path for sessions, ignoring `PI_CODING_AGENT_SESSION_DIR` and the `PI_CODING_AGENT_DIR` default

#### Scenario: pi agent dir relocation is followed
- **WHEN** `config.json#piSessionsDir` is unset, `PI_CODING_AGENT_SESSION_DIR` is unset, and `PI_CODING_AGENT_DIR=/custom/agent` is set in the dashboard's environment
- **THEN** the server SHALL scan `/custom/agent/sessions` (`PI_CODING_AGENT_DIR` + `/sessions`)

## ADDED Requirements

### Requirement: Single resolver for the pi sessions directory
The system SHALL resolve the pi sessions directory through exactly one helper, `resolvePiSessionsDir()`, in `packages/shared/src/dashboard-paths.ts`. Session scanning, per-cwd session discovery, and persistence migration SHALL all derive their root from this helper; no module SHALL hardcode `~/.pi/agent/sessions` independently. Each precedence layer SHALL trim its input and SHALL treat a whitespace-only value as unset (falling through to the next layer). A leading `~/` SHALL be expanded against the home directory; absolute paths SHALL pass through unchanged.

#### Scenario: Blank config value falls through
- **WHEN** `config.json#piSessionsDir` is a whitespace-only string and `PI_CODING_AGENT_SESSION_DIR` is `/env/sessions`
- **THEN** the resolver SHALL return `/env/sessions`

#### Scenario: Tilde expansion
- **WHEN** `config.json#piSessionsDir` is `~/my-sessions`
- **THEN** the resolver SHALL return `<homedir>/my-sessions`

#### Scenario: Discovery and migration share the resolved root
- **WHEN** a non-default `piSessionsDir` is configured
- **THEN** startup scan, per-cwd session discovery, and persistence migration SHALL all read from that same resolved directory
