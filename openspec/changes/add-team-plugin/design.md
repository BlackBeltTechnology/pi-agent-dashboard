## Context

Reference UX: Marveen's agents page — card grid with avatar, name, description, model
badge, running/online dots, "Beszélgetés" action (`marveen/web/index.html:412-470`,
`marveen/web/app.js:3511-3640`). Marveen agents are long-lived tmux processes; ours are
pi sessions that end and resume.

Host primitives used (plus one additive host change, D12):

- Plugin spawn: `SpawnSessionFn(opts: PluginSpawnOptions)` with `cwd, model, name,
  pluginRef, lifecycle, scope{tools,excludeTools,skills,extensions,extensionConfig},
  spawnToken, resume{sessionFile}`
  (`packages/dashboard-plugin-runtime/src/server/server-context.ts:171,537`);
  `onSessionResolved(sessionId, pluginRef)` (:105, carries no token — correlation is by a
  nonce inside our ref), `onSessionEnded` (:92), `onEvent(sessionId, event)` (:81),
  `abortSpawnedRun({sessionId?,spawnToken?,graceful?})` (:865), `assignSessionRef` (:505),
  `getSession`/`listAll` (:30-31). Trusted plugins only (`priority <= 100`,
  `packages/server/src/server.ts:2953`).
- Ownership: `pluginRef.principalOwner` is resolved per spawn token onto the session, also
  on resume (`packages/server/src/event-wiring.ts:1542-1584,1616-1649`), first writer wins
  (`server-context.ts:488-495`), persisted (`session-to-meta.ts:119,123`); the archive
  keeps `sessionFile` + owner (`session-archive.ts:70,268,278`).
- Owner gates the app relies on: every session-owned browser command (incl. subscribe) is
  owner-gated (`packages/server/src/pairing/browser-gateway.ts:1768-1791`); ticketed
  sockets carry a frozen principal (`server.ts:3592-3598`); REST principal from
  `request.principal` (`identity/resolver-hook.ts:90`), `LOCAL_OPERATOR` via
  `sessionPrincipalOf` (`identity/session-access.ts:48`). No role API exists.
- Companion-extension pattern: chat-gateway guard via `scope.extensions` +
  `extensionConfig` → `PI_EXT_<ID>_<KEY>` (`packages/chat-gateway/src/server/gateway.ts:607-617`,
  `src/guard/index.ts:116-128`).
- Get-or-create precedent: InvoiceBot `ensureAskSession`
  (`invoice-bot-dashboard/src/server/session-link.ts:471-581`, `runId` nonce `:353-367,481`,
  `cwd` check `:511,520`, lifecycle `:556`). A guard extension passed by `-e` that does not
  resolve is non-fatal to pi, so chat-gateway refuses to spawn without it
  (`packages/chat-gateway/src/server/gateway.ts:577-589`).
- pi prompt assembly: `appendSystemPrompt` renders as the `addendum` section and
  `contextFiles` as `project_context`, both from base options
  (pi `dist/core/system-prompt.js:17-20,95-98`). A `before_agent_start` handler that
  returns `systemPrompt` sets `forceSystemPrompt` (`dist/core/extensions/runner.js:1142`),
  and the dashboard bridge does so every turn
  (`packages/extension/src/dashboard-context-injector.ts:116`), so per-turn option edits
  by another extension are lost whenever the bridge runs first. Base options set by CLI
  flags (`--append-system-prompt <path>`, `--no-context-files`, pi `docs/cli.md:202,219`)
  are already in `event.systemPrompt` before any handler, so they survive in any order.
- `tool_call` fires for nested codemode/MCP calls too (pi `dist/core/extensions/types.d.ts:273-274,899`).
- `onEvent` is a global live + replay firehose with no owner gate
  (`packages/server/src/server.ts:1399-1405`, `event-wiring.ts:927-930`).
  Registered extension tools can be active independent of `--tools` (pi
  `docs/settings.md:40`, `docs/extensions.md:164`); codemode calls do not depend on the
  active tool set (pi `docs/mcp.md:204`).
- Embeddable chat: `@blackbelt-technology/pi-dashboard-web/chat-embed`
  (`packages/client/src/chat-embed/index.ts:16-35,71-103`, workspace-only; mount contract
  in `docs/embedding-chat-view.md`).

## Goals / Non-Goals

**Goals:** persistent per-user agents from shared + private personas, organised as project
teams with many conversations each; one app that runs embedded in the dashboard and
standalone at `/apps/team/` (D16); owner isolation of data and sessions; logical file confinement.

**Non-Goals:** org chart, delegation (Phase 2); Kanban, overview (Phase 3); schedules
(Phase 4); chat channels; avatar upload; OS/container sandbox; IdP role mapping; a
editing or removing config-defined projects from the dashboard (read-only there); per-project
read-only mode; write coordination between users sharing a project; the
IndexedDB replay cache of the dashboard client (team-app replays from the server on
reload).

## Decisions

**D1 — Two packages.** `packages/team-plugin` (public; manifest
`{id:"team", displayName:"AI Team", priority:100, server, configSchema, claims` = `sidebar-folder-section` + folder-actions-menu items (D17)`, apps` (D16)`}` plus
`extension/` = companion pi extension) and `packages/team-app` (private Vite + React SPA,
a sibling workspace so it may import the workspace-only `chat-embed`; its build is copied
into `team-plugin` and served by it, D14). Additive host
registry rows: `packages/shared/src/route-tiers.ts` and the MCP manifest denylist in
`packages/mcp-server-plugin`; plus the additive `scope` fields of D12.

