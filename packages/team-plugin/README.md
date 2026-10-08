# @blackbelt-technology/pi-dashboard-team-plugin

Persistent per-user **AI team** for the pi dashboard: named agents (personas with an avatar, role,
instructions and model) that remember their conversations, organised as project teams. Phase 1 of
the team product (org chart, Kanban and schedules come later).

- **Personas** — shared templates (admin-only write) and private personas (owner-only), fork a
  template into your own. Stored as validated JSON under `~/.pi/dashboard/team/`.
- **Targets** — an admin-configured **project** (name + absolute path + per-project user allowlist)
  or the user's **own workspace** (`users/<uk>/workspace/`, shared by all of that user's agents).
  A folder can also be **enabled** as a project from the dashboard folder menu.
- **Conversations** — per user × agent × target, many, each one pi session found or resumed on
  demand, owner-stamped, titled by the auto-namer, archivable/deletable (max 50 active).
- **Isolation guard** — tool preset at spawn + a deny-first `tool_call` guard that blocks every
  tool outside the preset and confines file tools to the target folder.
- **App** — served by the dashboard at **`<dashboard>/apps/team/`** (same origin, the dashboard's
  own sign-in). Optional standalone deployment below.

## Enable

Enable the plugin (it ships with the dashboard). Open `<dashboard>/apps/team/`. No CORS entry, no
extra server and no extra Keycloak client are needed for the default same-origin deployment.

```jsonc
// ~/.pi/dashboard/config.json → plugins.team
{
  "admins": [{ "iss": "https://idp.example/realms/r", "sub": "<keycloak user id>" }],
  "idleMinutes": 30,
  "maxConversations": 50,
  "maxLiveSessions": 10,
  "skillCatalog": {
    "review": "/abs/path/to/skill-dir",            // directory containing SKILL.md (shorthand)
    "triage": { "path": "/abs/triage", "users": "*", "targets": ["billing"] }
  },
  "projects": {
    "billing": {
      "name": "billing-api",
      "path": "/work/billing-api",
      "users": "*",                 // or [{ "iss": "...", "sub": "..." }]
      "contextFiles": false         // append the root AGENTS.md / CLAUDE.md (untrusted input)
    }
  }
}
```

## Skills

A persona can use only skills from the catalog. Entries come from `skillCatalog` (config,
read-only in the app) or are added by an admin in the app (managed, stored in
`<team home>/skills.json`; config wins on a name clash). An entry is `{ path, users, targets }`:
`path` is an absolute directory with a `SKILL.md` whose `name` matches the catalog name;
`users` and `targets` default to `"*"`.

- Team sessions start with `--no-skills` plus the persona's skills; global, package and
  extension skills are not available. `/skill:<name>` works for granted skills only.
- Revoking or narrowing a **managed** entry ends affected live sessions within 5 s.
  A **config** edit has no change notification: it applies at the next open of the conversation.
- Switching to single-user mode widens user-scoped entries to the operator.

## Modes

| Mode | When | Who is admin | `bash` personas |
|---|---|---|---|
| multi-user | OIDC identity active | principals listed in `admins` | never (rejected on write) |
| single-user | identity inactive | the local operator | shared personas only, badged **unconfined** |

Single-user mode only works where the host admits the app without a credential: loopback, a
`trustedNetworks` entry, or same-host serving. A foreign origin is refused by the host's network
guard (the app then shows "not admitted").

## Trust boundary

Isolation is **logical** (same OS user): file tools are confined to the target folder, tool names
are gated, project `.pi/` resources are never loaded (`--no-approve`), and the session folder is
pinned (`--session-dir`). `bash` cannot be confined. Real sandboxing is out of scope.

- **Host actions are refused too.** The guard confines tool calls; the bridge additionally refuses owner-typed
  `!cmd` bash, `/slash` extension commands, `/reload`, `/new`, `/model` and shutdown prompts in team sessions
  (`PI_EXT_TEAM_TOOLS`), so a team user cannot run host commands by typing them.
- **Protected paths.** `write`/`edit` may not touch `.git/`, `.pi/` or `.claude/` inside a target (a planted hook or
  `.pi` resource would run for the operator). Other files in a shared project remain writable by `files` agents.
- **Resource caps.** `maxConversations` (50 active per agent × target) and `maxLiveSessions` (10 live pi processes per user).
- **Projects are shared trees.** Every allowed user's agents read — and with the `files` preset
  write — the same files, with no locking. Narrow the audience with the per-project `users` list.
- **Never point a project at secrets** (`~/.ssh`, cloud credentials, …). A project path may not
  contain or lie inside the team home or `~/.pi`.
- **Persona instructions and `contextFiles` are untrusted prompt input.** Confinement is enforced
  by the guard extension, not the prompt.
- **Same origin as the operator dashboard**: the two apps share browser storage and the service
  worker scope; an XSS in either reaches both (both render agent output through the same `ChatView`).
  Use the standalone deployment for separation.
- Team session files live in pi's normal per-cwd folder, so `pi --resume` in a project from a
  terminal also lists them; the dashboard UI stays owner-filtered.
- A global `~/.pi/agent/SYSTEM.md` replaces the preamble of every session on the host, team
  sessions included. Multi-tenant hosts should not use one.

## Optional standalone deployment

The same build, served from its own origin (`dist/app/` + a runtime `config.json`):

```json
{ "dashboardUrl": "https://dash.example" }
```

Requires the app origin in the dashboard's `cors.allowedOrigins`, the dashboard host in
`allowedHosts`/`publicBaseUrls`, HTTPS (PKCE needs `crypto.subtle`), and a **public** Keycloak client
(standard flow + PKCE, exact redirect URI `https://app.example/apps/team/auth/callback`, an audience
mapper). Serve the files under `/apps/team/` (the build's base path); a minimal static server image
works — pin its digest.

## Development

```bash
npm run build:app -w @blackbelt-technology/pi-dashboard-team-plugin   # build + copy the SPA into dist/app
```

`packages/team-app` is the private SPA workspace; `team-plugin` copies its build at pack time so the
npm package and the Electron bundle both carry it.
