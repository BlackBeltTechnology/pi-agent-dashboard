## Context

See proposal.md — Why. Change A (`archive/2026-09-08-detach-automation-goal-from-core`)
has landed: `pendingPluginRefRegistry` is the unified token-keyed store, `session_register`
merges an opaque `pluginRef` into `DashboardSession` + `.meta.json`, and `onSessionResolved`
fires for the owning plugin. Core still files the goal ref itself under `GOAL_REF_OWNER = "goal"`
(`server.ts:712`) because the goal product lives in core.

Current state of the goal product (all in `packages/server/src`):

| Module | LoC | Core imports today |
|---|---|---|
| `goal/goal-store.ts` | 530 | none (node `fs`/`crypto` only; data dir `~/.pi/dashboard/goals`) |
| `goal/goal-budget-guard.ts` | 42 | none (pure) |
| `goal/decorate-goals-spend.ts` | 47 | none (takes a minimal `{ get(sessionId): { cost? } }` read surface) |
| `goal/goal-session-primer.ts` | 99 | none (deps injected: `sendPrompt`, `renameSession`) |
| `goal/goal-status-projector.ts` | 121 | `./goal-store` |
| `goal/goal-verdict-accumulator.ts` | 101 | `./goal-store` |
| `goal/goal-supervisor.ts` | 447 | `./goal-store`, **`../auth/spawn-token.js` (`mintSpawnToken`)** |
| `routes/goal-routes.ts` | 406 | `../goal/*`, `PreferencesStore`, `SessionManager` types, **`NetworkGuard` as `preHandler` on all 6 routes** (`:158,177,229,309,339,392`) |

The modules themselves are almost core-free. The coupling is all in the **wiring** —
`server.ts:1118-1245` (goal_status handlers, primer impl), `:1507-1645` (goals_update
broadcast, `applyGoalIdToSession`, `registerGoalRoutes`, `spawnGoalDriver`, supervisor,
boot reconcile), `:1099` (death fanout), `:2970` (dispose), and `event-wiring.ts:494-530,
1457-1461` (`linkGoalDriver` on register).

`goal-plugin` manifest: `id: "goal"`, `priority: 100` → passes the `≤ 100` trusted gate for
`spawnSession` / `abortSpawnedRun`. Its manifest id equals today's `GOAL_REF_OWNER`, so a ref
filed by the plugin lands under the **same owner id** core uses now.

Constraints: no behaviour change for the goal product (same commands, REST paths
`/api/folders/goals*` — the client hardcodes them in `goals-api.ts` — same response shapes,
`.meta.json`, wire protocol); `automation-plugin` is the layout reference
(`src/server/{routes,run-store,...}.ts` + `src/server/__tests__/`). **Carve-out:** the generic
plugin seam itself gains behaviour visible to every trusted plugin (duplicate-`spawnToken`
rejection; new capabilities).
These are deliberate seam changes, documented in `server-context-api.md`, not goal behaviour.

## Goals / Non-Goals

**Goals:**
- Every host service the goal product needs is reachable through `ServerPluginContext`; core
  contains zero goal-specific identifiers after the change (no `goal/` dir, no `goalId`
  handling in `event-wiring.ts`, no `GOAL_REF_OWNER`).
- Seam widenings are **generic** (usable by any trusted plugin), named for what they do, not
  for goal.
- Relocated modules are moved, not rewritten — diffs inside them are limited to import paths
  and the supervisor's token source. Exception: `routes.ts`'s deps interface, whose core type
  imports (`PreferencesStore`, `SessionManager`, `NetworkGuard`) cannot resolve cross-package
  (`server/package.json` has `exports: {}`); it is re-declared against `ServerPluginContext`
  types (`PluginSessionManager`, `ServerPluginContext["networkGuard"]`, `host.knownFolderCwds`).
  Route bodies are unchanged.

**Non-Goals:**
- Changing `DashboardSession.goalId` from a core-typed field to an untyped ref key. It stays
  declared in `@pi-dashboard/shared` (the client reads it); it is *populated* via the generic
  ref merge, exactly as Change A already does.
- Re-implementing `automation-plugin` patterns in goal (e.g. run-store) — goal keeps its own
  store format.
- Widening `PluginSessionManager` typing (`unknown` returns). The plugin casts to
  `DashboardSession` from shared types, as automation does.

## Decisions

### D1 — Close the gaps by widening `ServerPluginContext` generically (chosen; user-confirmed)

