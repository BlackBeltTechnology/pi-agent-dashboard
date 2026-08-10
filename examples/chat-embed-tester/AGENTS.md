# DOX — chat-embed-tester

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `INTEGRATION.md` | Exhaustive guide embedding pi-dashboard live agent chat (real `ChatView` + headless `useSessionState`) into a separate React app outside the monorepo. Covers every dependency, build setting, provider mount contract, WebSocket protocol, complete working example. Public surface = subpath export `@blackbelt-technology/pi-dashboard-web/chat-embed`. Terse in-repo contract at `docs/embedding-chat-view.md`. |
| `README.md` | Standalone isolated consumer of `@blackbelt-technology/pi-dashboard-web/chat-embed`. Proves embed contract against a running dashboard: connects `localhost:8000` over WebSocket, auto-grabs most-recently-active session, folds live event stream through `useSessionState`, mounts real `<ChatView>` in required providers + bounded-height scroll container. Imports only barrel surface + provider re-exports. Requires dashboard on `localhost:8000` (or `DASHBOARD_URL`). |
