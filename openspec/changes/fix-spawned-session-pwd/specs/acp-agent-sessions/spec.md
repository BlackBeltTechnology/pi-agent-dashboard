## MODIFIED Requirements

### Requirement: ACP spawn routing
A spawn request via WS `spawn_session` or `POST /api/session/spawn` carrying a configured `agent` id SHALL start the in-process host when the agent is not durable. For a durable agent it SHALL spawn a headless keeper session (regardless of the configured spawn strategy) whose child is the acp-bridge adapter (`[<node binary>, <server>/bin/acp-bridge.mjs, "--agent", <id>]`), without resolving pi, without pi argv shaping, and using an ACP preflight (cwd valid, node and agent command resolvable) instead of the pi/tmux preflight. It SHALL reuse the existing spawn token, headless PID registry, register watchdog and spawn-error surfacing. Spawn requests without `agent` SHALL behave exactly as before, apart from the cwd-derived `PWD` the headless-spawn capability sets in every spawn env.

#### Scenario: Non-durable agent starts in-process
- **WHEN** the user spawns agent `qmt` configured without `durable`
- **THEN** no keeper or adapter process SHALL be spawned
- **AND** only the agent process SHALL be started, as a child of the server

#### Scenario: UI spawn of a durable agent under tmux strategy on a machine without pi
- **WHEN** the spawn strategy is `tmux`, pi is not installed, and the user spawns agent `qmt` configured with `durable: true` from the spawn dialog
- **THEN** the session SHALL be spawned via the headless keeper with the adapter as its child
- **AND** no `PI_NOT_FOUND` error SHALL occur

#### Scenario: Spawn without agent unchanged
- **WHEN** a spawn request has no `agent`
- **THEN** the spawned process, arguments, environment and preflight SHALL be identical to the pre-change behaviour, apart from the cwd-derived `PWD` (headless-spawn capability)