Eight host services have no plugin-runtime path today. Seven get a generic capability; one
(#6) is served by an existing host service:

| # | Gap (today in `server.ts` / `event-wiring.ts`) | New generic capability |
|---|---|---|
| 1 | Supervisor pre-mints `spawnToken`, persists it in `inFlightSpawn` **before** spawn (`goal-supervisor.ts:304`); `ctx.spawnSession` mints internally | `ctx.mintSpawnToken(): string` + `PluginSpawnOptions.spawnToken?: string` (caller-supplied token used verbatim; core still files the ref against it) |
| 2 | Resume respawn passes `sessionFile` + `mode: "continue"` (`server.ts:1593`) | `PluginSpawnOptions.resume?: { sessionFile: string }` → `pluginSpawnToSessionOptions` maps to session-level `{ sessionFile, mode: "continue" }`. The existing plugin-level `mode?: "worktree" \| "local"` (run isolation) is untouched — the two `mode`s live on different types; the mapper is the only place both meet |
| 3 | Fresh respawn enqueues the reprime via `pendingInitialPromptRegistry.enqueue(cwd, …)`, consumed on spawn failure (`:1584-1610`) | `PluginSpawnOptions.initialPrompt?: string` — core enqueues before spawn, consumes on failure/throw (same code path) |
| 4 | Primer `renameSession`: `sessionManager.update({name})` + `broadcastSessionUpdated` + `rename_session` to pi (`:1206-1212`) | `ctx.renameSession(sessionId, name: string): boolean` (trusted-gated) |
| 5 | Routes `applyGoalIdToSession`: `sessionManager.update({goalId})` + `mergeSessionMeta` + `broadcastSessionUpdated` (`:1515-1527`); **and** `linkGoalDriver`'s C2e clear of the *outgoing* driver, which is `sessionManager.update(prev, { goalId: undefined })` **only** — no meta write, no broadcast (`event-wiring.ts:502-506`) | `ctx.assignSessionRef(sessionId, ref: Record<string, unknown \| undefined>, opts?: { persist?: boolean }): boolean` — runs the ref through `sanitizePluginRef` (`CORE_RESERVED_REF_KEYS` + `keyOwners`, same as the register path) then merges. `persist` defaults `true` = memory + `.meta.json` + `session_updated` broadcast; `persist: false` = in-memory only (the C2e case; meta keeps the old key so a restart rehydrates it exactly as today). `undefined` value clears the key at each persisted layer. Returns `false` for unknown session or untrusted caller; `true` otherwise, even when sanitize dropped every key (warn-once via the registry's channel) |
| 6 | Routes known-cwd check = `sessionManager.listAll()` cwds ∪ `preferencesStore.getPinnedDirectories()` (`goal-routes.ts:83-85`) | **No widening.** `ctx.consume<() => string[]>("host.knownFolderCwds")` (`server.ts:1049`, already consumed by kb-plugin) computes exactly that union |
| 7 | All six goal routes mount with `{ preHandler: networkGuard }` (`goal-routes.ts:158…392`); plugins have no access to the guard (`automation` routes rely on the auth `onRequest` hook only) | `ctx.networkGuard: preHandler` — the same `createNetworkGuard` instance core passes to its own route groups (`server.ts:1384`). Not trust-gated (attaching a guard only tightens) |
| 8 | Shutdown runs `clearTimeout(bootReconcileTimer); goalSupervisor.dispose()` (`server.ts:2969-2970`) **before** `piGateway.stop()` (`:2994`), so bridge-teardown deaths hit a disposed supervisor. `fastify.onClose` fires after both — too late | `ctx.onShutdown(fn: () => void): () => void` — core dispatches all subs at the exact point `goalSupervisor?.dispose()` runs today (same `try/catch` pattern as `pluginSessionEndSubs`). Not trust-gated |

Rationale: this is the same mechanism Change A used (generic seam, opaque ref) and keeps the
composition root goal-agnostic — the proposal's parity target. Each widening is ≤ ~15 lines in
`server.ts` and lifts code that already exists there into a named capability.

Supervisor deps map (`createGoalSupervisor` deps, today `server.ts:1620-1628`):

