## 1. Named-variable interpolation

- [ ] 1.1 Extend `interpolate(value, triggerValue, vars?)` in
  `packages/automation-plugin/src/server/interpolate.ts` to resolve single-brace
  `${name}` tokens against `vars`, leaving unknown tokens intact and preserving
  the existing `${{trigger}}` behaviour.
- [ ] 1.2 Thread `vars` through the recursive traversal (arrays + objects).

## 2. Fan-out on fire

- [ ] 2.1 Add `FireContext.vars?` and `FireContext.invoiceId?` in
  `trigger-registry.ts`.
- [ ] 2.2 Add `EngineDeps.enumerateQueued?: (cwd) => Promise<string[] | null>`.
- [ ] 2.3 Wrap the scheduler `onFire` with a per-invoice fan-out dispatcher:
  when `action.payload.scope === "per-invoice"`, enumerate queued invoices for
  the run workspace and `runner.fire` once per id (carrying `vars.invoice_id` +
  `invoiceId`); empty queue fires nothing; missing enumerator skips the fire
  with a warn; non-per-invoice actions fire once as before.
- [ ] 2.4 Expose the fan-out dispatcher on the Engine (e.g. `fire`) for tests.
- [ ] 2.5 Log the fan-out count and skip reasons.

## 3. Scoped run env

- [ ] 3.1 Widen `SpawnLike` with `env?: Record<string, string>`.
- [ ] 3.2 In `startRunFor`, resolve the action payload with trigger + vars,
  extract `payload.env` for a per-invoice fire, and forward it to
  `spawnSession`. Resolve `${invoice_id}` inside `inputs` via the same vars so
  the dispatched flow input carries the real id.

## 4. Wire the enumerator (cross-plugin seam)

- [ ] 4.1 In `packages/invoicebot-plugin/src/server/index.ts`, `provide`
  `invoicebot:queuedInvoices` = `(cwd) => engine.query(cwd, { view: "list",
  state: "queued" })` mapped to `details.items[].id`.
- [ ] 4.2 In `packages/automation-plugin/src/server/index.ts`, inject
  `enumerateQueued` that lazily `consume`s `invoicebot:queuedInvoices` at fire
  time.

## 5. Tests

- [ ] 5.1 `interpolate` resolves `${invoice_id}` from vars, leaves unknown
  `${x}` intact, and still resolves `${{trigger}}`.
- [ ] 5.2 Fan-out count equals queued count: an enumerator returning 3 ids
  produces 3 runs, each spawn carrying the resolved `env.IB_INVOICE_ID` for its
  id and a dispatched flow `inputs.invoice_id` equal to that id.
- [ ] 5.3 `concurrency: queue` serialises the fan-out: one active run + the rest
  queued under one automation key; draining starts the next.
- [ ] 5.4 Empty queue → no fire (no runs, no spawn).
- [ ] 5.5 Missing enumerator → per-invoice fire skipped (no literal-token run).

## 6. Validate

- [ ] 6.1 `openspec validate wire-per-invoice-automation-drain --strict` passes.
- [ ] 6.2 Scoped tests + build green for the touched packages.
