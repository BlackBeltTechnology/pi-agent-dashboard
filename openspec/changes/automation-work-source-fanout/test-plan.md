# Test Plan — automation-work-source-fanout

Stage: design   Generated: 2026-08-28

All scenarios' Triple slots resolve concretely from the doubt-reviewed specs.
The lease / resolve / dispatch logic is pure and driven by an **injectable fake
work-source** (mirrors the existing `resolve-children.test.ts` / engine dep
injection), so it routes L1. One L3 exercises a real end-to-end folder drain
against the docker harness.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | work-source vends distinct handles | EP | L1 | automated | fake source with items [a,b,c] | engine calls `next(3)` | 3 handles, each `{item, leaseToken}`, all items distinct, no repeat |
| E2 | bound — work-source defers | BVA | L1 | automated | source with 10 items, effective bound 4 | one `schedule.batch` fire | exactly 4 children spawned on distinct items; 6 items still available; NO truncation warning on parent |
| E3 | bound — static truncate unchanged | BVA | L1 | automated | static `count: 10`, bound 4 | one fire | 4 children spawned (first-4 order) + parent warning naming bound & 6 not spawned |
| E4 | dynamic width = items vended | EP | L1 | automated | source with 3 items, bound 4 | `schedule.batch` fire | exactly 3 children, one per item; no child scans source |
| E5 | empty resolution fast-fails | BVA (zero) | L1 | automated | source with 0 items | fire | no child spawned; parent settles as completed no-op |
| E6 | invalid bound rejected | BVA (invalid) | L1 | automated | `maxConcurrentSpawns: 0` / `-1` / `2.5` | parse yaml | validation error naming `maxConcurrentSpawns` |
| E7 | per-automation bound overrides default | EP | L1 | automated | settings default 4, automation declares 2, source has 5 items | fire | at most 2 children spawned |
| E8 | within-limit not surfaced | BVA (below) | L1 | automated | source with 2 items, bound 4 | fire | both spawn; no truncation warning recorded |
| E9 | `schedule.batch` requires single action | decision-table | L1 | automated | `schedule.batch` + `actions:[...]` OR `count: 3` | parse yaml | validation error; automation isolated invalid |
| E10 | unknown `on.source` isolates | decision-table | L1 | automated | `on.source: nope` (unregistered id) | parse/arm | automation isolated invalid, siblings unaffected |
| E11 | bound precedence per-auto → .env → default | decision-table | L1 | automated | no per-auto bound; `PI_AUTOMATION_MAX_CONCURRENT_SPAWNS=6` set; then a per-auto `2` added | resolve effective bound | env case → 6; per-auto case → 2 (per-auto wins over env, env wins over default 4) |
| E12 | manual run vends from source | state-transition | L1 | automated | `schedule.batch` automation, source has 2 items | manual run-now (`startRunFor`) | 2 children spawned for the items; no item-less child |
| E13 | per-child `${{trigger}}` injection | EP | L1 | automated | source [a,b,c], action payload `input: "${{trigger}}"` | fire → 3 children | child(a) payload `input==a`, child(b)`==b`, child(c)`==c` |
| E14 | templating syntax unchanged | EP | L1 | automated | author writes `input: "${{trigger}}"` under a work-source automation | dispatch | same token resolves per-child; no new placeholder syntax required/parsed |
| E15 | redelivery reuses idempotency key | state-transition | L1 | automated | item `a` delivered with key K, lease expires, `a` re-vended next fire | second delivery | redelivered child receives the SAME key K |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | single-flight — no two concurrently-valid leases | state-transition | L1 | automated | two overlapping fires, provider would resolve overlapping available set | both call `next` | first fire's lease wins; second excludes the leased item; item bound to exactly one child across both |
| F2 | in-flight excluded; new arrival drained later | state-convergence | L1 | automated | items a,b leased+running; c arrives after | subsequent fire | current fire ignores c; a later fire (a,b no longer available) resolves c and processes it once |
| F3 | end-to-end folder drain, no double-process | state-convergence | L3 | automated | folder-backed source with 3 files, `schedule.batch` automation | one fire against docker harness (`dashboardPort` from `.pi-test-harness.json`) | 3 child sessions each bound to a distinct file; folder drained; no file processed by two children |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | stale-token `ack` is a no-op | fault-injection | L1 | automated | lease on `a` expires, `a` re-vended to child2 | child1 calls `ack(staleToken)` | `ack` is a no-op; `a`'s current lease (child2) unaffected; `a` not double-dropped |
| X2 | stale-token `nack` is a no-op | fault-injection | L1 | automated | lease on `a` expires, `a` re-vended to child2 | child1 calls `nack(staleToken)` | `nack` is a no-op; `a` remains leased to child2 (not recalled) |
| X3 | dead child releases its item | fault-injection (abort) | L1 | automated | child bound to `a` | child dies before terminal status | `a` nacked/released; a subsequent fire may resolve and reprocess `a` |
| X4 | spawn failure releases item | fault-injection (abort) | L1 | automated | `a` leased, spawn hook throws | spawn attempt | `a`'s lease released; `a` available next fire |
| X5 | ack-on-done, nack-on-error | decision-table | L1 | automated | two children: one ends `done`, one ends `error` | both finalize | `done` child's item `ack`ed (dropped); `error` child's item `nack`ed (returned) |
| X6 | source `next` throws → nothing leased | fault-injection (abort) | L1 | automated | fake source whose `next` throws | fire | fire recorded errored; no child spawned; no item left leased |
| X7 | lease expiry auto-releases | fault-injection (delay) | L1 | automated | fake source visibility timeout T; child never acks within T | advance clock past T | item returns to available pool without any explicit nack |
| X8 | skipped overlapping fire leases nothing | state-transition (illegal edge) | L1 | automated | `concurrency: skip`, previous parent still running | second fire arrives | second fire dropped; leases 0 items; every available item still available (none held by dropped fire) |
| X9 | engine is domain-free | static-scan | L1 | automated | automation engine source | grep the engine module | contains no domain literals (`invoiceId`, `invoicebot`); all item resolution via the injected work-source contract |

---

## Coverage summary

- Requirements covered: 15/15 spec requirements (both delta files)
- Scenarios by class: edge 15 · perf 0 · frontend 3 · error 9
- Scenarios by level: L1 26 · L2 0 · L3 1
- Scenarios by disposition: automated 27 · manual-only 0

## New infra needed

- none. L1 reuses the existing vitest + injectable-engine-dep pattern
  (`resolve-children.test.ts`, `automation-schema.test.ts`); F3 reuses the docker
  e2e harness (`tests/e2e/automation-fanout.spec.ts` exemplar,
  `dashboardPort` from `.pi-test-harness.json`).
