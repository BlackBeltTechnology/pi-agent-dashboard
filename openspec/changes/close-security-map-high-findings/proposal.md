## Why

The security map (`docs/security/residual-risks.md`, commit `f633017fc`) lists three
High findings that are cheap to close, have an agreed fix, and are not owned by any
other change:

- **DEP-01** — the file routes anchor on all of `~/.pi`, so any `observe`-tier
  caller (paired phone, tunnel visitor with a session) can `GET /api/file` pi's
  provider credentials: `~/.pi/agent/auth.json` (API keys + OAuth refresh tokens),
  `mcp-auth.json`, `providers.json`, `plugin-credentials.json`. The existing
  dashboard-state guard only covers `~/.pi/dashboard`. `GET /api/session-file` is
  worse: for a path lexically inside the session cwd it skips the guard entirely
  (`routes/session-routes.ts:538-563`), so a `$HOME`-cwd session serves the same files
  and even `~/.pi/dashboard/local/token`.
- **TOOL-01** — the register rated this High: an agent holding its per-session MCP
  token (tier `control`) could call `prompt_response` on *another* session and answer
  its path-gate prompt. **Premise corrected by the plan-proposal trace:** the tool
  never reaches the bridge's prompt bus — the host wraps the message object as the
  `text` of a `send_prompt` (`server.ts:4166-4167`) — so no MCP road answers prompts
  and the finding is re-rated **Low (broken tool)**. What remains is that the surface
  advertises a broken answer tool (and an inert twin, `extension_ui_response`) one
  bind fix from a live self-approval road.
- **HTTP-01** — with `auth.providers.github` or `google` set and no
  `auth.allowedUsers`, any GitHub/Google account signs in at tier `operate`
  (`isUserAllowed` empty → `true`, `resolveGroupTier` empty → `operate`). Any
  provider *key* other than `github`/`google` resolves through OIDC discovery of its
  `issuerUrl`, so an `oidc` entry pointing at `https://accounts.google.com` has the
  same hole.

## What Changes

