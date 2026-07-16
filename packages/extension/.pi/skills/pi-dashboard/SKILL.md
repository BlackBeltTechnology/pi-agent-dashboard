---
name: pi-dashboard
description: >
  Monitor and control the pi-dashboard server. List sessions, send prompts,
  abort runs, spawn new sessions, manage git branches, control flows, and
  configure the dashboard — all via REST API. Use when you need to interact
  with other pi sessions, check dashboard health, or orchestrate multi-session
  workflows.
license: MIT
metadata:
  author: pi-dashboard
  version: "1.0"
---

# Pi Dashboard Control

Interact with the pi-dashboard server from any pi session via its REST API.

## Typed bus client (preferred for commands)

Session/flow COMMAND verbs now ride the SAME WebSocket bus the web client uses,
via [`scripts/dashboard-bus.ts`](scripts/dashboard-bus.ts) — a thin CLI wrapping
`@blackbelt-technology/pi-dashboard-bus-client`. It discovers the port itself
(config.json / `DASHBOARD_PORT` / 8000) and resolves an id-prefix to a full
session id from the live subscription snapshot, so command prose no longer needs
to teach BASE-URL derivation or GET `/api/sessions` id-resolution.

Canonical example:

```bash
npx tsx ./scripts/dashboard-bus.ts spawn /path/to/proj --prompt "/opsx-explore add-auth"
npx tsx ./scripts/dashboard-bus.ts until <id> idle
npx tsx ./scripts/dashboard-bus.ts prompt <id> "run the tests"
```

LLM authors can also write an ordinary type-checked `.ts` script importing
`{ connect }` from `@blackbelt-technology/pi-dashboard-bus-client` for multi-step
orchestration (spawn → prompt → until idle → read → plugin) using `connect()`,
`spawn()`, `prompt()`, `until()`, `read.sessions()`, and `plugin("goal", …)`.

### Tier split

- **COMMAND verbs → bus** (`dashboard-bus.ts`): abort, send_prompt, spawn,
  resume, flow_control, set_model, set_thinking_level, rename, hide/unhide,
  attach/detach_proposal, plugin goal.
- **READ-ONLY + no-WS-twin → REST** (`dashboard-api.sh`): session / health /
  config reads, git ops, grep/browse, `plugin_config_write`, tunnel, peer scan,
  openspec archive/toggle. REST remains a supported compatibility shell.

## Setup — Discover the Dashboard URL

Read the port from config, defaulting to `8000`:

```bash
PORT=$(cat ~/.pi/dashboard/config.json 2>/dev/null | grep '"port"' | grep -o '[0-9]*' || echo 8000)
BASE="http://localhost:$PORT"
```

Verify the server is running:

```bash
curl -s "$BASE/api/health" | jq .
# Expected: { "ok": true, "pid": ..., "uptime": ... }
```

## Authentication

By default, auth is **disabled** and all localhost requests work without tokens.

When auth is enabled (remote/tunnel access), include the JWT cookie:

```bash
# Check auth status
curl -s "$BASE/auth/status" | jq .

# If auth is enabled, include token in requests:
curl -s -b "pi_dash_token=YOUR_JWT" "$BASE/api/sessions" | jq .
```

## Quick Reference

### Monitor

| Action | Command |
|--------|---------|
| List sessions | `curl -s "$BASE/api/sessions" \| jq .` |
| Server health | `curl -s "$BASE/api/health" \| jq .` |
| Session file diff | `curl -s "$BASE/api/session-diff?sessionId=ID" \| jq .` |
| Read file | `curl -s "$BASE/api/file?cwd=CWD&path=REL" \| jq .` |
| List pinned dirs | `curl -s "$BASE/api/pinned-dirs" \| jq .` |

### Control Sessions

> The `/dashboard:session-*` and `/dashboard:flow-*` MUTATION commands now route
> through the bus CLI (`scripts/dashboard-bus.ts`). The REST rows below stay as a
> supported compatibility shell.

| Action | Command |
|--------|---------|
| Send prompt | `curl -s -X POST "$BASE/api/session/ID/prompt" -H 'Content-Type: application/json' -d '{"text":"your message"}'` |
| Abort | `curl -s -X POST "$BASE/api/session/ID/abort" -H 'Content-Type: application/json' -d '{}'` |
| Shutdown session | `curl -s -X POST "$BASE/api/session/ID/shutdown" -H 'Content-Type: application/json' -d '{}'` |
| Rename | `curl -s -X POST "$BASE/api/session/ID/rename" -H 'Content-Type: application/json' -d '{"name":"my-name"}'` |
| Hide | `curl -s -X POST "$BASE/api/session/ID/hide" -H 'Content-Type: application/json' -d '{}'` |
| Unhide | `curl -s -X POST "$BASE/api/session/ID/unhide" -H 'Content-Type: application/json' -d '{}'` |
| Spawn new | `curl -s -X POST "$BASE/api/session/spawn" -H 'Content-Type: application/json' -d '{"cwd":"/path"}'` |
| Resume/Fork | `curl -s -X POST "$BASE/api/session/ID/resume" -H 'Content-Type: application/json' -d '{"mode":"continue"}'` |

