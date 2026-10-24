# api-reference.md — pi-dashboard REST index

Pull-only condensed map. Source: packages/claude-plugin/skills/pi-dashboard-control/references/api-reference.md. REST endpoint list for pi-dashboard server (default `http://localhost:8000`, config `~/.pi/dashboard/config.json`).

Conventions: JSON responses; mutations need `Content-Type: application/json`. Localhost-only marked (LO).

## UI routes (browser)
- Prefix with `BASE`. Sessions: `/session/:id`, `/session/:id/diff`, `/session/:id/editor`. Folders: `/folder/:encodedCwd`, `.../openspec`, `.../openspec/specs`, `.../openspec/:changeName/:artifactId`, `.../openspec/archive[/:entry[/:artifact]]`.
- Session id: full id from `GET /api/sessions`; unique prefix >= 8 chars (case-insensitive) converges to the full id; shorter/unknown → inline "Session not found" (no redirect), ambiguous → candidate links. Archived: `/session/<full id>?archived=1` only (no prefix).
- `?embed=1` → no session list (sticky per tab until `?embed=0`). `uiUrl` / `diffUrl` per session row; base = matching configured origin/tunnel, else admitted `Host`, else `http://localhost:<port>` (https proxy not in `publicBaseUrls` → `http://`).
- `:encodedCwd` = base64url UTF-8 path, no `=`: `printf %s "$CWD" | base64 | tr '+/' '-_' | tr -d '=\n'`. Other params `encodeURIComponent`. No credentials in UI URLs.

## Health & Status
- `GET /api/health` → `{ok, pid, uptime}`.
- `GET /auth/status` → `{authenticated, authEnabled}`.

## Sessions
- `GET /api/sessions` → `{success, data: [session]}`; optional `?id=` (single value; exact or >= 8-char prefix, case-insensitive; repeated → 400).
- Session fields: `uiUrl`, `diffUrl` (absolute browser links, never stored), `id`, `cwd`, `name?`, `source` (`tui|zed|tmux|dashboard|terminal|unknown`), `status` (`active|idle|streaming|ended`), `model?`, `thinkingLevel?`, `startedAt`, `endedAt?`, `tokensIn?`, `tokensOut?`, `cost?` (USD), `currentTool?`, `gitBranch?`, `attachedProposal?`, `hidden?`, `activeFlowName?`, `flowStatus?` (`running|success|error|aborted`), `sessionFile?`.

## Session control (`:id` = session id)
- `POST /api/session/:id/prompt` body `{text, images?}`; images `{type:"image", data:base64, mimeType}`. 200 / 400 no text / 404 / 502 no bridge.
- `POST /api/session/:id/abort` `{}`. 200 / 404.
- `POST /api/session/:id/shutdown` `{}` (kills pi process, not server). 200 / 404.
- `POST /api/session/:id/rename` `{name}`. 200 / 400 / 404.
- `POST /api/session/:id/hide` and `/unhide` `{}`. 200 / 404.
- `POST /api/session/spawn` `{cwd}`. 200 `{data:{message}}` / 400 / 500.
- `POST /api/session/:id/resume` `{mode: "continue"|"fork"}`. 200 / 400 / 404 / 409 (active or resuming) / 500.
- `POST /api/session/:id/flow-control` `{action: "abort"|"toggle_autonomous"}`. 200 / 400 / 404.

## Model config
- `GET /api/models` → `{object:"list", data:[{id:"provider/modelId", provider, reasoning?, input?, contextWindow?, maxTokens?, cost?, excludedReason?}]}`. Reachable only by default; `?annotated=1` adds `excludedReason` (`no-credential|oauth-incompatible`). 503 if pi-ai unavailable.
- Do NOT parse `~/.pi/agent/providers.json` or `models.json` for catalogue (roles/presets only; fails silently).
- `POST /api/session/:id/model` `{provider, modelId}`. 200 / 400 / 404.
- `POST /api/session/:id/thinking-level` `{level}`. 200 / 400 / 404.

## OpenSpec
- `POST /api/session/:id/attach-proposal` `{changeName}` (auto-names session). 200 / 400 / 404.
- `POST /api/session/:id/detach-proposal` `{}`. 200 / 404.
- `GET /api/openspec-archive?cwd=` → `{data:[{name, date, path}]}`, path `openspec/changes/archive/<date>-<name>`.

