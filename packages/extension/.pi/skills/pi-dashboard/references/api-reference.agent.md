# api-reference.md — index

Pull-only condensed map. Source: packages/extension/.pi/skills/pi-dashboard/references/api-reference.md. Endpoint → method+path, body, response. Base URL `http://localhost:{port}` (default 8000; config `~/.pi/dashboard/config.json`). JSON responses; mutations need `Content-Type: application/json`.

## WebSocket bus verbs
- Session/flow COMMAND verbs — prefer WS bus over REST; client `@blackbelt-technology/pi-dashboard-bus-client` (`scripts/dashboard-bus.ts`). Verbs = `BrowserToServerMessage` union; `plugin_config_write` excluded → stays REST. `spawn`/`resume` replies exact-correlated; other waits structural (session-id + status).

## Health & Status
- `GET /api/health` — liveness `{ ok, pid, uptime }`. `GET /auth/status` — `{ authenticated, authEnabled }`.

## Sessions
- `GET /api/sessions` — list all. Fields: `id, cwd, name?, source (tui|zed|tmux|dashboard|terminal|unknown), status (active|idle|streaming|ended), model?, thinkingLevel?, startedAt, endedAt?, tokensIn?, tokensOut?, cost?, currentTool?, gitBranch?, attachedProposal?, hidden?, activeFlowName?, flowStatus? (running|success|error|aborted), sessionFile?`.

## Session Control
- `POST /api/session/:id/prompt` — `{ text (required), images? [{ type:"image", data, mimeType }] }`. 400 no text, 404, 502 no bridge.
- `POST /api/session/:id/abort` — 200 / 404. `POST /api/session/:id/shutdown` — terminates pi process, not server.
- `POST /api/session/:id/rename` — `{ name }`. 400 missing name, 404.
- `POST /api/session/:id/hide` / `unhide` — 200 / 404.
- `POST /api/session/spawn` — `{ cwd }`. 400 missing cwd, 500. `POST /api/session/:id/resume` — `{ mode: "continue"|"fork" }`. 400, 404, 409 active/already resuming, 500.

## Flow Control
- `POST /api/session/:id/flow-control` — `{ action: "abort"|"toggle_autonomous" }`. 400, 404.

## Model Configuration
- `GET /api/models` — reachable model catalogue. `annotated=1` → +`excludedReason` (`no-credential`|`oauth-incompatible`). `{ object:"list", data:[{ id:"provider/modelId", provider, reasoning?, input?, contextWindow?, maxTokens?, cost?, excludedReason? }] }`. 503 pi-ai down. Do NOT parse `~/.pi/agent/providers.json` / `models.json`.
- `POST /api/session/:id/model` — `{ provider, modelId }`. 400, 404.
- `POST /api/session/:id/thinking-level` — `{ level }`. 400, 404.

## OpenSpec
- `POST /api/session/:id/attach-proposal` — `{ changeName }`; auto-names unnamed session. 400, 404.
- `POST /api/session/:id/detach-proposal` — 200 / 404.
- `GET /api/openspec-archive?cwd=CWD` — `data: [{ name, date, path }]`.

## Git Operations
- All git endpoints — localhost-only.
- `GET /api/git/branches?cwd=CWD` — `{ current, detached, branches:[{ name, isRemote, isCurrent }] }`.
- `POST /api/git/checkout` — `{ cwd, branch, stash? }`. 409 dirty → `{ success:false, dirty:true, files:[...] }`.
- `POST /api/git/init` — `{ cwd }`. `POST /api/git/stash-pop` — `{ cwd }` → `{ conflicts }`.

## Files & Browse
- All localhost-only.
- `GET /api/file?cwd=CWD&path=RELPATH` — file `{ type:"file", content }` | dir `{ type:"directory", entries }`.
- `GET /api/browse?path=PATH` — `{ current, parent, entries:[{ name, path, isGit, isPi }] }`.
- `GET /api/readme?cwd=CWD` — README.md content.

## Events
- `GET /api/events/:sessionId/:seq` — `{ eventType, timestamp, data }`.
- `GET /api/session-diff?sessionId=ID` — localhost-only. `{ isGitRepo, files:[{ path, changes:[{ type, timestamp, message }], gitDiff }] }`.

## Configuration
- `GET /api/config` — redacted secrets; localhost-only.
- `PUT /api/config` — partial merge; localhost-only. Any subset: `port, autoShutdown, shutdownIdleSeconds, spawnStrategy, tunnel`.

## Tunnel
- `GET /api/tunnel-status` — `{ status: active|inactive|unavailable, url, serverOs }`.
- `POST /api/tunnel-connect` — create connection.
- `POST /api/tunnel-disconnect` — `{ forget?: true }`. forget=true → releases reserved URL (`zrok2 delete name`) + clears `tunnel.zrok.reservedName`; forget=false/absent → URL stable next connect.

## Server Lifecycle
- `POST /api/shutdown` — localhost-only; flushes persistence; `{ ok:true }`.

## Pi Resources
- All localhost-only.
- `GET /api/pi-resources?cwd=CWD` — discovered extensions, skills, prompts.
- `GET /api/pi-resource-file?path=FILEPATH` — restricted to allowed locations.
- `GET /api/editors?path=CWD` — available editors. `POST /api/open-editor` — `{ path, editor, file?, line? }`.

## Pinned Directories
- `GET /api/pinned-dirs` — `{ success, data: ["/path"] }`.
