# Test Plan — add-team-skill-access

Stage: design   Generated: 2026-10-08

The HARD gate was resolved. C1: revocation ends affected sessions within 5 s (folded into the team-skill-catalog spec and design D8). C2: no performance scenario for the listing cost, by user decision.

Harness exemplars:
- L1 team-plugin server: `packages/team-plugin/src/server/__tests__/{personas,conversations,projects}.test.ts` with `harness.ts`.
- L1 guard: `packages/team-plugin/src/extension/__tests__/guard.test.ts`.
- L1 bridge: `packages/extension/src/__tests__/{command-handler,prompt-expander}.test.ts`.
- L1 shared: `packages/shared/src/__tests__/skill-block-parser.test.ts`.
- L1 scanner: `packages/server/src/__tests__/pi-resource-scanner.test.ts`.
- L1 team-app: `packages/team-app/src/__tests__/{persona-editor,team-grid,chat-session,agent-view}.test.tsx`.
- L3: `tests/e2e/team/team-llm.spec.ts` (`fake-llm.ts` records the provider-bound system prompt and user texts; `team-harness.ts`).

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | team-skill-catalog: entry shape | EP | L1 | automated | config `skillCatalog: {review: "/opt/skills/review"}` (string) | normalise | entry `{path:"/opt/skills/review", users:"*", targets:"*"}` |
| E2 | team-skill-catalog: entry shape | EP | L1 | automated | `{review: {path}}` with no `users`/`targets` | normalise | `users:"*"`, `targets:"*"` |
| E3 | team-skill-catalog: allowed predicate | decision-table | L1 | automated | mode × users (`"*"`/lists caller/omits caller) × targets (`"*"`/lists target/omits target), 12 combos | `allowed(entry, caller, target)` | true only for (single or users-match) ∧ (targets-match); single-user + users omits caller → true |
| E4 | team-skill-catalog: principal match | EP | L1 | automated | `users: [{iss:"https://idp", sub:"Alice"}]`; caller `sub:"alice"` | `allowed` | false (exact string equality) |
| E5 | team-skill-catalog: name = pi name | EP | L1 | automated | `POST {name:"review", path:<dir whose SKILL.md says name: code-review>}` | create | `400 invalid_skill`, `fields.name="name_mismatch"`, `skills.json` unchanged |
| E6 | team-skill-catalog: name = pi name | EP | L1 | automated | dir `review/` with no frontmatter `name` | create `{name:"review"}` | `201` (directory-name fallback) |
| E7 | team-skill-catalog: pi name rule | BVA | L1 | automated | names `a`, 64×`a`, 65×`a`, `-a`, `a-`, `a--b`, `A`, `a:b` | create | first two `201`; the rest `400 invalid_skill` |
| E8 | team-skill-catalog: path validation | BVA | L1 | automated | absolute path of 512 bytes; 513 bytes; relative `skills/review` | create | 512 → passes length check; 513 and relative → `400 invalid_skill` |
| E9 | team-skill-catalog: path validation | EP | L1 | automated | path to a single `.md` file; dir without `SKILL.md`; dir with `SKILL.md` symlinked to a dir | create | each `400 invalid_skill` |
| E10 | team-skill-catalog: path validation (bidirectional) | decision-table | L1 | automated | paths: inside team home; inside project `billing`; equal to a project root; `/data` containing projects; `~/.pi` (contains agent dir + sessions root); `~/.pi/dashboard`; `~/.pi/agent/skills/review` | create | the first six `400 invalid_skill`; the last `201` |
| E11 | team-skill-catalog: path validation | state-transition | L1 | automated | `review` granted; then its dir is symlinked to `/etc` | next ensure | `409 skill_not_allowed reason:"invalid"`; log line has the name, no path |
| E12 | team-skill-catalog: config and managed | decision-table | L1 | automated | name in config only / managed only / both / neither; caller admin / non-admin / single-user operator | POST, PATCH, DELETE | non-admin multi → `403`; config entry PATCH/DELETE → `409 skill_readonly`; POST existing → `409 skill_exists`; both sources → config wins, managed `invalidReason:"shadowed_by_config"` |
| E13 | team-skill-catalog: managed file integrity | EP | L1 | automated | `skills.json` with `schemaVersion: 2`; truncated JSON | plugin load + admin `GET /skills` + `POST` | plugin runs; listing has `managedLoadError`; POST `503 skill_store_unavailable`; file bytes unchanged |
| E14 | team-skill-catalog: listing | EP | L1 | automated | `review` targets `["crm"]`; alice allowed only `billing` | alice `GET /skills`, `GET /me` | neither contains `review`; admin listing has it with `source`, `valid`, `usage {personas, liveSessions}` |
| E15 | team-skill-catalog: available | EP | L1 | automated | global `~/.pi/agent/skills/g1`, a global-settings package skill `p1`, project-local `.pi/skills/local-x` | `listGlobalSkills(globalDir)` | contains `g1`, `p1`; not `local-x` |
| E16 | team-skill-catalog: available | EP | L1 | automated | host without `host.listOperatorSkills` | admin `GET /skills/available` | `200 []`; non-admin → `403` |
| E17 | team-skill-catalog: impact preview | decision-table | L1 | automated | `review` targets `[billing]`, 2 live sessions in billing, shared persona with `[billing, crm]`, 1 other user's private persona | `POST /skills/review/impact {targets:["crm"]}` / `{remove:true}` / `{targets:["billing","crm"]}` | narrowing → `endSessions:2`, persona lists `lostTargets:["billing"]`, `otherUsersPrivate:1`; remove → same; widening → `endSessions:0`, `[]`; no file or session changed |
| E18 | team-skill-catalog: skill state in listings | decision-table | L1 | automated | persona skills `[review, legacy]`; `review` allowed, `legacy` invalid path / missing / users-denied / targets-denied | `GET /agents?project=billing` | `effectiveSkills:["review"]`, `skillBlock {skill:"legacy", reason}` matches each case, status `unavailable`, no path in body |
| E19 | team-skill-catalog: one blocking helper | decision-table | L1 | automated | same persona fixtures as E18 | ensure vs listing | `409 {skill, reason}` equals `skillBlock` for every fixture (first failing skill in persona order) |
| E20 | team-personas: skills allowed for targets | decision-table | L1 | automated | shared persona `projects:[billing,crm]`, `skills:[review]`; review targets `[billing]` / `"*"` / `[billing,crm]` | admin save | first → `400 invalid_persona fields.skills="skill_not_allowed"`, nothing written; others `200` |
| E21 | team-personas: private owner | decision-table | L1 | automated | alice private persona `skills:[review]`; review users `[bob]`; mode multi / single | save | multi → `400`; single → `200` |
| E22 | team-personas: fork | EP | L1 | automated | shared persona `skills:[review, all-ok]`, review users `[bob]`; alice forks | fork | fork `skills:["all-ok"]` |
| E23 | team-agent-sessions: spawn argv | EP | L1 | automated | persona skills `[]` / `[review]` | ensure create | argv contains `--no-skills` and no `--skill` / `--no-skills --skill <review realpath>`; env `PI_EXT_TEAM_SKILLS` `"[]"` / JSON with `{name:"review", root}` |
| E24 | team-agent-sessions: start check on every path | state-transition | L1 | automated | live session reused; catalog narrowed by config edit | ensure (reuse) / resume / create | reuse ends live session + `409`; resume and create `409`; nothing spawned; record unchanged |
| E25 | team-agent-sessions: composition | EP | L1 | automated | stub cwd-policy intersects `skills` to `[]` | ensure | `409 skill_not_allowed reason:"invalid"`; log `team.skills_narrowed` |
| E26 | guard: skill-root read grant | decision-table | L1 | automated | policy root `/opt/skills/review`; tools `read`, `grep`, `find`, `ls`, `write`, `edit` × paths `SKILL.md`, `references/x.md`, sibling `/opt/skills/release/SKILL.md`, symlink in root → `/etc/passwd`, `../release` | `decideToolCall` | read-only tools inside root allowed; write/edit inside root blocked; sibling, symlink-out, `..` blocked |
| E27 | guard: policy parsing | EP | L1 | automated | `PI_EXT_TEAM_SKILLS` unset / `"not json"` / `"[{\"name\":1}]"` / `"[]"` | `policyFromEnv` | first three → `null` (no readiness); `"[]"` → policy with empty skills |
| E28 | guard: prompt filter | decision-table | L1 | automated | `systemPromptOptions.skills`: granted `review` at root, leaked `memory-x`, same-name `review` from another dir, another skill planted inside the granted root, a symlinked path to granted `SKILL.md` | `before_agent_start` handler | array mutated in place; only the canonical granted `review` remains; no `systemPrompt` returned; other option fields deep-equal before/after |
| E29 | guard: input refusal | decision-table | L1 | automated | texts `/skill:memory-x hi`, `/skill:review hi`, `/skill:review\nhi`, `/skill:review\thi`, ` /skill:x`, `/SKILL:x`, `/skill:`, envelope `<skill name="x" location="/etc/x">…` , envelope at granted root, plain text | `input` handler | refuse (`handled`) for ungranted command and out-of-root envelope; `continue` for granted, leading-space, uppercase, empty-name, granted envelope, plain; never calls `ctx.ui.notify` |
| E30 | shared: `parseSkillCommand` | BVA | L1 | automated | `/skill:a`, `/skill:a b`, `/skill:a\nb`, `/skill:a\tb`, `/skill:`, `/skill: a`, ` /skill:a`, `/Skill:a` | parse | `{a,""}`, `{a,"b"}`, `{a,"b"}`, `{a,"b"}`, `null`, `null`, `null`, `null` |
| E31 | bridge-prompt-expansion: team envelope byte-identity | EP | L1 | automated | `SKILL.md` with frontmatter + body; args `check it` | team route vs non-team `expandPromptTemplateFromDisk` on the same file | identical strings; `parseSkillBlock` round-trips |
| E32 | command-routing: team carve-out | decision-table | L1 | automated | team-confined env; inputs `/skill:review x`, `/skill:review\nx`, `/skill:other`, `/skill:other\nx`, `/deploy\nnow` (prompt template exists), `/x` and `/x\nargs` (exec template), `/ctx-stats` (extension cmd), `!id`, `/compact`, plain | `send_prompt` | granted → one `sendUserMessage(envelope)` with no `expandPromptTemplates`; ungranted → no send, `prompt_received{fresh:false}` + `command_feedback{status:"error"}`; `/deploy\nnow` sent verbatim; exec/extension/bang → nothing dispatched, no `pi.exec`; spies prove `expandPromptTemplateFromDisk`, `sessionPrompt`, `tryDispatchExtensionCommand`, `tryExecSlashTemplate` never called |
| E33 | command-routing: non-team regression | EP | L1 | automated | no `PI_EXT_TEAM_TOOLS`; same inputs as E32 | `send_prompt` | behavior identical to the pre-change snapshot (existing command-handler tests stay green) |
| E34 | team-app: persona editor skills | state-transition | L1 | automated | editor with `review` (billing only) ticked; user ticks `crm` | change | `review` unticked + disabled, reason linked with `aria-describedby`, info note announced, focus stays on the `crm` checkbox |
| E35 | team-app: empty catalog | decision-table | L1 | automated | catalog empty × admin / member | open editor | admin: hint + link to Skills panel; member: no Skills field |
| E36 | team-app: composer pre-check | EP | L1 | automated | effective `[review, openspec-propose]`; typed `/skill:memory-x summarise` | Enter | no `send_prompt`; text kept; `aria-invalid="true"`; message lists `/skill:review, /skill:openspec-propose` |
| E37 | team-app: reason-specific card | decision-table | L1 | automated | `skillBlock.reason` ∈ invalid/missing/targets/users × admin/member | render card | specific copy per reason; admin action "Fix skill" (invalid/missing) or "Fix persona" (targets/users); member "ask your administrator"; no chat button |
| E38 | team-app: Skills panel | decision-table | L1 | automated | entries: config, managed, invalid `name_mismatch`, `shadowed_by_config`; `managedLoadError`; role admin/member; mode single | render panel / add / edit | config read-only (no Save/Remove); invalid reasons shown; load error banner; member cannot reach panel; single-user hides the users field; add: Save disabled until pick, catalog names disabled in picker; edit with impact → preview shown, confirm dialog when `endSessions>0` (focus on Cancel; Escape returns focus) |
| E39 | team-app: i18n | EP | L1 | automated | hu + en catalogs | key diff | identical key sets for every new key |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | team-agent-sessions: global + extension skills absent | state-convergence | L3 | automated | instance agent dir has `skills/release-cut/SKILL.md`; stub extension adds `memory-x` via `resources_discover`; persona `skills:[review]` | first prompt in team app | fake-LLM system prompt contains `review` description and neither `release-cut` nor `memory-x`; still contains persona + bridge fragment |
| F2 | team-agent-sessions: granted skill readable | state-convergence | L3 | automated | persona `chat` with `review`; fake-LLM scripted toolCall `read {path:<root>/references/x.md}` then `read {path:<root>/../release-cut/SKILL.md}` | prompt | first tool result contains x.md content; second is `team: path_outside_root` |
| F3 | team-agent-sessions + command-routing: `/skill:` from the app | state-transition | L3 | automated | effective `[review]` | send `/skill:review check` (single-line), then `/skill:memory-x\nsummarise` | first: fake-LLM user text starts with `<skill name="review"`; second: no new LLM request, chat shows "skill not available", pending bubble settled (no 30 s spinner) |
| F4 | team-skill-catalog: revocation ends streaming session | state-transition | L3 | automated | alice's session streaming (fake-LLM reply delayed 30 s) with persona listing `review` in billing | admin PATCH `review` targets `[crm]` → 2xx | session status `ended` within 5 s of the 2xx; record kept; reopen → `409 skill_not_allowed reason:"targets"`; UI shows the reason-specific banner with history readable |
| F5 | team-skill-catalog: widening keeps sessions | state-transition | L3 | automated | same live session | admin PATCH adds `crm` | after 6 s session still not ended; next prompt answered |
| F6 | team-app: blocked card before open | state-convergence | L3 | automated | persona with an invalid-path skill | open grid | card shows "path is invalid" warning + "Fix skill" (admin), no chat button; clicking opens the skill in the Skills panel |
| F7 | team-app: Skills panel visual consistency | visual/subjective | — | manual-only | Skills panel, add, edit (impact), persona editor, conversation banners in dark + light at 375/768/1440 | human compares with the shipped team app | [judgment: matches team-app recipes — no automatable observable beyond the mockup probe] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | team-agent-sessions: unreadable granted skill | fault-injection (abort) | L1 | automated | granted `SKILL.md` deleted after spawn | bridge `/skill:review go` | no `sendUserMessage`; `prompt_received{fresh:false}` + `command_feedback{status:"error"}`; never falls back to registry or unexpanded send |
| X2 | team-agent-sessions: missing skill policy | fault-injection (abort) | L1 | automated | spawn env without `PI_EXT_TEAM_SKILLS` | guard `session_start` + ensure | no `team_guard_ready`; ensure → `503 guard_unavailable`; no record written |
| X3 | team-skill-catalog: concurrent create | fault-injection (race) | L1 | automated | two `POST {name:"review"}` started in the same tick | await both | exactly one `201`, one `409 skill_exists`; `skills.json` has one entry |
| X4 | team-agent-sessions: check-then-act epoch | fault-injection (race) | L1 | automated | ensure passes D6; managed revocation lands before the session correlates | correlation | session aborted, `409 skill_not_allowed`, no record created |
| X5 | team-skill-catalog: cross-user authority | fault-injection (misuse) | L1 | automated | bob (non-admin) calls ensure/restart/PATCH for alice's conversation or skill | request | `404`/`403`; alice's session untouched; the invalidation pass runs only after a 2xx admin catalog write and skips records whose `uk` ≠ session `principalOwner` |
| X6 | team-skill-catalog: observability | fault-injection (refusal) | L1 | automated | refused spawn (targets), catalog write, invalidation of 2 sessions | capture logger | lines `team.skill_not_allowed name=review … reason=targets`, `team.skill_write op=update name=review by=<uk>`, `team.skill_invalidated name=review sessions=2`; no line contains a path or skill text |

## Coverage summary

- Requirements covered: 24/24. Delta requirements across team-skill-catalog (7), team-personas (1), team-agent-sessions (2), team-app (3), bridge-prompt-expansion (1), command-routing (1), bridge-extension (1), counted per testable SHALL group.
- Scenarios by class: edge 39 · perf 0 (C2: user decision) · frontend 7 · error 6
- Scenarios by level: L1 45 · L2 0 · L3 6
- Scenarios by disposition: automated 51 · manual-only 1

## New infra needed

- L3: a stub pi extension fixture that adds a skill through `resources_discover` (F1). Place it beside `tests/e2e/team/fake-llm.ts`.
- L3: a delayed-reply mode in `fake-llm.ts` to hold a turn in the streaming state (F4), if the script queue cannot already delay.
