# chat-embed tester

Standalone, isolated consumer of `@blackbelt-technology/pi-dashboard-web/chat-embed`.
Proves the embed contract end-to-end against a **running dashboard**: connects
to `localhost:8000` over WebSocket, auto-grabs the most-recently-active session,
folds the live event stream through `useSessionState`, and mounts the real
`<ChatView>` at full fidelity inside the required providers + a bounded-height
scroll container.

It imports **only** the barrel surface + provider re-exports — exactly what a
sibling workspace package would do (see `docs/embedding-chat-view.md`).

## Run

Requires a dashboard already running on `localhost:8000` (or set `DASHBOARD_URL`).

```bash
cd examples/chat-embed-tester
npx vite                 # → http://localhost:5199/
# point at a different dashboard:
DASHBOARD_URL=http://localhost:8000 npx vite
```

Open http://localhost:5199/ — the app auto-selects the most-recently-active live
session; use the header dropdown to switch. `Abort` and `ask_user` responses are
wired back over the same socket.

## How it resolves worktree code

- Not an npm workspace (lives outside `packages/*`) → resolves deps from the
  hoisted root `node_modules`; no install step.
- `vite.config.ts` aliases `@blackbelt-technology/pi-dashboard-web/chat-embed`
  straight at the **worktree** barrel source, because the `node_modules`
  symlink for that package points at the main-repo checkout (which lacks this
  worktree's `exports` map and new files). Vite follows the barrel's relative
  imports through the rest of the 107-file subtree (all under `packages/`, so
  `@vitejs/plugin-react` transforms the raw `.tsx`).
- `/ws` + `/api` are proxied to the dashboard, so the browser sees one origin —
  no CORS config needed (`corsAllowedOrigins` defaults to `[]`).
- `app.css` re-imports the client's own `index.css` (Tailwind v4 + full theme
  variables) and adds a `@source` for the client subtree (Vite root differs).

## What it validates

- Subpath barrel imports resolve and type-check.
- `useSessionState` reduces the real WS stream (`event`, `event_replay` with
  reset, interactive requests) into the same `SessionState` the app produces.
- The full provider mount contract renders `ChatView` with no app shell.
- The virtualized transcript needs the documented bounded-height parent.
