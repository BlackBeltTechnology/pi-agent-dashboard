## 1. Work-source contract + registry

- [ ] 1.1 Define the `WorkSource` contract: `next(n) → LeasedHandle[] {item, leaseToken}`, `ack(leaseToken)`, `nack(leaseToken)` — both ack/nack conditional on the token being current (stale = no-op). Types in `packages/automation-plugin/src/shared/`.
- [ ] 1.2 Add a `WorkSourceRegistry` (keyed by source id), mirroring `trigger-registry.ts`. Register/get/has/ids.
- [ ] 1.3 Build the folder-backed reference work-source: lease-by-rename into an `inflight/<token>/` (or lease-file with monotonic token), visibility-timeout expiry returns the item, stale-token ack/nack no-op. Inject the watch/clock for tests.
- [ ] 1.4 Inject a stable per-item idempotency key (derived from item identity/lease) alongside the item; the same item id redelivered after expiry carries the same key.

## 2. schedule.batch trigger + schema

- [ ] 2.1 Add the `schedule.batch` trigger kind in `trigger-registry.ts` alongside `schedule`/`file`; parse `cron` + `on.source`.
- [ ] 2.2 `automation-schema.ts`: validate `on.source` against registered source ids (unknown → isolate invalid); require exactly one `action:` for `schedule.batch`; reject `actions:`/`count` for this kind.
- [ ] 2.3 Thread `PI_AUTOMATION_MAX_CONCURRENT_SPAWNS` env → `EngineConfig` default in `index.ts`; effective bound precedence per-automation → env → dashboard default (4).

## 3. Engine: resolve-lease-inject + lifecycle

- [ ] 3.1 In `startRunFor`, for a work-source fan-out: evaluate the `concurrency` policy FIRST, then `next(bound)`, then spawn one child per leased handle. A dropped/skipped fire leases nothing.
- [ ] 3.2 Per-child dispatch: resolve each child's `${{trigger}}` from its own leased item (per-child, not per-fire) via `interpolate.ts` (reused unchanged); inject the idempotency key.
- [ ] 3.3 Empty resolution → spawn nothing, settle fire as completed no-op. Source `next` throws → settle fire errored, lease nothing.
- [ ] 3.4 Wire lease release into every finalize path: `finalizeChild` (done→ack, error/stopped→nack), `stopChild`, `onSessionDeath`, stale-run reaper, pre-register spawn-failure guard.
- [ ] 3.5 Work-source path defers excess (leave unleased, no warning); static `count`/`actions` path keeps truncate-and-warn — unchanged.

## 4. Tests — folded from test-plan.md (manifest is source of truth)

### 4.1 L1 unit (vitest) — see packages/automation-plugin/src/__tests__/resolve-children.test.ts and automation-schema.test.ts for harness glue