**D2 — Modes, keys and paths.** *Multi-user mode* requires OIDC identity active. With
identity inactive the plugin runs in *single-user mode*: every admitted caller is the
local operator. Single-user mode only works where the host admits the app without a
credential (loopback, `trustedNetworks`, or same-host serving); a foreign origin is
refused by the host's network guard. User key `uk = hex(sha256(iss+"\0"+sub)).slice(0,32)`; local operator =
`local`. Persona key `"<scope>:<slug>"`, slug `^[a-z0-9][a-z0-9-]{0,39}$`. Target `t` =
a project id (same regex, D13) or `_ws` (the user's own workspace; `_` cannot start a slug,
so no collision). Conversation id `c` = 22-char base64url of 16 random bytes. Under
`TEAM_HOME` (config `teamHome`, default `~/.pi/dashboard/team`; env `PI_TEAM_HOME` wins,
for tests only):

```
personas/<slug>.json                          shared
users/<uk>/personas/<slug>.json               private
users/<uk>/conversations/<t>/<scope>-<slug>/<c>.json  one ConversationRecord each
users/<uk>/workspace/                         own workspace = cwd when t = _ws (shared by the user's agents)
users/<uk>/runtime/<scope>-<slug>/persona.md  rendered persona (outside every target)
```

Paths are built only from validated slugs + `uk` and canonicalised through the longest
existing ancestor's `realpath` (as `host-cwd-policy` does), then asserted under
`TEAM_HOME`. Writes are atomic (tmp + rename). One file per conversation plus the
per-conversation single-flight and the per-(user, persona, target) create lock (D5)
remove write races. A project's
session cwd is its validated realpath (D13), never under `TEAM_HOME`.

**D3 — Persona schema v1.**

```ts
interface Persona {
  schemaVersion: 1;
  key: string; scope: "shared" | "private";
  owner?: { iss: string; sub: string };          // private only
  name: string; description: string;             // 1..60, 0..280 Unicode code points
  avatar: { kind: "gallery"; id: string } | { kind: "initials" };
  role: "leader" | "member";                     // badge only in Phase 1
  model?: string;
  instructions: string;                          // markdown, <= 32768 UTF-8 bytes, untrusted
  tools: "chat" | "files" | "full";
  projects: string[];                            // 1..50 distinct: project ids and/or "_ws"; default ["_ws"]
  skills?: string[];                             // names from the admin skill catalog
  forkedFrom?: string;
  createdAt: string; updatedAt: string; updatedBy: string;
}
```

`skills` are names resolved server-side through config `skillCatalog: { [name]: path }`
(admin-controlled); unknown names are rejected, so a persona never chooses a code path.
Unknown fields are rejected on write; unknown `schemaVersion` files are skipped on read.
Caps: 50 private personas per user, 200 shared personas; a create beyond a cap answers
`409 persona_limit`. `projects` (decision 2026-10-04): an admin sets it on shared personas
(any project, configured or folder-enabled); the owner sets it on private ones (`_ws` + projects allowed for
them); unknown or (private) not-allowed ids ⇒ `400 invalid_persona`. On read, ids that are
no longer configured or allowed are ignored for visibility, the file is not rewritten.
Fork keeps the entries the forking user may use, else `["_ws"]`.

**D4 — Admin gate.** Multi-user: admin = principal listed in config `admins`.
Single-user: the local operator is admin. Shared writes require admin; private writes
require `owner == principal`; private reads are owner-only (foreign key ⇒ `404`).
`tools:"full"` is accepted only in single-user mode and only on shared personas; in
multi-user mode a `full` persona is rejected on write and listed as unavailable (it
would break isolation between users).

**D5 — Conversations** (decision 2026-10-04: many conversations per agent and target).
A conversation is one persistent pi session keyed `(uk, personaKey, t, c)`.

*Create* `createConversation(principal, personaKey, t)`:

1. Persona readable, else `404 persona_not_found`; `t` in the persona's effective
   `projects`, else `409 persona_not_in_project`; `t` allowed (D13), else
   `404 project_not_found`; path re-validated, else `409 project_unavailable`.
   Target dir `T` = project realpath or `users/<uk>/workspace/`.
2. Lock per `(uk, personaKey, t)`; active (non-archived) count `< maxConversations`
   (config, default 50), else `409 conversation_limit`.
3. Mint `c`, spawn fresh (step 6), wait (step 7), then write the record (step 8). No record
   on failure.

*Ensure* `ensureConversation(principal, personaKey, t, c)`:

1. Record exists for the principal, else `404 conversation_not_found` (another user's id
   answers the same); persona and target checks as in create step 1: a retired persona ⇒
   `404 persona_not_found`, a persona no longer assigned to `t` ⇒ `409
   persona_not_in_project`. Those conversations stay listed and can be archived or deleted,
   not continued.
2. Single-flight per `(uk, personaKey, t, c)`.
3. **Reuse** when the record's session is live, not ended, `cwd === T`,
   `principalOwner` equals the principal and `pluginRefs.team.{personaKey, project,
   conversationId}` match.
4. Else **resume** the recorded `sessionFile` when it exists and its persisted owner
   (live or archive) equals the principal.
5. Else `409 conversation_unrecoverable`, no spawn (a conversation is never silently
   restarted empty; the user archives or deletes it).
6. Spawn options: `cwd: T, model: persona.model, pluginRef: { team: { personaKey, project,
   conversationId: c, uk, runId: randomUUID() }, principalOwner }, lifecycle:
   { recover:false, finalizeOnSocketClose:true }, scope: { tools: preset(persona.tools),
   skills: catalogPaths(persona.skills), extensions:[teamExtensionPath], extensionConfig:
   { team: { persona: personaFilePath, root: T, tools: persona.tools } } }` (+ `resume`
   in step 4), `spawnToken` minted by the plugin (caller-supplied tokens are used verbatim,
   `server-context.ts:252-263`, as the goal supervisor does), and scope additions
   `appendSystemPrompt: [personaRuntimePath, ...projectContextFiles]`,
   `noContextFiles: true`, `noProjectTrust: true` (D6), `sessionDir: piSessionDirForCwd(T)`
   (D15). No `name`, so the dashboard auto-namer names the session (titles below). Before
   each spawn/resume the plugin renders `persona.md` from the current persona.