- **D1 (DEP-01).** Extend the *always-refused* tier of the dashboard-state guard
  with a fixed set of pi-agent credential files under every agent directory
  (`~/.pi/agent` and the server's `PI_CODING_AGENT_DIR`): `auth.json`,
  `mcp-auth.json`, `providers.json`, `plugin-credentials.json`, `models.json`,
  `mcp.json`, `system-one/auth.json`, plus `<name>.*` siblings (quarantine/backup
  copies). Refused for every caller, in every mode, at every containment site (cwd
  anchor incl. cwd = `$HOME`, `~/.pi` anchor, git-root, grants, mention resolver,
  grep, writable-md, and the `/api/session-file` in-cwd shortcut, which now runs the
  guard on the real path before any shortcut), on the resolved real path with the
  post-open (dev,ino) recheck made structural at every content-serving site
  (grant opener, digest, md-read, eml, session-file, pi-resource-file, live-server
  static). `GET /api/pi-resource-file`, which had no state predicate at all, now runs
  the refusal on the real path, and so does `POST /api/file/write-binary` (hash oracle +
  overwrite target). Plugin routes that return file content go through a new optional
  `ServerPluginContext.readFileGuarded` seam (the flows file route served a symlink to a
  credential file; the automation result/prompt routes read symlinkable files); the
  design records a verdict for every plugin route that reads files. Grep drops matches
  whose `(dev,ino)` is an always-refused file (hard links). Case
  compare is exact on case-sensitive volumes and folded only where the volume folds.
  The `~/.pi` anchor itself stays; skills/prompts previews keep working. The JS grep
  walker skips these files without reading them.
- **D2 (TOOL-01).** Remove `prompt_response` **and** `extension_ui_response` from
  the MCP tool surface for **all** callers: delete the two manifest rows, denylist them
  (reason "agent prompt answers stay human-in-the-loop; broken session bind", matching
  the `/api/questions` and `grant_response` precedent), and regenerate the manifest
  artifacts with `pnpm --filter @blackbelt-technology/pi-dashboard-mcp-server-plugin
  codegen`. The chat-gateway keeps answering: `prompt_response` moves to its chat-local
  verb-tier table, its tier read from `WS_MESSAGE_TIERS.prompt_response` rather than a
  literal (the shared table loses the row; both land in one commit). No new road, no
  new route, no plugin-runtime change in D2. Residual roads recorded: REST
  `POST /api/questions/:id/answer` (non-file kinds), the browser WebSocket
  `prompt_response` message and `POST /api/access/prompts/:promptId`.
- **D3 (HTTP-01).** A provider is *public* when its key is `github`/`google` **or**
  its configured `issuerUrl` host is on a fixed public-IdP host set (decided from
  configuration alone, so a provider whose OIDC discovery failed is still classified)
  (`accounts.google.com`, `github.com`, `gitlab.com`, `login.microsoftonline.com`
  with tenant `common|consumers|organizations`, `appleid.apple.com`). A public
  provider with empty `allowedUsers` **and** empty `groupTiers` → login refused (403
  remedy page naming `auth.allowedUsers` / `auth.groupTiers`) at the `/auth/login`
  auto-redirect, `/auth/start/:provider` (no IdP round trip) and
  `/auth/callback/:provider` (before code exchange); the picker shows the provider
  with a "not configured for sign-in" note. Already-issued session cookies of a
  now-refused provider are rejected (cookie cleared, 401 / HTML redirect to `/auth/login`, which states the remedy), a
  session whose provider key is no longer in the configured providers is rejected (fail
  closed), and on an auth reload that refuses a provider its open browser/terminal
  WebSockets are closed (4401; terminal sockets get the session-tier stamp at upgrade,
  mandatory). Live-preview sockets are capability-URL scoped and not swept (residual).
  Unknown-issuer `keycloak`/`oidc` keep allow-all. Every open-enrolment provider
  gets a startup/reload warning line, an `openEnrolment` field on
  `GET /api/auth/diagnostics` (derived from the live auth state), and a Settings →
  Security banner (shown to callers that can read the `operate`-tier diagnostics;
  Security settings are operator-facing, no tier change).
- **Docs:** README auth table, CHANGELOG `Unreleased` (Security + BREAKING notes),
  `docs/faq.md` ("Empty = allow all"), and a register correction (DEP-01 / HTTP-01 /
  TOOL-01 status; TOOL-01 re-rated Low with a correction note) via DocScribe.

**BREAKING** (three user-visible changes):

1. **D3 login refusal.** Existing public-IdP deployments (`github`, `google`, or any
   key whose issuer is on the public host set) without an allowlist lose OAuth login
   after upgrade until `auth.allowedUsers` (or `auth.groupTiers`) is set, and their
   existing session cookies stop working. No config escape hatch (deliberate; see
   design D3). Localhost/trusted-host bypass and passkeys are unaffected. **Named
   residual (operator action):** passkey users, invites and device bearers created
   while sign-in was open are not revoked by the upgrade; review Settings ▸ Users and
   Settings ▸ Paired devices after upgrading (the startup warning says so). Also: removing
   a provider from `auth.providers` now revokes the sessions it issued.
2. **D1 file-route / editor-pane loss.** `~/.pi/agent/models.json`, `mcp.json` and
   the other credential files can no longer be opened through any file route or the
   editor pane (they have dedicated Settings pages; no dashboard UI links to them as
   files).
3. **D2 two MCP tools disappear.** `prompt_response` and `extension_ui_response` are no
   longer advertised or callable over MCP for any token (`tools/call` returns the
   standard unknown-tool error). Neither ever answered a prompt (the tool was broken,
   see Why); dashboard and chat answers are unchanged. A repo grep of `.claude/`,
   `.pi/{agents,skills,flows}`, `packages/*/skills`, `packages/*/agents` finds no
   orchestrator using them. An older `mcp-server-plugin` on a newer host still lists
   the broken tool; calling it remains harmless.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `trust-and-credential-boundaries`: MODIFIED "Dashboard state is never served to an
  unproven caller" — adds the pi-agent credential-file set to the always-refused tier,
  the `/api/session-file` shortcut fix, the structural post-open recheck, the case rule,
  `POST /api/file/write-binary` and plugin-registered file routes.
- `dashboard-plugin-loader`: ADDED "`ServerPluginContext` exposes a state-guarded file
  read" (optional `readFileGuarded`, the seam plugin routes use).
- `file-read-containment`: MODIFIED "File-read containment anchors at the git common
  root with a layered cwd fast path" (anchor/exception wording now names the
  credential-and-state refusal; session-directory site runs it before its in-cwd
  shortcut), "the git-root widening is unconditional and per-site anchors and error
  strings are preserved" (same wording) and "Containment decisions are bound to the path
  they decided" (its "unchanged" wording is made relative to its originating change so
  the credential-and-state refusals and the grep identity filter are allowed).
  Anchors themselves are unchanged.