- [ ] 4.1.1 next vends distinct handles — input: fake source items [a,b,c] · trigger: engine calls next(3) · observable: 3 handles each {item,leaseToken}, all distinct, no repeat. (test-plan #E1)
- [ ] 4.1.2 work-source bound defers — input: 10 items, bound 4 · trigger: one schedule.batch fire · observable: 4 children on distinct items, 6 still available, NO truncation warning. (test-plan #E2)
- [ ] 4.1.3 static bound truncates unchanged — input: count:10, bound 4 · trigger: fire · observable: 4 children (first-4) + parent warning naming bound & 6 not spawned. (test-plan #E3)
- [ ] 4.1.4 dynamic width = items vended — input: 3 items, bound 4 · trigger: fire · observable: exactly 3 children, no child scans source. (test-plan #E4)
- [ ] 4.1.5 empty resolution fast-fails — input: 0 items · trigger: fire · observable: no child, parent settles completed no-op. (test-plan #E5)
- [ ] 4.1.6 invalid bound rejected — input: maxConcurrentSpawns 0/-1/2.5 · trigger: parse · observable: validation error naming the field. (test-plan #E6)
- [ ] 4.1.7 per-automation bound overrides default — input: default 4, declares 2, 5 items · trigger: fire · observable: at most 2 children. (test-plan #E7)
- [ ] 4.1.8 within-limit not surfaced — input: 2 items, bound 4 · trigger: fire · observable: both spawn, no warning. (test-plan #E8)
- [ ] 4.1.9 schedule.batch requires single action — input: schedule.batch + actions:[] OR count:3 · trigger: parse · observable: validation error, automation isolated. (test-plan #E9)
- [ ] 4.1.10 unknown on.source isolates — input: on.source: nope · trigger: parse/arm · observable: automation isolated invalid, siblings unaffected. (test-plan #E10)
- [ ] 4.1.11 bound precedence per-auto → env → default — input: env PI_AUTOMATION_MAX_CONCURRENT_SPAWNS=6, then per-auto 2 · trigger: resolve effective bound · observable: env→6, per-auto→2. (test-plan #E11)
- [ ] 4.1.12 manual run vends from source — input: schedule.batch, 2 items · trigger: manual run-now · observable: 2 children for the items, no item-less child. (test-plan #E12)
- [ ] 4.1.13 per-child ${{trigger}} injection — input: source [a,b,c], payload input:"${{trigger}}" · trigger: fire → 3 children · observable: child(a).input==a, child(b)==b, child(c)==c. (test-plan #E13)
- [ ] 4.1.14 templating syntax unchanged — input: input:"${{trigger}}" · trigger: dispatch · observable: token resolves per-child, no new syntax parsed. (test-plan #E14)
- [ ] 4.1.15 redelivery reuses idempotency key — input: item a key K, lease expires, a re-vended · trigger: second delivery · observable: redelivered child gets same key K. (test-plan #E15)
- [ ] 4.1.16 single-flight, no two concurrently-valid leases — input: two overlapping fires over overlapping set · trigger: both call next · observable: first lease wins, second excludes it, item bound to exactly one child. (test-plan #F1)
- [ ] 4.1.17 in-flight excluded, new arrival drained later — input: a,b leased+running, c arrives after · trigger: subsequent fire · observable: current fire ignores c; later fire resolves c once. (test-plan #F2)
- [ ] 4.1.18 stale-token ack is a no-op — input: a's lease expired + re-vended to child2 · trigger: child1 ack(staleToken) · observable: no-op, child2's lease intact, a not double-dropped. (test-plan #X1)
- [ ] 4.1.19 stale-token nack is a no-op — input: a's lease expired + re-vended · trigger: child1 nack(staleToken) · observable: no-op, a remains leased to child2. (test-plan #X2)
- [ ] 4.1.20 dead child releases its item — input: child bound to a · trigger: child dies before terminal · observable: a released, subsequent fire reprocesses a. (test-plan #X3)
- [ ] 4.1.21 spawn failure releases item — input: a leased, spawn hook throws · trigger: spawn attempt · observable: a's lease released, a available next fire. (test-plan #X4)
- [ ] 4.1.22 ack-on-done, nack-on-error — input: two children, one done one error · trigger: both finalize · observable: done item acked/dropped, error item nacked/returned. (test-plan #X5)
- [ ] 4.1.23 source next throws leases nothing — input: fake source next throws · trigger: fire · observable: fire errored, no child, no item leased. (test-plan #X6)
- [ ] 4.1.24 lease expiry auto-releases — input: source visibility timeout T, child never acks · trigger: advance clock past T · observable: item returns to available pool without explicit nack. (test-plan #X7)
- [ ] 4.1.25 skipped overlapping fire leases nothing — input: concurrency:skip, previous parent running · trigger: second fire · observable: dropped, leases 0, all items still available. (test-plan #X8)
- [ ] 4.1.26 engine is domain-free — input: automation engine source · trigger: grep the engine module · observable: no invoiceId/invoicebot literals; resolution only via injected work-source. (test-plan #X9)

### 4.2 L3 e2e (Playwright vs docker harness) — see tests/e2e/automation-fanout.spec.ts; read dashboardPort from .pi-test-harness.json

- [ ] 4.2.1 end-to-end folder drain, no double-process — input: folder-backed source with 3 files, schedule.batch automation · trigger: one fire against the harness · observable: 3 child sessions each bound to a distinct file, folder drained, no file processed by two children. (test-plan #F3)

## 5. Docs

- [ ] 5.1 Update `packages/automation-plugin/` directory `AGENTS.md` rows for the new files (work-source-registry, schedule-batch trigger, engine lease lifecycle) and the `configSchema.json` `on.source` + defer semantics. (docs prose under docs/ delegated to DocScribe if any.)
