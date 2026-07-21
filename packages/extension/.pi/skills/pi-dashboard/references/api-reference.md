# Pi Dashboard REST API Reference

Base URL: `http://localhost:{port}` (default port: `8000`, configurable in `~/.pi/dashboard/config.json`).

All responses use JSON. Mutation endpoints require `Content-Type: application/json`.

---

## WebSocket bus verbs

Session/flow COMMAND verbs are preferably driven over the SAME WebSocket bus the
web client uses, via `@blackbelt-technology/pi-dashboard-bus-client` (wrapped by
[`scripts/dashboard-bus.ts`](../scripts/dashboard-bus.ts)). The client sends
`BrowserToServerMessage` verbs; the per-verb helpers are codegen'd from that
union, with a denylist that excludes `plugin_config_write` (stays REST). `spawn`
and `resume` replies are **exact-correlated** to the request; all other waits are
**structural** (matched on session-id + status). The REST endpoints below remain
a supported compatibility shell for the same operations plus the read-only and
no-WS-twin endpoints.

---

## Health & Status

### `GET /api/health`
Server liveness check.

**Response:**
```json
{ "ok": true, "pid": 12345, "uptime": 3600 }
```

### `GET /auth/status`
Check authentication status.

**Response (auth disabled):**
```json
{ "authenticated": true, "authEnabled": false }
```

---

## Sessions

