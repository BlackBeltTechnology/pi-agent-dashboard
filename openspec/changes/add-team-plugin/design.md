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

**Goals:** persistent per-user agents from shared + private personas; a standalone,
own-origin SPA; owner isolation of data and sessions; logical file confinement.

**Non-Goals:** org chart, delegation (Phase 2); Kanban, overview (Phase 3); schedules
(Phase 4); chat channels; avatar upload; OS/container sandbox; IdP role mapping; the
IndexedDB replay cache of the dashboard client (team-app replays from the server on
reload); bundling the app into Electron.

## Decisions

**D1 — Two packages.** `packages/team-plugin` (public; manifest
`{id:"team", displayName:"AI Team", priority:100, server, configSchema, claims:[]}` plus
`extension/` = companion pi extension) and `packages/team-app` (private Vite + React SPA,
a sibling workspace so it may import the workspace-only `chat-embed`). Additive host
registry rows: `packages/shared/src/route-tiers.ts` and the MCP manifest denylist in
`packages/mcp-server-plugin`; plus the additive `scope` fields of D12.

**D2 — Modes, keys and paths.** *Multi-user mode* requires OIDC identity active. With
identity inactive the plugin runs in *single-user mode*: every admitted caller is the
local operator. Single-user mode only works where the host admits the app without a
credential (loopback, `trustedNetworks`, or same-host serving); a foreign origin is
refused by the host's network guard. User key `uk = hex(sha256(iss+"\0"+sub)).slice(0,32)`; local operator =
`local`. Persona key `"<scope>:<slug>"`, slug `^[a-z0-9][a-z0-9-]{0,39}$`. Under
`TEAM_HOME` (config `teamHome`, default `~/.pi/dashboard/team`; env `PI_TEAM_HOME` wins,
for tests only):

```
personas/<slug>.json                          shared
users/<uk>/personas/<slug>.json               private
users/<uk>/instances/<scope>-<slug>.json      one InstanceRecord per (user, persona)
users/<uk>/agents/<scope>-<slug>/             workspace = session cwd
users/<uk>/runtime/<scope>-<slug>/persona.md  rendered persona (outside the workspace)
```

