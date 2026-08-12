# session-api.ts — index

REST wrappers for session control. Exports `registerSessionApi(fastify, deps)`. Routes: `/api/session/:id/{prompt,abort,shutdown,rename,hide,unhide,resume,flow-control,model,thinking-level,attach-proposal,detach-proposal}` and `/api/session/spawn`. Tags user-resume intent; handles fork-empty-session degrade.

`POST /api/session/:id/shutdown` delegates to `browserGateway.shutdownSession(id)` — the SAME body the browser `shutdown` message runs. As a parallel implementation it omitted `setLiveness(closedReason:"manual")` (#449: REST-closed sessions came back as cold-start recovery candidates) and killed headless-only, leaking a tmux-spawned `pi` after the WS path was fixed (#452). See change: fix-tmux-session-shutdown-leak (task 7.4).
