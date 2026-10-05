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

**Agent-to-agent delegation is explicitly Phase 2.** In Phase 1 a team agent cannot drive
another agent: the isolation guard blocks every tool outside the persona's preset (incl.
the subagent `Agent` tool, dashboard REST skills, MCP, `codemode`), and `role: "leader"`
is a badge only. Phase 1 keeps the hooks Phase 2 needs (the `leader` role, the name gate
as the single place to allow a new tool, conversations keyed per user × target). Open
questions are recorded in `design.md` → Open Questions → "Phase 2: delegation".

## What Changes

- New dashboard plugin `packages/team-plugin` (server entry + a pi extension loaded into
  the sessions it spawns; dashboard UI = a folder row slot + folder-menu items, D17):
  - **Personas**: shared templates (admin-only write) and private personas (owner-only),
    with "fork a template into my own"; validated JSON store under
    `~/.pi/dashboard/team/`.
  - **Targets — projects or own workspace**: the user picks the target in a project
    selector at the top of the app: an admin-configured **project** (name + absolute path +
    per-project user allowlist + per-project `contextFiles` switch) or their **own
    workspace** (one plugin-owned folder per user, shared by all of that user's agents so
    they can hand files to each other). The target is the session cwd. Project files are
    shared between users (collaboration); the `files` preset may write in them.
  - **Project teams**: each persona carries a `projects` list (project ids and/or the own
    workspace; default own workspace). Admins assign shared personas; owners assign their
    private ones (only to projects they may use). The grid shows the personas of the
    selected target.
  - **Conversations**: per user × agent × target, many persistent conversations, each one
    pi session found or resumed on demand (reuse live → resume ended), single-flight,
    owner-stamped, recorded in a durable per-user record. Titles from the dashboard
    auto-namer, renameable; archive / restore; delete (transcript file kept on disk); at
    most 50 active per agent × target. Idle sessions are ended and resumed on next use.
  - **Isolation guard**: tool presets at spawn (`scope.tools`) plus a deny-first
    `tool_call` guard that blocks every tool outside the preset (extension, MCP, codemode
    tools included) and confines file tools to the target folder (project root or own
    workspace); `bash` only on
    admin-authored shared personas, flagged as unconfined. Skills only from an
    admin-configured catalog.
  - **Persona injection at spawn**: the persona is rendered to a file outside the
    target and passed with `--append-system-prompt`; `--no-context-files` keeps the
    operator's and parent folders' `AGENTS.md` out; a project with `contextFiles` on adds
    only its root `AGENTS.md`/`CLAUDE.md` as further appended files. `--no-approve`
    keeps a project's trust-gated `.pi/` resources (extensions, MCP, `SYSTEM.md`) from
    loading — the dashboard bridge would otherwise auto-trust them. Order-independent against the dashboard bridge. Persona
    edits apply on the next session start ("Restart to apply" keeps the transcript).
  - **Modes**: multi-user requires OIDC identity; with identity inactive the plugin runs
    single-user (the local operator, who is admin). `bash` personas exist only in
    single-user mode.