Paths are built only from validated slugs + `uk` and canonicalised through the longest
existing ancestor's `realpath` (as `host-cwd-policy` does), then asserted under
`TEAM_HOME`. Writes are atomic (tmp + rename). One instance file per (user, persona)
plus the per-key single-flight (D5) removes cross-persona write races.

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
  skills?: string[];                             // names from the admin skill catalog
  forkedFrom?: string;
  createdAt: string; updatedAt: string; updatedBy: string;
}
```

`skills` are names resolved server-side through config `skillCatalog: { [name]: path }`
(admin-controlled); unknown names are rejected, so a persona never chooses a code path.
Unknown fields are rejected on write; unknown `schemaVersion` files are skipped on read.
Caps: 50 private personas per user, 200 shared personas; a create beyond a cap answers
`409 persona_limit`.

**D4 — Admin gate.** Multi-user: admin = principal listed in config `admins`.
Single-user: the local operator is admin. Shared writes require admin; private writes
require `owner == principal`; private reads are owner-only (foreign key ⇒ `404`).
`tools:"full"` is accepted only in single-user mode and only on shared personas; in
multi-user mode a `full` persona is rejected on write and listed as unavailable (it
would break isolation between users).

**D5 — ensureAgentSession(principal, personaKey).**

1. Persona readable by principal, else `404 persona_not_found`.
2. Single-flight per `(uk, personaKey)`.
3. **Reuse** when the record's session is live, not ended, `cwd === workspace`,
   `principalOwner` equals the principal and `pluginRefs.team.personaKey` matches.
4. Else **resume** the recorded `sessionFile` when it exists and its persisted owner
   (live or archive) equals the principal; a missing or different owner ⇒ no resume
   (fail closed) and fall through to 5.
5. Else **spawn fresh**.
6. Spawn options: `cwd: workspace, name: persona.name, model: persona.model, pluginRef:
   { team: { personaKey, uk, runId: randomUUID() }, principalOwner }, lifecycle:
   { recover:false, finalizeOnSocketClose:true }, scope: { tools: preset(persona.tools),
   skills: catalogPaths(persona.skills), extensions:[teamExtensionPath], extensionConfig:
   { team: { persona: personaFilePath, workspace, tools: persona.tools } } }` (+ `resume`
   in step 4), `spawnToken` minted by the plugin (caller-supplied tokens are used verbatim,
   `server-context.ts:252-263`, as the goal supervisor does), and scope additions
   `appendSystemPrompt: [personaRuntimePath]`, `noContextFiles: true` (D6). Before each
   spawn/resume the plugin renders `persona.md` from the current persona.
7. Wait for the session whose `pluginRef.team.runId` equals ours (the plugin subscribes to
   `onSessionResolved` once at activation and routes by `runId`), then for the team
   extension's ready signal (D7). 30 s overall. On timeout or missing ready signal:
   `abortSpawnedRun({ spawnToken })` with our minted token, respond `504 spawn_timeout` or
   `503 guard_unavailable`, write no record.
8. Write the instance record `{ sessionId, sessionFile, runId, spawnToken, startedAt,
   personaUpdatedAt, lastAgentEndAt, personaSnapshot: { name, description, avatar, role,
   model } }`; the snapshot lets a `retired` card render after the persona is deleted.

Logged: `team.ensure {uk, personaKey, outcome: reuse|resume|spawn|timeout, sessionId}` —
never persona text.

**D6 — Persona injection at spawn.** The persona reaches the prompt as a base option,
not through a per-turn handler: `scope.appendSystemPrompt = [persona.md]` (rendered
outside the workspace) and `scope.noContextFiles = true` (no operator or parent-dir
`AGENTS.md`). Both are in `event.systemPrompt` before any `before_agent_start` handler, and pi renders
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
  workspace; an absent path argument means the cwd = workspace. Unparseable policy or
  path ⇒ block.

`full` (bash) cannot be confined; it exists only in single-user mode (D4) and is badged
"unconfined".

**D8 — Lifecycle and status.** Status: `new` (no record), `sleeping` (record, no live
session), `running` (live, idle), `busy` (live, streaming), `retired` (persona deleted;
rendered from the record's `personaSnapshot`), `unavailable` (a `full` persona in
multi-user mode).
`onEvent` is filtered to session ids in this plugin's instance records and to live
(non-replay) events; `lastAgentEndAt` is persisted in the record so idleness survives a
server restart. `busy` is read from the live session status, and `busy` sessions are
never ended. A sweep runs every 5 minutes; sessions idle longer than `idleMinutes`
(default 30, `0` = off) get a graceful `abortSpawnedRun`, so a session ends between
`idleMinutes` and `idleMinutes + 5` minutes after its last run. `POST .../reset` ends a live session and deletes the record;
transcript and workspace stay.

**D9 — REST surface** (`/api/plugins/team`, JSON, lowercase error codes, `401` without a
principal in multi-user mode):

| Method + path | Purpose |
|---|---|
| `GET /me` | `{ uk, iss, sub, admin, mode }` |
| `GET /personas` | shared + caller's private |
| `POST /personas` | create (`scope` decides gate) |
| `PUT /personas/:key` | update |
| `DELETE /personas/:key` | delete; instances become `retired` |
| `POST /personas/:key/fork` | body `{ slug? }`; default = source slug, then `-2`, `-3`… (base truncated so the result fits 40 chars); explicit taken slug ⇒ `409 slug_taken` |
| `GET /agents` | persona × caller's instance status (one `listAll` pass, never spawns) |
| `POST /agents/:key/session` | ensureAgentSession → `{ sessionId }` |
| `POST /agents/:key/restart` | end live session, keep record (next open resumes with the current persona) |
| `POST /agents/:key/reset` | end + clear record |

Encapsulated scope with `@fastify/rate-limit` using mcp-server-plugin's values
(`max: 100_000`, `timeWindow: "1 minute"`, `allowList: ["127.0.0.1","::1"]`,
`packages/mcp-server-plugin/src/server/routes.ts:113-117`); `ROUTE_TIERS` row + MCP classification per
route.

**D10 — SPA.** Vite + React + wouter on `@blackbelt-technology/pi-dashboard-app-kit`.
Routes: `/` (Csapat grid), `/agent/:key`, `/personas/new`, `/personas/:key`,
`/auth/callback`. The conversation view: `POST /agents/:key/session` → browser-scope
ticketed socket (the host owner-gates the subscribe) → headless `useSessionState` →
`ChatView` (with a `ToolContext` `{ cwd, sessionId, session, send }` built from the reduced
state and the socket's `send`) + `CommandInput` (its `onSend` sends the prompt command
over the same socket) inside a bounded-height pane, mounted with `ThemeProvider`,
`UiPrimitiveProvider` (`createUiPrimitiveRegistry`), `MobileProvider`,
`SessionAssetsProvider`, `DisplayPrefsProvider`, `ApiContext.Provider` (the dashboard
base) and a wouter `Router`. Cards poll `GET /agents` every 5 s while visible. HU default,
EN toggle, identical key sets. Original SVG avatar gallery; no Marveen assets. Screens
are mocked with `frontend-mockup-loop-dashboard` before implementation.

**D12 — Additive host change: two spawn-scope fields.** `PluginSpawnOptions.scope` gains
`appendSystemPrompt?: string[]` (absolute paths → repeated `--append-system-prompt`) and
`noContextFiles?: boolean` (→ `--no-context-files`), mapped by
`pluginSpawnToSessionOptions` (`packages/dashboard-plugin-runtime/src/server/server-context.ts:374`)
→ `SessionFlags` → `sessionFlagsToArgv`, sanitized like the other argv fields (relative
paths dropped: pi treats a non-existent path as literal text). cwd-policy composition
(`packages/server/src/spawn-process/cwd-policy.ts:121-145`) does not touch them, as with
`extensions`. Absent fields ⇒ byte-identical argv. Compatibility: additive optional
fields; older plugins unaffected. Rollback: revert the mapper rows.

**D11 — Deployment.** Static `dist/` + runtime `config.json`; minimal static-server
Dockerfile (pinned digest). E2E extends `docker/compose.test.identity.yml` with the app
service, its origin in `cors.allowedOrigins`, and a realm public client with an audience
mapper.

No latency budget is set for Phase 1 (decision 2026-10-03); `GET /agents` stays one
`listAll` pass plus per-user record reads.

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
- [Process count grows with users × agents] → idle ending (D8); listing never spawns.
- [Persona instructions are untrusted prompt input] → only affect the owner's/admin's
  agent; confinement is enforced by the extension, not the prompt.
- [`principalOwner` is first-writer-wins] → team sessions are spawned only by this plugin
  with the owner set at spawn; no other road stamps them.
- [Archived transcripts stay readable by the operator] → expected; documented.

## Migration Plan

New packages, new data dir, additive registry rows, two additive spawn-scope fields
(D12, shipped with the host in the same release). Deploy order: app-kit → host with D12 → team-plugin
(enable, `admins`, `skillCatalog`, `idleMinutes`) → `cors.allowedOrigins` + Keycloak client
→ team-app deploy. Rollback: disable the plugin (routes vanish, no spawns), remove the app;
`TEAM_HOME` and session files stay and are reused on re-enable (`schemaVersion: 1`).

## Open Questions

- Should deleting a shared persona also end live instances immediately (currently they
  finish, then show `retired`)?
