## 1. Idle settling run-now on an empty queue (server)

- [x] 1.1 In `packages/automation-plugin/src/server/engine.ts`, change
  `runNow`'s empty-queue branch for a `scope: per-invoice` automation to start
  ONE idle run via `startRunFor(automation)` (no fire context) and return its
  `runId`, instead of `{ ok: true }` with no id.
- [x] 1.2 Leave the scheduler `dispatchFire` empty-queue behaviour (skip) and the
  missing-enumerator branch (`{ ok: false }`) unchanged.

## 2. Run-now control on the automation row (client)

- [x] 2.1 In `packages/automation-plugin/src/client/AutomationBoard.tsx`, add the
  `auto-row` class to the automation card `<li>` (additive) and give the run-now
  button the stable `data-testid="automation-run-now"`, keeping it gated on
  `a.valid && !running` and wired to the existing `onRunNow`.
- [x] 2.2 Update `AutomationBoard.test.tsx` per-card run-now assertions to scope
  by the card container (the run-now testid is now stable).

## 3. Tests

- [x] 3.1 Server: run-now on a `scope: per-invoice` automation with an EMPTY
  queue starts exactly one run and returns a `runId`; two consecutive empty
  run-nows return DISTINCT run ids.
- [x] 3.2 Server: run-now with a non-empty queue still fans out one run per
  invoice (unchanged); missing enumerator still returns `{ ok: false }`;
  scheduler `dispatchFire` on an empty queue still starts no run.
- [x] 3.3 Client: the valid automation row exposes an enabled
  `automation-run-now` button that calls the run-now API; a running row shows
  Stop (no run-now); an invalid row offers no run-now.

## 4. Validate

- [x] 4.1 `openspec validate settle-idle-run-now-and-add-run-now-control --strict`
  passes.
- [x] 4.2 Scoped tests + build green for the touched package.