| Dep | Plugin source |
|---|---|
| `isSessionLive`, `resolveSessionFile` | `ctx.sessionManager.getSession(id)` cast to `DashboardSession` (`status`, `sessionFile`) |
| `killByToken(token)` | `ctx.abortSpawnedRun({ spawnToken: token })` |
| `killBySession(id)` | `ctx.abortSpawnedRun({ sessionId: id })` — called **after** `killByToken` fails, preserving today's token-first order (`goal-supervisor.ts:385-387`) |
| `spawnDriver` | `ctx.spawnSession` (D3) |
| primer `sendPrompt` | `ctx.sendToSession` |
| primer `renameSession` | `ctx.renameSession` (#4) |
| death fanout `onDriverDeath` | `ctx.onSessionEnded` — today goal runs *before* all plugin subs (`server.ts:1099`); post-move it is one sub in load order. Goal store and automation run-store are disjoint state → no ordering dependency |

Alternatives considered:
- **Core `provide("goal-host", {...})` adapter** — fastest, but core still names goal and owns
  goal-shaped callbacks; only partial parity. Rejected.
- **Restructure supervisor to record the token after spawn** (drops gap 1) — changes the
  crash window covered by `reconcileOnBoot`; violates "no behaviour change". Rejected.
- **Plugin calls its own host over REST** (rename / link) — loopback HTTP from inside the
  process, auth token juggling. Rejected.

### D2 — `linkGoalDriver` moves into the plugin as an `onSessionResolved` handler

Today `event-wiring.ts` runs `linkGoalDriver` when `session.goalId` changed across register
(`priorGoalId !== goalId`). The plugin subscribes `ctx.onSessionResolved((sessionId, ref) =>
…)`, which Change A dispatches **only on the first-register (token-consumed) path** — the
reconnect / cold-start restore path deliberately does not notify (`event-wiring.ts:1404-1406`).
The handler links when `goal.driverSessionId !== sessionId` (idempotent for a re-delivered
first register).

Divergence, accepted: core also re-links on the *restore* path whenever in-memory `goalId` was
lost but the persisted ref still carries it (e.g. the C2e-cleared outgoing driver reconnects,
or an alive replaced driver survives a restart via `cleanupOrphans` reclaim). That re-link
steals the pursuit back and re-sends `/goal` to an already-primed session — the plugin does
**not** reproduce it. Conversely the plugin never fires on restore, so it can never steal where
core's `priorGoalId === goalId` (meta-rehydrated) guard would hold. Net: strictly fewer
re-links, all in the duplicate-prime direction. Test: alive-old-driver-after-restart
re-register → no `replaceDriver`, no primer.

Alternatives: owner-notify on the restore path (persisting `ownerId` on the pid-registry
entry) — reproduces core's steal case and reverses a Change A decision; rejected. A new
`ctx.onSessionRegistered` firing for every register with prior/next snapshots — broader than
needed; rejected.

### D3 — Wiring layout inside `goal-plugin/src/server/`

Mirror `automation-plugin`: relocated modules keep their basenames under
`packages/goal-plugin/src/server/`; `routes.ts` (was `goal-routes.ts`); `index.ts` becomes the
composition root for the product (store, handlers, routes, supervisor, boot reconcile, dispose)
and keeps the existing `goal_status` snapshot broadcast + `plugin_action` handler. The
`goal_status` peers (accumulator, projector, budget guard) register through
`ctx.registerPiHandler` — same dispatch (`dispatchPluginPiMessage`) they ride today.

`goals_update` broadcast: `ctx.broadcastToSubscribers({ type: "goals_update", cwd, goals:
decorateGoalsWithSpend(payload.goals, spendLookup) })` where `spendLookup = { get: (id) =>
ctx.sessionManager.getSession(id) as DashboardSession | undefined }` (the helper's surface is
`get()`, `PluginSessionManager` exposes `getSession()`; routes use the same adapter) — the spend
decoration core applies today (`server.ts:1509-1512`) moves with it; same wire type. No client subscribes
to it yet (`useGoals.ts` refetches over REST), so the payload must stay identical but has no
live consumer to regress.

Routes mount on `ctx.fastify` (raw instance, as automation does) under the **unchanged**
`/api/folders/goals*` paths — not the `/api/plugins/<id>/*` prefix automation chose. Known-cwd
guard: `ctx.consume("host.knownFolderCwds")` (D1-#6); route guard: `ctx.networkGuard` (D1-#7).

Link handler (D2) outgoing-driver clear: `ctx.assignSessionRef(prevDriver, { goalId: undefined
}, { persist: false })` — byte-for-byte the C2e semantics.

Spawn paths collapse to one `spawnDriver` built on `ctx.spawnSession({ cwd, model?,
spawnToken, pluginRef: { goalId }, lifecycle: { recover: false }, resume?, initialPrompt? })`.
`GoalRecord.inFlightSpawn.spawnToken` keeps the pre-minted token (D1-#1).

Boot reconcile keeps the 30 s `unref`'d timer, started from `registerPlugin`. Dispose:
`ctx.onShutdown(() => { clearTimeout(bootReconcileTimer); supervisor.dispose(); })` (D1-#8),
which fires at the same point in the shutdown sequence core disposes today — before
`piGateway.stop()` tears bridges down. `fastify.onClose` was considered and rejected: it fires
after bridge teardown, so death events would reach a live supervisor and could respawn during
shutdown or an in-process create/stop cycle. Supervisor backoff timers are not `unref`'d
(`goal-supervisor.ts:117,123`), so the hook is required, not optional.

### D4 — Tests move with their modules

The 8 core test files (`__tests__/{goal-*,decorate-goals-spend}.test.ts`, 1,374 LoC) move to
`packages/goal-plugin/src/server/__tests__/` with import paths rewritten. New tests cover only
the seam widenings (D1) in core and the `onSessionResolved` link handler (D2) in the plugin.

### D5 — Ordering: plugin-load time is early enough

Plugins register before `fastify.listen` (automation already registers routes this way), so
routes and `goal_status` handlers exist before any bridge connects. `goalStore.subscribe` for
`goals_update` and the supervisor exist before the first spawn. Nothing in core needed the
goal registries before plugin load — the only pre-load consumer was `event-wiring.ts`'s
`linkGoalDriver`, which moves (D2).

## Risks / Trade-offs

- [Relocated module silently loses a host service, surfaces at runtime] → Every host service
  is enumerated in Context + D1; plugin `index.ts` must consume each named capability. Harness
  smoke: create goal → spawn driver → kill → respawn → reconnect, plus `goal_status` verdict
  persistence.
- [`assignSessionRef` lets any trusted plugin write arbitrary session keys] → trusted-gated
  (`priority ≤ 100`), same trust level `spawnSession` already grants; document in
  `server-context-api.md`.
- [Handover guard drift (D2)] → plugin links on first register only; core additionally
  re-links on restore when in-memory `goalId` was lost. Every dropped re-link is a
  duplicate-prime / steal-back case (see D2). Test reconnect, cold-start and
  alive-old-driver-after-restart explicitly.
- [`spawnToken` supplied by caller could collide] → only accepted from trusted plugins; the
  spawn path rejects a token for which `pendingPluginRefRegistry.has(token)` is true (new
  non-destructive check — `resolve()` consumes; today `file()` is `store.set` and would
  silently overwrite the prior owner). Format is bare `randomUUID()`, so duplicate-rejection,
  not format validation, is the control.
- [`initialPrompt` rides the per-cwd `pendingInitialPromptRegistry` FIFO, so a concurrent
  register in the same cwd could consume it] → pre-existing behaviour on the same code path;
  out of scope under "no behaviour change".
- [Type-only `PluginSessionManager` (`unknown`)] → plugin casts to `DashboardSession`; a shape
  drift breaks at runtime, not compile time. Same exposure automation accepts today.
- [Server restart during the move] → `.meta.json` and goal files unchanged; a half-applied
  worktree is the only failure mode, covered by the single-PR merge.

## Migration Plan

1. Core: add the D1 capabilities + tests (`server.ts`, `server-context.ts`,
   `pluginSpawnToSessionOptions`, `pending-plugin-ref-registry.ts` `has()`). Core still runs
   the goal product at this point — no behaviour change, tests green. Landable alone.
2. **Atomic with 3** — Plugin: `git mv` the seven modules + routes + tests into
   `goal-plugin/src/server/`; build the composition root in `index.ts` against `ctx`.
3. **Atomic with 2** — Core: delete goal wiring from `server.ts` and `event-wiring.ts`
   (`goalStore`, `primeGoalSession` deps, `linkGoalDriver`, `GOAL_REF_OWNER`); remove `goal/`
   dir and its `AGENTS.md` tree; `kb dox lint` clean. Steps 2 and 3 cannot be split: both
   sides registering `/api/folders/goals*` on the same fastify instance is
   `FST_ERR_DUPLICATED_ROUTE` at boot, and two stores/supervisors would double-drive.
4. Docs: `docs/architecture.md` (DocScribe) + `server-context-api.md` reference for the new
   capabilities; directory `AGENTS.md` rows.
5. Rollback: single PR revert — no on-disk format changed.

## Open Questions

None — dispose resolved via `ctx.onShutdown` (D1-#8, D3); `NetworkGuard` is load-bearing on
every goal route and is served by D1-#7.