7. Wait for the session whose `pluginRef.team.runId` equals ours (the plugin subscribes to
   `onSessionResolved` once at activation and routes by `runId`), then for the team
   extension's ready signal (D7). 30 s overall. On timeout or missing ready signal:
   `abortSpawnedRun({ spawnToken })` with our minted token, respond `504 spawn_timeout` or
   `503 guard_unavailable`, write nothing.
8. Write the record `{ c, sessionId, sessionFile, runId, spawnToken, createdAt, startedAt,
   lastActivityAt, lastAgentEndAt, personaUpdatedAt, title?, archived, personaSnapshot:
   { name, description, avatar, role, model } }`; the snapshot renders a `retired` card.

*Titles*: `record.title` (user rename, 1–80 code points) ?? live or persisted session name
(auto-namer) ?? excerpt of the first user prompt (≤ 60 code points) ?? "Beszélgetés ·
<date>". To verify in 3.1: the auto-namer names a plugin-spawned session that has no
spawn `name`; if not, the excerpt is the fallback and the plugin sets the session name to
it after the first turn.

*Archive / delete*: `archived: true` ends a live session (graceful `abortSpawnedRun`) and
drops the conversation from the default list and the limit count; restore re-checks the
limit. Delete ends a live session and removes the record; the session file stays on disk
and is unreachable through the app.

Logged: `team.ensure {uk, personaKey, t, c, outcome: create|reuse|resume|timeout|unrecoverable,
sessionId}` — never persona text, titles or project paths.

**D6 — Persona injection at spawn.** The persona reaches the prompt as a base option,
not through a per-turn handler: `scope.appendSystemPrompt = [persona.md]` (rendered
outside the workspace) and `scope.noContextFiles = true` (no operator or parent-dir
`AGENTS.md`; pi discovery is all-or-nothing — agent dir + cwd + parents, pi
`docs/configuration.md` "Context files" — so it is always off). For a project with
`contextFiles: true`, the plugin appends the project root's `AGENTS.md` and `CLAUDE.md`
(each only if it resolves inside the root, is a regular file and is ≤ 64 KiB) as further
`appendSystemPrompt` entries after `persona.md`; nested-directory context files are not
loaded. They are untrusted input like persona instructions. `scope.noProjectTrust =
true` (`--no-approve`) skips trust-gated project resources (`.pi/settings.json`,
`.pi/mcp.json`, `.pi/extensions|skills|prompts`, `.pi/SYSTEM.md`, `.agents/skills`; pi
`docs/security.md`): the dashboard bridge auto-trusts a dashboard-spawned headless
session's cwd (`packages/extension/src/project-trust.ts`), and a CLI override takes
precedence over every extension's `project_trust` decision. Applied to every team
session, `_ws` included. All of these are in `event.systemPrompt` before any `before_agent_start` handler, and pi renders
the addendum before the cwd section, so the bridge's forced splice keeps them in either
load order. The bridge splices at the last `\nCurrent working directory: `
(`packages/extension/src/dashboard-context-injector.ts:80-97`); the renderer neutralises
that literal inside persona text (zero-width joiner after the newline) so untrusted
instructions cannot move the anchor. The renderer verifies `persona.md` exists right
before spawn (pi treats a missing path as literal text); a missing file aborts the ensure with
`500 persona_render_failed` and no spawn. The operator's
`~/.pi/agent/SYSTEM.md`, if present, still replaces the preamble of every session on the
host; it is an operator-wide setting and documented as such. Persona edits apply on the
next session start: `GET /agents` flags `personaStale` when `persona.updatedAt >
record.personaUpdatedAt`, and `POST /agents/:key/restart` ends the live session while
keeping the record, so the next open resumes the same transcript with the new persona. A
test asserts on the provider-bound prompt (not `getSystemPrompt()`) with the bridge
loaded. Alternative rejected: per-turn injection in the team extension — order-dependent
against the bridge.

**D7 — Isolation (logical).** The guard must be present: the plugin verifies the
extension file exists at activation (routes answer `503 guard_unavailable` otherwise), and
the extension sends a `team_guard_ready` plugin message on session start
(`dashboard:plugin-message` → `plugin_pi_message`, `packages/extension/src/bridge.ts:3371-3390`)
that the plugin receives with `registerPiHandler`
(`packages/server/src/server.ts:1381-1385,2942-2945`); `onEvent` cannot carry it. A session
without the ready signal is aborted. Three layers:

- Spawn `scope.tools` preset: `chat` = `read, grep, find, ls`; `files` = + `write, edit`;
  `full` = + `bash`.
- Name gate (deny-first `tool_call`): any tool whose name is not in the preset is
  blocked before execution — this covers extension tools (`update_roles`, `canvas`, kb,
  browser, MCP) and `codemode` / `tool_search`.
