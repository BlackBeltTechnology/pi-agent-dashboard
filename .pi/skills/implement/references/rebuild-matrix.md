# Rebuild Matrix — Full Detail

Synthesized from `AGENTS.md` "Build & Restart Workflow" + `docs/faq.md`. This is the long-form reference; the skill SKILL.md has the quick decision tree.

## The three components

```
   ┌─────────────────┐    ┌──────────────────┐    ┌──────────────────┐
   │ Bridge Extension│    │ Dashboard Server │    │   Web Client     │
   │ src/extension/  │    │  src/server/     │    │  src/client/     │
   │                 │◀──▶│  src/shared/     │◀──▶│                  │
   │ Runs IN every   │ WS │ Aggregates       │ WS │ React + Tailwind │
   │ pi session,     │    │ events, persists │    │ UI               │
   │ forwards events │    │ to JSON/.meta    │    │ Subscribes via   │
   │ via WebSocket   │    │ Dual WS gateways │    │ /ws/browser      │
   └─────────────────┘    └──────────────────┘    └──────────────────┘
        reload                  restart                 build (prod)
                                                       HMR    (dev)
```

Why each has a different rebuild path:
- **Extension** lives in pi sessions, not the server process. Pi must be told to re-`require()` it → `npm run reload`.
- **Server** runs TS directly via jiti (pi's TypeScript loader). No compile step. Restart picks up source changes.
- **Client** is a Vite-bundled React app served by the server. Dev mode = Vite HMR. Prod mode = pre-built `dist/client/`.

## Per-component recipes

### Bridge extension — `src/extension/`

```bash
npm run reload          # reload all connected pi sessions
npm run reload:check    # type-check first, then reload
```

`reload:check` is the safer default when you're not sure your TS compiles. It runs `tsc --noEmit` then reloads only if types are clean.

### Server — `src/server/`, `src/shared/`

Server runs TS directly via jiti. No build step. Just restart:

```bash
# Graceful restart via API (preserves current dev/prod mode)
curl -X POST http://localhost:8000/api/restart

# Or via CLI
pi-dashboard restart              # production
pi-dashboard restart --dev        # dev

# Force a mode
curl -X POST -H 'Content-Type: application/json' \
  -d '{"dev": true}' http://localhost:8000/api/restart

# Manual stop + start (fallback if API is broken)
pi-dashboard stop && pi-dashboard start
pi-dashboard stop && pi-dashboard start --dev
```

### Client — `src/client/`

| Mode | Action |
|------|--------|
| Dev (`npm run dev` or `pi-dashboard start --dev`) | Nothing — Vite HMR auto-reloads |
| Prod | `npm run build && curl -X POST http://localhost:8000/api/restart` |

### After `openspec-apply` finishes — full rebuild

```bash
npm run build
curl -X POST http://localhost:8000/api/restart
npm run reload
```

Or just run `npx tsx ./scripts/full-rebuild.ts` from this skill.

## Mode mechanics

### Check current mode

```bash
curl -s http://localhost:8000/api/health | jq .mode
# Returns "dev" or "production"
```

### Dev mode with production fallback

In `--dev` mode, the server proxies to Vite for HMR. **If Vite is not running, it auto-falls back to serving the pre-built `dist/client/`.** This means `pi-dashboard start --dev` always works — no 502 errors. The fallback is silent; you only notice because HMR stops working.

If client changes don't appear in dev mode → check that Vite is actually running. The dev server should be on a different port (typically 5173).

## Fault-tolerant restart

- `POST /api/restart` waits for the old server to exit, starts a new one, verifies health.
- Body `{"dev": true|false}` switches modes mid-flight.
- `pi-dashboard stop` kills stale processes holding the ports (via `lsof`), not just the PID file. So if the PID file is stale but a zombie holds the port, `stop` still cleans up.

### Single restart path (don't bypass)

`pi-dashboard restart` (CLI) probes `isDashboardRunning(port)` and **delegates to `/api/restart`** when the dashboard is up. Only when no dashboard is running does it fall back to local `cmdStop` + `cmdStart`. Why this matters:

- Server broadcasts `server_restarting { reason, quiesceMs }` to every connected pi bridge before exiting.
- Bridges suppress their auto-start spawn step for the quiesce window (5 s for restart, 60 s for shutdown).
- This prevents a race where a bridge auto-starts a new server before the orchestrator can launch the replacement.

**Don't bypass `/api/restart` with manual `kill`** — you'll lose the broadcast and bridges will race.

## Common rebuild mistakes

| Mistake | Fix |
|---------|-----|
| Edited `src/server/` → ran `npm run build` | Server doesn't need build. Just `curl -X POST .../api/restart`. |
| Edited `src/extension/` → restarted server | Bridge code lives in pi sessions, not server. Need `npm run reload`. |
| Edited `src/client/` in dev mode → ran `npm run build && restart` | Vite HMR was already reloading it. The build was wasted. |
| Edited `src/shared/` → only restarted server | Shared types may also be imported by extension and client. Reload + rebuild if those import paths are affected. |
| Multi-component change → forgot one component | Use `npx tsx ./scripts/full-rebuild.ts` — does all three in correct order. |

## Reference: AGENTS.md Build & Restart Workflow

The canonical short form is in `AGENTS.md` section "Build & Restart Workflow" (lines 498–553). This reference document expands it with the why and the edge cases.
