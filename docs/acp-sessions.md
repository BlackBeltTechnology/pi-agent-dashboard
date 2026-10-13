# ACP agent sessions

Run non-pi ACP agents (Agent Client Protocol, JSON-RPC 2.0 NDJSON over stdio) in the dashboard. Example agent: querymt (`qmtcode`). See change: add-acp-session-driver.

## Config

File: `~/.pi/dashboard/config.json` (`getDashboardConfigDir()` + `config.json`).

```json
{
  "acpAgents": [
    {
      "id": "qmt",
      "name": "querymt",
      "command": "qmtcode",
      "args": ["--stdio"],
      "env": { "OPENAI_API_KEY": "sk-..." },
      "durable": false
    }
  ],
  "acp": {
    "protocolV2": false,
    "spawnTimeoutMs": 30000,
    "requestTimeoutMs": 30000,
    "maxLineBytes": 4194304,
    "eventLogMaxBytes": 67108864
  }
}
```

Agent fields:

| Field | Type | Default | Notes |
|---|---|---|---|
| `id` | string | required | Unique. Duplicate → first wins, rest dropped + warning. |
| `name` | string | `id` | Shown in spawn picker. |
| `command` | string | required | argv[0]. Launched with `shell: false`. |
| `args` | string[] | `[]` | argv tail. Shell metachars inert. |
| `env` | string map | `{}` | Merged into child env. `PI_*`, `ELECTRON_*`, `NODE_OPTIONS` dropped + warning. |
| `durable` | boolean | `false` | `false` → in-process host. `true` → out-of-process host (survives server restart). |

Settings (`acp.*`). Out-of-range → clamped + warning. Non-number → default + warning.

| Key | Default | Range |
|---|---|---|
| `protocolV2` | `false` | boolean. `true` → request ACP v2 in `initialize`. |
| `spawnTimeoutMs` | `30000` | 5000–120000 |
| `requestTimeoutMs` | `30000` | 1000–300000 |
| `maxLineBytes` | `4194304` (4 MiB) | 65536–67108864 (64 KiB–64 MiB) |
| `eventLogMaxBytes` | `67108864` (64 MiB) | 1048576–1073741824 (1 MiB–1 GiB) |

Absent `acpAgents` → no ACP UI, no ACP spawn. Spawn with `agent` → error.

## Feature matrix

| Works | Refused (`unsupported_for_acp`) |
|---|---|
| Chat, streaming | resume, fork, continue |
| Tool cards | reload, retry |
| Thinking (live) | goals (`/goal`, link existing) |
| Plans (debug raw-event view only) | flows (`flow_control`, `flow_management`) |
| Model + thought-level selection (when agent advertises `model` / `thought_level`) | roles (`role_*`, `request_roles`) |
| Prompt queue (follow-up edit/remove/promote/clear) | inline terminal (`open_inline_terminal`) |
| Abort (`session/cancel`) | `list_files`, stop-after-turn, kill_process |
| Permission prompts (`select` dialog) | subagent resync |
| Commands (`commands_list`) | Automations: allowed with `agent` + `core.prompt` only |

Automations with `agent`: `core.skill` and plugin actions rejected at save and fire.

## Protocol version

- Default: v1 (`initialize` protocolVersion `1`). Matches shipping agents.
- `acp.protocolV2: true`: request v2. Accept v2 only when requested. Other version → error, exit.
- Client caps: `fs: {readTextFile:false, writeTextFile:false}`, `terminal: false`.

## Hosts

| | Non-durable (default) | Durable (`durable: true`) |
|---|---|---|
| Host | in-process, server child | `bin/acp-bridge.mjs` under rpc-keeper |
| Transport | `LocalBridgeSocket` → `PiGateway.attachLocalConnection` | WebSocket to gateway |
| Survives server restart | no | yes |
| After server restart | shown ended, `driver: "acp"` | reattach, event log replayed |
| Event log | none | `~/.pi/dashboard/acp/<id>.events.jsonl` (cap `eventLogMaxBytes`) |

