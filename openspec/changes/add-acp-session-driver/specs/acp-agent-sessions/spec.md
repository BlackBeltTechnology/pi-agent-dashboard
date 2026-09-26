## ADDED Requirements

### Requirement: ACP agent registry and configuration
The config loader SHALL parse `acpAgents` (`[{ id, name, command, args?, env? }]`) and `acp` (`{ protocolV2?, spawnTimeoutMs?, requestTimeoutMs?, maxLineBytes?, eventLogMaxBytes? }`) from `~/.pi/dashboard/config.json`, dropping malformed agent entries with a logged warning. When two entries share an `id`, the first SHALL win and later ones SHALL be dropped with a warning. Numeric `acp` values SHALL be clamped with a warning to `spawnTimeoutMs` 5 000–120 000, `requestTimeoutMs` 1 000–300 000, `maxLineBytes` 65 536–67 108 864, `eventLogMaxBytes` 1 048 576–1 073 741 824; non-numeric values SHALL fall back to the default with a warning. `GET /api/config` SHALL replace every `acpAgents[].env` value with `***`, and a config write carrying `***` for such a value SHALL preserve the stored value. The spawn picker SHALL receive agents only as `{ id, name }`. When `acpAgents` is absent or empty, no ACP spawn surface SHALL be exposed.

#### Scenario: No agents configured
- **WHEN** `acpAgents` is absent
- **THEN** the spawn dialog SHALL NOT show an agent picker
- **AND** a spawn request (WS `spawn_session` or `POST /api/session/spawn`) with an `agent` field SHALL fail with an error

#### Scenario: Duplicate agent id
- **WHEN** `acpAgents` contains two entries with id `qmt`
- **THEN** only the first SHALL be loaded and a warning SHALL be logged

#### Scenario: Out-of-range timeout clamped
- **WHEN** `acp.spawnTimeoutMs` is `1000`
- **THEN** the effective value SHALL be `5000` and a warning SHALL be logged

#### Scenario: Agent env redacted and preserved
- **WHEN** `config.json` contains agent `qmt` with `env: { "OPENAI_API_KEY": "sk-x" }`
- **THEN** `GET /api/config` SHALL NOT contain `sk-x`
- **AND** saving the config back unchanged SHALL leave `sk-x` stored on disk

### Requirement: ACP spawn routing
A spawn request via WS `spawn_session` or `POST /api/session/spawn` carrying a configured `agent` id SHALL spawn a headless keeper session (regardless of the configured spawn strategy) whose child is the acp-bridge adapter (`[<node binary>, <server>/bin/acp-bridge.mjs, "--agent", <id>]`), without resolving pi, without pi argv shaping, and using an ACP preflight (cwd valid, node and agent command resolvable) instead of the pi/tmux preflight. It SHALL reuse the existing spawn token, headless PID registry, register watchdog and spawn-error surfacing. Spawn requests without `agent` SHALL behave exactly as before.

#### Scenario: UI spawn with agent under tmux strategy on a machine without pi
- **WHEN** the spawn strategy is `tmux`, pi is not installed, and the user spawns agent `qmt` from the spawn dialog
- **THEN** the session SHALL be spawned via the headless keeper with the adapter as its child
- **AND** no `PI_NOT_FOUND` error SHALL occur

#### Scenario: Spawn without agent unchanged
- **WHEN** a spawn request has no `agent`
- **THEN** the spawned process, arguments, environment and preflight SHALL be identical to the pre-change behaviour

### Requirement: Adapter launches the agent safely
The adapter SHALL read the agent definition from the dashboard config by id and launch `command` with `args` (default `[]`) as an argv array, never through a shell, in the session cwd; on Windows a `.cmd` or `.bat` command SHALL be rejected with a clear error. The child environment SHALL contain only allowlisted variables from the adapter environment (`PATH`, `HOME`, `USER`, `LOGNAME`, `SHELL`, `TERM`, `LANG`, `LC_*`, `TMPDIR`, `TZ`, `SystemRoot`, `APPDATA`, `LOCALAPPDATA`, `USERPROFILE`, `ComSpec`, `PATHEXT`) plus the agent's configured `env`; no `PI_*`, `ELECTRON_*` or `NODE_OPTIONS` variable SHALL be present even if configured.

#### Scenario: Shell metacharacters are inert
- **WHEN** an agent's `args` contains `"; rm -rf ~"`
- **THEN** the child process SHALL receive that string as a single literal argv element

#### Scenario: Dashboard credentials not passed via environment
- **WHEN** the adapter's environment contains `PI_DASHBOARD_SPAWN_TOKEN`, `PI_DASHBOARD_URL` and `PI_DASHBOARD_MCP_TOKEN`, and the agent config sets `env: { "NODE_OPTIONS": "--require x", "FOO": "1" }`
- **THEN** the agent child's environment SHALL contain `FOO` and none of the other four variables

