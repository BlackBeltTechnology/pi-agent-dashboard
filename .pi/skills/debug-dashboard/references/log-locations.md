# Log + Config File Locations

Every persistent file the dashboard reads or writes, with what to look for in each. Synthesized from `docs/faq.md`, `AGENTS.md` Key Files table, and source greps.

## `~/.pi/dashboard/`

Everything dashboard-specific lives here.

### `server.log`

**Daemon stdout/stderr, append mode, timestamped headers per restart.**

Each start writes a banner like:
```
=== [2025-05-25T10:30:00Z] dashboard start (pid 12345, mode=production) ===
[bootstrap] ready (pi resolved via <source>)
```

The **last banner** is the current run. Everything before is history.

Useful greps:
```bash
# Just the current run (from the last banner onward)
tac ~/.pi/dashboard/server.log | sed -n '/^=== \[/q;p' | tac

# All start banners (history of restarts)
grep '^=== \[' ~/.pi/dashboard/server.log

# Errors only
grep -iE 'error|fail|warn|throw' ~/.pi/dashboard/server.log | tail -20

# Bridge connection events
grep -iE 'bridge|websocket|client.*connected|client.*disconnected' ~/.pi/dashboard/server.log | tail -20
```

### `server.pid`

PID file. **May be stale** if the server crashed without cleanup. Source of truth for "is the server actually running" is `lsof -i :<port>`, not the PID file:

```bash
PORT=$(jq -r .port ~/.pi/dashboard/config.json 2>/dev/null || echo 8000)
lsof -i :$PORT
```

`pi-dashboard stop` already kills by port (not just PID), so it handles stale-PID cases.

### `config.json`

Live config — port, piPort, auth, tunnel, plugins, model proxy, terminal defaults. Reloadable via `PUT /api/config` (partial merge, secrets preserved as `***`). Port/piPort changes set `restartRequired: true` in the response.

Don't edit this directly while the server is running unless you know what you're doing — the server may not pick up changes until restart.

### `zrok.pid`

Tunnel PID. Reserved share = stable URL across restarts.

### `model-proxy.jsonl`

Append-mode JSONL log of model proxy requests. 50 MB rotation. Useful for:
- Debugging which provider was used for a request
- Auditing API key usage
- Investigating concurrency-limit hits

### `tool-overrides.json`

Per-tool path overrides set via Settings → Tools. Lets you point at custom installs of pi, openspec, code-server, etc.

## `~/.pi/agent/`

Pi-managed state, not dashboard-specific. Dashboard reads but doesn't write.

### `~/.pi/agent/sessions/<session-id>/`

Per-session pi state. `meta.json` (dashboard sidecar) + pi's own files. Dashboard discovers sessions at startup by scanning this dir.

### `~/.pi/agent/auth.json`

Pi provider OAuth credentials (Anthropic, Codex, GitHub Copilot, Gemini CLI, Antigravity). Has lockfile semantics — concurrent writes serialize.

## `/tmp/`

### `/tmp/pi-test.log`

Where `npx tsx ./scripts/run-tests-triage.ts` captures `npm test` output. Lives until next reboot or until you re-run. On Windows, the path is `%TEMP%\pi-test.log` instead.

```bash
grep -nE 'FAIL|Error|✗|✘' /tmp/pi-test.log
grep -n -A 20 'FAIL ' /tmp/pi-test.log
```

## In-repo

### `dist/client/`

Production client build output. Served by the server in production mode. Rebuild via `npm run build`.

### `dist/` (per-package)

Each workspace package (`packages/extension/`, `packages/server/`, etc.) builds its own `dist/` for tsc output. Most don't need to be built (jiti runs source TS directly); they exist for npm publish.

## Quick "where is X" cheatsheet

| Question | Path |
|----------|------|
| Why did the server fail to start? | `~/.pi/dashboard/server.log` (last banner) |
| What port is the server on? | `jq .port ~/.pi/dashboard/config.json` |
| Is the server actually running? | `lsof -i :<port>` |
| Which provider was used for request X? | `~/.pi/dashboard/model-proxy.jsonl` |
| Why is the bridge not connecting? | `server.log` grep `bridge\|websocket` |
| Which sessions exist? | `~/.pi/agent/sessions/` or `GET /api/sessions` |
| Why is OAuth failing? | `~/.pi/agent/auth.json` perms + `server.log` |
| Why are my changes not appearing? | Are you in dev mode? `npx tsx ./scripts/health-probe.ts` |
