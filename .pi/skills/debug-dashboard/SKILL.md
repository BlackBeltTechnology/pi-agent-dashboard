---
name: debug-dashboard
description: Diagnose problems in the running pi-agent-dashboard system. Tail ~/.pi/dashboard/server.log, probe /api/health for mode + uptime, check bridge WebSocket connectivity, triage vitest failures via tee→grep, inspect known-issue FAQ entries (Electron Node bin selection, Fastify + bad-Node crashes, stale-port hangs, single-instance lock). Routes UI/visual issues to the browser skill. Use when the server seems hung, a pi session won't connect, tests fail mysteriously, the dashboard shows a blank page, restart loops, port conflicts, or any "why isn't X working" / "the dashboard is doing Y" question.
---

# Debug Dashboard

System-level debugging for the running pi-agent-dashboard. Three layers:

```
   ┌─────────────────────────────────────────────────────────┐
   │  Layer 1 — Is the server alive?                         │
   │            npx tsx ./scripts/health-probe.ts            │
   │            npx tsx ./scripts/tail-server-log.ts         │
   └─────────────────────────────────────────────────────────┘
                            │
                            ▼
   ┌─────────────────────────────────────────────────────────┐
   │  Layer 2 — Are the bridges connecting?                  │
   │            npx tsx ./scripts/list-sessions.ts           │
   │            npx tsx ./scripts/tail-server-log.ts --errors│
   └─────────────────────────────────────────────────────────┘
                            │
                            ▼
   ┌─────────────────────────────────────────────────────────┐
   │  Layer 3 — Is the UI rendering?                         │
   │            (use the browser skill)                     │
   └─────────────────────────────────────────────────────────┘
```

## First moves — always run these

```bash
npx tsx ./scripts/health-probe.ts        # mode + uptime + version, or "not-running"
npx tsx ./scripts/tail-server-log.ts     # last 50 lines of current run
npx tsx ./scripts/list-sessions.ts       # connected pi sessions via REST
```

> Scripts are TypeScript (cross-platform). All invocations use `npx tsx` so they work on Linux, macOS, and Windows. `tsx` is already a project dep.

If `health-probe` says "not-running" → server isn't up. Check `server.log` for the most recent start banner (`[bootstrap] ready ...`) and what came after. The log appends with timestamped headers per start, so the **last** banner block is the relevant one.

## When the server is up but misbehaving

| Symptom | Likely cause | Where to look |
|---------|--------------|---------------|
| Restart loops | Stale port held by zombie, or `restart` racing with bridge auto-start | `lsof -i :8000`, then `pi-dashboard stop` (kills by port, not just PID) |
| `EADDRINUSE` on start | Concurrent spawn from multiple pi sessions | Harmless — losing process exits silently. Check log. |
| Bridge connects then disconnects | `server_restarting` broadcast active, or version skew | grep `server_restarting` in server.log; check `/api/health` for version |
| Blank page in browser | Vite not running in dev mode (silent fallback to prod build); or auth blocking | Check `/api/health.mode`; check `auth` settings |
| New session won't start / yellow `spawn_register_timeout`, no card | `pi` crashed at startup (bad extension) OR host overload | See `references/known-issues.md` → "New session won't start" — manual `pi --mode rpc` run splits crash vs overload |
| `Cannot connect to dashboard server` on Electron boot | `launchDashboardServer` fell back to `process.execPath` (Electron GUI binary) | See `references/known-issues.md` → "Electron Node bin selection" |
| Fastify crashes immediately | Bad Node version (22.0–22.17.x or 24.1–24.2.x per nodejs/node#58515) | `node --version` — must be ≥ 22.18.0 |

Full known-issue catalogue: [`references/known-issues.md`](references/known-issues.md).

## When tests fail mysteriously

Use the tee→grep pattern. Never rerun to inspect — capture once, grep forever:

```bash
npx tsx ./scripts/run-tests-triage.ts                 # all tests, tee to OS tmpdir, summarize failures
npx tsx ./scripts/run-tests-triage.ts packages/server # restrict to one package's vitest
npx tsx ./scripts/run-tests-triage.ts -t 'my test'    # by test name
```

After it finishes, the log lives at:
- Linux/macOS: `/tmp/pi-test.log`
- Windows: `%TEMP%\pi-test.log`

You can re-grep / re-read with custom patterns; the script prints the absolute path on each run.

Patterns + per-package vitest configs + watch mode are documented in [`references/test-failure-triage.md`](references/test-failure-triage.md).

## When the UI is the problem

This skill stops at "the server says X but the UI shows Y". For visual debugging — verifying layouts, screenshotting, hunting console errors, testing responsive breakpoints — switch to the **`browser`** skill (shipped by the dashboard bridge extension to every session). Quick pointer: see [`references/ui-debug.md`](references/ui-debug.md).

## When you must verify a change without touching the live server

The live `:8000` server runs MAIN-repo code — `/api/restart` never loads worktree edits, and a careless `npm run build` **leaks** into `packages/client/dist` (what live serves). To verify a UI/worktree change or serve a review mockup in full isolation (temp `HOME`, non-8000 ports, `PI_DASHBOARD_NO_MDNS=1`), see [`references/isolated-verification.md`](references/isolated-verification.md).

## Log file locations

All log + config files. Worth bookmarking. See [`references/log-locations.md`](references/log-locations.md) for the full map.

| Path | Contents |
|------|----------|
| `~/.pi/dashboard/server.log` | Daemon stdout/stderr, append mode, timestamped headers per start |
| `~/.pi/dashboard/server.pid` | PID file (may be stale; use `lsof -i :8000` to confirm) |
| `~/.pi/dashboard/config.json` | Live config (port, piPort, auth, tunnel, plugins) |
| `~/.pi/dashboard/zrok.pid` | Tunnel PID file |
| `~/.pi/dashboard/model-proxy.jsonl` | Model proxy request log (50 MB rotation) |
| `~/.pi/dashboard/tool-overrides.json` | Tool registry overrides |
| `/tmp/pi-test.log` | Last test run (when you used the tee→grep pattern) |
| `~/.pi/agent/sessions/` | Per-session pi state |

## STOP — docs-first gate

Before answering any "how do I X" / "why does Y happen" question:

```bash
grep -ni '<keyword>' docs/faq.md docs/*.md README.md
```

The FAQ already documents most recurring symptoms (Electron Node bin, Fastify crash range, tunnel watchdog, port conflicts). Reading source before grepping docs wastes tokens and risks wrong answers. Per `AGENTS.md` "STOP — Docs-First Gate".

## Related skills

- `browser` — UI/visual issues, screenshots, console errors, responsive testing (Electron + web)
- `implement` — back to implementing once the bug is identified
- `pi-dashboard` — interact with the dashboard via REST (list sessions, send prompts, abort)
- `ci-troubleshoot` — when the problem only shows up in CI
- `code-review` — review the fix before committing