### Requirement: Registration, heartbeat and initialization
On start the adapter SHALL register with the local dashboard gateway before launching the agent, sending `session_register` with a dashboard session id it mints (UUID), `cwd`, `source: "dashboard"`, its `pid`, `hasUI: false`, `dashboardSpawned: true`, the spawn token, `registerReason: "spawn"` and `driver: "acp"`, and SHALL send `session_heartbeat` every 15 s while connected. It SHALL then send `initialize` requesting protocol version 1, or 2 when `acp.protocolV2` is `true`, declaring no file-system and no terminal client capabilities, then `session/new { cwd, mcpServers: [] }`, accepting a response version of 1 or (only when requested) 2, and then publish `models_list` and `commands_list`. The agent's ACP session id SHALL NOT be used as a dashboard id or file path. If the agent fails to start, initialization errors, requires authentication, negotiates an unsupported version, or does not complete within `acp.spawnTimeoutMs` (default 30 000 ms), the adapter SHALL show the cause in the session as an error, log it to `server.log`, terminate the agent and exit non-zero.

#### Scenario: Successful spawn
- **WHEN** a user spawns agent `qmt` in `/work/repo`
- **THEN** a visible session card with `driver: "acp"` SHALL appear
- **AND** the agent SHALL receive `initialize` then `session/new` with `cwd: "/work/repo"`
- **AND** `server.log` SHALL record the agent id and negotiated protocol version

#### Scenario: Session stays alive while idle
- **WHEN** an ACP session is idle for 10 minutes
- **THEN** the session SHALL remain registered

#### Scenario: Unsupported protocol version
- **WHEN** the agent answers `initialize` with version 2 although 1 was requested
- **THEN** the session SHALL show an "unsupported ACP protocol version" error
- **AND** the agent and adapter processes SHALL exit

#### Scenario: Agent never answers
- **WHEN** the agent does not answer `initialize` within `acp.spawnTimeoutMs`
- **THEN** the session SHALL show a timeout error and the processes SHALL exit

### Requirement: Prompt, acknowledgement, queue and cancel
A `send_prompt` to an idle ACP session SHALL produce the user-turn events for the prompt, send `session/prompt` with text and image blocks, and emit `prompt_received { promptId, fresh: true }` on acceptance (v2 response) or on write (v1). A `send_prompt` while not idle (including `delivery: "steer"`) SHALL be queued by the adapter with `prompt_received { fresh: false }` and a `queue_update`; follow-up edit, remove, promote and clear SHALL act on that queue; queued prompts SHALL be sent in order after each idle transition. The agent's echo of a dashboard-originated user message SHALL NOT produce an additional user message, whether it arrives before or after the `session/prompt` response. A rejected `session/prompt` SHALL end the turn with an error. `abort` SHALL send `session/cancel` and answer pending permission requests `cancelled`.

#### Scenario: Prompt while idle
- **WHEN** the user sends "hello" to an idle ACP session
- **THEN** the agent SHALL receive `session/prompt` with a text block "hello"
- **AND** browsers SHALL receive `prompt_received` with the prompt's `promptId` and `fresh: true`
- **AND** the chat SHALL show exactly one user message "hello"

#### Scenario: Echo arrives before acceptance
- **WHEN** a v2 agent sends `user_message { messageId: "u1" }` for the prompt before responding to `session/prompt` with `{ messageId: "u1" }`
- **THEN** the chat SHALL show exactly one user message for that prompt

#### Scenario: Prompt while running is queued
- **WHEN** the user sends a prompt while a turn is running
- **THEN** browsers SHALL receive `prompt_received` with `fresh: false` and a `queue_update` listing it
- **AND** no `session/prompt` SHALL be sent until the session is idle
- **AND** it SHALL then be sent exactly once

#### Scenario: Prompt rejected by agent
- **WHEN** the agent answers `session/prompt` with a JSON-RPC error
- **THEN** the turn SHALL end with an error shown in the chat and the session SHALL become idle

#### Scenario: Abort
- **WHEN** the user aborts a running ACP turn with a permission request pending
- **THEN** the agent SHALL receive `session/cancel`
- **AND** the pending permission request SHALL be answered with outcome `cancelled`

### Requirement: Agent exit handling
When the agent process exits or crashes while the adapter is running, the adapter SHALL show the exit code or signal as an error in the session, answer pending permission requests `cancelled`, clear its prompt queue, unregister from the gateway and exit, ending the session.

#### Scenario: Agent crashes mid-turn
- **WHEN** the agent process is killed with SIGKILL during a streaming turn
- **THEN** the chat SHALL show an error naming the signal
- **AND** the session SHALL transition to ended and the adapter process SHALL exit

### Requirement: Permission request bridging
An agent `session/request_permission` SHALL be shown as a single-choice interactive prompt using the same `prompt_request` shape the extension's prompt bus produces for a `select` prompt, with the request `title` (v2) or tool-call title (v1) as question and `options[].name` as choices. The chosen option SHALL be returned as `{ outcome: { outcome: "selected", optionId } }`; dismissal, abort or session close SHALL return `{ outcome: { outcome: "cancelled" } }`.

#### Scenario: User allows once
- **WHEN** the agent requests permission with options `allow` ("Allow once") and `deny` ("Deny") and the user picks "Allow once"
- **THEN** the agent SHALL receive `optionId: "allow"` with outcome `selected`

