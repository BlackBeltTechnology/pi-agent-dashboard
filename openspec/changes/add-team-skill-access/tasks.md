## 1. Spikes (de-risk before building)

- [x] 1.1 Spike: mutating `before_agent_start.systemPromptOptions.skills` in place drops the filtered skills from the provider-bound prompt while every other prompt fragment survives (design D10).
- [x] 1.2 Spike: `input` returning `{action:"handled"}` stops skill expansion for every source; found that the bridge expands `/skill:` itself (design D12).
- [x] 1.3 Resolve the D11 host seam: plugin service registry `host.listOperatorSkills` (design D11).

Spike results are recorded in design.md D10, D11 and D12; scripts are in `spikes/`. Every test task in section 8 is written first (red), then the implementation task that turns it green.

## 2. Shared + host

- [x] 2.1 `packages/shared`: export `parseSkillCommand(text)` (design D13).
- [x] 2.2 `packages/server/src/pi/pi-resource-scanner.ts`: export `listGlobalSkills(globalDir)` (global skills + global-settings packages, never local). Register `host.listOperatorSkills` in `server.ts` beside `host.isProjectTrusted`.

## 3. Catalog service (team-plugin server)

- [x] 3.1 `skills-service.ts`: normalisation (legacy string, defaults), pi-name rule + `name_mismatch`, path validation (absolute, ≤ 512 bytes, realpath dir with `SKILL.md`, bidirectional exclusion of team home, project roots, agent dir, sessions root, dashboard home), config-wins precedence, `skills.json` load (`schemaVersion: 1`, `managedLoadError`), in-process write mutex, catalog epoch.
- [x] 3.2 `allowed()` predicate (exact principal match, single-user ignores users) and `firstBlockedSkill(personaSkills, caller, target)` (design D14).
- [x] 3.3 `configSchema.json`: `skillCatalog` values `string | {path, users?, targets?}`; update `types.ts`.
- [x] 3.4 Routes: `GET|POST /skills`, `PATCH|DELETE /skills/:name`, `POST /skills/:name/impact`, `GET /skills/available`; `GET /me.skills` caller-visible; `GET /agents` items gain `effectiveSkills` + `skillBlock`; description memo by `SKILL.md` `(realpath, mtimeMs, size)`; admin usage counts.
- [x] 3.5 Observability (`team.skills_narrowed` emits from the slice-C composition refusal, task 5.1; the other three lines land here): `team.skill_write`, `team.skill_not_allowed`, `team.skill_invalidated`, `team.skills_narrowed`; no paths or skill text.

## 4. Persona validation

- [x] 4.1 `persona.ts` `PersonaRules` + `personas-service.ts`: skills allowed for every target (+ owner on private), `fields.skills="skill_not_allowed"`; fork keeps only allowed skills.

## 5. Spawn + invalidation (team-plugin server)

- [x] 5.1 `conversations.ts`: `firstBlockedSkill` on create, resume and reuse (reuse ends the live session); `409 skill_not_allowed {skill, reason}`; `scope.noSkills: true` + `scope.skills`; `extensionConfig.team.skills = JSON.stringify([{name, root}])` (always set, `"[]"` when empty); refuse when cwd-policy composition narrows the set.
- [x] 5.2 Catalog epoch: re-check after the session correlates; abort + `409` when blocked.
- [x] 5.3 `invalidateSkill(name)` server-authority pass modelled on `sweepIdle`: owner-binding check, `abortSpawnedRun({graceful:false})`, only for sessions whose grant changed (denied, removed, `realpath` changed), within 5 s of the write's 2xx, audit-logged; reachable only from a successful admin catalog write.

## 6. Guard extension (team-plugin)

- [x] 6.1 `guard.ts`: `policyFromEnv` parses `PI_EXT_TEAM_SKILLS` (missing/unparseable → `null`); read-only tools allowed inside skill roots via `canonicalize`/`inside`; write/edit stay root-confined.
- [x] 6.2 `index.ts`: `before_agent_start` in-place filter on `(name, canonical filePath)`; `input` refusal of ungranted `parseSkillCommand` names and out-of-root `parseSkillBlock` envelopes (`handled`, no `ctx.ui.notify`).

## 7. Bridge (packages/extension) — team-session skill route (design D12)

- [x] 7.1 `command-handler.ts`: in team-confined sessions, `parseSkillCommand` runs before `parseSendPrompt`; granted names expand via `readTemplate` + `buildSkillBlock`; refusals and read failures emit `prompt_received{fresh:false}` + `command_feedback{status:"error"}` and are never queued; no `expandPromptTemplateFromDisk`; multi-line other `/` text sent verbatim; `sessionPrompt`, flow fast-path, extension dispatch and exec templates unreachable.

