# team-plugin.md — team plugin index

Pull-only condensed map. Source: docs/team-plugin.md. AI Team Phase 1: persistent per-user agents from shared + private personas. See change: `add-team-plugin`.

## Purpose
- Agent = persona (avatar, role, instructions, model) + target + user → one resumable pi session.
- Phase 1 only. No agent-to-agent delegation. `role: "leader"` = badge.

## Packages
- `packages/team-plugin`: id `team`, priority 100. REST `/api/plugins/team/*`.
- `packages/team-app`: Vite SPA → `dist/app` via `scripts/build-app.mjs`.
- Claim `sidebar-folder-section` → `FolderTeamSection`. Host via `HostPort`.

## Data layout
- `TEAM_HOME`: env `PI_TEAM_HOME` > config `teamHome` > `~/.pi/dashboard/team`.
- `personas/<slug>.json`; `users/<uk>/personas/<slug>.json`.
- `users/<uk>/conversations/<t>/<scope>-<slug>/<c>.json`.
- `users/<uk>/workspace/` = cwd when `t = _ws`. `users/<uk>/runtime/…/persona.md`.
- `projects.json` (schemaVersion 1).
- `uk` = `hex(sha256(iss+"\0"+sub)).slice(0,32)`; local = `local`.
- Slug `^[a-z0-9][a-z0-9-]{0,39}$`. `c` = 22-char base64url.
- Paths `realpath`-canonicalised, asserted under `TEAM_HOME`. Atomic tmp+rename.

## Modes + admin
| Mode | When | Admin | `bash` personas |
|---|---|---|---|
| multi-user | OIDC active | config `admins` | rejected on write |
| single-user | identity inactive | local operator | shared only, **unconfined** |

- `access.ts`: `createAccess`, `callerOf(request)`; null ⇒ 401.
- Shared write = admin. Private write/read = owner (foreign ⇒ 404).

## Config keys
`admins`, `skillCatalog`, `idleMinutes` (30), `maxConversations` (50), `maxLiveSessions` (10), `teamHome`, `projects`. Unknown keys rejected.

## Personas
- Fields: `key`, `scope`, `owner?`, `name`, `description`, `avatar`, `role` (`leader`|`member`), `model?`, `instructions` (≤ 32768 bytes, untrusted), `tools`, `projects`, `skills?`, `forkedFrom?`.
- `projects`: 1..50 ids + `_ws`; default `["_ws"]`. Not allowed ⇒ `400 invalid_persona`.
- `skills`: names → `skillCatalog` paths. Unknown rejected.
- Caps: 50 private, 200 shared ⇒ `409 persona_limit`. Taken fork slug ⇒ `409 slug_taken`.

### `tools` presets
- `chat` = `read, grep, find, ls`. `files` = chat + `write, edit`. `full` = files + `bash`.
- `full`: single-user + shared only. Multi-user spawn ⇒ `409 persona_unavailable` (checked live).

## Targets
- **Projects**: config `projects[id] = { name, path, users, contextFiles? }`. Admin-authored, read-only. Path absolute dir, not overlapping `TEAM_HOME` or `~/.pi`.
- **Folder-enabled**: `TEAM_HOME/projects.json` (≤ 200). Immutable realpath. Config wins.
- **Own workspace**: `_ws`. Default target.
- `resolveFolder(cwd)`: realpath match, else longest containing. Worktrees never match.
- Invalid path ⇒ `team.project_invalid {projectId, reason}`.

## Conversations
One conversation = one pi session keyed `(uk, personaKey, t, c)`.

- **Create**: persona readable (`404 persona_not_found`); `t` in persona projects (`409 persona_not_in_project`); target allowed (`404 project_not_found`). Lock per `(uk, personaKey, t)`. Active < `maxConversations` (`409 conversation_limit`).
- **Live cap**: `maxLiveSessions` per user ⇒ `429 session_limit`.
- **Ensure**: single-flight per key.
  - Reuse live iff cwd, `principalOwner`, `pluginRefs.team` match.
  - Resume `sessionFile` if owner matches.
  - Else `409 conversation_unrecoverable`. Never silent empty restart.
