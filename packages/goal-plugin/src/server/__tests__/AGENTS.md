# DOX — packages/goal-plugin/src/server/__tests__

Test suites for the goal product hosted here. Moved from
`packages/server/src/__tests__/` with their modules (imports rewritten); new
suites cover the composition root + relocated route surface.

| File | Purpose |
|------|---------|
| `decorate-goals-spend.test.ts` | Purity + robustness of `decorateGoalsWithSpend` (new records, no in-place mutation, 0-contribution on bad lookup). Moved from core. See change: fix-goal-detail-turns-and-spend, relocate-goal-product-to-plugin. |
| `goal-budget-guard.test.ts` | `decideBudgetHalt` table: halt at cumulative `maxTurns`, `/goal pause` command, no-halt shapes. Moved from core. See change: sophisticate-goal-authoring-and-control. |
| `goal-routes.test.ts` | REST routes on the plugin deps surface (fastify inject): CRUD, link/unlink, spawn branch, cwd validation (200 active / 200 pinned-inactive / 403 neither), spend decoration (response decorated, persisted file clean, broadcast decorated), E18 guard preHandler on all six routes + non-loopback 403, E19 exact route table (no `/api/plugins/goal`), E20 known-cwd table. Fake sessionManager exposes `getSession` (plugin surface) + `get` (spend lookup). See change: add-goals-folder-page, relocate-goal-product-to-plugin. |
| `goal-session-primer.test.ts` | `primeGoalSession` command construction + rename ordering. Moved from core. See change: add-goal-session-supervisor. |
| `goal-status-projector.test.ts` | Snapshot → durable status/turn projection. Moved from core. See change: persist-goal-status-and-progress. |
| `goal-store.test.ts` | Store CRUD + link/unlink/replaceDriver + persistence round-trips on explicit tmpdir dataDir. Moved from core. See change: add-goals-folder-page. |
| `goal-supervisor.test.ts` | Respawn policy with injected fake timers/depis: backoff ladder, breaker, resume-vs-fresh, abort kill order, boot reconcile. `mintSpawnToken` now an injected dep. Moved from core. See change: add-goal-session-supervisor, relocate-goal-product-to-plugin. |
| `goal-verdict-accumulator.test.ts` | Verdict history append + advance gate (lastVerdict/turnsUsed). Moved from core. See change: sophisticate-goal-authoring-and-control. |
| `plugin-action-handler.test.ts` | Composition-root scenarios via REAL `registerPlugin` + fake ctx (vi.fn seams, real fastify + store): E21 goals_update spend decoration; E22 goal_status peers (accumulator/projector/budget halt via `/goal pause` dispatch); E23 token-first kill order + E23b token-miss session fallthrough; X5 no respawn after onShutdown dispose; X6 boot reconcile re-spawns with a NEW minted token after restart; E24 link handover (C2e clear persist:false, replaceDriver, prime once); E25 idempotent re-delivery. Uses per-test wiped default store dir. See change: relocate-goal-product-to-plugin. |
