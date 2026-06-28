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
