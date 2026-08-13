## 1. Shared fan-out core

- [ ] 1.1 In `packages/automation-plugin/src/server/engine.ts`, extract the
  per-invoice enumerate→fire-context step out of `dispatchFire` into a shared
  helper returning `{ skip: true, reason } | { skip: false, contexts:
  FireContext[] }` (no enumerator / enumerate-threw → skip; empty queue →
  `contexts: []`).
- [ ] 1.2 Rewire `dispatchFire` to consume the shared helper (behaviour
  unchanged: skip → drop the fire with a warn; empty → no fire; else
  `runner.fire` per context).

## 2. Fan-out-aware run-now

- [ ] 2.1 Add `engine.runNow(automation)` to the Engine interface + return:
  non-per-invoice → `startRunFor(automation)` once; per-invoice → shared fan-out,
  `startRunFor(automation, fireCtx)` per queued invoice, returning the first
  started run's id. Skip → `{ ok: false, error }`; empty queue → `{ ok: true }`.
- [ ] 2.2 Route `runNowViaEngine` in `index.ts` through `engine.runNow(found)`
  instead of `engine.startRunFor(found)`.

## 3. Tests

- [ ] 3.1 Run-now on a per-invoice automation with a queue of N fans out to N
  `startRunFor` calls, each with a distinct bound `invoice_id` and resolved
  `env.IB_INVOICE_ID` (+ `IB_TOOLSET`); returns the first run's id.
- [ ] 3.2 Run-now on a per-invoice automation with an empty queue starts no run
  and returns `{ ok: true }` with no runId.
- [ ] 3.3 Run-now on a per-invoice automation with no enumerator wired starts no
  run and returns `{ ok: false }`.
- [ ] 3.4 Run-now on a non-per-invoice automation starts exactly one run
  (unchanged) and returns its runId.

## 4. Validate

- [ ] 4.1 `openspec validate run-now-fans-out-per-invoice --strict` passes.
- [ ] 4.2 Scoped tests + build green for the touched package.