- `dashboard-mcp-server`: ADDED "Prompt answers are not an MCP capability"; MODIFIED
  "A session cannot drive itself through the MCP endpoint" (drops `prompt-response`
  from the enumerated session-targeting tools). "Validation of other tools is
  unchanged" needs no change (it speaks of tools still in the allowlist).
- `mcp-tool-tiers`: MODIFIED "Session-targeting tools are covered end to end" (the
  `control` tier no longer includes the two answer tools; the "ask_user answered over
  MCP" scenario is replaced). "The tool surface is complete over a reviewed manifest"
  is satisfied as written (the new denylist entries keep the partition total).
- `chat-gateway-tier-authorization`: MODIFIED "Verb tiers come from the dashboard's
  shared effective-tier table" — the exception is "a verb with no MCP-manifest row";
  `prompt_response` joins the chat-local verbs with its tier read from the dashboard's
  `WS_MESSAGE_TIERS.prompt_response` (not a literal), because the shared table no longer
  carries it.
- `path-anchor-grants`: MODIFIED "A grant admits its own subtree and nothing more" —
  the credential-and-state refusal runs before the grant layer; a grant never admits a
  refused file.
- `oauth-authentication`: MODIFIED "OAuth callback handling" (open-enrolment refusal,
  `allowedUsers` scenario split by provider); MODIFIED "OIDC groups map to a tier"
  (unconfigured `groupTiers` keeps legacy behaviour except the open-enrolment
  refusal); ADDED "Public providers are classified from configuration, not from the key alone or
  from discovery", "Open OAuth enrolment is refused for public providers", "Sessions of
  refused or removed providers are rejected" and "Open OAuth enrolment is surfaced and
  its refusal audited".
- `shared-config`: MODIFIED "Config file location and schema" — `auth.allowedUsers`
  row: "Empty = allow all" becomes provider-specific; adds the `auth.groupTiers` row
  (config-file-only map, lifts the open-enrolment refusal).

## Impact

- Server: `lib/dashboard-state-guard.ts`, `access/verified-read.ts`, `lib/grep.ts`,
  `lib/eml.ts`, `routes/file-routes.ts` (digest, md-read), `routes/openspec-routes.ts`
  (`/api/pi-resource-file`), `routes/file-write-binary-routes.ts` +
  `lib/writable-handler-target.ts` (write-binary), `routes/grep-routes.ts` (identity filter),
  `routes/session-routes.ts` (`/api/session-file`), `live-server/live-static.ts`,
  `auth/auth.ts`, `auth/auth-plugin.ts` (+ reload sweep callback), `server.ts`,
  `terminal/terminal-gateway.ts` (`handleUpgrade` signature + session-tier stamp),
  `routes/system-routes.ts` (diagnostics).
- Plugin runtime + plugins: `dashboard-plugin-runtime/src/server/server-context.ts`
  (optional `readFileGuarded`), `flows-plugin/src/server/flow-files.ts`,
  `automation-plugin/src/server/routes.ts`.
- MCP plugin: `tools.manifest.ts` (two rows removed), `tools.denylist.ts` (three
  entries), regenerated `generated/tools.ts`, README block.
- Chat gateway: `chat-gateway/src/server/team/tier.ts` (`CHAT_LOCAL_VERB_TIERS`).
- Shared: regenerated `mcp/verb-tiers.generated.ts`; `rest-api.ts` (diagnostics type,
  if typed). No new route, no `route-tiers.ts` change; the only plugin-runtime change
  is the optional context member above (no new capability for a plugin to widen).
- Client: `SettingsPanel.tsx` Security tab banner.
- Migration/rollback/compat: see design. D3 is the user-visible auth break.

## Discipline Skills

- `security-hardening` — credential containment, removing a self-approval road from
  the agent-reachable surface, fail-closed IdP enrolment, session/socket revocation.
- `doubt-driven-review` — D1 sets an irreversible-feeling compatibility line
  (a file operators may open today) and D3 is a breaking default; review before
  they stand.
- `observability-instrumentation` — the OAuth open-enrolment refusal audit line,
  the startup/reload warning and the revoked-socket close log.

## Ownership / not in scope

| Finding | Status | Owner |
|---|---|---|
| WS-01 tokenless loopback bridge grace | Out of scope | `close-loopback-legacy-window` |
| ELEC-04 unsigned desktop binaries | Out of scope | `macos-notarization`, `windows-authenticode-signing` |
| PLUG-01 in-process server plugins | By design (accepted, documented) | — |
| TOOL-04 agent `read` of pi agent dir credentials | **Not closed here.** `encrypt-credentials-at-rest` `credential-file-guard` protects only `plugin-credentials.json` + vault files (not `auth.json`/`mcp-auth.json`/`providers.json`); path-gate read-only root unchanged | unowned residual (Medium) |
| DEP-02 symlink lexical layer | Out of scope | separate change |
| Legacy plain API keys in `~/.pi/agent/settings.json` (and project-layer `<cwd>/.pi/mcp.json`) | **Residual, not covered**: `settings.json` is pi's primary user-editable file (settings editor, previews read it). Mitigation: `pi-legacy-credentials` migration moves keys to `auth.json` (`server/src/auth/pi-legacy-credentials.ts`) | none (TOOL-04 / CRED family residual) |
| Session-side `PI_CODING_AGENT_DIR` override | **Residual**: guard reads the server process env + default `~/.pi/agent` only | none (documented) |
| TOOL-01 remaining prompt-answer roads (no MCP tool answers prompts; these remain): REST `POST /api/questions/:id/answer` (non-file kinds, `control`), browser WebSocket `prompt_response` (`pairing/browser-gateway.ts:2418`, `control`), `POST /api/access/prompts/:promptId` (`operate`) | **Residual, not closed** (finding re-rated Low; MCP road removed). Loopback needs local proof by default, which a same-host agent with a shell can obtain | none; `add-supervised-tool-approval` is `related` |
| Live-preview (`live` scope) WebSockets | **Residual**: capability-URL scoped, not session-tier; not swept on an auth reload, ends at ticket expiry (`server.ts:5022-5035`) | none |
| Plugin-registered file routes added after this change | **Process**: design D1 records a verdict per route; task 1.13 re-runs the audit; flows file + automation result/prompt are fixed through the seam | none |
| Broken `session` bind of `set_session_tags`, `edit_followup_entry`, `history_backfill` | **Residual**: not answer roads; follow-up should fix or remove the bind kind | none |
| Open-enrolment users/invites/device bearers created before upgrade (G2) | **Named residual**: operator reviews Settings ▸ Users / Paired devices | none |
| `~/.pi/agent/backups/**` and tool-made credential copies | **Residual** (not created by pi or the dashboard; not enumerable) | none |
| Windows alternate names of a credential file (`auth.json::$DATA`, 8.3 `AUTHJS~1.JSON`, trailing dot) | **Residual** (G5): content sites covered by the post-open `(dev,ino)` recheck; path-level sites (mention resolver, `tree`) may under-refuse; no Windows test row, no predicate normalisation | none |
| `/api/pi-resource-file` substring allowlist looseness | **Residual** (DEP family); only the credential refusal is added | none |
| CRED-03 already-issued tokens survive allowlist edits | **Residual**: only refused-open-enrolment and removed-provider sessions are rejected on validation | out of scope |