## Git (all LO)
- `GET /api/git/branches?cwd=` → `{current, detached, branches:[{name, isRemote, isCurrent}]}`.
- `POST /api/git/checkout` `{cwd, branch, stash}`. 200 `{stashed}` / 409 `{dirty:true, files}`.
- `POST /api/git/init` `{cwd}`.
- `POST /api/git/stash-pop` `{cwd}` → `{conflicts}`.

## Files & browse
- `GET /api/file?cwd=&path=` (LO) → `{type:"file", content}` or `{type:"directory", entries}` (dirs end `/`).
- `GET /api/browse?path=` (LO) → `{current, parent, entries:[{name, path, isGit, isPi}]}`.
- `GET /api/readme?cwd=` (LO).

## Events & diff
- `GET /api/events/:sessionId/:seq` → `{eventType, timestamp, data}`.
- `GET /api/events/stream?session=ID,…&types=T,…` → SSE, never ends. `ready`, then open questions, then live: `session_added`, `status {from?,to}` (changes only), `session_removed`, `question_opened {questionId, questionType, preview, sessionLabel}`, `question_closed {reason: answered|removed}`. `: ping` every 20 s. Unknown type → 400. observe; visibility = session list. Follow it with the `pi-dashboard-watch` skill.
- `GET /api/session-diff?sessionId=` (LO) → `{isGitRepo, files:[{path, changes:[{type, timestamp, message}], gitDiff}]}`.

## Configuration
- `GET /api/config` (LO, secrets redacted).
- `PUT /api/config` (LO, partial merge): `port`, `autoShutdown`, `shutdownIdleSeconds`, `spawnStrategy` (`headless`), `tunnel.enabled`.

## Tunnel
- `GET /api/tunnel-status` → `{status: active|inactive|unavailable, url, serverOs}`.
- `POST /api/tunnel-connect`.
- `POST /api/tunnel-disconnect` body `{forget?: true}`. `forget:true` → `zrok2 delete name` + clears `tunnel.zrok.reservedName`. Default keeps reserved URL.

## Server lifecycle
- `POST /api/shutdown` (LO) → `{ok:true}`; flushes persistence.

## Pi resources (LO)
- `GET /api/pi-resources?cwd=` (extensions, skills, prompts).
- `GET /api/pi-resource-file?path=` (restricted locations).
- `GET /api/editors?path=`.
- `POST /api/open-editor` `{path, editor, file, line}`.

## Pinned dirs
- `GET /api/pinned-dirs` → `{data: [path]}`.

## Open questions
- Scope: all open `ask_user` questions of visible sessions (incl. hidden, headless, automation, goal-driver). Ids opaque, stable across bridge reconnect. Unseen id → 404. Reads: `observe` tier; answers: `control` tier. Not MCP tools.
- `GET /api/questions` → newest first; rows: `id, sessionId, sessionLabel, changeName, preview, type, origin?, askedAt, briefStatus`.
  - `origin`: `file` (access prompt), `chat-gateway`, `widget-bar`.
  - `briefStatus`: `provided|pending|ready|failed|unavailable`.
- `GET /api/questions/:id` → full: `question, options, brief (briefLabel), snapshot, answerable` (false for file-access). 404.
- `POST /api/questions/:id/answer` body exactly one of `{answer}` or `{cancelled:true}`.
  - Encoding: confirm `"true"|"false"`; select = option; multiselect = JSON array (`"[]"` ok, ≠ cancel); input/editor = string (empty ok); batch = JSON array one per sub-question. Text only.
  - 200 `{transmitted}` (false = bridge unreachable, re-post ok). 400 invalid/both/neither. 403 file-access or tier < control. 404 unknown/not visible/answered > 10 min ago/pre-restart. 409 `{error:"answered"}` (transmitted < 10 min).
  - One answer per question across route, chat, dialog.
- `POST /api/questions/:id/summarize` `{}` → regenerate non-generated brief via `@fast`. 200 / 404 / 409 (answered or already generated) / 502 (fail/timeout) / 503 (`@fast` unresolved). Current brief kept on failure.