- Path gate: path arguments of `read, write, edit, grep, find, ls` are canonicalised
  (longest existing ancestor + `realpath`, so symlinks resolve) and must lie inside the
  target root `T` (project realpath or the user's own workspace, passed as `root`); an absent
  path argument means the cwd = `T`. Unparseable policy or path ⇒ block. A symlink inside
  a project that points out of it is therefore blocked.

`full` (bash) cannot be confined; it exists only in single-user mode (D4) and is badged
"unconfined".

**D8 — Lifecycle and status.** Conversation status: `sleeping` (record, no live session),
`running` (live, idle), `busy` (live, streaming). Agent (card) status per target:
`retired` (persona deleted; rendered from the newest record's `personaSnapshot`),
`unavailable` (a `full` persona in multi-user mode, or `unassigned`: no longer in the
persona's `projects` while the user has active conversations there), else the most active
of its active conversations (`busy` > `running` > `sleeping`), else `new` (no active
conversation). `personaStale` per conversation when `persona.updatedAt >
record.personaUpdatedAt`; the card is stale when any active conversation is.
`onEvent` is filtered to session ids in this plugin's records and to live (non-replay)
events; `lastAgentEndAt` and `lastActivityAt` are persisted in the record so idleness
survives a server restart. `busy` is read from the live session status, and `busy`
sessions are never ended. A sweep runs every 5 minutes; sessions idle longer than
`idleMinutes` (default 30, `0` = off) get a graceful `abortSpawnedRun`, so a session ends
between `idleMinutes` and `idleMinutes + 5` minutes after its last run. Live pi processes
are bounded by idle ending, not by the conversation count. A target whose project was
removed from config (or is no longer allowed for the user) is shown unavailable in the
project selector; its records are kept.

**D9 — REST surface** (`/api/plugins/team`, JSON, lowercase error codes, `401` without a
principal in multi-user mode; `t` = `?project=<id|_ws>`, required where listed):

| Method + path | Purpose |
|---|---|
| `GET /me` | `{ uk, iss, sub, admin, mode }` |
| `GET /projects` | projects allowed for the caller: `{ id, name, contextFiles, available, source }` (+ `path`, `users` for admins only) |
| `POST /projects/match` | body `{ cwds: string[] }` (1–200) → per cwd `{ cwd, project: { id, name, available, agents, active } \| null, enableable }` (D17); only projects allowed for the caller; never spawns |
| `POST /projects` | enable a folder (admin; operator in single-user) body `{ path, name?, users?, contextFiles? }` → `201 { id }`; `409 project_exists` when the realpath already is a project |
| `PATCH /projects/:id` | folder-enabled only: `{ name?, users?, contextFiles? }`; config project ⇒ `409 project_readonly` |
| `DELETE /projects/:id` | folder-enabled only (disable); records kept, conversations become `unavailable`; config project ⇒ `409 project_readonly` |
| `GET /users` | admin, multi-user: team users seen so far `{ iss, sub, email?, name?, lastSeenAt }` (recorded on `GET /me`) |
| `GET /personas` | shared + caller's private |
| `POST /personas` | create (`scope` decides gate) |
| `PUT /personas/:key` | update |
| `DELETE /personas/:key` | delete; its conversations become `retired` |
| `POST /personas/:key/fork` | body `{ slug? }`; default = source slug, then `-2`, `-3`… (base truncated so the result fits 40 chars); explicit taken slug ⇒ `409 slug_taken` |
| `GET /agents?t` | personas for target `t` (D8): status, `activeCount`, `latest {id, title, status, lastActivityAt}`, `personaStale`, `unassigned` (one `listAll` pass, never spawns) |
| `GET /agents/:key/conversations?t&archived=` | caller's conversations, newest activity first: `{ id, title, status, lastActivityAt, archived, personaStale }` |
| `POST /agents/:key/conversations?t` | create (D5) → `{ id, sessionId }` |
| `POST /agents/:key/conversations/:c/session?t` | ensure (D5) → `{ sessionId }` |
| `PATCH /agents/:key/conversations/:c?t` | body `{ title?, archived? }` |
| `POST /agents/:key/conversations/:c/restart?t` | end live session, keep record (next open resumes with the current persona) |
| `DELETE /agents/:key/conversations/:c?t` | end live session, delete record (session file kept) |

Encapsulated scope with `@fastify/rate-limit` using mcp-server-plugin's values
(`max: 100_000`, `timeWindow: "1 minute"`, `allowList: ["127.0.0.1","::1"]`,
`packages/mcp-server-plugin/src/server/routes.ts:113-117`); `ROUTE_TIERS` row + MCP classification per
route.

**D10 — SPA.** Vite + React + wouter on `@blackbelt-technology/pi-dashboard-app-kit`.
Two hosts (D16): embedded in the dashboard content area (`/team/*`, `/folder/:encodedCwd/team/*`)
and standalone at `/apps/team/`; routes are
relative to `host.basePath` (wouter `base`); the standalone build's Vite `base` is
`/apps/team/` in every deployment (D14). Routes
(all carry `?project=<id|_ws>`): `/` (Csapat grid), `/agent/:key` (conversation list; on
wide screens it opens the newest), `/agent/:key/c/:c` (conversation), `/personas/new`,
`/personas/:key`, `/auth/callback` (standalone only). **Project selector** = the app's `HeaderContext` (D16)
(APG menu button): own workspace + allowed projects (`GET /projects`), unavailable ones
disabled with a reason, a plain label when only the own workspace exists; remembered in
`localStorage` (`team:target`); start = last selected → first available project → `_ws`.
The grid lists `GET /agents?t`; a card shows status, "N beszélgetés · <relative time>",
"Beszélgetés" (newest active conversation, or create the first) and a labelled "+" (new
conversation). The conversation view is two panes from 1024 px (list | chat) and two
routes below. Opening a conversation: `POST .../conversations/:c/session` → browser-scope
ticketed socket (the host owner-gates the subscribe) → headless `useSessionState` →
`ChatView` (with a `ToolContext` `{ cwd, sessionId, session, send }` built from the reduced
state and the socket's `send`) + `CommandInput` (its `onSend` sends the prompt command
over the same socket) inside a bounded-height pane, mounted with `ThemeProvider`,
`UiPrimitiveProvider` (`createUiPrimitiveRegistry`), `MobileProvider`,
`SessionAssetsProvider`, `DisplayPrefsProvider`, `ApiContext.Provider` (the dashboard
base) and a wouter `Router` — standalone only; embedded, the dashboard's providers are
already present and are not re-provided. Cards and the conversation list poll every 5 s while
visible. HU default,
EN toggle, identical key sets. Original SVG avatar gallery; no Marveen assets. Screens
are mocked with `frontend-mockup-loop-dashboard` before implementation.

**D12 — Additive host change: four spawn-scope fields.** `PluginSpawnOptions.scope` gains
`appendSystemPrompt?: string[]` (absolute paths → repeated `--append-system-prompt`),
`noContextFiles?: boolean` (→ `--no-context-files`), `noProjectTrust?: boolean`
(→ `--no-approve`) and `sessionDir?: string` (absolute path → `--session-dir`; relative,
empty or NUL ⇒ dropped), mapped by
`pluginSpawnToSessionOptions` (`packages/dashboard-plugin-runtime/src/server/server-context.ts:374`)
→ `SessionFlags` → `sessionFlagsToArgv`, sanitized like the other argv fields (relative
paths dropped: pi treats a non-existent path as literal text). cwd-policy composition
(`packages/server/src/spawn-process/cwd-policy.ts:121-145`) does not touch them, as with
`extensions`. Absent fields ⇒ byte-identical argv. Compatibility: additive optional
fields; older plugins unaffected. Rollback: revert the mapper rows.

**D13 — Projects.** Two sources (decisions 2026-10-04): admin-authored plugin config
(below, read-only in the dashboard) and folders enabled from the dashboard (D17). Config:

```ts
projects?: { [projectId: string]: {            // id: slug regex (D2)
  name: string;                                // 1..60 code points, shown to users
  path: string;                                // absolute
  users: "*" | { iss: string; sub: string }[]; // "*" = every authenticated user
  contextFiles?: boolean;                      // default false (D6)
} }
```

Validation at activation and again on every ensure (paths can change underneath):
`path` absolute, `realpath` exists and is a directory, accepted by the host cwd policy, and
neither contains nor lies inside `TEAM_HOME` or the pi agent dir (`~/.pi`). Otherwise
a project at `~` would expose every user's personas and transcripts. An invalid entry is
logged (`team.project_invalid {projectId, reason}`, no path) and treated as unavailable;
activation does not fail. Single-user mode ignores `users` (the operator may use every
valid project). Which personas a project shows is decided by each persona's `projects`
(D3), not by the project entry. Multi-user: allowed iff `users === "*"` or the principal's `(iss, sub)` is
listed. Projects are shared trees: all allowed users' agents read them and, with the
`files` preset, write them concurrently; no locking (non-goal). Changing a project's
`path` makes existing records' `cwd` mismatch, so D5 step 3 does not reuse and step 4
resumes the transcript in the new root.

**D11 — Deployment.** Default: none beyond enabling the plugin (D14). Optional standalone:
the same `dist/` served under `/apps/team/` by a minimal static-server Dockerfile (pinned
digest) + runtime `config.json` with `dashboardUrl`, the origin in `cors.allowedOrigins`,
and a realm public client with an audience mapper (app-kit OIDC). E2E extends
`docker/compose.test.identity.yml`: same-origin first (no extra service), plus the
standalone app service.

**D14 — Serving: same origin by default** (decision 2026-10-04).

- Packaging: `team-app` builds with base `/apps/team/`; `team-plugin` copies the build to
  `dist/app/` at pack time, so the npm package and the Electron bundle carry it (this is
  the 1.3 Electron decision).
- Routes on `ctx.fastify` (plugins get the root instance, as `roles-plugin` mounts
  `/api/roles`): `GET /apps/team` → `308 /apps/team/`; `GET /apps/team/*` → the file under
  `dist/app/` when one exists (realpath-confined to `dist/app/`, no directory listing,
  hashed `assets/*` `Cache-Control: immutable`, `index.html` `no-store`), else `index.html`
  (deep links). Build missing ⇒ `503` text page, logged once. Explicit routes win over the
  host's SPA `setNotFoundHandler` (`packages/server/src/server.ts:2673-2704`); the
  dashboard client has no `/apps` route, and a test pins both directions.
- Admission: `/apps/*` is outside the network guard's jurisdiction (`/api`, `/v1`,
  `/editor`, `/live`; `openspec/specs/trusted-networks/spec.md`), exactly like the
  dashboard's own static UI, so the page and assets load unauthenticated. They carry no
  data: every data call stays under `/api/plugins/team/*` (guard, identity, owner checks)
  and the socket keeps its ticket. Static routes need no `ROUTE_TIERS` row (`/api/*` only).
- Endpoint: no `config.json` is served ⇒ app-kit same-origin default (`extract-standalone-
  app-kit` D3, `allowMissing`).
- Sign-in: the host's dashboard login seam, not a second OIDC client:
  `startSignIn` → the identity plugin's `loginUrl?returnTo=/apps/team/…&challenge` →
  handoff → `tokenUrl` → in-memory bearer (`packages/client/src/lib/identity/
  dashboard-login.ts`, `login-session.ts`); reload re-runs silent sign-in. No new
  Keycloak client, no `oidc-client-ts` store, so no storage-key clash with the dashboard.
  To verify first (task 5.2): `safeReturnTo` accepts the `/apps/team/` prefix and the
  login page returns there; if it does not, the fallback is the app-kit OIDC flow with the
  dashboard's client and one more redirect URI.
- Same origin as the operator dashboard: shared `localStorage`/`sessionStorage`/IndexedDB
  and service-worker scope. `sw.js` is fetch pass-through (no navigation fallback), so it
  cannot serve the dashboard page for `/apps/team/`. App storage keys are prefixed
  `team:` (`add-plugin-app-host` D7). XSS in either app reaches both; both render agent output through the same
  `ChatView`, so this adds no new class of risk.
- Standalone stays possible with the same build (D11).

**D16 — Two hosts: embedded in the dashboard and standalone** (decision 2026-10-04,
revised 2026-10-04 to `add-plugin-app-host`'s board-style embedding). One app source, two
entries, environment only through app-kit's `AppHost`:

- Library entry `team-app/app` (default export `defineDashboardApp({ id: "team", title:
  "AI Team", App, HeaderContext })`; no `createRoot`, no global CSS on `html`/`body`/
  `:root`); peer deps `react`, `react-dom`, `wouter` at the dashboard's ranges. It is
  embedded **like the OpenSpec board** (`shell-overlay-route` `presentation: "content"`:
  content area beside the sidebar, sidebar and its header visible; mobile = `MobileShell`
  detail panel). `team-plugin`'s client entry makes two claims, each rendering
  `<EmbeddedApp app={teamApp} basePath … onBack pluginContext>` (`dashboard-plugin-runtime`):
  - **Global** `/team/*`, `depth: 1` (Back → `/`), `basePath: "/team"`; free project
    selector, own workspace reachable.
  - **Folder** `/folder/:encodedCwd/team/*`, `depth: 2`, `parentPath: "/folder/:encodedCwd"`,
    `folderParam: "encodedCwd"`; project locked to the folder's project (D17).
  - Top bar = `EmbeddedApp`'s board-style bar: Back · breadcrumb (`AI Csapat`, or
    `<folder> › AI Csapat`) · `HeaderContext` · actions (`setActions`, ≤ 2 inline: folder
    view "Teljes csapat" → `/team/?project=<id>`) · Open standalone (`/apps/team/…`, named
    window).
  - Global entry: a sidebar row "Csapat →" above the folders, through a **new global
    sidebar-entry slot requested from `add-plugin-app-host`** (proposed id
    `sidebar-global-entry`, state-only like the folder entries). Until it exists, `/team`
    is reached from the folder view's "Teljes csapat" and deep links.
- Standalone entry `index.html` + `standalone.tsx`: `createStandaloneHost({ appId: "team",
  basePath: "/apps/team" })` → `AppHostProvider` → `StandaloneBar` + `App` (served per D14,
  or deployed per D11).
- Header split. `HeaderContext` = the project selector, in `EmbeddedApp`'s top bar
  (embedded; locked chip in the folder claim) or in `StandaloneBar` (standalone). Sign-in, user chip, sign-out, HU/EN and
  theme toggles render only standalone; embedded follows the dashboard's identity,
  language (`host.i18n`; the dashboard ships a HU catalog) and theme.
- Shared state. The selected target lives in a small app store (`localStorage`
  `team:target` + subscribe via `useSyncExternalStore`), not in the router, so
  `HeaderContext` works even when the host renders it outside the app's `Router`; `App`
  mirrors the store into `?project=` and adopts `?project=` from a deep link.
- Data and environment only via the host: `host.api.fetch` (embedded: dashboard auth;
  standalone: app-kit `authedFetch`) and `host.api.wsUrl` (ticketed socket) in both modes;
  `document.title` via `host.setTitle`; no `window.location` writes except the standalone
  sign-in redirect; key handlers scoped to the app root.
- Embedded extra: the conversation menu offers "Megnyitás a dashboardon" →
  `host.openSession(sessionId)` when `host.capabilities.dashboard`; absent standalone.
- Identity is the same principal in both modes (the dashboard's signed-in user, or the
  local operator), so owner checks, the admin gate and project allowlists are unchanged.
- Dependency: the `AppHost` contract in app-kit (`extract-standalone-app-kit`) is required;
  `add-plugin-app-host` (`EmbeddedApp`, `presentation: "content"`) is optional at runtime.
  Without it the claims are not registered, the folder entry and menu item open the
  standalone app (D17), and the app is standalone only.

**D17 — Folder entry and folder-enabled projects** (decisions 2026-10-04). Team is reachable
from the dashboard's folder, so a session view's folder leads to that folder's team.

- Matching folder → project (`resolveFolderProject(cwd)`): `realpath(cwd)` equal to a
  usable project's path, else the nearest usable project that contains it (longest path
  wins); only projects allowed for the caller. The agent still runs at the project root, not
  the subfolder. A worktree (sibling path) does not match its main checkout.
- Folder slot (`sidebar-folder-section`, beside OpenSpec / Automations / KB): row
  "Csapat · N ügynök · M aktív" only for a matched folder; **hidden** for an unmatched one.
  Data: one `POST /projects/match` for all visible folder cwds, refreshed by the folder
  menu's unified refresh and on window focus (no per-row polling).
- Folder actions menu items (declarative contributions): matched → `OPEN` "Csapat";
  matched + folder-enabled + admin/operator → `WORKSPACE` "Csapat beállításai…" and
  "Csapat kikapcsolása"; unmatched + `enableable` → `WORKSPACE` "Csapat bekapcsolása ehhez
  a mappához". `enableable` = caller is an admin (multi-user) or the operator (single-user)
  and the folder passes D13 path validation; nobody else sees an enable item.
- Enabling (`POST /projects`): stores `{ id, name, path, users, contextFiles, createdBy,
  createdAt }` in `TEAM_HOME/projects.json` (`schemaVersion: 1`, atomic write, ≤ 200
  entries). `id` = slug of the folder basename, uniquified `-2`, `-3`… against both
  sources; `name` defaults to the basename; `path` = the realpath, immutable (move = disable
  + enable). Single-user: `users` ignored (operator). Multi-user dialog: name, "Kik
  használhatják" = everyone signed in (`"*"`) or selected team users (`GET /users`; users
  appear after their first visit, so "*" or a later edit covers newcomers), context files
  switch (D6). Same D13 validation at write and on every ensure. Config wins: a config id or
  path equal to a folder-enabled one hides the folder-enabled entry (logged).