## 8. Tests (folded from test-plan.md, one task per manifest row)

### L1 — team-plugin server (exemplar: `packages/team-plugin/src/server/__tests__/personas.test.ts`, `conversations.test.ts`, `harness.ts`)

- [x] 8.1 Test legacy string normalisation — input config `{review: "/opt/skills/review"}` · trigger normalise · observable `{path, users:"*", targets:"*"}` (test-plan #E1).
- [x] 8.2 Test default users/targets — input `{review:{path}}` · trigger normalise · observable `users:"*"`, `targets:"*"` (test-plan #E2).
- [x] 8.3 Test the `allowed` decision table — input mode × users × targets (12 combos) · trigger `allowed()` · observable true only for (single or users-match) ∧ targets-match (test-plan #E3).
- [x] 8.4 Test exact principal match — input `sub:"Alice"` entry vs caller `sub:"alice"` · trigger `allowed()` · observable false (test-plan #E4).
- [x] 8.5 Test name mismatch — input `POST {name:"review"}` at a `code-review` skill · trigger create · observable `400 invalid_skill fields.name="name_mismatch"`, file unchanged (test-plan #E5).
- [x] 8.6 Test directory-name fallback — input skill dir `review/` without frontmatter name · trigger create · observable `201` (test-plan #E6).
- [x] 8.7 Test pi name BVA — input names `a`, 64×a, 65×a, `-a`, `a-`, `a--b`, `A`, `a:b` · trigger create · observable first two `201`, rest `400` (test-plan #E7).
- [x] 8.8 Test path length/absolute BVA — input 512-byte, 513-byte, relative paths · trigger create · observable 512 passes, others `400` (test-plan #E8).
- [x] 8.9 Test non-directory skill paths — input single `.md`, dir without `SKILL.md`, `SKILL.md` that is a dir · trigger create · observable each `400 invalid_skill` (test-plan #E9).
- [x] 8.10 Test bidirectional path exclusion — input paths inside team home / inside project / equal to project / ancestor `/data` / `~/.pi` / `~/.pi/dashboard` / `~/.pi/agent/skills/review` · trigger create · observable six `400`, last `201` (test-plan #E10).
- [x] 8.11 Test path turned invalid after grant — input granted dir re-pointed by symlink to `/etc` · trigger next ensure · observable `409 reason:"invalid"`, log without path (test-plan #E11).
- [x] 8.12 Test config vs managed decision table — input name source × caller role · trigger POST/PATCH/DELETE · observable `403` / `409 skill_readonly` / `409 skill_exists` / config wins with `shadowed_by_config` (test-plan #E12).
- [x] 8.13 Test bad `skills.json` — input `schemaVersion: 2` and truncated JSON · trigger load + GET + POST · observable plugin runs, `managedLoadError`, POST `503 skill_store_unavailable`, file bytes unchanged (test-plan #E13).
- [x] 8.14 Test caller-scoped listing — input `review` targets `[crm]`, alice on billing only · trigger alice GET `/skills` + `/me` · observable `review` absent; admin listing has source/valid/usage (test-plan #E14).
- [x] 8.15 Test available list without host service — input host lacking `host.listOperatorSkills` · trigger admin and non-admin `GET /skills/available` · observable `200 []` and `403` (test-plan #E16).
- [x] 8.16 Test impact preview — input narrowing/remove/widening bodies with 2 live sessions · trigger `POST /skills/review/impact` · observable `endSessions`, `blockedPersonas.lostTargets`, `otherUsersPrivate` as in the manifest; nothing written or ended (test-plan #E17).
- [x] 8.17 Test `effectiveSkills` + `skillBlock` in `GET /agents` — input persona `[review, legacy]` across four failure reasons · trigger list agents · observable matching `skillBlock`, status `unavailable`, no path (test-plan #E18).
- [x] 8.18 Test listing/ensure parity — input E18 fixtures · trigger ensure and list · observable `409 {skill, reason}` equals `skillBlock` (test-plan #E19).
- [x] 8.19 Test shared persona skills vs targets — input `projects:[billing,crm]`, review targets variants · trigger admin save · observable `400 skill_not_allowed` only when not allowed in crm (test-plan #E20).
- [x] 8.20 Test private persona owner check — input review users `[bob]`, alice saves, mode multi/single · trigger save · observable multi `400`, single `200` (test-plan #E21).
- [x] 8.21 Test fork filtering — input shared persona `[review, all-ok]`, review users `[bob]` · trigger alice fork · observable fork skills `["all-ok"]` (test-plan #E22).
- [x] 8.22 Test spawn argv + env — input persona skills `[]` and `[review]` · trigger ensure create · observable `--no-skills` (+ `--skill <realpath>`), `PI_EXT_TEAM_SKILLS` `"[]"` / JSON (test-plan #E23).
- [x] 8.23 Test start check on reuse/resume/create — input config-narrowed catalog with a live session · trigger each ensure path · observable reuse ends session + `409`, others `409`, nothing spawned, record unchanged (test-plan #E24).
- [x] 8.24 Test composition narrowing — input stub cwd-policy intersecting skills to `[]` · trigger ensure · observable `409 reason:"invalid"`, `team.skills_narrowed` (test-plan #E25).
- [x] 8.25 Test concurrent create — input two same-tick `POST {name:"review"}` · trigger await both · observable one `201`, one `409`, one entry (test-plan #X3).
- [x] 8.26 Test check-then-act epoch — input managed revocation between D6 check and correlation · trigger correlation · observable abort, `409`, no record (test-plan #X4).
- [x] 8.27 Test cross-user authority — input bob ensure/restart/PATCH against alice's conversation or skill · trigger requests · observable `404`/`403`, alice untouched; invalidation pass only after admin 2xx and skips owner-mismatched records (test-plan #X5).
- [x] 8.28 Test observability lines — input a refused spawn, a catalog write, an invalidation of 2 sessions · trigger capture logger · observable the three lines, no path or skill text (test-plan #X6).

### L1 — host scanner (exemplar: `packages/server/src/__tests__/pi-resource-scanner.test.ts`)

- [x] 8.29 Test `listGlobalSkills` excludes project-local — input global `g1`, package `p1`, local `local-x` · trigger `listGlobalSkills(globalDir)` · observable `g1`, `p1` only (test-plan #E15).

### L1 — guard (exemplar: `packages/team-plugin/src/extension/__tests__/guard.test.ts`)

- [x] 8.30 Test skill-root grant decision table — input tools × paths in/sibling/symlink-out/`..` · trigger `decideToolCall` · observable read-only allowed inside root; write/edit and escapes blocked (test-plan #E26).
- [x] 8.31 Test skill policy parsing — input `PI_EXT_TEAM_SKILLS` unset / bad JSON / bad shape / `"[]"` · trigger `policyFromEnv` · observable `null` ×3, empty-skills policy for `"[]"` (test-plan #E27).
- [x] 8.32 Test prompt filter — input granted, leaked, same-name-other-dir, planted-in-root, symlinked-path skills · trigger `before_agent_start` · observable in-place array with only the canonical granted skill; nothing else changed; no `systemPrompt` returned (test-plan #E28).
- [x] 8.33 Test input refusal table — input the ten texts in the manifest · trigger `input` · observable `handled` for ungranted command and out-of-root envelope, `continue` otherwise; `ctx.ui.notify` never called (test-plan #E29).
- [x] 8.34 Test missing policy aborts the spawn — input env without `PI_EXT_TEAM_SKILLS` · trigger `session_start` + ensure · observable no readiness, `503 guard_unavailable`, no record (test-plan #X2).

### L1 — shared (exemplar: `packages/shared/src/__tests__/skill-block-parser.test.ts`)

- [x] 8.35 Test `parseSkillCommand` BVA — input the eight strings in the manifest · trigger parse · observable the listed results (test-plan #E30).

### L1 — bridge (exemplar: `packages/extension/src/__tests__/command-handler.test.ts`, `prompt-expander.test.ts`)

- [x] 8.36 Test team envelope byte-identity — input `SKILL.md` with frontmatter, args `check it` · trigger team route vs `expandPromptTemplateFromDisk` · observable identical strings, `parseSkillBlock` round-trips (test-plan #E31).
- [x] 8.37 Test team routing carve-out — input the ten team-session inputs in the manifest · trigger `send_prompt` · observable granted single send without expansion flag, refusals settled, verbatim multi-line, nothing dispatched/executed; spies on `expandPromptTemplateFromDisk`, `sessionPrompt`, `tryDispatchExtensionCommand`, `tryExecSlashTemplate` never called (test-plan #E32).
- [x] 8.38 Test non-team regression — input same inputs without `PI_EXT_TEAM_TOOLS` · trigger `send_prompt` · observable unchanged behavior, existing suite green (test-plan #E33).
- [x] 8.39 Test unreadable granted skill — input granted `SKILL.md` deleted after spawn · trigger `/skill:review go` · observable no send, settlement + error feedback, no fallback (test-plan #X1).

### L1 — team-app (exemplar: `packages/team-app/src/__tests__/persona-editor.test.tsx`, `team-grid.test.tsx`, `chat-session.test.tsx`)

- [x] 8.40 Test editor auto-untick — input `review` (billing only) ticked · trigger tick `crm` · observable unticked + disabled, reason linked, note announced, focus on `crm` (test-plan #E34).
- [x] 8.41 Test empty-catalog editor — input empty catalog × admin/member · trigger open editor · observable admin hint + link, member no field (test-plan #E35).
- [x] 8.42 Test composer pre-check — input effective `[review, openspec-propose]`, typed `/skill:memory-x summarise` · trigger Enter · observable no `send_prompt`, text kept, `aria-invalid`, available list shown (test-plan #E36).
- [x] 8.43 Test reason-specific card — input `skillBlock.reason` × role · trigger render · observable specific copy, Fix skill / Fix persona / ask admin, no chat button (test-plan #E37).
- [x] 8.44 Test Skills panel — input config/managed/invalid/shadowed entries, load error, role, mode · trigger render/add/edit · observable read-only config, reasons, banner, member blocked, single-user hides users, picker gating, impact preview + confirm focus behavior (test-plan #E38).
- [x] 8.45 Test i18n parity — input hu + en catalogs · trigger key diff · observable identical new key sets (test-plan #E39).

### L3 — Playwright e2e (exemplar: `tests/e2e/team/team-llm.spec.ts` with `fake-llm.ts`, `team-harness.ts`)

- [x] 8.46 E2E global + extension skills absent — input agent-dir `release-cut`, stub `resources_discover` extension adding `memory-x`, persona `[review]` · trigger first prompt · observable fake-LLM system prompt has `review`, lacks `release-cut`/`memory-x`, keeps persona + bridge fragment (test-plan #F1). Adds the stub-extension fixture beside `fake-llm.ts`.
- [x] 8.47 E2E granted skill readable — input `chat` persona with `review`, scripted reads of `references/x.md` and a sibling skill · trigger prompt · observable first result has content, second `team: path_outside_root` (test-plan #F2).
- [x] 8.48 E2E `/skill:` from the app — input effective `[review]` · trigger send `/skill:review check`, then `/skill:memory-x↵summarise` · observable envelope reaches the fake LLM; second sends no request, shows "skill not available", bubble settles (test-plan #F3).
- [x] 8.49 E2E revocation ends a streaming session — input session streaming (delayed fake-LLM reply) · trigger admin PATCH narrowing targets · observable status `ended` within 5 s of the 2xx, record kept, reopen `409 reason:"targets"`, banner with readable history (test-plan #F4). Adds a delayed-reply mode to `fake-llm.ts` if needed.
- [x] 8.50 E2E widening keeps sessions — input same live session · trigger admin PATCH adding `crm` · observable not ended after 6 s, next prompt answered (test-plan #F5).
- [x] 8.51 E2E blocked card before open — input persona with an invalid-path skill · trigger open grid · observable warning + "Fix skill", no chat button, click opens the Skills panel entry (test-plan #F6).

### Manual

- [ ] 8.52 Visual consistency review of the Skills panel, editor and conversation banners in dark + light at 375/768/1440 against the shipped team app and `mockups/` (test-plan: manual-only, #F7).

## 9. Team app UI

- [x] 9.1 API client + types for `/skills` routes, impact preview, extended `/me` and `/agents`.
- [x] 9.2 PersonaEditor skills fieldset (target filtering, auto-untick, empty-catalog hint).
- [x] 9.3 Admin Skills panel (list, add with picker/path, edit/remove, impact preview + confirm, invalid reasons, load-error banner).
- [x] 9.4 Skill availability feedback (card chip + reason-specific block, conversation banner, header chips, composer pre-check via `parseSkillCommand`).
- [x] 9.5 i18n strings (hu + en).

## 10. Review, docs, release notes

- [ ] 10.1 Run `security-hardening` over the guard + bridge diff; run `doubt-driven-review` on the `--no-skills` behavioral break before merge.
- [ ] 10.2 CHANGELOG `[Unreleased]`: personas no longer inherit global/package/extension skills; legacy alias keys and single-file entries become invalid; new admin Skills panel.
- [ ] 10.3 Update `packages/team-plugin/README.md` (entry shape, managed entries, config-edit timing, mode-switch note) and the `AGENTS.md` rows for the touched files.
- [ ] 10.4 File a pi upstream issue: `--no-skills` does not gate skills added through `resources_discover` (`resource-loader.js` `extendResources`).
