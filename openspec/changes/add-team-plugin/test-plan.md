# Test Plan — add-team-plugin

Stage: design   Generated: 2026-10-03

Project teams + conversations folded 2026-10-04 (E41–E46, F23–F25; E20, E22, E25, E32, E33, F1–F3, F9,
F20, F21, X6, X7, X10 rewritten): persona `projects`, own workspace per user, many conversations per
agent × target, limit 50, archive/delete, titles.

Session files folded 2026-10-04 (E39–E40, X12): `--session-dir` pinned to pi's default per-cwd folder.

Same-origin serving folded 2026-10-04 (E37–E38, F22): plugin serves the app at `/apps/team/`,
standalone optional.

Projects folded 2026-10-04 (E29–E36, F20–F21, X10–X11): admin list + per-project user allowlist, projects
default when allowed, shared writes, per-project `contextFiles`, `--no-approve` always.

Decisions folded from the scenario gate (2026-10-03): no Phase-1 perf budget (no perf
rows); idle sweep every 5 min; name/description in Unicode code points, instructions in
UTF-8 bytes, 50 private / 200 shared persona caps (`409 persona_limit`); route rate limit
reuses mcp-server-plugin values (structural check, not a load test).

Levels: L1 = vitest (`packages/team-plugin/src/**/__tests__`, `packages/team-app/src/**/__tests__`,
host tests for D12); L3 = Playwright against the identity docker harness
(`docker/compose.test.identity.yml`, exemplar `tests/e2e/identity/two-user-isolation.spec.ts`;
port from `.pi-test-harness.json`).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | plugin-spawn-scope: mapping | EP | L1 | automated | `scope.appendSystemPrompt:["/t/persona.md"]`, `noContextFiles:true` | `pluginSpawnToSessionOptions` → `sessionFlagsToArgv` | argv contains `--append-system-prompt /t/persona.md` and `--no-context-files` |
| E2 | plugin-spawn-scope: mapping | EP | L1 | automated | `appendSystemPrompt:["/a.md","/b.md"]` | map → argv | two separate `--append-system-prompt` pairs in order |
| E3 | plugin-spawn-scope: sanitize | EP (invalid) | L1 | automated | `appendSystemPrompt:["persona.md","", "/x\u0000y", 5]`, `noContextFiles:"yes"` | map → argv | no `--append-system-prompt`, no `--no-context-files`, no throw |
| E4 | plugin-spawn-scope: omitted | regression | L1 | automated | `{cwd, model}` without scope; scope with only `tools` | map → argv | argv byte-identical to pre-change fixture; only `--tools` added |
| E5 | plugin-spawn-scope: cwd policy | EP | L1 | automated | cwd policy `{tools:["read"]}` + scope with `appendSystemPrompt`, `noContextFiles` | `mergeCwdPolicy` | the two new fields pass through unchanged |
| E6 | Persona schema and validation | BVA | L1 | automated | `name` lengths 0 · 1 · 60 · 61 code points (incl. 60 × "é" and 60 emoji) | `POST /personas` | 400 · 201 · 201 · 400 `invalid_persona`; no file written on 400 |
| E7 | Persona schema and validation | BVA | L1 | automated | `description` 280 · 281 code points | `POST` | 201 · 400 |
| E8 | Persona schema and validation | BVA | L1 | automated | `instructions` 32768 · 32769 UTF-8 bytes (multibyte content) | `POST` | 201 · 400 |
| E9 | Persona schema and validation | EP (invalid) | L1 | automated | slug `../etc`, `Backend`, `-x`, 41 chars, `a` (valid), 40 chars (valid); unknown field `foo` | `POST` | invalid ones 400 + no file anywhere under `TEAM_HOME`; valid ones 201 |
| E10 | Persona schema and validation | EP | L1 | automated | `personas/x.json` with `schemaVersion:2` beside a valid persona | `GET /personas` | 200 listing the valid one, without `x`; warning logged |
| E11 | Persona count limits | BVA | L1 | automated | alice owns 49 · 50 private personas; store has 199 · 200 shared | create private; admin creates shared | 201 · `409 persona_limit`; 201 · `409 persona_limit`; counts unchanged after 409 |
| E12 | Shared and private scopes | decision table | L1 | automated | caller ∈ {owner alice, other bob} × op ∈ {GET list, PUT, DELETE, fork} on `private:copywriter` | request | alice: listed/200/200/201; bob: absent/404/404/404 `persona_not_found` |
| E13 | Shared and private scopes + modes | decision table | L1 | automated | mode ∈ {single, multi} × scope ∈ {shared, private} × `tools:"full"` | `POST` as admin/owner | single+shared 201; single+private 400; multi+shared 400; multi+private 400 |
| E14 | Admin gate | decision table | L1 | automated | caller ∈ {listed admin, unlisted bob, local operator (identity inactive)} | `POST/PUT/DELETE` shared persona; `GET /me` | 201/200/200 · 403 `admin_required` · 201/200/200; `admin` true · false · true |
| E15 | Fork | EP + BVA | L1 | automated | fork `shared:backend` with no body; again; with `{slug:"mine"}`; with taken `{slug:"mine"}`; fork of a 40-char slug | `POST /personas/:key/fork` | `private:backend` · `private:backend-2` · `private:mine` · `409 slug_taken` · result ≤ 40 chars, matches slug regex; all have `forkedFrom` |
| E16 | Fork | EP | L1 | automated | single-user shared persona with `tools:"full"` | fork | fork has `tools:"files"` |
| E17 | Skills come from an admin catalog | EP (invalid) | L1 | automated | `skillCatalog:{review:"/s/review"}`; persona `skills:["review"]`, `["/tmp/evil"]`, `["nope"]` | `POST`; ensure | 201 and spawn scope `skills:["/s/review"]`; 400; 400 |
| E18 | Store integrity | fault-injection | L1 | automated | rename step throws after tmp write | `PUT` persona | previous file content byte-identical; no stray tmp file left |
| E19 | Store integrity | EP | L1 | automated | `TEAM_HOME` containing a symlink `agents/x → /etc` | ensure for that persona | refused; no session spawned |
| E20 | Targets (own workspace) | EP | L1 | automated | alice and bob talk to `shared:backend` in `_ws`; alice's `private:reviewer` in `_ws`; local operator in `_ws` | create (fake ctx) | alice's two agents share cwd `users/<uk-alice>/workspace/`; bob's and the operator's (`users/local/workspace/`) differ; dirs named by 32-hex `uk`; no raw `sub` in any path |
| E21 | Tool presets and confinement | decision table | L1 | automated | preset ∈ {chat, files, full} × tool ∈ {read, grep, ls, find, write, edit, bash, update_roles, canvas, codemode, mcp__x} | team extension `tool_call` | allowed exactly the preset names; every other call `{block:true}` |
| E22 | Tool presets and confinement | EP (invalid) | L1 | automated | root W = own workspace; paths `notes.md`, `../../<other-uk>/workspace/notes.md`, `/etc/passwd`, `link/passwd` (link → /etc), new `../other/new.txt`, no path arg | `read`/`write`/`grep`/`ls` | allowed · blocked · blocked · blocked · blocked · allowed (cwd = W) |
| E23 | Tool presets and confinement | fault-injection | L1 | automated | `PI_EXT_TEAM_TOOLS` missing/garbage; path arg non-string | `tool_call` | blocked |
| E24 | Persona injection | EP | L1 | automated | persona instructions containing `\nCurrent working directory: /x` | render `persona.md`, then bridge `spliceContextFragment` over a prompt with the addendum | prompt keeps full persona text and ends with the bridge fragment |
| E25 | Persona injection (stale) | EP | L1 | automated | persona edited after a conversation's `personaUpdatedAt`; another conversation started after the edit | `GET /agents?t`; `GET .../conversations?t` | first conversation `personaStale:true`, second false; card `personaStale:true`; false everywhere when not edited |
| E26 | Route authorization | decision table | L1 | automated | identity active × principal present/absent; identity inactive | any team route | 401 when active+absent; served as local operator when inactive |
| E27 | Route authorization | structural | L1 | automated | plugin route registration | inspect rate-limit registration | `max:100000`, `timeWindow:"1 minute"`, `allowList:["127.0.0.1","::1"]` |
| E28 | Route authorization (registries) | completeness | L1 | automated | all `/api/plugins/team/*` routes | `mcp-manifest-completeness` + route-tier tests | every route has a `ROUTE_TIERS` row and MCP classification |
| E29 | plugin-spawn-scope: mapping | EP | L1 | automated | `scope.noProjectTrust:true`; `noProjectTrust:"yes"` | map → argv | `--no-approve` present; absent for the non-boolean |
| E30 | Admin-configured projects | decision table | L1 | automated | project paths: relative · missing · regular file · `$HOME` (contains `TEAM_HOME`) · inside `~/.pi` · symlink resolving into `TEAM_HOME` · valid dir | plugin activation; `GET /projects` as admin | only the valid one listed; each invalid one logged `team.project_invalid` with id + reason, no path; activation succeeds |
| E31 | Admin-configured projects | decision table | L1 | automated | mode ∈ {single, multi} × `users` ∈ {`"*"`, `[alice]`} × caller ∈ {alice, bob} | `GET /projects`; ensure on that project | allowed: listed + ensure proceeds; not allowed (multi, `[alice]`, bob): absent + `404 project_not_found`, 0 spawns; unknown id → same 404; `path` only in admin responses |
| E32 | Conversations | state-transition | L1 | automated | alice: two conversations with `shared:backend` on `billing`, one on `_ws`; then deletes one `billing` conversation | create ×3; `DELETE`; list | three sessions, cwds `billing` ×2 + own workspace, three records under `conversations/<t>/shared-backend/`; after delete the other two untouched and `billing` count 1 |
| E33 | Agents per target | decision table | L1 | automated | `shared:backend` `projects:[billing]`; `shared:writer` `[_ws]`; `private:x` `[_ws, billing]`; `shared:old` removed from `billing` while alice has 2 active conversations there | `GET /agents?project=billing`; `?project=_ws` | billing: backend, x, old (`unavailable`, `unassigned`, count 2); _ws: writer, x; create with `old` on billing ⇒ `409 persona_not_in_project` |
| E34 | Tool presets and confinement (project root) | EP (invalid) | L1 | automated | root = project P; paths `src/a.ts`, `../other/x`, `link/README.md` (link → `../other-repo`), absolute path inside P, no path arg | `read`/`write`/`ls` | allowed · blocked · blocked · allowed · allowed (cwd = P) |
| E35 | Persona injection (project context) | EP | L1 | automated | project with root `AGENTS.md`; parent dir `AGENTS.md`; root `CLAUDE.md` of 65 KiB; root `AGENTS.md` symlink → outside; `contextFiles` on/off | ensure; inspect spawn `scope.appendSystemPrompt` | on: `[persona.md, <root>/AGENTS.md]` only (oversize and escaping files skipped, parent never); off: `[persona.md]`; `noContextFiles` and `noProjectTrust` true in both |
| E36 | Admin-configured projects (shared files) | EP | L1 | automated | alice and bob both allowed on `billing` | create for each (fake ctx) | two sessions, same cwd = `billing` realpath, different owners and records |
| E37 | App delivery | decision table | L1 | automated | `GET /apps/team` · `/apps/team/` · `/apps/team/assets/<hash>.js` · `/apps/team/agent/shared:backend` · `/apps/team/../../package.json` + `%2e%2e` form · build dir missing · `/session/abc` | inject into host with plugin enabled | 308 · index · file + immutable cache · index · never a file outside `dist/app/` · 503 · dashboard index (not team) |
| E38 | App delivery (admission) | EP | L1 | automated | identity enforced; untrusted non-loopback client without credential | `GET /apps/team/`; `GET /api/plugins/team/agents` | 200 HTML with no persona/user data; data route refused |
| E39 | plugin-spawn-scope: mapping | EP | L1 | automated | `scope.sessionDir` `"/s/--repo--"` · `"rel"` · `""` · `"/x\u0000y"` | map → argv | `--session-dir /s/--repo--` only for the absolute one; no throw |
| E40 | Session files (D15) | EP | L1 | automated | `/Users/a/repo`, `/tmp/x y`, `C:\work\repo` | `piSessionDirForCwd` vs pi `getDefaultSessionDir(cwd, agentDir)` | identical folder names under the same root |
| E41 | Project assignment | decision table | L1 | automated | author ∈ {admin (shared), alice (private, allowed on billing only)} × `projects` ∈ {omitted, `[]`, `[_ws]`, `[billing]`, `[crm]`, `[nope]`, 51 entries, duplicates} | `POST /personas` | omitted ⇒ stored `[_ws]`; `[]`, `[nope]`, 51, duplicates ⇒ 400; admin `[crm]` 201; alice `[crm]` 400 `invalid_persona`, nothing written |
| E42 | Fork (projects) | EP | L1 | automated | alice allowed on `billing` forks shared personas with `projects` `[billing, crm]` · `[crm]` | `POST /personas/:key/fork` | fork `projects` `[billing]` · `[_ws]` |
| E43 | Conversations (limit) | BVA | L1 | automated | alice has 49 · 50 active (+3 archived) conversations with `shared:backend` on `billing`; restore one archived at 50 | create; `PATCH {archived:false}` | 49→201; 50→`409 conversation_limit`, 0 spawns; archived not counted; restore at 50 ⇒ `409 conversation_limit` |
| E44 | Conversation titles | EP | L1 | automated | user title set; no user title + session name; neither + first prompt of 200 chars; nothing; `PATCH {title}` 0 · 80 · 81 code points | list; `PATCH` | user title · session name · 60-code-point excerpt · "Beszélgetés · <date>"; 400 · 200 · 400 |
| E45 | Conversations (delete) | EP | L1 | automated | conversation with live session | `DELETE`; then ensure; check disk | session ended; ensure ⇒ `404 conversation_not_found`; record gone; session file still on disk |
| E46 | Route authorization (conversation ids) | EP (invalid) | L1 | automated | bob uses alice's conversation id on every conversation route | request | `404 conversation_not_found` identically; nothing spawned or changed |
| E47 | Two hosts | decision table | L1 | automated | host mode ∈ {embedded (`capabilities.dashboard:true`), standalone (identity `oidc` · `none`)} | render app shell | embedded: selector in `HeaderContext`, no sign-in/user/language/theme controls, "Megnyitás a dashboardon" present, title via `setTitle`; standalone: `StandaloneBar` with selector, sign-in state, HU/EN, theme; no dashboard item |
| E48 | Folder-enabled projects and folder matching | decision table | L1 | automated | projects `/repo`, `/repo/billing-api` (alice allowed), `crm` (not allowed); cwds equal · subfolder · other subfolder of `/repo` · symlink to billing-api · crm folder · unrelated · sibling worktree | `POST /projects/match` as alice | billing-api · billing-api · `/repo` · billing-api · none · none · `/repo`; never spawns |
| E49 | Folder-enabled projects and folder matching | decision table | L1 | automated | mode {single, multi} × caller {admin/operator, bob} × path {valid, `$HOME`, inside `~/.pi`, missing, already a project} | `POST /projects` | allowed: 201 / 400 / 400 / 400 / `409 project_exists`; bob multi: 403, nothing stored; id slug uniquified vs config |
| E50 | Folder-enabled projects and folder matching | state-transition | L1 | automated | config `billing`; folder-enabled `mkt` with 2 conversations | PATCH/DELETE billing; DELETE mkt; ensure; re-enable | `409 project_readonly`; records kept; `409 project_unavailable`; re-enable restores |
| E51 | Folder-enabled projects (known users) | EP | L1 | automated | alice, bob hit `/me`; `GET /users` as admin, bob; single-user | request | admin lists both; bob 403; single-user 404 |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Conversations (ensure) | state-transition | L1 | automated | fake ctx; created conversation | ensure (live) → end session → ensure | reuse (same id, 0 spawns) · resume (`resume.sessionFile` = recorded file, owner re-stamped); record updated once per start |
| F2 | Conversations (ensure) | state-transition (illegal) | L1 | automated | record whose live session has another `principalOwner`; record whose cwd ≠ target; recorded file missing; file with no persisted owner | ensure | none reused/resumed; `409 conversation_unrecoverable`, 0 spawns; foreign session untouched |
| F3 | Single-flight per conversation | concurrency | L1 | automated | two simultaneous ensures for one conversation; one each for two conversations of the same agent | ensure | 1 spawn, same `sessionId` for both; two conversations → two spawns and both records intact (no lost update) |
| F4 | Correlation by nonce | concurrency | L1 | automated | spawn A times out (aborted); A's session registers late; spawn B succeeds | resolve events A then B | record binds B only |
| F5 | Agent status | state-transition | L1 | automated | sessions in states none / ended / live idle / streaming / persona deleted / `full` in multi-user | `GET /agents` | `new` · `sleeping` · `running` · `busy` · `retired` (name/avatar/role from snapshot) · `unavailable`; 0 spawns during listing |
| F6 | Idle ending | BVA | L1 | automated | `lastAgentEndAt` = now−29 min · now−31 min · streaming for 45 min; `idleMinutes:0` | sweep tick (fake clock, 5-min cadence) | not ended · ended gracefully · not ended · never ended |
| F7 | Idle ending | EP | L1 | automated | replayed `agent_end` for own session; live `agent_end` for a foreign session | `onEvent` | `lastAgentEndAt` unchanged in both cases |
| F8 | Idle ending | restart | L1 | automated | record with `lastAgentEndAt` = now−31 min | plugin re-activates, sweep runs | session ended (idleness survived restart) |
| F9 | Conversations (restart, archive) | state-transition | L1 | automated | live conversation | `restart` then ensure; `PATCH {archived:true}`; `PATCH {archived:false}` then ensure | restart: ended, record kept, next ensure = resume (same file); archive: session ended, hidden from default list, not counted; restore: listed again, ensure resumes |
| F10 | Team grid | convergence | L1 | automated | grid with mocked `/agents` returning `running` then `busy` | 5 s poll tick (fake timers); tab hidden | card shows `busy` after one tick; no polling while hidden |
| F11 | Team grid | decision table | L1 | automated | admin vs non-admin × shared/private/retired/unavailable/`personaStale` cards | render | admin shared: edit+delete; non-admin shared: fork only; retired/unavailable: no conversation action; stale: "Restart to apply" |
| F12 | Persona editor | EP | L1 | automated | 61-code-point name; server 400 field error; non-admin user | save; open editor | name field shows error, no PUT retried; `full` option absent for private and in multi-user |
| F13 | Agent conversation | state-transition | L1 | automated | conversation view with fake socket replaying 5 messages | socket drops and reconnects with replay of the same 5 + 1 new | transcript shows 6 messages, each once; `CommandInput.onSend` sends over the socket |
| F14 | Agent conversation | e2e | L3 | automated | alice signed in via Keycloak, persona `shared:backend` | open agent, send prompt, reload app, reopen agent | earlier prompt + reply visible; new prompt continues the same `sessionId` |
| F15 | Shared and private scopes (multi-user) | e2e | L3 | automated | alice and bob (exemplar `two-user-isolation.spec.ts`) | alice creates `private:copywriter` and opens it; bob loads grid and tries to subscribe to alice's `sessionId` over his socket | bob's grid lacks it; bob's subscribe is refused by the host |
| F16 | Persona injection | e2e | L3 | automated | admin edits `shared:backend` while alice's session is live | alice's card → "Restart to apply" → prompt | card flags stale; after restart transcript intact and the reply follows the new instructions (faux model echoes the persona marker) |
| F17 | App delivery (standalone) | e2e | L3 | automated | app served from its own origin, listed in `cors.allowedOrigins` | open signed out | OIDC redirect; no `/api/plugins/team/*` request before sign-in; grid after sign-in |
| F18 | Language, theme, a11y | EP | L1 | automated | app chrome | toggle HU→EN; tab through grid; axe scan | all strings switch without reload; HU/EN catalogs have identical key sets; visible focus; no icon-only button without accessible name |
| F19 | Team grid look | visual | — | manual-only | grid, editor, conversation vs approved mockup | human review | [judgment: matches approved Marveen-style mockup, light + dark] |
| F20 | Team grid | EP | L1 | automated | `/agents?t` with an agent `busy` (3 conversations, latest 2 h ago), one `new` (0), one `unassigned` (1) | render | card shows status + "3 beszélgetés · 2 órája"; primary opens the latest conversation; `new` card's primary creates the first; `unassigned` card has no new-conversation action but links its conversations |
| F21 | Agent conversation (list) | state-transition | L1 | automated | agent with 2 active + 1 archived conversation; fake sockets per session; limit reached variant | open list; switch between the two; toggle archived filter; rename; limit variant | each shows only its own transcript, unchanged on return; archived only under the filter; rename updates the list; at the limit "New conversation" is disabled with its reason |
| F22 | App delivery (same origin) | e2e | L3 | automated | alice signed out; plugin enabled; no standalone service | open `<dashboard>/apps/team/agent/shared:backend` | dashboard login → back on that agent; no `/api/plugins/team/*` before sign-in; prompt round-trip works |
| F23 | Single-flight (creates at the limit) | concurrency | L1 | automated | alice at 49 active; two creates arrive together | create ×2 | exactly one 201 and one `409 conversation_limit`; 50 active afterwards |
| F24 | Project selector | state-transition | L1 | automated | `/projects` with `billing`, `crm` (`available:false`); stored `team:target` = `crm` · `billing` · none; no projects | app boot; select own workspace; reload | start target `billing` (crm unavailable) · `billing` · `billing`; `crm` disabled with reason; selection remembered; no projects ⇒ plain label, no menu; switching re-requests `/agents?t` |
| F25 | Persona editor (projects) | EP | L1 | automated | non-admin opens editor from empty project `billing`; unticks all; admin editing a shared persona | render; save | new private persona preselects `_ws` + `billing`; options = `_ws` + allowed projects; all unticked ⇒ field error, no request; admin sees every configured project |
| F26 | Two hosts | EP | L1 | automated | `basePath` `/team` · `/folder/<enc>/team` · `/apps/team`; deep link `<base>/agent/shared:backend?project=billing`; selector switched to `_ws` from a `HeaderContext` outside the app `Router` | render; select | same view in both; store and `?project=` both `_ws`; all requests via `host.api.fetch` |
| F27 | Folder entry | decision table | L1 | automated | folders matched (folder-enabled), matched (config), unmatched × caller admin / member / operator | render folder slot + menu | row + OPEN only when matched; settings/disable only folder-enabled + admin/operator; enable only unmatched + admin/operator; one batched match call |
| F28 | Folder entry | EP | L1 | automated | folder claim inside `billing`; enable dialog blank name / "selected" with none | render; save | locked selector + "Teljes csapat" → `/team/?project=billing`; field errors, no POST |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | One persistent session | fault-injection (delay) | L1 | automated | host never resolves the spawn | ensure (fake clock 30 s) | `504 spawn_timeout`; `abortSpawnedRun` called with the plugin-minted `spawnToken`; no record written |
| X2 | Guard required | fault-injection (abort) | L1 | automated | extension file missing at activation | any ensure | `503 guard_unavailable`; 0 spawns |
| X3 | Guard required | fault-injection (abort) | L1 | automated | session resolves but no `team_guard_ready` message | ensure | session aborted; `503 guard_unavailable`; no record |
| X4 | Persona injection | fault-injection | L1 | automated | `persona.md` deleted between render and spawn | ensure | spawn not issued; error `persona_render_failed` logged; 500 with code, no record |
| X5 | Persona injection | integration | L1 | automated | bridge extension + team spawn options, agent-dir `AGENTS.md` with marker `OPERATOR-SECRET` | build provider-bound prompt (pi SDK, faux provider) | contains persona marker and the bridge fragment; does not contain `OPERATOR-SECRET` |
| X6 | Persona deletion retires | fault-injection | L1 | automated | persona deleted while alice has conversations with it | ensure one of them; `GET /agents?t` | `404 persona_not_found`; card `retired` from the snapshot; records, workspace and session files untouched; archive/delete still allowed |
| X7 | Route observability | log assertion | L1 | automated | ensure outcomes create/reuse/resume/timeout/unrecoverable | create; ensure | one `team.ensure` log line each with `uk`, `personaKey`, `t`, `c`, `outcome`, `sessionId`; no persona name/instructions, title or path in any line |
| X8 | Standalone app | fault-injection | L1 | automated | descriptor unreachable; host 403 in `none` mode | app boot | "sign-in unavailable" view, no team data; "not admitted" view explaining single-user needs network admission |
| X9 | Standalone app | e2e fault | L3 | automated | dashboard restarted while alice is in a conversation | wait for reconnect | conversation reconnects with a fresh ticket; no duplicated messages |
| X10 | Admin-configured projects | fault-injection | L1 | automated | allowed project's directory deleted after activation; existing conversation on it | create; ensure; `GET /projects` | `409 project_unavailable`, 0 spawns; `available:false`; record kept |
| X11 | Persona injection (project trust) | integration | L1 | automated | project with `.pi/extensions/x.ts` (registers tool `marker_tool`) and `.pi/SYSTEM.md` with marker `PROJECT-SYSTEM`; bridge extension loaded; saved trust for the project in `trust.json` | spawn argv from team options; build provider-bound prompt (pi SDK, faux provider) | argv contains `--no-approve`; `marker_tool` not registered; prompt lacks `PROJECT-SYSTEM` |
| X12 | Persona injection (session files) | integration | L1 | automated | project with `.pi/settings.json` `sessionDir:"./.sessions"`; real pi spawn with team options (faux provider) | ensure, prompt, rerun host discovery, ensure | file in `piSessionDirForCwd(project)`, nothing under `project/.sessions`; rediscovered with owner; second ensure resumes |
| X13 | Two hosts | fault-injection | L1 | automated | team-plugin on a dashboard without `EmbeddedApp`; library entry | plugin load; import `./app` | activates, no embedded route, `/apps/team/` served; entry exports `id:"team"`, no global CSS, no `createRoot` |
| X14 | Folder entry | fault-injection | L1 | automated | no app host (`EmbeddedApp`); match endpoint 500 | open from folder; render sidebar | standalone `/apps/team/?project=` in a new tab; on 500 no row/item, no error |

---

## Coverage summary

- Requirements covered: 31/31 (team-personas 9, team-agent-sessions 11, team-app 8, plugin-spawn-scope 3)
- Scenarios by class: edge 51 · perf 0 · frontend 28 · error 14
- Scenarios by level: L1 86 · L2 0 · L3 6 · manual 1
- Scenarios by disposition: automated 92 · manual-only 1

## New infra needed

- Identity harness additions: same-origin app via the enabled plugin (primary); standalone team-app static service, its origin in `cors.allowedOrigins`,
  a Keycloak public client with audience mapper, a faux model provider that echoes a
  persona marker (F14, F16). Extends `docker/compose.test.identity.yml`; no new level.
