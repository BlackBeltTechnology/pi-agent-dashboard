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

## New session won't start (spawn_register_timeout)

### Symptom — "+ New session" yields a yellow timeout banner, no session card ever renders

`/api/session/spawn` returns success (the RPC keeper launched) but `activeSessions` never increments. **Success from the spawn API means ONLY the keeper launched — it does NOT mean `pi` started.** Two root causes, distinguished by one manual `pi` run.

**Reproduce + isolate:**
```bash
# 1. Spawn and poll activeSessions for ~40s
curl -s -o /tmp/sp.json -X POST http://localhost:8000/api/session/spawn -d '{"cwd":"<repo>"}'
watch -n2 'curl -s http://localhost:8000/api/health | jq .server.activeSessions'

# 2. Read the keeper log for that spawn (transport id from /tmp/sp.json)
#    ~/.pi/dashboard/sessions/keeper-<transport>.log
#    'pi exited code=1 ... elapsed=NNNNms' == pi crashed at startup (extension/config), NOT overload.

# 3. Capture pi's crash reason directly (keeper output-capture is OFF by default):
NODE=~/.pi-dashboard/node/bin/node
CLI=node_modules/@earendil-works/pi-coding-agent/dist/cli.js
( echo '' | timeout 8 "$NODE" "$CLI" --mode rpc ) >/tmp/o 2>/tmp/e; echo exit=$?; head /tmp/e
```

**Branch on the manual exit code:**
- **exit=1 + `Failed to load extension`** → an enabled extension is incompatible with the bundled pi. Note the package + the missing module. Check `~/.pi/agent/settings.json` for enabled `npm:<ext>` and `~/.pi/agent/npm/package.json` for the pinned version + install mtime (correlate with when spawns started failing). Fix: pin a known-working version in `~/.pi/agent/npm/package.json`, then `npm install --legacy-peer-deps` (the tree has conflicting peers; plain install fails). Pin EXACTLY (not `^`) so it can't auto-upgrade back to a broken `latest`. Re-run the manual pi check (expect exit=0), then a real dashboard spawn (expect `activeSessions` +1 within ~5s).
- **exit=0 (no crash)** → it's host overload, not a crash. Count real pi procs, group cwds via `lsof`, check `uptime` load + server RSS via `/api/health`. Look for runaway burst-spawns (many `rpc-keeper/keeper.cjs` under one parent pi pid, started within ~60s). Kill keeper subtrees with SIGTERM (the keeper stops its child; killing only the child triggers a respawn). Optionally raise `spawnRegisterTimeoutMs` (default 30000, clamp 5000–120000) in `~/.pi/dashboard/config.json`.

**Pitfalls:**
- Killing a pi child PID alone is futile — the RPC keeper respawns it. Kill the keeper parent (`rpc-keeper/keeper.cjs`) instead.
- UUIDv7 session ids sharing an 8-char prefix (e.g. `019ef4c7-e291` / `019ef4c7-e292`) are DISTINCT sessions spawned ms apart, not duplicates — don't chase a phantom dup bug.
- The `[dashboard] failed to flip ctx.hasUI` stderr line is a non-fatal bridge warning; pi still exits 0 — not the crash cause.

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

For visual UI investigation use the **`browser`** skill (shipped by the dashboard bridge extension).

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
