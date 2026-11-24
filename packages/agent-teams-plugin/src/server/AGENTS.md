# DOX — packages/agent-teams-plugin/src/server

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `index.ts` | SERVER entry. `registerPlugin(ctx)` (also default export) calls `createTeamsRuntime(ctx)`; `ctx.onShutdown` disposes it. REST/dispatcher/mail delivery/host-spawn bindings arrive in later sections via runtime seams. |
| `runtime.ts` | Composition: `createTeamsRuntime(host, opts)` wires config reader, `TeamPersistence` + `TeamStore` (hydrated at start), session driver, mode registry, `createOps`, lane handlers, `onSessionResolved/Ended`, shutdown flush, orphan-TTL re-arm and closing-team resume. `opts` injects clock, fs, extension points, planner/starter/mailer seams. |
| `store.ts` | `TeamStore`: synchronous mutations (teams, members, tasks primitives, mail log), per-team in-memory `rev`, typed `on()` events (`change`, `team_created`, `lead_bound`, `task_completed`, `member_status`, `team_closed`; listener throws isolated), `sessionId → {teamId, lead|member}` index, `hydrate()` (members `disconnected`, `spawning` kept). |
| `persistence.ts` | `TeamPersistence`: per-team JSON (`teams/<id>.json`, temp+rename, 100 ms coalescing, write-through, `flushSync`), append-only `<id>.mail.jsonl` (ack tombstones, `selectCompaction` keeps unacked + newest until ≤50 % cap), load with quarantine (`.corrupt`/`.future`), closed-team pruning, `degraded` flag, injectable `PersistFs`. |
| `config.ts` | `createConfigReader`: per-operation config merged over `configSchema.json` defaults, `maxTeammates` clamped 1–10 with one log line per value. |
| `types.ts` | `Logger`, `HostSession` narrowing of `sessionManager.getSession` (`narrowHostSession`), `Actor` (`lead|user|server`). |
| `driver.ts` | `MemberDriver` interface + `createSessionDriver(host)`: the ONLY caller of `spawnSession`/`emitEventToSession`/`abortSession`/`shutdownSession`; `spawnLead`, `notifyTeamClosed`; `ResolvedSpawnSpec`, `SpawnRequest`. No `initialPrompt`, `recover:false`. |
| `modes.ts` | `createModeRegistry(sessionDriver)`: `mode → {driver, available?(callerSessionId?)}`, `session` registered, `resolve()` → `mode_unavailable` reasons. |
| `extension-points.ts` | Empty-by-default registries (spawn contributors, op gates, dispatch eligibility, route visibility; `seal()` at first lane request), `TrustedSpawnOptions`, `applySpawnContributors` (narrow-only), `runOpGates` (shared budget, fail-closed); re-exports `registerMailKind`. |
| `ops.ts` | `createOps(deps)`: `resolveCaller`, `call` op table (TeamCreate, TeammateSpawn, TeamStatus, TeamDelete; `registerOp` for later sections), actor ops (`createTeam`, `bindLead`, `spawnMember`, `abortMember`, `teamDelete`, `requestShutdown`, `sendServerMail`, `enqueueLeadNotice`, `releaseMember`), hello/busy/idle/ack, orphan TTL, closing resume; seams `planner`/`starter`/`mailer`. |
| `lane.ts` | `createLaneHandlers` (`agent-teams/call|hello|busy|idle|ack`, local-origin gate, caller from `meta.sessionId`, own-property payload reads) and `registerLane` (`hubLocalOnly:true`; logs once and returns false when the seam is absent). |
| `__tests__/` | → see `__tests__/AGENTS.md`. |