Ended ACP sessions restored at boot from `~/.pi/dashboard/acp/<id>.meta.json`. History is NOT restored (no event log for host A). Never recovery candidates.

## Restart behaviour

- Server stop, non-durable: agent killed. Session ends.
- Server stop, durable: agent + adapter keep running under keeper. Browser reconnect → `session_register { registerReason: "reattach", driver: "acp" }` → models/commands → event log replay → `replay_complete`.
- Log cap reached: drop oldest whole turns until ≤ 50 % of cap, then one notice event.
- Agent crash: error in chat (exit code / signal), pending permissions `cancelled`, queue cleared, session ends.

## Environment

Child env = allowlist from adapter env + agent `env`.

Allowlist:

- `PATH`, `HOME`, `USER`, `LOGNAME`, `SHELL`, `TERM`, `LANG`, `LC_*`, `TMPDIR`, `TZ`
- Windows: `SystemRoot`, `APPDATA`, `LOCALAPPDATA`, `USERPROFILE`, `ComSpec`, `PATHEXT`

Dropped (never reach agent): every other adapter var, incl. `PI_DASHBOARD_*`, `PI_*`. Configured `PI_*`, `ELECTRON_*`, `NODE_OPTIONS` → dropped + warning.

## Security

- Argv only. `spawn(command, args, { shell: false })`. No shell.
- Windows: `command` ending `.cmd` / `.bat` → rejected. Use `.exe`.
- Agent runs as the server user. Same-user file access NOT isolated. Env-level isolation only.
- Configuring `acpAgents` = arbitrary command execution. Config writes gated by `operate` tier.
- No fs / terminal client capabilities. Agent `fs/*`, `terminal/*`, unknown `_*` requests → JSON-RPC `-32601`.
- Agent stdout: bounded lines (`maxLineBytes`), non-JSON skipped, never evaluated.
- ACP session id: opaque, memory-only. Never used as path or dashboard id. Paths use adapter-minted UUID.
- Config API: `GET /api/config` → `acpAgents[].env` values as `***`. Write of `***` keeps stored value (match by agent `id` + key).
- `GET /api/acp/agents` → `[{id, name}]` only. Tier `control`.

## UI

- Spawn picker: split button. Main action → remembered agent. Chevron → `pi (default)` + configured agents.
- Memory key: `localStorage` `pi-dashboard:spawn-agent:<cwd>`. Removed agent id → falls back to pi.
- Worktree dialog: one `Agent` select, preselected from parent folder memory.
- Sibling spawn inherits source session agent. "Initialize project" always pi.
- Goal spawns always pi.
- Driver chip on session card. Ended ACP session → callout. Resume/Fork/Reload/Retry hidden.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Spawn error `No ACP agents are configured` | `acpAgents` empty/absent | Add agent, restart server. |
| `ACP agent command not found` | `command` not on PATH | Absolute path or fix PATH. |
| `requires a shell (.cmd/.bat)` | Windows shell script | Configure `.exe`. |
| `unsupported ACP protocol version` | agent answered wrong version | Set `protocolV2` to match agent. |
| Spawn timeout | agent never answers `initialize` | Raise `spawnTimeoutMs`; check agent logs. |
| Ended ACP session won't resume | by design | Start new session with same agent. |

## Verification

- `GET /api/acp/agents` → lists configured `{id,name}`.
- Spawn agent → card shows driver chip; chat accepts prompt; `server.log` shows agent id + negotiated version.
- Durable agent: `pi-dashboard stop && pi-dashboard start` → session reattaches with history.

Source: `openspec/changes/add-acp-session-driver/`. Code: `packages/server/src/acp-bridge/`, `packages/shared/src/acp/`, `packages/server/src/spawn-process/acp-spawn.ts`, `packages/server/src/browser-handlers/acp-guard.ts`.