- Disabling removes the entry only: conversation records, workspaces and session files
  stay; conversations on it show `unavailable` (reason "A csapat ki van kapcsolva ennél a
  mappánál") and can be archived or deleted; personas' `projects` keep the id (ignored on
  read, D3), so re-enabling the same path with the same id restores everything.
- Placement: like the OpenSpec board — the folder claim `/folder/:encodedCwd/team/*` (D16).
  The app resolves the project from the host's decoded folder via `POST /projects/match`;
  the selector is **locked** to it (chip, no menu); the "Teljes csapat" action opens the
  global claim `/team/?project=<id>`. Back returns to the folder (and the dashboard's
  return pill brings the user back from a session they opened). Without the app host, the
  folder entry and the "Csapat" item open the standalone `/apps/team/?project=<id>` in a
  new tab.
- Empty grid in a project: besides "Saját persona ide", admins (operator) get "Ügynökök
  hozzáadása": pick existing shared personas, which appends the id to their `projects`
  (existing `PUT /personas/:key`, admin gate unchanged).

**D15 — Session files: pin the default folder** (decision 2026-10-04). Every team spawn and
resume passes `scope.sessionDir = piSessionDirForCwd(T)` = `resolvePiSessionsDir()` +
`--<cwd, leading separator dropped, / \ : → ->--` (pi's `getDefaultSessionDirPath`,
`dist/core/session-manager.js:290-295`; the host's private `encodeCwd` in
`packages/server/src/session/session-discovery.ts` moves to
`packages/shared/src/dashboard-paths.ts` as `piSessionDirForCwd` and both use it). Why:

