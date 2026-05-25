# Known Issues Catalogue

Distilled from `docs/faq.md` and recent change history. When a user reports a symptom, grep this list first.

## STOP — grep the FAQ first

Per `AGENTS.md` "STOP — Docs-First Gate":

```bash
grep -ni '<symptom-keyword>' docs/faq.md README.md docs/*.md
```

This catalogue is a **shortcut** to the canonical FAQ entries, not a replacement.

## Server won't start

### Symptom — `Cannot connect to dashboard server` on Electron boot, only banner in server.log

**Cause:** `launchDashboardServer` fell back to `process.execPath` (Electron GUI binary) as Node interpreter. Spawned child re-launched the Electron app, hit the single-instance lock, exited silently — producing only `[<ts>] Electron launch (parent pid …)` header with no follow-up.

**Fix:** Already fixed in change `fix-electron-server-launch-node-bin`. Both Electron launchers (`spawnFromSource`, `launchServer`) call `pickNodeForServer()` — selects bundled Node first, system Node fallback, `process.execPath`+`ELECTRON_RUN_AS_NODE=1` as last resort. If you see this on a recent build, file a regression.

### Symptom — Fastify crashes immediately on start

**Cause:** Bad Node.js version. Specifically:
- 22.0.0–22.17.x (crash per nodejs/node#58515)
- 24.1.0–24.2.x (same bug)

**Fix:** Use Node.js ≥ 22.18.0 (or ≥ 24.3.0). Check:
```bash
node --version
```

Repo-lint `node-version-check.ts` warns at startup if a known-bad version is detected.

### Symptom — `EADDRINUSE` on start

**Cause:** Concurrent spawns from multiple pi sessions racing to start the server. Or a stale process still holding the port.

**Fix:** Harmless if concurrent — losing process exits silently. If persistent:
```bash
lsof -i :8000          # find the holder
pi-dashboard stop      # kills by port (handles stale PID files)
pi-dashboard start
```

`pi-dashboard stop` kills processes holding the port via `lsof`, not just the PID file — so stale PIDs don't block it.

## Bridge won't connect

### Symptom — Bridge connects then immediately disconnects

**Cause:** `server_restarting` broadcast active. Server sends `server_restarting { reason, quiesceMs }` before exiting, bridges suppress auto-start for the quiesce window (5 s for restart, 60 s for shutdown).

**Check:**
```bash
grep 'server_restarting' ~/.pi/dashboard/server.log | tail -5
```

If the broadcast is recent, just wait the quiesce window out — bridges will reconnect on their own.

### Symptom — Bridge connects but no events appear

**Possible causes:**
1. Extension version skew — bridge code in pi session doesn't match server protocol.
2. Pi process for the session crashed but TCP didn't notice.

**Check:**
```bash
# Reload all bridges with the latest extension code
npm run reload

# Check what pi sessions are alive
ps -ef | grep -i 'pi[^-]' | grep -v grep
```

## Dashboard UI shows blank page

### Symptom — Blank page in browser after restart in `--dev` mode

**Cause:** Vite isn't actually running, so the server silently falls back to serving `dist/client/`. If `dist/client/` is stale or missing, page is blank.

**Fix:**
```bash
# Verify dev mode
curl -s http://localhost:8000/api/health | jq .mode    # should be "dev"

# Start Vite (separate terminal)
npm run dev

# Or rebuild prod bundle as a baseline
npm run build
```

### Symptom — Page loads but stuck on "Loading…"

**Possible causes:**
1. Auth is enabled and JWT is missing/expired.
2. Browser WebSocket can't connect (CORS, proxy, tunnel down).

**Check browser devtools** → Network tab → look for failed `/api/health` or `/ws/browser` requests.

For visual UI investigation use the **`browser-visual-debug`** skill.

## Restart misbehaviour

### Symptom — Restart loop / restart doesn't take effect

**Possible causes:**
1. Bypassed `/api/restart` with manual `kill` → bridge auto-start raced the new server.
2. PID file stale, `restart` re-spawning on top of the old process.

**Fix:** Use `/api/restart` (the **single restart path**). `pi-dashboard restart` (CLI) delegates to it automatically when the dashboard is up. If forced manual:
```bash
pi-dashboard stop && sleep 2 && pi-dashboard start
```

## Tunnel issues

### Symptom — Tunnel URL works briefly then 502s

**Cause:** zrok share dropped. Tunnel watchdog should auto-recycle, but check:
```bash
curl -s http://localhost:8000/api/tunnel-status | jq
```

`watchdog.consecutiveFailures` ≥ 2 triggers `deleteTunnel()` + `createTunnel()`. Reserved token preserved — URL stays same.

### Symptom — Tunnel callback URL not working for OAuth

**Cause:** OAuth provider needs the callback registered. Each provider has its own registration UI.

**URL format:** `https://<tunnel-url>/auth/callback/<provider>`

Register this in each OAuth provider's settings.

## Test failures (CI-specific)

For CI failure modes (lockfile mismatch, missing node-pty prebuild, etc.) see the **`ci-troubleshoot`** skill — `references/common-failures.md`.

For local vitest failures see `references/test-failure-triage.md` in this skill.

## How this list stays current

When a new known-issue is added to `docs/faq.md`, mirror a 3–10 line entry here pointing at the FAQ. Don't duplicate the full FAQ entry — the FAQ is canonical.