### `GET /api/sessions`
List all sessions.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "abc123",
      "cwd": "/path/to/project",
      "name": "my-session",
      "source": "tui",
      "status": "active",
      "model": "claude-sonnet-4-20250514",
      "startedAt": 1711900000000,
      "tokensIn": 5000,
      "tokensOut": 1200,
      "cost": 0.05,
      "currentTool": "Edit",
      "gitBranch": "main",
      "hidden": false
    }
  ]
}
```

**Session fields:**
| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique session identifier |
| `cwd` | string | Working directory |
| `name` | string? | User-assigned name |
| `source` | string | Origin: `tui`, `zed`, `tmux`, `dashboard`, `terminal`, `unknown` |
| `status` | string | `active`, `idle`, `streaming`, `ended` |
| `model` | string? | Current model name |
| `thinkingLevel` | string? | Current thinking level |
| `startedAt` | number | Unix timestamp (ms) |
| `endedAt` | number? | Unix timestamp (ms) when ended |
| `tokensIn` | number? | Total input tokens |
| `tokensOut` | number? | Total output tokens |
| `cost` | number? | Total cost in USD |
| `currentTool` | string? | Currently executing tool name |
| `gitBranch` | string? | Current git branch |
| `attachedProposal` | string? | Attached OpenSpec change name |
| `hidden` | boolean? | Whether session is hidden |
| `activeFlowName` | string? | Running flow name |
| `flowStatus` | string? | `running`, `success`, `error`, `aborted` |
| `sessionFile` | string? | Path to session JSONL file |

---

## Session Control

### `POST /api/session/:id/prompt`
Send a text prompt to a session.

**Body:**
```json
{ "text": "your prompt message", "images": [] }
```
- `text` (required): Prompt text
- `images` (optional): Array of `{ type: "image", data: "base64...", mimeType: "image/png" }`

**Responses:**
- `200`: `{ "success": true }`
- `400`: Missing `text`
- `404`: Session not found
- `502`: No bridge connection (session not connected to dashboard)

### `POST /api/session/:id/abort`
Abort the current operation in a session.

**Body:** `{}`

**Responses:**
- `200`: `{ "success": true }`
- `404`: Session not found

### `POST /api/session/:id/shutdown`
Shut down a pi session (terminates the process, not the server).

**Body:** `{}`

**Responses:**
- `200`: `{ "success": true }`
- `404`: Session not found

### `POST /api/session/:id/rename`
Rename a session.

**Body:**
```json
{ "name": "new-session-name" }
```

**Responses:**
- `200`: `{ "success": true }`
- `400`: Missing `name`
- `404`: Session not found

### `POST /api/session/:id/hide`
Hide a session from the default view.

**Body:** `{}`

**Responses:**
- `200`: `{ "success": true }`
- `404`: Session not found

### `POST /api/session/:id/unhide`
Unhide a previously hidden session.

**Body:** `{}`

**Responses:**
- `200`: `{ "success": true }`
- `404`: Session not found

### `POST /api/session/spawn`
Spawn a new pi session in a directory.

**Body:**
```json
{ "cwd": "/path/to/project" }
```

**Responses:**
- `200`: `{ "success": true, "data": { "message": "..." } }`
- `400`: Missing `cwd`
- `500`: Spawn failed

### `POST /api/session/:id/resume`
Resume or fork an ended session.

**Body:**
```json
{ "mode": "continue" }
```
- `mode`: `"continue"` (resume same session) or `"fork"` (create a new branch from this session)

**Responses:**
- `200`: `{ "success": true, "data": { "message": "..." } }`
- `400`: Invalid `mode` or missing session file
- `404`: Session not found
- `409`: Session is still active or already resuming
- `500`: Spawn failed

---

## Flow Control

### `POST /api/session/:id/flow-control`
Control a running flow.

**Body:**
```json
{ "action": "abort" }
```
- `action`: `"abort"` or `"toggle_autonomous"`

**Responses:**
- `200`: `{ "success": true }`
- `400`: Invalid `action`
- `404`: Session not found

---

## Model Configuration

### `GET /api/models`
List the dashboard's reachable model catalogue (model-introspection surface). Ungated beyond the dashboard's own auth gate — no `pi-proxy-...` Bearer key required (same posture as `GET /api/provider-auth/status`). To inspect available/reachable models, call this endpoint; do NOT parse `~/.pi/agent/providers.json` or `~/.pi/agent/models.json` — that path is wrong and fails silently (those files hold roles/presets, not the catalogue).

**Query:**
- `annotated=1`: return every model plus `excludedReason` (`no-credential` | `oauth-incompatible`); default returns only reachable models.

**Responses:**
- `200`: `{ "object": "list", "data": [{ "id": "provider/modelId", "provider", "reasoning?", "input?", "contextWindow?", "maxTokens?", "cost?", "excludedReason?" }] }` (capability/cost metadata only — never credentials)
- `503`: model runtime (pi-ai) unavailable

### `POST /api/session/:id/model`
Set the model for a session.

**Body:**
```json
{ "provider": "anthropic", "modelId": "claude-sonnet-4-20250514" }
```

**Responses:**
- `200`: `{ "success": true }`
- `400`: Missing `provider` or `modelId`
- `404`: Session not found

### `POST /api/session/:id/thinking-level`
Set the thinking level for a session.

**Body:**
```json
{ "level": "high" }
```

**Responses:**
- `200`: `{ "success": true }`
- `400`: Missing `level`
- `404`: Session not found

---

## OpenSpec

### `POST /api/session/:id/attach-proposal`
Attach an OpenSpec change proposal to a session. Auto-names the session if unnamed.

**Body:**
```json
{ "changeName": "add-new-feature" }
```

**Responses:**
- `200`: `{ "success": true }`
- `400`: Missing `changeName`
- `404`: Session not found

### `POST /api/session/:id/detach-proposal`
Detach the currently attached proposal from a session.

**Body:** `{}`

**Responses:**
- `200`: `{ "success": true }`
- `404`: Session not found

### `GET /api/openspec-archive?cwd=CWD`
List archived OpenSpec changes for a directory.

**Response:**
```json
{
  "success": true,
  "data": [
    { "name": "add-feature", "date": "2025-01-15", "path": "openspec/changes/archive/2025-01-15-add-feature" }
  ]
}
```

---

## Git Operations

All git endpoints are **localhost-only**.

### `GET /api/git/branches?cwd=CWD`
List git branches.

**Response:**
```json
{
  "success": true,
  "data": {
    "current": "main",
    "detached": false,
    "branches": [
      { "name": "main", "isRemote": false, "isCurrent": true },
      { "name": "origin/main", "isRemote": true, "isCurrent": false }
    ]
  }
}
```

### `POST /api/git/checkout`
Checkout a branch.

**Body:**
```json
{ "cwd": "/path", "branch": "feature-branch", "stash": false }
```

**Responses:**
- `200`: `{ "success": true, "data": { "stashed": false } }`
- `409`: Dirty working tree (returns `{ "success": false, "dirty": true, "files": [...] }`)

### `POST /api/git/init`
Initialize a git repository.

**Body:** `{ "cwd": "/path" }`

### `POST /api/git/stash-pop`
Pop the most recent stash.

**Body:** `{ "cwd": "/path" }`

**Response:** `{ "success": true, "data": { "conflicts": false } }`

---

## Files & Browse

### `GET /api/file?cwd=CWD&path=RELPATH`
Read a file or list a directory (localhost-only).

**Response (file):**
```json
{ "success": true, "data": { "type": "file", "content": "file contents..." } }
```

**Response (directory):**
```json
{ "success": true, "data": { "type": "directory", "entries": ["file1.ts", "dir/"] } }
```

### `GET /api/browse?path=PATH`
Browse directories (localhost-only).

**Response:**
```json
{
  "success": true,
  "data": {
    "current": "/Users/me/projects",
    "parent": "/Users/me",
    "entries": [
      { "name": "my-app", "path": "/Users/me/projects/my-app", "isGit": true, "isPi": true }
    ]
  }
}
```

### `GET /api/readme?cwd=CWD`
Read README.md from a directory (localhost-only).

---

## Events

### `GET /api/events/:sessionId/:seq`
Fetch a specific event by sequence number.

**Response:**
```json
{
  "success": true,
  "data": {
    "eventType": "tool_use",
    "timestamp": 1711900000000,
    "data": { "toolName": "Edit", "input": "..." }
  }
}
```

### `GET /api/session-diff?sessionId=ID`
Get file changes made during a session (localhost-only).

**Response:**
```json
{
  "success": true,
  "data": {
    "isGitRepo": true,
    "files": [
      {
        "path": "src/app.ts",
        "changes": [{ "type": "edit", "timestamp": 1711900000000, "message": "Add feature" }],
        "gitDiff": "--- a/src/app.ts\n+++ b/src/app.ts\n..."
      }
    ]
  }
}
```

---

## Configuration

### `GET /api/config`
Read server configuration (redacted secrets, localhost-only).

### `PUT /api/config`
Update server configuration (partial merge, localhost-only).

**Body (any subset):**
```json
{
  "port": 8000,
  "autoShutdown": true,
  "shutdownIdleSeconds": 300,
  "spawnStrategy": "headless",
  "tunnel": { "enabled": true }
}
```

---

## Tunnel

### `GET /api/tunnel-status`
Check tunnel status.

**Response:**
```json
{ "status": "active", "url": "https://abc.share.zrok.io", "serverOs": "darwin" }
```
Status can be `active`, `inactive`, or `unavailable`.

### `POST /api/tunnel-connect`
Create a tunnel connection.

### `POST /api/tunnel-disconnect`
Disconnect the active tunnel.

**Body (optional):**
```json
{ "forget": true }
```
When `forget: true`, releases reserved URL (zrok v2 `zrok2 delete name`) and clears config `tunnel.zrok.reservedName`. Without body or `forget: false`, plain disconnect preserves reserved URL + config (URL stable on next connect).

---

## Server Lifecycle

### `POST /api/shutdown`
Shut down the dashboard server (localhost-only). Flushes persistence before exit.

**Response:** `{ "ok": true }`

---

## Pi Resources

### `GET /api/pi-resources?cwd=CWD`
List discovered extensions, skills, and prompts (localhost-only).

### `GET /api/pi-resource-file?path=FILEPATH`
Read a pi resource file (localhost-only, restricted to allowed locations).

### `GET /api/editors?path=CWD`
Detect available editors (localhost-only).

### `POST /api/open-editor`
Open a file in an editor (localhost-only).

**Body:**
```json
{ "path": "/project", "editor": "vscode", "file": "src/app.ts", "line": 42 }
```

---

## Pinned Directories

### `GET /api/pinned-dirs`
List pinned directories.

**Response:**
```json
{ "success": true, "data": ["/path/to/project1", "/path/to/project2"] }
```