- With an explicit `--session-dir` pi writes files flat into that folder
  (`session-manager.js:1317`), and the host discovers sessions only in subfolders of its one
  root (`meta-json-session-cache`, `session-persistence` specs). Pinning the exact default
  folder keeps startup restore, the archive index, the persisted owner and therefore D5
  resume working across dashboard restarts.
- The CLI option outranks `PI_CODING_AGENT_SESSION_DIR` and the project's
  `.pi/settings.json` `sessionDir`, which pi reads even under `--no-approve`.

Rejected: a per-user folder under `TEAM_HOME` (clean separation, but sessions would not be
rediscovered after a restart, so resume would fail closed; needs host discovery of
plugin-registered roots, a larger change). Accepted: the operator's terminal `pi --resume`
in a project also lists team sessions; the dashboard UI stays owner-filtered
(`canAccessSession`, `packages/server/src/identity/session-access.ts`).

No latency budget is set for Phase 1 (decision 2026-10-03); `GET /agents` stays one
`listAll` pass plus per-user record reads.

**D18 — Implementation notes and scope decisions** (2026-10-05, during implementation).

- **Minimal `AppHost` lands here.** `add-plugin-app-host` was unimplemented when this change was built, so the
  `AppHost` contract (types, `defineDashboardApp`, `AppHostProvider`/`useAppHost`, `createStandaloneHost`,
  `StandaloneBar`) now lives in `packages/app-kit/src/react/app-host.tsx` (decision with the user). The embedded host
  (`EmbeddedApp`, `shell-overlay-route` `presentation: "content"`, the global sidebar-entry slot) stays with
  `add-plugin-app-host`; it plugs into the same interface. Until then the plugin registers only the
  `sidebar-folder-section` claim and the folder row / "Csapat" item open `/apps/team/?project=<id>` in a new tab
  (D17 fallback; `hasEmbeddedHost()` flips it when `EmbeddedApp` exists). The app's `HeaderContext`, locked folder chip
  and "Teljes csapat" action (`host.setActions`) are already host-driven and tested against a fake embedded host.