- **Additive host change** (`plugin-spawn-scope`): `scope.appendSystemPrompt`,
  `scope.noContextFiles`, `scope.noProjectTrust` and `scope.sessionDir`, mapped to
  `--append-system-prompt`, `--no-context-files`, `--no-approve` and `--session-dir`; plus a
  shared helper `piSessionDirForCwd(cwd)` (host sessions root + pi's per-cwd folder name),
  used by host session discovery and the team plugin.
  - **Session files**: team sessions pin pi's default per-cwd session folder explicitly
    (`--session-dir`), so a project's `.pi/settings.json` `sessionDir` cannot redirect team
    transcripts (e.g. into the shared project tree) while discovery, archive, owner and
    resume keep working.
  - REST API under `/api/plugins/team/*`.
- New SPA `packages/team-app` built on
  `@blackbelt-technology/pi-dashboard-app-kit` (`extract-standalone-app-kit`):
  Marveen-style shell with a **project selector**, **Csapat** card grid scoped to the
  selected target (avatar, name, role, model, status, scope, conversation count, latest
  activity), persona editor (create / edit / fork / delete, project assignment), agent view
  with a conversation list + the conversation, embedding the dashboard `ChatView` +
  `CommandInput`.
  **Served by the dashboard itself at `/apps/team/` by default** (bundled into
  `team-plugin`, same origin, the host's existing dashboard sign-in); a standalone
  origin (own static server + `config.json` + CORS + own OIDC client) stays optional. HU-first with an EN toggle; light/dark.
  **Folder entry**: a session's or folder's team is one click away — a "Csapat" row in the
  folder card (only when the folder is, or lies inside, a project) and folder-menu items;
  it opens like the OpenSpec board, locked to that project. Admins (the operator in
  single-user mode) can **enable a folder** as a project from the folder menu, choosing
  who may use it; config-defined projects stay read-only.
  **Also runs embedded in the dashboard like the OpenSpec board** (`add-plugin-app-host`:
  `shell-overlay-route` `presentation: "content"` + `EmbeddedApp`): global at `/team/`
  (sidebar row "Csapat →" via a requested global sidebar-entry slot) and per folder at
  `/folder/<cwd>/team/`. One source, two entries (library `./app` via `defineDashboardApp`,
  standalone `index.html`); the project selector is the app's `HeaderContext` in both;
  sign-in, language and theme controls appear only standalone.
- Optional standalone deployment artifact: the same `dist/` + runtime `config.json` + a
  static-server image; E2E against the existing Keycloak identity harness (same-origin
  default and standalone).

## Capabilities

### New Capabilities
- `team-personas`: persona schema, project assignment, shared vs private scope, admin
  gate, fork, storage.
- `team-agent-sessions`: targets (projects + own workspace), the admin project registry,
  agents per target, conversations (create / ensure / title / archive / delete), idle
  ending, persona injection, isolation guard.
- `team-app`: the SPA surfaces (delivery same-origin or standalone, sign-in, project
  selector, team grid, conversation list + conversation, persona editor).

### Modified Capabilities
- `plugin-spawn-scope`: four optional scope fields (`appendSystemPrompt`,
  `noContextFiles`, `noProjectTrust`, `sessionDir`) mapped to pi CLI flags; absent ⇒
  byte-identical argv.
- Host-side registries get additive rows (`packages/shared/src/route-tiers.ts`, the MCP
  manifest denylist in `packages/mcp-server-plugin`).

## Impact

- New packages: `packages/team-plugin` (public, priority 100 — trusted, needed for
  `spawnSession` + `pluginRef.principalOwner`), `packages/team-app` (private, build
  artifact). Registrations per the new-package checklist (publish list, vitest projects,
  knip, `ROUTE_TIERS`, MCP-manifest classification).
- Depends on `extract-standalone-app-kit` (must land first, including the `AppHost`
  contract of `add-plugin-app-host` D2). `add-plugin-app-host` is optional at runtime:
  with it the app also runs embedded in the content area (`/team/`, `/folder/<cwd>/team/`);
  without it, standalone only. Requests from it: a global sidebar-entry slot.
- Data: new directory `~/.pi/dashboard/team/` (`schemaVersion: 1` files). No migration of
  existing data. Rollback: disable/uninstall the plugin; the directory and session files
  stay on disk and are ignored.
- Deployment: default = enable the plugin; the app is at `<dashboard>/apps/team/` with no
  CORS entry, no extra server and no extra Keycloak client. Standalone only: the app origin
  in `cors.allowedOrigins`, HTTPS for OIDC PKCE, a Keycloak public client.
- Same origin as the operator dashboard: the two apps share browser storage and the
  service-worker scope; an XSS in either reaches both (both already render agent output
  through the same `ChatView`).
- Trust boundary: Phase 1 isolation is logical (same OS user). `bash` personas cannot be
  confined, so they exist only in single-user mode. Real sandboxing is out of scope.
  Projects are deliberately shared: every allowed user's agents read (and, with
  `files`, write) the same tree. A project path may not contain, or sit inside, the team
  home or `~/.pi`. Projects are configured in the plugin config only (no editing UI in
  Phase 1).
  Team session files live in pi's normal per-cwd folder, so an operator running `pi --resume`
  in a project from a terminal also lists team users' sessions (the pi CLI has no owner
  concept); the dashboard UI stays owner-filtered. Documented.
- Host compatibility: the spawn-scope fields are optional; the plugin requires a host
  that has them (released together).

## Discipline Skills

- `security-hardening` — multi-tenant data on one host: owner checks on every route,
  path confinement in the guard, persona instructions as untrusted input, admin gate,
  project path validation (no team home / `~/.pi` overlap), per-project allowlist,
  project trust forced off (`--no-approve`), project context files as untrusted input,
  folder enable (admin/operator-only project writes; the match route never reveals projects
  the caller may not use).
- `doubt-driven-review` — the persona/instance file formats and the public REST surface are
  hard to change once users have data.
- `observability-instrumentation` — new endpoints and a spawn/resume path: log ensure
  outcomes (reuse/resume/spawn/timeout) with session id, never persona content.
- `performance-optimization` — the agents list polls; bound the per-request work
  (single `listAll` pass, no per-agent disk scan).
- `systematic-debugging` — spawn correlation is asynchronous; use it if a bind fails.
- `review-code` — inline review before commit.
