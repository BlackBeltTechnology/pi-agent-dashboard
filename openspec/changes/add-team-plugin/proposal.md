## Why

Users want an "AI team" they can open from any device: named agents with a persona
(avatar, role, instructions, model) that remember the conversation, the way Marveen's
"Csapat" page presents its agent fleet (`Szotasz/marveen`, MIT). The dashboard already has
every primitive needed — owner-stamped sessions (`principalOwner`), plugin-owned session
refs, resume-by-file, OIDC identity, cross-origin admission — but no product that turns
them into persistent, per-user agents, and no surface a non-technical user can use
without the operator dashboard.

This is Phase 1 (foundation) of four. Later phases add the org chart + delegation,
the team Kanban + overview, and per-agent schedules.

## What Changes

- New dashboard plugin `packages/team-plugin` (server entry + a pi extension loaded into
  the sessions it spawns; no dashboard UI claims):
  - **Personas**: shared templates (admin-only write) and private personas (owner-only),
    with "fork a template into my own"; validated JSON store under
    `~/.pi/dashboard/team/`.
  - **Persistent agents**: persona × user = one persistent pi session, found or created on
    demand (reuse live → resume ended → spawn fresh), single-flight, owner-stamped,
    recorded in a durable per-user instance record; idle sessions are ended and resumed
    on next use.
  - **Workspaces**: one plugin-owned directory per (user, agent) as the session cwd.
  - **Isolation guard**: tool presets at spawn (`scope.tools`) plus a deny-first
    `tool_call` guard that blocks every tool outside the preset (extension, MCP, codemode
    tools included) and confines file tools to the workspace; `bash` only on
    admin-authored shared personas, flagged as unconfined. Skills only from an
    admin-configured catalog.
  - **Persona injection at spawn**: the persona is rendered to a file outside the
    workspace and passed with `--append-system-prompt`; `--no-context-files` keeps the
    operator's `AGENTS.md` out. Order-independent against the dashboard bridge. Persona
    edits apply on the next session start ("Restart to apply" keeps the transcript).
  - **Modes**: multi-user requires OIDC identity; with identity inactive the plugin runs
    single-user (the local operator, who is admin). `bash` personas exist only in
    single-user mode.
- **Additive host change** (`plugin-spawn-scope`): `scope.appendSystemPrompt` and
  `scope.noContextFiles`, mapped to the pi flags of the same name.
  - REST API under `/api/plugins/team/*`.
- New standalone SPA `packages/team-app` (own origin, OIDC) built on
  `@blackbelt-technology/pi-dashboard-app-kit` (`extract-standalone-app-kit`):
  Marveen-style shell, **Csapat** card grid (avatar, name, role, model, status, scope),
  persona editor (create / edit / fork / delete), agent conversation view embedding the
  dashboard `ChatView` + `CommandInput`. HU-first with an EN toggle; light/dark.
- Static deployment artifact: `dist/` + runtime `config.json` + a static-server image;
  E2E against the existing Keycloak identity harness.

## Capabilities

### New Capabilities
- `team-personas`: persona schema, shared vs private scope, admin gate, fork, storage.
- `team-agent-sessions`: get-or-create persistent per-user agent sessions, workspaces,
  idle ending, reset, persona injection, isolation guard.
- `team-app`: the standalone SPA surfaces (sign-in, team grid, persona editor,
  conversation).

### Modified Capabilities
- `plugin-spawn-scope`: two optional scope fields (`appendSystemPrompt`,
  `noContextFiles`) mapped to pi CLI flags; absent ⇒ byte-identical argv.
- Host-side registries get additive rows (`packages/shared/src/route-tiers.ts`, the MCP
  manifest denylist in `packages/mcp-server-plugin`).

## Impact

- New packages: `packages/team-plugin` (public, priority 100 — trusted, needed for
  `spawnSession` + `pluginRef.principalOwner`), `packages/team-app` (private, build
  artifact). Registrations per the new-package checklist (publish list, vitest projects,
  knip, `ROUTE_TIERS`, MCP-manifest classification).
- Depends on `extract-standalone-app-kit` (must land first).
- Data: new directory `~/.pi/dashboard/team/` (`schemaVersion: 1` files). No migration of
  existing data. Rollback: disable/uninstall the plugin; the directory and session files
  stay on disk and are ignored.
- Deployment: the app origin must be added to `cors.allowedOrigins`; HTTPS required for
  OIDC PKCE; a Keycloak public client for the app.
- Trust boundary: Phase 1 isolation is logical (same OS user). `bash` personas cannot be
  confined, so they exist only in single-user mode. Real sandboxing is out of scope.
- Host compatibility: the spawn-scope fields are optional; the plugin requires a host
  that has them (released together).

## Discipline Skills

- `security-hardening` — multi-tenant data on one host: owner checks on every route,
  path confinement in the guard, persona instructions as untrusted input, admin gate.
- `doubt-driven-review` — the persona/instance file formats and the public REST surface are
  hard to change once users have data.
- `observability-instrumentation` — new endpoints and a spawn/resume path: log ensure
  outcomes (reuse/resume/spawn/timeout) with session id, never persona content.
- `performance-optimization` — the agents list polls; bound the per-request work
  (single `listAll` pass, no per-agent disk scan).
- `systematic-debugging` — spawn correlation is asynchronous; use it if a bind fails.
- `review-code` — inline review before commit.
