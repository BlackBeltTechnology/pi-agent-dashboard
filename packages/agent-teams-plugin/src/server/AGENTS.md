# DOX — packages/agent-teams-plugin/src/server

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `index.ts` | SERVER entry. `registerPlugin(ctx)` (also default export) calls `createTeamsRuntime(ctx)`, mounts the REST… → see `index.ts.AGENTS.md` |
| `access.ts` | Owner rule: `createAccess(identity)` → `canViewTeam`/`canControlTeam` (same predicate; identity absent/not… → see `access.ts.AGENTS.md` |
| `args.ts` | Op arg parsing. Own-prop reads, string sanitise, code-point length check, over-limit → `invalid_args`. Truncates only `result`/`finalText` (`truncateWithMarker`). |
| `epoch.ts` | `mintEpoch()` (16 hex, random, per plugin start) and `PROCESS_EPOCH` (route default). First half of the snapshot ETag. See change: add-agent-teams-ui. |
| `runtime.ts` | Composition: `createTeamsRuntime(host, opts)` wires config reader, `TeamPersistence` + `TeamStore` (hydrated… → see `runtime.ts.AGENTS.md` |
| `store.ts` | `TeamStore`: synchronous mutations (teams, members, tasks primitives, mail log), per-team in-memory `rev`,… → see `store.ts.AGENTS.md` |
| `persistence.ts` | `TeamPersistence`: per-team JSON (`teams/<id>.json`, temp+rename, 100 ms coalescing, write-through,… → see `persistence.ts.AGENTS.md` |
| `config.ts` | `createConfigReader`: per-operation config (incl. `blockSleepPolling`/`blockGitWrite`) merged over… → see `config.ts.AGENTS.md` |
| `types.ts` | `Logger`, `HostSession` narrowing of `sessionManager.getSession` (`narrowHostSession`), `Actor`… → see `types.ts.AGENTS.md` |
| `driver.ts` | `MemberDriver` interface + `createSessionDriver(host)`: the ONLY caller of… → see `driver.ts.AGENTS.md` |
| `modes.ts` | `createModeRegistry(sessionDriver)`: `mode → {driver, available?(callerSessionId?)}`, `session` registered,… → see `modes.ts.AGENTS.md` |
| `modes-inproc.ts` | Mode `in-process`. `createInProcAvailability`: per-lead-session map fed by `inproc hello`… → see `modes-inproc.ts.AGENTS.md` |
| `driver-inproc.ts` | `createInProcDriver`: `MemberDriver` for mode `in-process` (`supportsResume:false`, `ownsSpawnClock:true`). → see `driver-inproc.ts.AGENTS.md` |
| `inproc-mail.ts` | `frameMailBlock`/`frameMailBatch`/`mailIdsKey`: one block per mail (core `formatEnvelope` line, unquoted… → see `inproc-mail.ts.AGENTS.md` |
| `inproc-lifecycle.ts` | `createInProcLifecycle`: server intake of the lead host's `{op:"event"}` reports + hello `snapshot`. → see `inproc-lifecycle.ts.AGENTS.md` |
| `inproc-lead.ts` | `createInProcLead`: lead lifecycle. `onSessionEnded(lead)` ⇒ team closed `lead_ended` (members `gone:… → see `inproc-lead.ts.AGENTS.md` |
| `proxy-identity.ts` | Lead-proxied member identity: `mintProxyToken` (32 bytes hex), `tokensEqual` (constant-time, equal-length… → see `proxy-identity.ts.AGENTS.md` |
| `extension-points.ts` | Empty-by-default registries (spawn contributors, op gates, dispatch eligibility, route visibility; `seal()`… → see `extension-points.ts.AGENTS.md` |
| `ops.ts` | `createOps(deps)`: `resolveCaller`, `call` op table (TeamCreate, TeammateSpawn, TeamStatus, TeamDelete + the… → see `ops.ts.AGENTS.md` |
| `spawn.ts` | Host spawn (tasks 5.x): `createSpawnPlanner` (cwd realpath confinement on path-segment boundary +… → see `spawn.ts.AGENTS.md` |
| `op-util.ts` | `fail(code, message?, details?)` failure envelope, `isLive(member)` (not `gone`/`failed`), `compareTaskIds` (numeric order of string ids). |
| `tasks.ts` | `createTaskOps`: `TaskCreate`/`TaskList`/`TaskGet`/`TaskUpdate` (one synchronous transition each; validate… → see `tasks.ts.AGENTS.md` |
| `dispatch.ts` | `createDispatcher`: per eligible member claim the lowest-id owned pending unblocked task, else lowest-id… → see `dispatch.ts.AGENTS.md` |
| `mail.ts` | `createMailEngine`: `flush` (emit unacked, not-yet-handed-over mail via the driver, grouped by wake;… → see `mail.ts.AGENTS.md` |
| `mail-limits.ts` | `createMailLimits`: per-sender token bucket (`mailRatePerMin`, integer-ms refill, 1 token/call), per-pair loop breaker (`checkPair` trips once, `bumpPair`, `resetPairs` on task activity). |
| `notices.ts` | `createNoticeBuffer`: lead notice coalescer — fixed `notifyCoalesceMs` window from the first item (team… → see `notices.ts.AGENTS.md` |
| `messaging.ts` | `createMessaging`: `SendMessage` (kind `message` only → `kind_reserved`, code-point size cap, lead-only… → see `messaging.ts.AGENTS.md` |
| `shutdown.ts` | `createShutdown`: request records, `ShutdownRequest`/`ShutdownResponse` ops, approval → release tasks →… → see `shutdown.ts.AGENTS.md` |
| `lane.ts` | `createLaneHandlers` (`agent-teams/call|hello|busy|idle|ack`, local-origin gate, caller from… → see `lane.ts.AGENTS.md` |
| `routes.ts` | `mountTeamsRoutes(fastify, deps)`: encapsulated scope under `/api/plugins/agent-teams` with… → see `routes.ts.AGENTS.md` |
| `snapshot.ts` | Pure REST view builders: `summaryOf`, `listOf` (+ `unavailable`, `persist_degraded`), `snapshotOf` (members,… → see `snapshot.ts.AGENTS.md` |
| `telemetry.ts` | `createTelemetry(logger)`: per-team counters (`spawns`, `claims`, `claimConflicts`, `deliveries`, `queued`,… → see `telemetry.ts.AGENTS.md` |
| `ui-counters.ts` | `createUiCounters`: counter map flushed as `agent-teams: counter counter=<name> n=<v> window_s=60` every 60 s while counting (timer only while non-empty); `dispose()`. See change: add-agent-teams-ui. |
| `ui-bridge.ts` | `createUiBridge`: `store.on(change)` → ≤1 `plugin_event` `agent-teams:changed {teamId, epoch, rev, closed?}`… → see `ui-bridge.ts.AGENTS.md` |
| `user-actions.ts` | `createUserActions`: `stopMember` (store pre-checks ⇒ `team_closed`/`not_found`/`not_connected`/`not_busy`;… → see `user-actions.ts.AGENTS.md` |
| `agent-prompts.ts` | Agent / member prompt files `<dataDir>/prompts/<teamId>/<member>.agent.md|.member.md` (`writePromptFile`:… → see `agent-prompts.ts.AGENTS.md` |
| `agents.ts` | Teammate types: `resolveAgent` `<leadCwd>/.pi/agents/<n>.md` (trusted project only) →… → see `agents.ts.AGENTS.md` |
| `hook-engine.ts` | `createHookEngine`: run ≤3 commands of one event under ONE deadline (`opGateBudgetMs` − margin); exit 0… → see `hook-engine.ts.AGENTS.md` |
| `hook-hash.ts` | `hashHooks`: SHA-256 of canonical JSON (events sorted, command text, order, effective `timeoutMs`). Trust identity. See change: add-agent-teams-templates-hooks. |
| `hook-limiter.ts` | `HookLimiter`: 2 per team, 4 global (`HOOK_TEAM_CONCURRENCY`/`HOOK_GLOBAL_CONCURRENCY`); queue inside caller… → see `hook-limiter.ts.AGENTS.md` |
| `hook-payload.ts` | `buildHookPayload` (stdin JSON: event, team, cwd, member, memberCwd, task, idle; `finalText` ≤4000) and… → see `hook-payload.ts.AGENTS.md` |
| `hook-run.ts` | `startHook`: `bash -c` detached via shared exec wrapper, stdin JSON, `buildHookEnv` allowlist, 64 KiB stream… → see `hook-run.ts.AGENTS.md` |
| `hook-trust.ts` | TOFU store `<dataDir>/hook-trust.json` keyed `realpath(cwd)`+hash; fail closed on corrupt file; serialised… → see `hook-trust.ts.AGENTS.md` |
| `hooks.ts` | `createHookGates`/`registerHooks`: `TaskCreate`, `TaskUpdate→completed` and `TeammateIdle` op gates over the… → see `hooks.ts.AGENTS.md` |
| `plan-policy.ts` | Pure plan helpers: `strongerPolicy` (false<true<"user"), `planPolicyFor`, `buildPlanMemberToolList`,… → see `plan-policy.ts.AGENTS.md` |
| `plan-store.ts` | Pure plan-request primitives over `Team.plans`: `planBounds`/`boundedText` (`planMaxChars`, 120 lines, core… → see `plan-store.ts.AGENTS.md` |
| `plans.ts` | Plan approval: `PlanSubmit` (`message_too_long`/`invalid_args`/`plan_not_required`, supersede, `plan_request`… → see `plans.ts.AGENTS.md` |
| `spawn-precedence.ts` | Pure `resolveSpawnFields`: first defined of spawn arg → template member → agent → team default; template… → see `spawn-precedence.ts.AGENTS.md` |
| `spawn-resolve.ts` | `registerSpawnResolve`: ONE sync resolver (template `maxTeammates` cap, agent lookup,… → see `spawn-resolve.ts.AGENTS.md` |
| `start-lead.ts` | `createServerLeads`: server-started lead — `starting` team, persisted spawn token + `leadBindDeadline`… → see `start-lead.ts.AGENTS.md` |
| `start-phase.ts` | `createStartPhase`: post-bind start — profile `seed` once, `playbook` mail (REST path), eager roster via… → see `start-phase.ts.AGENTS.md` |
| `start-prepare.ts` | `prepareStart`: everything before a team exists — goal check, template load (cache dropped), playbook render… → see `start-prepare.ts.AGENTS.md` |
| `start-profiles.ts` | `registerStartProfile(name,{preflight,seed})` / `getStartProfile`; process-wide like bundled templates. See change: add-agent-teams-templates-hooks. |
| `start.ts` | `registerStart`: lane ops `team.templates`/`team.start` (bridge callers, not agent tools; command path =… → see `start.ts.AGENTS.md` |
| `template-fs.ts` | Safe source-file access: `resolveSourceDir`, `readSourceFile` (regular file, realpath inside dir, size from… → see `template-fs.ts.AGENTS.md` |
| `template-parse.ts` | `parseTemplate(text, stem)` → `{core, errors, warnings}`: strict frontmatter, `TEMPLATE_NAME_RE`, member… → see `template-parse.ts.AGENTS.md` |
| `template-render.ts` | `normalizeGoal` (≤4000, one line), `substituteVars` (`{{goal}}`/`{{cwd}}` once),… → see `template-render.ts.AGENTS.md` |
| `template-yaml.ts` | `splitFrontmatter`/`parseYamlMapping`: strict `yaml` — no alias/anchor/merge/tag, unique keys, mapping only; never throws. See change: add-agent-teams-templates-hooks. |
| `templates-hooks.ts` | Composition root: `registerTemplatesHooks(deps)` runs `REGISTRARS` in order (templates, agents, hooks,… → see `templates-hooks.ts.AGENTS.md` |
| `templates-routes.ts` | `registerTemplatesRoutes`: GET `templates`, POST `teams/start`, POST/DELETE `hook-trust`, GET… → see `templates-routes.ts.AGENTS.md` |
| `templates.ts` | Discovery/loader: project (trusted only) → user → `bundled` (`registerBundledTemplate`); `listTemplates` (cap… → see `templates.ts.AGENTS.md` |
| `__tests__/` | → see `__tests__/AGENTS.md`. |