- **Standalone config is base-scoped**: `createStandaloneHost` reads `<basePath>/config.json` (never the dashboard's own
  `/config.json`, which a host without a client build answers `500`).
- **Host ref shape.** The host stores the whole ref the plugin filed under `session.pluginRefs.<pluginId>`, i.e.
  `{ team: { personaKey, project, conversationId, uk, runId }, principalOwner }`; reuse checks read `pluginRefs.team.team`.
- **`personaStale` only for live sessions.** A sleeping (idle-ended or just restarted) conversation already picks the
  current persona up on its next start, so "Restart to apply" is shown only while a session is live.
- **Resume edge cases.** A session the host no longer knows is resumed when the recorded transcript exists (our record sits
  under the user's own folder and only this plugin writes it); a conversation that never completed a turn and has no
  transcript starts fresh under the same id instead of `409 conversation_unrecoverable`.
- **Replay detection** for `onEvent`: `event.replay === true` or a timestamp older than 120 s is treated as replayed history.
- **API additions** (additive): `GET /me` returns `maxConversations` + the skill-catalog names; `POST /projects/match` rows carry
  `manageable` (admin ∧ folder-enabled). The app starts on the remembered target, else the first available project, else `_ws`.
- **Audit hardening (2026-10-05).** (1) The guard refuses any `scheme:` path (pi converts `file://` to a real path) and
  `write`/`edit` under `.git` / `.pi` / `.claude`. (2) The bridge (`packages/extension/src/command-handler.ts`) refuses
  host-action prompts (`!`/`!!` bash, `/slash`, reload, new, model, shutdown, mgmt) when `PI_EXT_TEAM_TOOLS` is set — they
  bypass `tool_call`. (3) A `full` persona never launches in multi-user mode (`409 persona_unavailable`), whatever mode
  authored it. (4) Guard readiness is per RUN: the spawn projects `runId` (`PI_EXT_TEAM_RUN_ID`) and the ready message echoes it,
  so a resumed session can never be credited with an earlier signal (camelCase keys project as `RUN_ID`). (5) A per-user live
  cap (`maxLiveSessions`, default 10, `429 session_limit`). (6) Ensure/patch re-read the record after the awaited spawn/abort:
  an archive/delete that lands mid-spawn is never undone. (7) Streaming `lastActivityAt` writes coalesce to ≤ 1 per 10 s; the turn
  end is always persisted. (8) `/agents` computes the usable project set once per request; `/projects/match` memoises counts per project.
- **Sign-in** reuses the dashboard's own login library (`dashboard-login.ts`: PKCE, handoff exchange, `signOutTarget`) through the
  `@dash` alias; the team API is never called before the identity layer reports a credential (or none is needed).
- **E2E** runs on the identity-matrix lifecycle (one private dashboard, fake OIDC issuer with the real interactive flow, real pi,
  a local OpenAI-compatible fake provider that records provider-bound prompts and replays tool calls): `playwright.team.config.ts`,
  `npm run test:e2e:team`. The docker identity overlay extension (task 6.2) and the own-origin standalone E2E are not done.

## Risks / Trade-offs

- [Logical isolation only] → file tools confined, tool names gated, `full` (bash) only in
  single-user mode; D5 step 4 fails closed on owner mismatch; trust boundary documented;
  real sandbox is a later change.
- [Operator `SYSTEM.md` applies to team sessions] → documented: multi-tenant hosts should
  not use a global `SYSTEM.md`.
- [Persona edits need a session restart] → `personaStale` flag + one-click restart that
  keeps the transcript; idle ending restarts most sessions anyway.
- [pi tool/extension semantics change across versions] → the name gate is the enforced
  boundary, the spawn allowlist only a first filter; a test asserts a `chat` session cannot
  call `write`, `bash` or `update_roles`.
- [Process count grows with users × agents × conversations] → idle ending (D8) bounds live
  sessions; listing never spawns; 50 active conversations per agent × target. No cap on live
  sessions per user in Phase 1; revisit if idle ending is not enough.
- [Conversation lost to an unresumable file] → `409 conversation_unrecoverable`, never a
  silent empty restart; the user archives or deletes it.
- [Persona instructions are untrusted prompt input] → only affect the owner's/admin's
  agent; confinement is enforced by the extension, not the prompt.
- [`principalOwner` is first-writer-wins] → team sessions are spawned only by this plugin
  with the owner set at spawn; no other road stamps them.
- [Archived transcripts stay readable by the operator] → expected; documented.
- [Same origin as the operator dashboard] → shared storage + SW scope, shared XSS blast
  radius (D14); standalone deployment exists for operators who want separation.
- [Login seam return path] → `/apps/team/` must pass the host's same-origin `safeReturnTo`;
  verified before 5.2 builds on it, with the app-kit OIDC fallback.
- [Shared project files] → by design (decision 2026-10-04): every allowed user's
  `files` agents write the same tree with no coordination; one user's agent can overwrite
  another's work. Mitigated only by the per-project `users` allowlist; documented.
- [Project content is untrusted prompt input] → `contextFiles` and any file an agent reads
  can steer it; confinement still holds (guard, not prompt). `contextFiles` is opt-in per
  project.
- [Project `.pi/` resources] → `--no-approve` on every team session; a test asserts a
  project's `.pi/extensions` and `.pi/SYSTEM.md` do not load even when the bridge is
  present. pi still reads the project `sessionDir` setting before trust (pi
  `docs/security.md`), so without an override a project could redirect team session files
  (e.g. into its own tree, readable by every allowed user's agent). Closed by D15: the
  `--session-dir` CLI option outranks the project setting.
- [Team sessions in the operator's terminal session list] → accepted (D15); the operator
  shares the OS user and can read them anyway; documented.
- [pi changes its per-cwd folder encoding] → a parity test compares `piSessionDirForCwd`
  with pi's `getDefaultSessionDir` on POSIX and Windows-style paths; a mismatch fails CI
  instead of silently breaking rediscovery.
- [Project path pointing at sensitive trees] → realpath + overlap check against
  `TEAM_HOME` / `~/.pi` + host cwd policy, re-checked per ensure; still an admin decision
  for anything else (e.g. `~/.ssh`): documented in the deploy section.

- [Folder enable widens who can create projects] → admins only (operator in single-user),
  same D13 path validation at write and on every ensure, immutable realpath, ≤ 200 entries;
  `POST /projects/match` reports only projects allowed for the caller, so a non-admin cannot
  probe which paths are projects beyond their own.
- [Sidebar cost] → one batched match call for visible folders, no per-row polling.

## Migration Plan

New packages, new data dir, additive registry rows, four additive spawn-scope fields + the
`piSessionDirForCwd` helper
(D12, shipped with the host in the same release). Deploy order: app-kit → host with D12 → team-plugin
(enable, `admins`, `skillCatalog`, `idleMinutes`, `maxConversations`, `projects`) → (standalone only: `cors.allowedOrigins` + Keycloak client → team-app deploy). Rollback: disable the plugin (routes vanish, no spawns), remove the app;
`TEAM_HOME` and session files stay and are reused on re-enable (`schemaVersion: 1`).

## Open Questions

- Should deleting a shared persona also end live conversations immediately (currently they
  finish, then show `retired`)?

### Phase 2: delegation (deferred, not designed)

Phase 1 state: no agent can drive another. The D7 name gate blocks every tool outside the
preset (subagent `Agent`, `pi-dashboard` REST skill, MCP, `codemode`, `tool_search`);
`role: "leader"` is a badge only. Loophole, unsupported: a `full` (bash) persona in
single-user mode can call the dashboard REST API or start `pi` itself; it bypasses
conversation records and ownership (that is why `full` is single-user only and "unconfined").

Outline (to be designed in its own change):
- A dedicated team tool (working name `team_delegate`) that the name gate allows only for
  `leader` personas. It creates or continues a teammate's conversation for the **same
  user and same target**, so the D5 owner/target checks and D13 project allowlist still hold.
- The delegated conversation appears in the teammate's conversation list, linked to the
  leader's conversation (parent id on the ConversationRecord).

Open questions:
- Who may delegate: only `leader` personas, or any persona the admin marks? Is "leader"
  per persona or per project team (org chart)?
- Which teammates are reachable: only personas assigned to the same target, or also the
  own workspace from a project (cross-target hand-off of files)?
- New conversation per delegation, or continue a named existing one? How is the result
  returned to the leader: synchronous wait with a timeout, or async notification?
- Limits: max delegation depth, max conversations a single delegation may create
  (and whether they count against `maxConversations`), loop prevention (A → B → A).
- Tool presets: does a delegated teammate keep its own preset, or is it capped at the
  leader's (no privilege escalation through a `files` teammate from a `chat` leader)?
- Cost and process count: delegated sessions add live pi processes per user; is a
  per-user live-session cap needed once delegation exists (Phase 1 has none)?
- Visibility and control: how the user sees and stops a delegation chain in the app, and
  whether a delegated conversation is read-only to the user while the leader drives it.
- Audit: what is logged per delegation (ids only, never persona or prompt content).
