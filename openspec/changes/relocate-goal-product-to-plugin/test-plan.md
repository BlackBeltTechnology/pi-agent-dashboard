# Test Plan — relocate-goal-product-to-plugin

Stage: design   Generated: 2026-09-11

Contract under test: design.md D1 (eight host-service gaps → seven generic
`ServerPluginContext` capabilities + `host.knownFolderCwds`), D2 (link handler on
`onSessionResolved`, first-register path only), D3 (plugin composition root),
Migration steps 2+3 atomic. Every goal-product observable must be byte-identical
to today (REST paths `/api/folders/goals*`, `.meta.json` keys, `goals_update` /
`goal_status` wire types, spawn opts shape).

Exemplars (harness glue to copy): `packages/server/src/__tests__/plugin-spawn-scope-env.test.ts`
(fake plugin ctx + `pluginSpawnToSessionOptions` + register path),
`packages/server/src/__tests__/pending-plugin-ref-registry.test.ts`,
`packages/server/src/__tests__/goal-routes.test.ts` (fastify `inject`),
`packages/roles-plugin/src/server/__tests__/roles-routes.test.ts` (preHandler introspection),
`packages/goal-plugin/src/server/__tests__/plugin-action-handler.test.ts` (fake `ctx` with `vi.fn()`),
`packages/server/src/__tests__/goal-supervisor.test.ts` (fake timers),
`packages/server/src/__tests__/shutdown-terminates-any-strategy.test.ts` (server `stop()` ordering),
`tests/e2e/bus-client-goal-plugin-action.spec.ts`, `tests/e2e/keeper-restart-survival.spec.ts`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | D1-#1 caller `spawnToken` used verbatim | EP (token supplied) | L1 | automated | trusted plugin (priority 100), `opts.spawnToken = "11111111-1111-4111-8111-111111111111"`, `pluginRef: { goalId: "g1" }` | `ctx.spawnSession(opts)` | `spawnPiSession` receives `spawnToken` equal to the supplied value; `pendingPluginRefRegistry.has(that token) === true` with owner `"goal"` before the spawn await; `result.spawnToken` equals the supplied value |
| E2 | D1-#1 duplicate token rejected | EP (token collides) | L1 | automated | registry already holds `tok-A` filed by owner `"automation"`; trusted plugin `"goal"` passes `spawnToken: "tok-A"` | `ctx.spawnSession(opts)` | returns `{ success: false, message }` (message names the duplicate); `spawnPiSession` not called; `registry.resolve("tok-A").ownerId === "automation"` (prior entry untouched) |
| E3 | D1-#1 trust gate × token supplied | decision-table | L1 | automated | 4 combos: trusted∈{100,1000} × spawnToken∈{supplied, absent} | `ctx.spawnSession(opts)` | untrusted → `{ success:false }` and registry never filed (both token cases); trusted+absent → `result.spawnToken` is a fresh UUID v4 (minted, not undefined); trusted+supplied → E1 |
| E4 | D1-#2 `resume` mapping | EP + isolation-`mode` interaction | L1 | automated | `opts = { cwd, resume: { sessionFile: "/tmp/s.jsonl" }, mode: "worktree" }` | `pluginSpawnToSessionOptions(opts)` | output has `sessionFile === "/tmp/s.jsonl"` **and** `mode === "continue"` at session level, and the worktree isolation flag still mapped (both `mode`s survive) |
| E5 | D1-#2 `resume` with empty / non-string `sessionFile` | BVA (invalid) | L1 | automated | `resume: { sessionFile: "" }` and `resume: { sessionFile: 42 }` | `pluginSpawnToSessionOptions(opts)` | mapper does not throw; output has no `sessionFile` key and no `mode: "continue"` (sanitized like every other untrusted field) |
| E6 | D1-#3 `initialPrompt` enqueued before spawn | state-transition (order) | L1 | automated | `opts.initialPrompt = "/goal reprime"`, spawn succeeds | `ctx.spawnSession(opts)` | `pendingInitialPromptRegistry.enqueue(cwd, "/goal reprime")` call-ordered **before** `spawnPiSession`; after success the queue for `cwd` still holds the prompt (consumed only by register) |
| E7 | D1-#3 queue cap boundary | BVA (`PENDING_INITIAL_PROMPT_QUEUE_CAP = 8`) | L1 | automated | 8 prompts already queued for `cwd`; 9th spawn with `initialPrompt` | `ctx.spawnSession(opts)` | `enqueue` returns `false`; spawn still proceeds (`success: true`); queue length stays 8 (pre-existing behaviour preserved) |
| E8 | D1-#4 `renameSession` trusted | EP | L1 | automated | trusted plugin; session `s1` live | `ctx.renameSession("s1", "goal: ship")` | returns `true`; `sessionManager.get("s1").name === "goal: ship"`; `broadcastSessionUpdated("s1", { name })` once; `piGateway.sendToSession("s1", { type: "rename_session", … })` once |
| E9 | D1-#4 `renameSession` gate × unknown session | decision-table | L1 | automated | untrusted plugin / unknown session id / empty name | `ctx.renameSession(…)` | returns `false` in every case; no `sessionManager.update`, no broadcast, no pi message |
| E10 | D1-#5 `assignSessionRef` persisted set | EP | L1 | automated | trusted; `s1` has `sessionFile`; `ref = { goalId: "g1" }` | `ctx.assignSessionRef("s1", ref)` (default `persist`) | returns `true`; in-memory `goalId === "g1"`; `mergeSessionMeta(sessionFile, { goalId: "g1" })` once; `broadcastSessionUpdated("s1", { goalId: "g1" })` once |
| E11 | D1-#5 `undefined` clears every persisted layer | EP (clear) | L1 | automated | `s1` has `goalId: "g1"` in memory + meta | `ctx.assignSessionRef("s1", { goalId: undefined })` | in-memory `goalId` is `undefined`; meta file no longer has `goalId` key; broadcast carries `goalId: undefined` |
| E12 | D1-#5 `persist: false` is memory-only (C2e) | EP | L1 | automated | `s1` has `goalId: "g1"` in memory + meta | `ctx.assignSessionRef("s1", { goalId: undefined }, { persist: false })` | returns `true`; in-memory `goalId` undefined; `mergeSessionMeta` **not** called (meta still has `goalId: "g1"`); `broadcastSessionUpdated` **not** called |
| E13 | D1-#5 reserved keys sanitized | decision-table (`CORE_RESERVED_REF_KEYS`) | L1 | automated | `ref = { status: "ended", name: "x", goalId: "g1" }` | `ctx.assignSessionRef("s1", ref)` | `status` and `name` unchanged; `goalId === "g1"`; warn-once logged for the reserved keys; returns `true` (sanitize dropped some keys, merge still applied) |
| E14 | D1-#5 gate × unknown session | decision-table | L1 | automated | untrusted plugin / unknown session | `ctx.assignSessionRef(…)` | returns `false`; no update, no meta write, no broadcast |
| E15 | D1-#1 `mintSpawnToken` | EP | L1 | automated | trusted plugin | `ctx.mintSpawnToken()` ×2 | both match UUID v4 regex; values differ |
| E16 | `pendingPluginRefRegistry.has()` non-destructive | state-transition | L1 | automated | `file("tok-A", ref, "goal", lifecycle)` | `has("tok-A")` then `resolve("tok-A")` then `has("tok-A")` | `true` → resolve returns the filed ref (has did not consume) → `false`; and `has()` after `PENDING_PLUGIN_REF_TTL_MS = 60_000` elapsed (fake timers) → `false` |
| E17 | D1-#8 `onShutdown` ordering | state-transition (order) | L1 | automated | two plugin subs registered; spy on `piGateway.stop` | server `stop()` | both subs invoked exactly once, **before** `piGateway.stop()` and before `fastify.close()`; the returned unsubscribe, if called earlier, prevents that sub's invocation |
| E18 | D1-#7 `ctx.networkGuard` guards goal routes | EP (identity + effect) | L1 | automated | plugin mounts routes with `ctx.networkGuard`; `inject` from non-loopback remote address without auth | `GET /api/folders/goals?cwd=/x` | `ctx.networkGuard` is the same function reference core passes to `registerSessionRoutes`; response `403`; all six routes report a `preHandler` in fastify route introspection |
| E19 | D3 REST paths unchanged | EP (exact set) | L1 | automated | plugin registered on a fresh fastify | `fastify.printRoutes()` / route table | exactly the six method+path pairs from today's `goal-routes.ts` (`GET/POST /api/folders/goals`, `PATCH/DELETE /api/folders/goals/:id`, …) present; **no** route under `/api/plugins/goal/` |
| E20 | D1-#6 known-cwd via `host.knownFolderCwds` | decision-table (active × pinned) | L1 | automated | cwd ∈ {active-unpinned, pinned-inactive, neither} | `GET /api/folders/goals?cwd=…` | active-unpinned → `200`; pinned-inactive → `200`; neither → same status + body today's `rejectInvalidCwd` returns |
| E21 | D3 `goals_update` decorated with spend | EP (sum) | L1 | automated | goal `g1` linked sessions `a` (cost 1.5) and `b` (cost 2); `ctx.sessionManager.getSession` returns them | store mutation for `cwd` | `ctx.broadcastToSubscribers` called once with `{ type: "goals_update", cwd, goals }` where `goals[0].spend === 3.5` (same key/value core emits today) |
| E22 | D3 `goal_status` peers via `registerPiHandler` | state-transition | L1 | automated | plugin registered on fake `ctx`; synthetic `goal_status` `{ verdict: "pass", … }` from driver `s1` of `g1` | dispatch through the captured `registerPiHandler("goal_status")` | accumulator persists the verdict on `GoalRecord g1`; projector updates `status`; with `budget` exceeded the budget guard calls `ctx.abortSpawnedRun` / halt path exactly as `goal-budget-guard.test.ts` asserts today |
| E23 | D3 supervisor kill order | state-transition | L1 | automated | goal with `inFlightSpawn.spawnToken = "tok-A"` and `driverSessionId = "s1"`; `abortSpawnedRun` returns `false` then `true` | supervisor abort | `ctx.abortSpawnedRun` called first with `{ spawnToken: "tok-A" }`, then with `{ sessionId: "s1" }`; when the first returns `true` the second is never called |
| E24 | D2 first-register link | state-transition | L1 | automated | `g1.driverSessionId = "s1"` (dead), `inFlightSpawn` set; handler receives `("s2", { goalId: "g1" })` | `ctx.onSessionResolved` handler | `assignSessionRef("s1", { goalId: undefined }, { persist: false })`; `store.replaceDriver(cwd, "g1", "s2")`; `inFlightSpawn` cleared; `assignSessionRef("s2", { goalId: "g1" })` persisted; primer sends `/goal …` to `s2` exactly once |
| E25 | D2 idempotent re-delivery | state-transition (illegal edge) | L1 | automated | `g1.driverSessionId = "s2"` | handler receives `("s2", { goalId: "g1" })` again | no `replaceDriver`, no primer, no `assignSessionRef` calls |
| E26 | D2 restore path does not link (divergence, accepted) | state-transition | L1 | automated | `s1` pid-registry entry carries `pluginRef { goalId: "g1" }`; `g1.driverSessionId = "s2"`; `s1` re-registers with **no** pending token | bridge `session_register` for `s1` | `onSessionResolved` **not** dispatched to plugin `"goal"`; `g1.driverSessionId` still `"s2"`; no primer; `s1` in-memory `goalId` merged from the ref (core merge unchanged); **and `g1.status` stays as persisted (`respawning` when seeded so) rather than flipping to `pursuing`** — pins the accepted D2 `replaceDriver` status/baseline divergence so it is asserted, not latent |
| E27 | D1 core is goal-free | EP (static) | L1 | automated | post-move tree | `rg -n "goal" packages/server/src --glob '!**/AGENTS.md'` | zero hits outside `@pi-dashboard/shared` type re-exports; `packages/server/src/goal/` and `routes/goal-routes.ts` absent |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| — | none — proposal declares no latency/throughput budget; pure relocation | — | — | — | — | — | — |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | end-to-end create + spawn | state-convergence | L3 | automated | harness up; `POST /api/folders/goals` `{ cwd, objective, spawn: true }` | poll `GET /api/sessions` + `GET /api/folders/goals?cwd` | converges to: one session with `goalId === <id>`; goal `driverSessionId === that session`; its `.meta.json` contains `goalId`; server log shows exactly one `/goal` primer prompt |
| F2 | supervisor respawn after driver death | state-transition | L3 | automated | F1 state; kill driver via the browser-bus `shutdown` message (real process death; the test-plan's `POST /api/session/:id/abort` route does not exist). The supervisor's in-harness RESUME spawn does not complete pi registration (faux-model limitation, watchdog-verified) — the spec completes the register handshake for the respawned driver over a bridge socket using the token the supervisor persisted (`inFlightSpawn.spawnToken`), exercising the production register path end-to-end | poll goals + sessions | converges to: death classified (`respawns[]` grows, status `respawning`, new minted token in `inFlightSpawn`); after the respawned driver's register: new session id with same `goalId` as `driverSessionId`, status `pursuing`; old session's in-memory `goalId` absent in `GET /api/sessions` (C2e); primer prompt count on new session === 1 |
| F3 | bridge reconnect does not re-prime | state-transition (keeper restart) | L3 | automated | F1 state; restart the driver's keeper (`keeper-restart-survival` glue) | session re-registers | `goalId` retained; `driverSessionId` unchanged; primer prompt count unchanged (no second `/goal`) |
| F4 | unlink via REST | state-transition | L3 | automated | F1 state | `DELETE /api/folders/goals/:id/driver` (today's unlink route) | `GET /api/sessions` shows no `goalId`; `.meta.json` no longer has `goalId`; goal `driverSessionId` null |
| F5 | verdict persistence | state-convergence | L3 | automated | F1 state; driver emits `goal_status { verdict }` (synthetic bridge or real run) | `GET /api/folders/goals?cwd` | record carries the verdict + status; file under `~/.pi/dashboard/goals/` has identical keys to a pre-change fixture |
| F6 | Goals board visual parity | visual/subjective | — | manual-only | folder Goals page after relocation | human compares with pre-change screenshot | [judgment: layout/labels look unchanged — no automatable observable beyond F1–F5] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | D1-#1/#3 spawn failure cleanup with caller token | fault-injection (abort) | L1 | automated | `spawnPiSession` resolves `{ success: false }` | `ctx.spawnSession({ spawnToken: "tok-A", initialPrompt })` | `registry.has("tok-A") === false`; `pendingInitialPromptRegistry.consume(cwd)` called (queue empty); result `{ success: false }` |
| X2 | D1-#3 spawn throws | fault-injection (abort) | L1 | automated | `spawnPiSession` rejects | `ctx.spawnSession({ initialPrompt })` | ref removed; prompt consumed; result `{ success: false, message }` (no unhandled rejection) |
| X3 | D1-#5 meta write fails | fault-injection (abort) | L1 | automated | `mergeSessionMeta` throws `EACCES` | `ctx.assignSessionRef("s1", { goalId: "g1" })` | in-memory update applied; broadcast still sent; warn logged; returns `true` (same warn-only posture as `linkGoalDriver` today) |
| X4 | D1-#8 throwing shutdown sub | fault-injection (abort) | L1 | automated | first sub throws | server `stop()` | error logged `[plugin-onShutdown]`; second sub still runs; `piGateway.stop()` still called; `stop()` resolves |
| X5 | D3 no respawn after dispose | state-transition (illegal edge) | L1 | automated | plugin registered; shutdown sub has run (`supervisor.dispose()`) | `ctx.onSessionEnded` handler fired for the driver | `ctx.spawnSession` **not** called; no timer scheduled |
| X6 | D3 boot reconcile after crash mid-spawn | fault-injection (restart, fake timers) | L1 | automated | `GoalRecord g1.inFlightSpawn = { spawnToken: "tok-old" }` persisted; plugin registers on fresh `ctx`; no session registers | advance `30_000` ms | `reconcileOnBoot` runs; `ctx.spawnSession` called once with a **new** minted token and `pluginRef { goalId: "g1" }`; `inFlightSpawn.spawnToken` updated |
| X7 | D1-#4 rename when pi socket gone | fault-injection (abort) | L1 | automated | `piGateway.sendToSession` returns `false` | `ctx.renameSession("s1", "n")` | in-memory name + broadcast still applied; returns `true` (matches today's `:1206-1212` behaviour) |
| X8 | Migration 2+3 atomic | fault-injection (partial apply) | ci | automated | the PR's diff | `git diff --name-status develop...HEAD` | routes/modules appear under `goal-plugin/src/server/` **and** `packages/server/src/goal/` + `routes/goal-routes.ts` are deleted in the same commit range; `npm test` boots the server without `FST_ERR_DUPLICATED_ROUTE` |

---

## Coverage summary

- Requirements covered: D1 #1–#8 (8/8), D2, D3 (routes, broadcast, peers, supervisor, dispose, reconcile), Migration atomicity, byte-identical goal surface — 12/12
- Scenarios by class: edge 27 · perf 0 · frontend 6 · error 8
- Scenarios by level: L1 33 · L2 0 · L3 5 · ci 1 · — 1
- Scenarios by disposition: automated 40 · manual-only 1

## New infra needed

- none — all L1 rows extend existing vitest suites (exemplars above); L3 rows reuse the docker harness + `keeper-restart-survival` / `bus-client-goal-plugin-action` glue; X8 is a workflow-level assertion in the existing CI job.