- **Record**: `{ c, sessionId, sessionFile, runId, spawnToken, createdAt, startedAt, lastActivityAt, lastAgentEndAt, personaUpdatedAt, title?, archived, personaSnapshot }`.
- **Title**: rename (1–80 cp) ?? session name ?? first-prompt (≤ 60 cp) ?? `Beszélgetés · <date>`.
- **Archive**: graceful `abortSpawnedRun`; restore re-checks limit. **Delete**: end + remove record; session file kept.
- Spawn race: archive/delete aborts run, no resurrect ⇒ `409 conversation_archived`.
- Activity writes ≤ 1 per 10 s; `agent_end` always written.
- **Idle**: sweep 5 min; end past `idleMinutes` (`0` = off). `busy` never ended.
- Log `team.ensure`. No persona text, titles, paths.

## Persona injection
Base option, not per-turn handler.
- `appendSystemPrompt = [persona.md]` → `--append-system-prompt`.
- `noContextFiles` → `--no-context-files`. Project `contextFiles: true` appends root `AGENTS.md`/`CLAUDE.md` (≤ 64 KiB).
- `noProjectTrust` → `--no-approve`. `noMcp` → `--no-mcp` (all presets).
- `sessionDir = piSessionDirForCwd(T)` → `--session-dir`.
- Missing `persona.md` ⇒ `500 persona_render_failed`.
- Edits apply next start. `personaStale` + `POST .../restart`.

## Isolation guard
Logical isolation, same OS user.
- Guard verified at activation; else `503 guard_unavailable`.
- Extension sends `team_guard_ready {runId}`; no ready ⇒ abort. Env `PI_EXT_TEAM_RUN_ID`.
- **Name gate**: deny-first `tool_call`; names outside preset blocked (extension, MCP, `codemode`, `tool_search`). See change: `spawn-scope-no-mcp`.
- Pi < 1.0.4 rejects `--no-mcp` ⇒ spawn fails closed.
- **Path gate**: `read, write, edit, grep, find, ls` canonicalised, must lie in `T`. Unparseable ⇒ block.
- `~` and `scheme:` paths refused. `write`/`edit` refused under `.git`, `.pi`, `.claude`.
- Policy env `PI_EXT_TEAM_TOOLS`, `PI_EXT_TEAM_ROOT`. Fail-closed.
- Host-action prompts refused in `command-handler.ts` (`isTeamConfinedSession()`): `!cmd`, `/slash`, `/reload`, `/new`, `/model`, `/quit`. Plain text, `/compact` allowed.

## REST surface
`/api/plugins/team`, lowercase codes. `401` no principal. `t` = `?project=<id|_ws>`.

- `GET /me` → `{ uk, iss, sub, admin, mode }`. `GET /users` (admin, multi-user).
- `GET /projects`; `POST /projects/match` `{ cwds }` (never spawns); `POST /projects` (admin, `201`); `PATCH`/`DELETE /projects/:id` (folder-only).
- `GET`/`POST /personas`, `PUT`/`DELETE /personas/:key`, `POST /personas/:key/fork` `{ slug? }`. Delete → conversations `retired`.
- `GET /agents?t` → status, `activeCount`, `latest`, `personaStale`.
- `GET`/`POST /agents/:key/conversations?t`; `POST .../:c/session?t` ensure; `PATCH .../:c?t` `{ title?, archived? }`; `POST .../:c/restart?t`; `DELETE .../:c?t`.

- `@fastify/rate-limit`; `ROUTE_TIERS` + MCP classification per route.
- `GET /agents` never spawns.

## App delivery
- Default `/apps/team/`, same origin, host sign-in. No CORS, no extra Keycloak client.
- `GET /apps/team` → 308. Missing build ⇒ 503. Outside network guard.
- `AppHost` (`@blackbelt-technology/pi-dashboard-app-kit`): `host.api.fetch`, `host.api.wsUrl`, `host.setTitle`. Entry `./app`.
- Foreign origin: app-kit OIDC. Standalone: CORS, HTTPS (PKCE).
- Embedded host (`add-plugin-app-host`) deferred; folder menu opens `/apps/team/?project=<id>`.

## Trust boundary + known limits
- Same-origin: shared storage, shared XSS blast. Standalone for separation.
- `full` unconfinable; single-user only. Projects shared, no locking. Never point at secrets.
- `instructions` + `contextFiles` untrusted; guard enforces, not prompt.
- Session files visible to `pi --resume`; UI owner-filtered.
- Rollback: disable plugin; `TEAM_HOME` persists.
