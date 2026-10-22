# api-reference.md — index

Pull-only condensed map. Source: packages/extension/.pi/skills/pi-dashboard/references/api-reference.md. Endpoint → method+path, body, response. Base URL `http://localhost:{port}` (default 8000; config `~/.pi/dashboard/config.json`). JSON responses; mutations need `Content-Type: application/json`.

## WebSocket bus verbs
- Session/flow COMMAND verbs — prefer WS bus over REST; client `@blackbelt-technology/pi-dashboard-bus-client` (`scripts/dashboard-bus.ts`). Verbs = `BrowserToServerMessage` union; `plugin_config_write` excluded → stays REST. `spawn`/`resume` replies exact-correlated; other waits structural (session-id + status).

## UI routes (browser)
- Prefix with `BASE`. Sessions: `/session/:id`, `/session/:id/diff`, `/session/:id/editor`. Folders: `/folder/:encodedCwd`, `.../openspec`, `.../openspec/specs`, `.../openspec/:changeName/:artifactId`, `.../openspec/archive[/:entry[/:artifact]]`.
- Session id: full id from `GET /api/sessions`; unique prefix >= 8 chars (case-insensitive) converges to the full id; shorter/unknown → inline "Session not found" (no redirect), ambiguous → candidate links. Archived: `/session/<full id>?archived=1` only (no prefix).
- `?embed=1` → no session list (sticky per tab until `?embed=0`). `uiUrl` / `diffUrl` per session row; base = matching configured origin/tunnel, else admitted `Host`, else `http://localhost:<port>` (https proxy not in `publicBaseUrls` → `http://`).
- `:encodedCwd` = base64url UTF-8 path, no `=`: `printf %s "$CWD" | base64 | tr '+/' '-_' | tr -d '=\n'`. Other params `encodeURIComponent`. No credentials in UI URLs.

## Health & Status
- `GET /api/health` — liveness `{ ok, pid, uptime }`. `GET /auth/status` — `{ authenticated, authEnabled }`.

## Sessions
- `GET /api/sessions` — list all; optional `?id=` (single value; exact or >= 8-char prefix, case-insensitive; repeated → 400). Fields: `uiUrl, diffUrl` (absolute browser links, never stored), `id, cwd, name?, source (tui|zed|tmux|dashboard|terminal|unknown), status (active|idle|streaming|ended), model?, thinkingLevel?, startedAt, endedAt?, tokensIn?, tokensOut?, cost?, currentTool?, gitBranch?, attachedProposal?, hidden?, activeFlowName?, flowStatus? (running|success|error|aborted), sessionFile?`.

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

## Access Provisioning
- Proposal only: writes no grant/config. In-memory, expires 10 min. Prefer the `project-access` skill.
- `POST /api/access/provision` — `{ projectRoot, lines:[{path, why?}] (≤32), remote?:["lan"|"internet"|"device"] }` → `data:{ requestId, status, projectRoot, lines:[{lineId, path, why, classification}], remote, expiresAt }`. Classification: `invalid|missing|forbidden|sensitive|in-root|covered|grantable`. Refusals `{success:false, error, reason?, requestId?, retryAfterMs?}`: 400 `empty|too-many-lines|invalid-request|invalid-root`; 409 `pending-exists|no-operator|prompting-disabled|report-mode`; 429 `capacity|rate-limited|cooldown`; 503 `disabled`.
- `GET /api/access/provision` — `data.requests` (pending). `GET /api/access/provision/:id` — status `pending|settled|dismissed|expired` + per-line `outcome` (`granted|rejected|changed|refused|failed`, remote `handed-off`); 404 after restart.
- `POST /api/access/provision/:id/settle`, `POST /api/access/provision/dismiss-all` — operator-only (`403 no-capability`); skills never call.