### Flow Control

| Action | Command |
|--------|---------|
| Abort flow | `curl -s -X POST "$BASE/api/session/ID/flow-control" -H 'Content-Type: application/json' -d '{"action":"abort"}'` |
| Toggle autonomous | `curl -s -X POST "$BASE/api/session/ID/flow-control" -H 'Content-Type: application/json' -d '{"action":"toggle_autonomous"}'` |

### Model / Thinking

| Action | Command |
|--------|---------|
| Set model | `curl -s -X POST "$BASE/api/session/ID/model" -H 'Content-Type: application/json' -d '{"provider":"anthropic","modelId":"claude-sonnet-4-20250514"}'` |
| Set thinking | `curl -s -X POST "$BASE/api/session/ID/thinking-level" -H 'Content-Type: application/json' -d '{"level":"high"}'` |

### Git Operations

| Action | Command |
|--------|---------|
| List branches | `curl -s "$BASE/api/git/branches?cwd=CWD" \| jq .` |
| Checkout | `curl -s -X POST "$BASE/api/git/checkout" -H 'Content-Type: application/json' -d '{"cwd":"CWD","branch":"main"}'` |
| Init repo | `curl -s -X POST "$BASE/api/git/init" -H 'Content-Type: application/json' -d '{"cwd":"CWD"}'` |
| Stash pop | `curl -s -X POST "$BASE/api/git/stash-pop" -H 'Content-Type: application/json' -d '{"cwd":"CWD"}'` |

### OpenSpec

| Action | Command |
|--------|---------|
| Attach proposal | `curl -s -X POST "$BASE/api/session/ID/attach-proposal" -H 'Content-Type: application/json' -d '{"changeName":"change-name"}'` |
| Detach proposal | `curl -s -X POST "$BASE/api/session/ID/detach-proposal" -H 'Content-Type: application/json' -d '{}'` |
| Archive listing | `curl -s "$BASE/api/openspec-archive?cwd=CWD" \| jq .` |

### Configuration

| Action | Command |
|--------|---------|
| Read config | `curl -s "$BASE/api/config" \| jq .` |
| Update config | `curl -s -X PUT "$BASE/api/config" -H 'Content-Type: application/json' -d '{"autoShutdown":false}'` |

### Tunnel

| Action | Command |
|--------|---------|
| Tunnel status | `curl -s "$BASE/api/tunnel-status" \| jq .` |
| Connect tunnel | `curl -s -X POST "$BASE/api/tunnel-connect"` |
| Disconnect tunnel | `curl -s -X POST "$BASE/api/tunnel-disconnect"` |

## Helper Script

A convenience wrapper is available at [scripts/dashboard-api.sh](scripts/dashboard-api.sh):

```bash
# Usage:
./scripts/dashboard-api.sh GET /api/sessions
./scripts/dashboard-api.sh POST /api/session/ID/prompt '{"text":"hello"}'
./scripts/dashboard-api.sh POST /api/session/spawn '{"cwd":"/path/to/project"}'
```

## Slash Commands

The `/dashboard:*` namespace wraps common operations as one-shot slash commands.
Files live in [`commands/`](commands/) and are auto-discovered by the bridge's
prompt-expander (`/dashboard:session-list` resolves `dashboard-session-list.md`).

Two classes:

- **LLM-free** (`executable: bash` frontmatter) — body runs as bash, output
  renders in chat, the LLM is never invoked (chat shows an "ℹ ran locally"
  footer). Read-only / zero-blast-radius ops. Example:

  ```
  /dashboard:session-list          # table of every session, no token cost
  /dashboard:session-info abc123   # all fields for a session by id-prefix
  /dashboard:server-health         # pid + uptime
  ```

- **LLM-bound** (no `executable` frontmatter) — body expands into a user
  message the LLM interprets. Mutations needing judgment or free-form text.
  Example:

  ```
  /dashboard:session-tell abc123 please run the tests
  /dashboard:session-abort-all     # asks which sessions before aborting
  ```

LLM-free bodies get `PI_DASHBOARD_PORT` / `PI_DASHBOARD_BASE` injected, so they
curl the running dashboard without re-deriving the port. Full list:
[references/slash-commands.md](references/slash-commands.md).
Convention + frontmatter: [commands/README.md](commands/README.md).

## Detailed References

- [Slash Commands](references/slash-commands.md) — every `/dashboard:*` command, args, LLM-free vs LLM-bound
- [API Reference](references/api-reference.md) — Complete endpoint documentation with request/response schemas
- [Recipes](references/recipes.md) — Multi-step orchestration workflows
