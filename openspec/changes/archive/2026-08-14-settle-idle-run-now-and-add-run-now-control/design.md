## Context

`engine.runNow` (added by `run-now-fans-out-per-invoice`) fans a manual run-now
out to one run per queued invoice. For an empty queue it returns `{ ok: true }`
with no `runId`, mirroring the scheduler's "skip on empty" behaviour. That is
wrong for the manual path: run-now is an explicit operator action and must always
issue a settling run id.

The board card (`AutomationBoard.tsx`) already renders a run-now button with a
per-card `data-testid={run-now-<name>}` and an `onRunNow` handler that POSTs the
run-now API. It lacks the stable `auto-row` container class and the stable
`automation-run-now` testid the row contract requires.

## Decisions

### Decision 1 — Manual empty-queue → one idle settling run

In `engine.runNow`, when the per-invoice fan-out yields an empty `contexts`
list, start ONE run via `startRunFor(automation)` with NO fire context (no bound
invoice, no scoped env). This is the "idle pick": the process flow finds nothing
queued and settles promptly. It returns `startRunFor`'s `runId`, so:

- the run-id contract holds (a manual click always yields a run);
- two consecutive idle run-nows return distinct ids, because `startRunFor` mints
  a fresh run id per call via the run store.

The scheduler path is untouched: `dispatchFire` still logs "no queued invoices;
no fire" and starts nothing on an empty queue. Only the manual `runNow` differs —
exactly the manual-vs-scheduled distinction the defect calls for.

A missing/failed enumerator still returns `{ ok: false }` (fan-out is genuinely
unavailable — not the same as "queue empty"). A non-empty queue is unchanged.

### Decision 2 — Stable run-now control on the row

Add `auto-row` to the card `<li>` className (additive; existing classes kept) so
the row is selectable as `.auto-row`. Give the run-now button the stable
`data-testid="automation-run-now"` while keeping the per-card `run-now-<name>`
addressability for existing unit assertions.

A single element carries one `data-testid`, so the run-now button's primary
`data-testid` becomes the stable `automation-run-now`; per-card unit assertions
scope by the card container (`within(getByTestId("automation-def-<name>"))`)
instead of the old per-card run-now testid. The button stays gated on
`a.valid && !running` (invalid → no run-now; running → Stop), unchanged.

## Non-goals

- No change to the scheduler fan-out, the enumerator wiring, interpolation, or
  the per-invoice env/inputs resolution.
- No change to the enable/disable control or the overflow (Edit/Delete) menu.
- The idle run does not resolve `${invoice_id}` (there is no invoice to bind); it
  is a plain folder-level run that settles on an empty pick.
