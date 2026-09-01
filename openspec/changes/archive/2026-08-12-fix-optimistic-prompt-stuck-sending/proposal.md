# Fix the browser client's optimistic prompt stuck at `sending`

## Why

`fix-bridge-stale-ctx-crash` removed the stale-`ctx` crash that killed pi
mid-session. With that crash gone, the faux browser-E2E specs
`tests/e2e/faux-text.spec.ts` (#F1) and `tests/e2e/faux-ask.spec.ts` (#F2) are
STILL red — a **second, independent fault**, which that change explicitly
reclassified as out of scope.

Evidence gathered during that change's implementation:

- Driven over REST against the same container, the pipeline is healthy.
  `POST /api/session/spawn` registers the session; `POST /api/session/:id/prompt`
  with `[[faux:plain-text]] go` is answered (`tokensOut` 12) and the session
  returns to `idle`. Spawn, bridge registration, prompt delivery and the faux
  model all work.
- The failure is **client-side only**: driven through the composer in the
  browser, the optimistic prompt stays at `sending` and the composer stays
  disabled. The client never settles the send even though the identical prompt
  succeeds over REST.
- `Dashboard server failed to start: readiness timeout` appears in the notice
  log but is **cosmetic here** — a stale `notifyLog` entry from a boot-time race
  where `launchServer`'s readiness probe expires while the server is still
  coming up (`autoStartServer` then does one immediate `isDashboardRunning`
  recheck and gives up). The server does come up and the bridge does connect.

## What Changes

- Root-cause why the browser client's optimistic prompt never leaves `sending`.
  Start at the client's optimistic-prompt ack path and the browser↔server
  websocket — NOT the bridge, the faux provider, or session registration, all
  three proven healthy.
- Fix the ack/settle path so a sent prompt settles and the composer re-enables.
- Restore `tests/e2e/faux-text.spec.ts` and `tests/e2e/faux-ask.spec.ts` to
  green (the F1/F2 rows inherited from `fix-bridge-stale-ctx-crash`).
- Optionally harden the cosmetic readiness-timeout notice (widen the
  `autoStartServer` recheck window) so it stops appearing on a healthy boot.

## Impact

- Unblocks every change whose L3 rows drive a prompt through the composer,
  including `unify-folder-status-capsule` tasks 2.21–2.28.
- Affects `packages/client/` (optimistic prompt state) and possibly
  `packages/server/` (ack emission).

## Discipline Skills

`systematic-debugging` (root-cause a live bug from evidence), `review-code`.
