# Test Plan — add-team-plugin

Stage: design   Generated: 2026-10-03

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
| E20 | Per-user agent workspace | EP | L1 | automated | alice and bob open `shared:backend`; local operator opens it | ensure (fake ctx) | three distinct cwds; alice/bob dirs named by 32-hex `uk`, operator under `users/local/`; no raw `sub` in any path |
| E21 | Tool presets and confinement | decision table | L1 | automated | preset ∈ {chat, files, full} × tool ∈ {read, grep, ls, find, write, edit, bash, update_roles, canvas, codemode, mcp__x} | team extension `tool_call` | allowed exactly the preset names; every other call `{block:true}` |
| E22 | Tool presets and confinement | EP (invalid) | L1 | automated | workspace W; paths `notes.md`, `../../<other-uk>/agents/x/notes.md`, `/etc/passwd`, `link/passwd` (link → /etc), new `../other/new.txt`, no path arg | `read`/`write`/`grep`/`ls` | allowed · blocked · blocked · blocked · blocked · allowed (cwd = W) |
| E23 | Tool presets and confinement | fault-injection | L1 | automated | `PI_EXT_TEAM_TOOLS` missing/garbage; path arg non-string | `tool_call` | blocked |
| E24 | Persona injection | EP | L1 | automated | persona instructions containing `\nCurrent working directory: /x` | render `persona.md`, then bridge `spliceContextFragment` over a prompt with the addendum | prompt keeps full persona text and ends with the bridge fragment |
| E25 | Persona injection | EP | L1 | automated | persona edited after instance `personaUpdatedAt` | `GET /agents` | instance `personaStale:true`; false when not edited |
| E26 | Route authorization | decision table | L1 | automated | identity active × principal present/absent; identity inactive | any team route | 401 when active+absent; served as local operator when inactive |
| E27 | Route authorization | structural | L1 | automated | plugin route registration | inspect rate-limit registration | `max:100000`, `timeWindow:"1 minute"`, `allowList:["127.0.0.1","::1"]` |
| E28 | Route authorization (registries) | completeness | L1 | automated | all `/api/plugins/team/*` routes | `mcp-manifest-completeness` + route-tier tests | every route has a `ROUTE_TIERS` row and MCP classification |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | One persistent session | state-transition | L1 | automated | fake ctx; no record | ensure → ensure (live) → end session → ensure | outcomes spawn · reuse (same id, 0 spawns) · resume (`resume.sessionFile` = recorded file, owner re-stamped); record updated once per start |
| F2 | One persistent session | state-transition (illegal) | L1 | automated | record whose live session has another `principalOwner`; record whose cwd ≠ workspace; archived file with no owner | ensure | none reused/resumed; fresh spawn each; foreign session untouched |
| F3 | Single-flight | concurrency | L1 | automated | two simultaneous ensures for (alice, backend); one each for (alice, backend) + (alice, writer) | ensure | 1 spawn, same `sessionId` for both; two personas → two spawns and both instance files present (no lost update) |
| F4 | Correlation by nonce | concurrency | L1 | automated | spawn A times out (aborted); A's session registers late; spawn B succeeds | resolve events A then B | record binds B only |
| F5 | Agent status | state-transition | L1 | automated | sessions in states none / ended / live idle / streaming / persona deleted / `full` in multi-user | `GET /agents` | `new` · `sleeping` · `running` · `busy` · `retired` (name/avatar/role from snapshot) · `unavailable`; 0 spawns during listing |
| F6 | Idle ending | BVA | L1 | automated | `lastAgentEndAt` = now−29 min · now−31 min · streaming for 45 min; `idleMinutes:0` | sweep tick (fake clock, 5-min cadence) | not ended · ended gracefully · not ended · never ended |
| F7 | Idle ending | EP | L1 | automated | replayed `agent_end` for own session; live `agent_end` for a foreign session | `onEvent` | `lastAgentEndAt` unchanged in both cases |
| F8 | Idle ending | restart | L1 | automated | record with `lastAgentEndAt` = now−31 min | plugin re-activates, sweep runs | session ended (idleness survived restart) |
| F9 | Reset / restart | state-transition | L1 | automated | live session | `restart` then ensure; `reset` then ensure | restart: ended, record kept, next ensure = resume (same transcript file); reset: record deleted, next ensure = fresh spawn, workspace files still present |
| F10 | Team grid | convergence | L1 | automated | grid with mocked `/agents` returning `running` then `busy` | 5 s poll tick (fake timers); tab hidden | card shows `busy` after one tick; no polling while hidden |
| F11 | Team grid | decision table | L1 | automated | admin vs non-admin × shared/private/retired/unavailable/`personaStale` cards | render | admin shared: edit+delete; non-admin shared: fork only; retired/unavailable: no conversation action; stale: "Restart to apply" |
| F12 | Persona editor | EP | L1 | automated | 61-code-point name; server 400 field error; non-admin user | save; open editor | name field shows error, no PUT retried; `full` option absent for private and in multi-user |
| F13 | Agent conversation | state-transition | L1 | automated | conversation view with fake socket replaying 5 messages | socket drops and reconnects with replay of the same 5 + 1 new | transcript shows 6 messages, each once; `CommandInput.onSend` sends over the socket |
| F14 | Agent conversation | e2e | L3 | automated | alice signed in via Keycloak, persona `shared:backend` | open agent, send prompt, reload app, reopen agent | earlier prompt + reply visible; new prompt continues the same `sessionId` |
| F15 | Shared and private scopes (multi-user) | e2e | L3 | automated | alice and bob (exemplar `two-user-isolation.spec.ts`) | alice creates `private:copywriter` and opens it; bob loads grid and tries to subscribe to alice's `sessionId` over his socket | bob's grid lacks it; bob's subscribe is refused by the host |
| F16 | Persona injection | e2e | L3 | automated | admin edits `shared:backend` while alice's session is live | alice's card → "Restart to apply" → prompt | card flags stale; after restart transcript intact and the reply follows the new instructions (faux model echoes the persona marker) |
| F17 | Standalone app | e2e | L3 | automated | app served from its own origin, listed in `cors.allowedOrigins` | open signed out | OIDC redirect; no `/api/plugins/team/*` request before sign-in; grid after sign-in |
| F18 | Language, theme, a11y | EP | L1 | automated | app chrome | toggle HU→EN; tab through grid; axe scan | all strings switch without reload; HU/EN catalogs have identical key sets; visible focus; no icon-only button without accessible name |
| F19 | Team grid look | visual | — | manual-only | grid, editor, conversation vs approved mockup | human review | [judgment: matches approved Marveen-style mockup, light + dark] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | One persistent session | fault-injection (delay) | L1 | automated | host never resolves the spawn | ensure (fake clock 30 s) | `504 spawn_timeout`; `abortSpawnedRun` called with the plugin-minted `spawnToken`; no record written |
| X2 | Guard required | fault-injection (abort) | L1 | automated | extension file missing at activation | any ensure | `503 guard_unavailable`; 0 spawns |
| X3 | Guard required | fault-injection (abort) | L1 | automated | session resolves but no `team_guard_ready` message | ensure | session aborted; `503 guard_unavailable`; no record |
| X4 | Persona injection | fault-injection | L1 | automated | `persona.md` deleted between render and spawn | ensure | spawn not issued; error `persona_render_failed` logged; 500 with code, no record |
| X5 | Persona injection | integration | L1 | automated | bridge extension + team spawn options, agent-dir `AGENTS.md` with marker `OPERATOR-SECRET` | build provider-bound prompt (pi SDK, faux provider) | contains persona marker and the bridge fragment; does not contain `OPERATOR-SECRET` |
| X6 | Persona deletion retires | fault-injection | L1 | automated | persona deleted while alice's instance exists | `POST /agents/:key/session` | `404 persona_not_found`; record, workspace and session file untouched |
| X7 | Route observability | log assertion | L1 | automated | ensure outcomes reuse/resume/spawn/timeout | ensure | one `team.ensure` log line each with `uk`, `personaKey`, `outcome`, `sessionId`; no persona name/instructions in any line |
| X8 | Standalone app | fault-injection | L1 | automated | descriptor unreachable; host 403 in `none` mode | app boot | "sign-in unavailable" view, no team data; "not admitted" view explaining single-user needs network admission |
| X9 | Standalone app | e2e fault | L3 | automated | dashboard restarted while alice is in a conversation | wait for reconnect | conversation reconnects with a fresh ticket; no duplicated messages |

---

## Coverage summary

- Requirements covered: 22/22 (team-personas 8, team-agent-sessions 8, team-app 5, plugin-spawn-scope 3 — "Single-flight" and "Correlation" counted under persistent session)
- Scenarios by class: edge 28 · perf 0 · frontend 19 · error 9
- Scenarios by level: L1 50 · L2 0 · L3 5 · manual 1
- Scenarios by disposition: automated 55 · manual-only 1

## New infra needed

- Identity harness additions: team-app static service, its origin in `cors.allowedOrigins`,
  a Keycloak public client with audience mapper, a faux model provider that echoes a
  persona marker (F14, F16). Extends `docker/compose.test.identity.yml`; no new level.