### Requirement: Config options and commands bridging
When the agent advertises config options with category `model` or `thought_level`, the adapter SHALL publish them through `models_list` and the session's model / thinking-level state, and SHALL apply `set_model` / `set_thinking_level` via `session/set_config_option`. Advertised commands SHALL be published via `commands_list`. Outbound requests other than `session/prompt` SHALL time out after `acp.requestTimeoutMs` (default 30 000 ms) with a user-visible error.

#### Scenario: Model switch
- **WHEN** the agent advertises a `model` option and the user selects a different model in the session
- **THEN** the agent SHALL receive `session/set_config_option` with that option id and value
- **AND** the session's model SHALL reflect the agent's subsequent `config_option_update`

#### Scenario: Config request times out
- **WHEN** the agent does not answer `session/set_config_option` within `acp.requestTimeoutMs`
- **THEN** the user SHALL see an error notification and the session SHALL remain usable

### Requirement: Server-to-bridge message coverage
The adapter SHALL handle every server→bridge message type: supported ones act; ones expecting a reply SHALL receive a deterministic empty or refused reply (including `transcript_request` → refused `transcript_chunk`, `list_files` → empty `files_list`); the rest SHALL be ignored. The handler SHALL be exhaustive at compile time over the protocol union.

#### Scenario: File listing on an ACP session
- **WHEN** the server sends `list_files` to an ACP session's adapter
- **THEN** the adapter SHALL reply with an empty `files_list`

### Requirement: Unsupported client methods refused
The adapter SHALL answer agent-initiated `fs/*`, `terminal/*` and unknown `_`-prefixed requests with JSON-RPC error `-32601`, SHALL NOT answer notifications, and SHALL NOT read or write files or run commands on the agent's behalf.

#### Scenario: Agent asks to read a file
- **WHEN** an ACP v1 agent sends request `fs/read_text_file`
- **THEN** it SHALL receive JSON-RPC error `-32601`

### Requirement: Untrusted agent output handling
The adapter SHALL split agent stdout into lines with a per-line cap of `acp.maxLineBytes` (default 4 MiB), discarding an over-long line through its terminating newline while keeping memory bounded; SHALL skip non-JSON lines; SHALL never evaluate payload content; and SHALL report skipped / discarded / dropped-update counts to `server.log` at most once per minute per session.

#### Scenario: Agent writes a log line to stdout
- **WHEN** the agent emits `starting up...` on stdout
- **THEN** the line SHALL be skipped and later JSON-RPC lines SHALL be processed

#### Scenario: Over-long line
- **WHEN** the agent emits a single line larger than `acp.maxLineBytes`
- **THEN** that line SHALL be discarded and the following line SHALL be processed normally

### Requirement: Reattach after dashboard restart
The adapter SHALL append every forwarded event to `~/.pi/dashboard/acp/<dashboardSessionId>.events.jsonl`, capped at `acp.eventLogMaxBytes`; on reaching the cap the adapter SHALL drop the oldest whole turns until the log is at most 50 % of the cap and record one notice event. When its gateway connection is re-established it SHALL register with `registerReason: "reattach"`, `driver: "acp"` and no `eventCount`, re-publish `models_list`, `commands_list` and the current model state, replay the event log as `event_forward` messages, send `replay_complete`, and re-send any pending permission request as a fresh interactive prompt. The agent process and its ACP session SHALL be unaffected by the dashboard restart.

#### Scenario: Dashboard restarts mid-session
- **WHEN** the dashboard server restarts while an ACP session is idle after two turns
- **THEN** after restart the session SHALL reappear with both turns rendered and its model selector populated
- **AND** a new prompt SHALL be delivered to the same ACP session

#### Scenario: Event log reaches its cap
- **WHEN** appending an event would exceed `acp.eventLogMaxBytes`
- **THEN** the log SHALL shrink to at most 50 % of the cap by removing whole oldest turns
- **AND** a replay SHALL begin with a truncation notice followed by complete turns only

#### Scenario: Dashboard restarts mid-turn
- **WHEN** the dashboard restarts while the agent is streaming a reply
- **THEN** after reattach the chat SHALL show the reply as one assistant message containing the text streamed before and after the restart

### Requirement: Driver persistence and degraded-feature contract
`driver` from `session_register` SHALL be stored on the session, persisted in session metadata, and included in session payloads, surviving server restarts and session end. The server SHALL reject pi-only browser operations (flow control and management, extension command dispatch, fork/tree navigation, reload/retry, role pushes, stop-after-turn, terminal commands, file listing) for `driver: "acp"` sessions with a typed "unsupported for ACP sessions" error without forwarding them, and the client SHALL hide the corresponding controls.

#### Scenario: Flow start on ACP session
- **WHEN** a flow start is requested for an ACP session
- **THEN** the server SHALL return an "unsupported for ACP sessions" error
- **AND** nothing SHALL be forwarded to the adapter

#### Scenario: Ended ACP session keeps its driver after restart
- **WHEN** an ACP session has ended and the server restarts
- **THEN** the restored session SHALL still report `driver: "acp"` and pi-only controls SHALL stay hidden
