## 1. Already on develop (prerequisites — no work here)

- [x] 1.1 Base work-source contract (`WorkSource`, `LeasedHandle`) exists in `shared/work-source.ts`
- [x] 1.2 Base `WorkSourceRegistry` (`register`/`get`/`has`/`ids`) exists
- [x] 1.3 `schedule.batch` fan-out (`scheduleBatchTrigger`, `startWorkSourceFire`, `workSources`) shipped via `automation-work-source-fanout`
- [x] 1.4 `scanner.ts` threads `knownWorkSourceIds` into `parseAutomationYaml` (verified identical to final)
- [x] 1.5 `automation-schema.ts` validates `on.source` against the passed id set (verified identical to final)
- [x] 1.6 `detach-automation-goal-from-core` `pluginRef`/`lifecycle` spawn seam landed (must be PRESERVED, not reverted)

## 2. Cross-plugin registration seam

- [x] 2.1 Add `WorkSourceContext` + optional async `take` to `shared/work-source.ts` (shared members factored into `WorkSourceCommon`; `next` stays synchronous); verify existing `WorkSource` implementations still satisfy the type
- [x] 2.2 Add `WorkSourceProvider` + `addProvider` + lazy `get`/`has`/`ids` consult with per-provider try/catch isolation to `work-source-registry.ts`; verify local ids win collisions
- [x] 2.3 Create `work-source-contributions.ts` — `WORK_SOURCE_CONTRIBUTION_PREFIX` + `collectWorkSourceContributions` (structural `next`/`ack`/`nack` check, drop malformed/dup with warning, domain-free)
- [x] 2.4 Wire the seam in `server/index.ts`: `collectWorkSourceContributions(ctx.consumeAll("automation.worksource."))` → `workSources.addProvider({ ids, get })`, collected lazily

## 3. Targeted single-item run

- [x] 3.1 Graft `runWorkItem(automation, key)` into `engine.ts` (interface member + implementation + export), leasing via `source.take`, `in_flight` on null lease, `unsupported` without `take`, reusing the batch child spawn path — PRESERVED develop's `pluginRef`/`lifecycle` spawn shape (additive graft, `automationRun` NOT reintroduced)
- [x] 3.2 `await` the async `take` and pass `WorkSourceContext { cwd }` at lease time in `engine.ts` (`next` kept synchronous — no propagation into `startWorkSourceFire`)
- [x] 3.3 In `server/index.ts`, provide `automation:runWorkItem` and wire `runWorkItemViaEngine(cwd, key)` (scan scope for the `schedule.batch` automation → `engine.runWorkItem`)

## 4. /list stops lying

- [x] 4.1 In `routes.ts`, rename `KNOWN_KINDS` → `FALLBACK_KINDS` and validate via `hooks.triggerKinds?.() ?? FALLBACK_KINDS`; thread `hooks.workSourceIds?.()` into `scanAutomations` + `parseAutomationYaml`; add `triggerKinds`/`workSourceIds` to `AutomationRouteHooks`
- [x] 4.2 In `server/index.ts`, supply `triggerKinds: () => engineRef?.registry.kinds()` and `workSourceIds: () => engineRef?.workSources.ids()` route hooks

## 5. Tests

- [x] 5.1 `work-source-registration-seam.test.ts` — late publish, malformed/duplicate drop, throwing-provider isolation, local-wins-collision; passes
- [x] 5.2 `run-work-item.test.ts` — one child per named item (value in payload), `in_flight` refusal on live lease, `unsupported` without `take`, dead-run lease release; spawn-stamp reads adapted to develop's `pluginRef.automationRun.idempotencyKey` shape; passes
- [x] 5.3 Existing `work-source-fanout.test.ts` stays green (sync `next` unchanged — no regression)

## 6. Validate

- [x] 6.1 `openspec validate work-source-seam --strict` passes
- [x] 6.2 `automation-plugin` tests green (360 passed, 37 files); `npm run build` succeeds (client built during `pnpm install`); `tsc --noEmit` 0 errors (matched develop baseline exactly)
