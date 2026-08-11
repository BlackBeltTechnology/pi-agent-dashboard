## 1. Evidence-derivation helper

- [ ] 1.1 Add a single helper that derives a best-known end time for a session from evidence: recorded last activity, else transcript last-write time, else `startedAt`
- [ ] 1.2 Reuse the existing transcript-mtime read the scanner already performs (`readJsonlMtime`) rather than adding a second stat path
- [ ] 1.3 Confirm the helper never returns the current time

## 2. Enforce the invariant inside the session map (D1)

- [ ] 2.1 Guarantee in `memory-session-manager` that a session entering the map with `status: "ended"` and no `endedAt` receives one
- [ ] 2.2 Cover `restore()` specifically — it is a bare `sessions.set` today and bypasses `update()`/`unregister()`
- [ ] 2.3 Preserve any explicitly supplied `endedAt` unchanged
- [ ] 2.4 Keep `unregister()`'s observed-ending timestamp as `Date.now()` — do NOT route a live session's ending through evidence derivation
- [ ] 2.5 Ensure the `restore()` enforcement does not emit `onChange` (a boot-time `moveToFront` + `sessions_reordered` storm over ~3,300 records would churn stored order)
- [ ] 2.6 Order the enforcement so the status/`endedAt` conditional short-circuits before any filesystem stat, since the same path runs on `update()` per activity event

## 3. Correct the disk-derived writers (D2)

- [ ] 3.1 `session-bootstrap.ts` — supply an evidence-derived `endedAt` when restoring historical sessions; it sets no `lastActivityAt`, so it must stat its own `sessionFile` rather than relying on a `lastActivityAt` fallback
- [ ] 3.2 `session-scanner.ts` `sessionFromMeta` — the dominant reproduction path; ensure a rebuilt session carries an `endedAt` even when the persisted meta lacks one
- [ ] 3.3 `session-scanner.ts:261` — ensure the built `SessionMeta` carries `endedAt`, preserving one already present in prior meta
- [ ] 3.4 `session-action-handler.ts:227` — ensure the zombie normalisation records an evidence-derived timestamp, including on the early-return path at `:229-231`
- [ ] 3.5 Directory add/pin path (`directory-handler.ts:55-65`) — historical sessions are `register()`ed then `unregister()`ed, taking `Date.now()`; give them the evidence-derived value (`session-discovery.ts:126` already carries `modifiedAt`)
- [ ] 3.6 Confirm both disk paths produce the same derived value for the same session

## 4. Unify the boot normalisation (D3)

- [ ] 4.1 Replace `restored.endedAt ?? Date.now()` in `server.ts:357-358` with the evidence-derived value
- [ ] 4.2 Confirm this path and the bootstrap path now agree on the rule

## 5. Scope confirmations (do not change these)

- [ ] 5.1 Leave `terminal-manager.ts:300`/`:418` unchanged — `TerminalSession` is a distinct type with no `endedAt`; record the confirmation in `design.md`
- [ ] 5.2 Confirm no liveness site is altered: liveness remains `status`-based on both server and client

## 6. Tests — L1 unit (vitest)

Harness exemplar for every row in this section: `packages/server/src/__tests__/reconcile-session-order.test.ts` (pure in-process unit style, no server boot); for manager-construction glue see `packages/server/src/browser-handlers/__tests__/session-meta-handler.test.ts`.

- [ ] 6.1 Ending without a supplied timestamp stamps one — session in map `status:"active"` with `endedAt` undefined · `update(id,{status:"ended"})` with no `endedAt` · record has a numeric `endedAt` (test-plan #E1)
- [ ] 6.2 An explicitly supplied timestamp is preserved — caller-supplied `endedAt = 1_700_000_000_000` · `update(id,{status:"ended",endedAt})` · stored value is exactly that (test-plan #E2)
- [ ] 6.3 Re-ending does not move the timestamp — session already `ended` with `endedAt = T` · `update(id,{status:"ended"})` again with no timestamp · `endedAt` is still `T` (test-plan #E3)
- [ ] 6.4 `restore()` is covered by the invariant — object `{status:"ended"}` with no `endedAt` · `restore(session)`, the bare `sessions.set` path · stored record has a numeric `endedAt` (test-plan #E4)
- [ ] 6.5 Evidence precedence when both sources exist — reconstructed session with `lastActivityAt = A` and transcript mtime `M`, `A ≠ M` · restore with no `endedAt` · `endedAt === A` (test-plan #E5)
- [ ] 6.6 Evidence precedence when activity is absent — no `lastActivityAt`, transcript mtime `M` · restore with no `endedAt` · `endedAt === M` (test-plan #E6)
- [ ] 6.7 Evidence precedence with no evidence at all — no `lastActivityAt`, transcript unreadable · restore with no `endedAt` · `endedAt === startedAt` (test-plan #E7)
- [ ] 6.8 A witnessed ending records the witnessed time — running session with `lastActivityAt = T − 60s` · server directly witnesses the end at `T` · `endedAt === T`, not `T − 60s` (test-plan #E8)
- [ ] 6.9 A bad record is not live — record `status:"ended"` with `endedAt` undefined · `listActive()` · record absent from the result (test-plan #E9)
- [ ] 6.10 A live session legitimately has no timestamp — running session with no `endedAt` · `listActive()` · record present, absence not treated as a defect (test-plan #E10)
- [ ] 6.11 Seeding orders by end time, not start time — two ended ids absent from stored order, `S1` started 10:00 ended 12:00 and `S2` started 11:00 ended 11:30 · `reconcileSessionOrder` seeds them · `S1` precedes `S2` (test-plan #E11)
- [ ] 6.12 No filesystem work when the timestamp is already present — session already carrying `status:"ended"` and an `endedAt` · enters the map via `restore()` · no stat is performed for that record (test-plan #E12)
- [ ] 6.13 A timeout-inferred ending uses evidence, not detection time — bridge dies silently, last activity `T − 5min` · server concludes the session ended when the grace period expires at `T` · `endedAt === T − 5min` (test-plan #X1)
- [ ] 6.14 Unreadable evidence degrades safely — transcript missing/unreadable at derivation · session reconstructed at boot · falls back to `startedAt`, no exception escapes, remaining sessions still restore (test-plan #X2)
- [ ] 6.15 Abandoned zombie normalisation carries a truthful timestamp — zombie `status:"active"` with no `sessionFile` · prompt normalises to `"ended"` then hits the early return at `session-action-handler.ts:229-231` · `endedAt` is evidence-derived, not the normalisation time (test-plan #X3)
- [ ] 6.16 Directory add does not stamp detection time — historical sessions with known `modifiedAt` · directory added/pinned, driving `register()` then `unregister()` · each `endedAt` equals its evidence value, not the add time (test-plan #X4)

## 7. Tests — L3 browser e2e (Playwright, docker harness)

Harness exemplar for both rows: `tests/e2e/session-reap.spec.ts` (drives the harness and restarts the server); read the harness port from `.pi-test-harness.json` via `tests/e2e/lifecycle.ts` — never hardcode `:18000`.

- [ ] 7.1 Bootstrap-restored card shows the right age — historical TUI session restored by `session-bootstrap`, transcript last written 30 days ago, no `lastActivityAt` · dashboard renders its card in the ended tier · the time badge reads ~30 days, not the age of `startedAt` and not "just now" (test-plan #F1)
- [ ] 7.2 Boot restore does not churn stored order — a directory whose ended tier already has a stored order, browser connected · server restart replays the boot restore loop · ended-tier order identical before and after, and zero `sessions_reordered` frames received during the restore loop (test-plan #F2)

## 8. Manual verification

- [ ] 8.1 On the live instance after the change, confirm the count of `status:"ended"` records without `endedAt` is zero where it was 34
- [ ] 8.2 Confirm the live session count is unchanged (it is `status`-derived and must not move)

## 9. Follow-up

- [ ] 9.1 Resolve whether transcript mtime or an explicit last-entry timestamp is the better evidence source (open question in `design.md`)
- [ ] 9.2 `extractTimestamp` returns `Date.now()` for an unparseable session filename, so the `startedAt` fallback can itself be reconstruction time — decide whether to close that hole
- [ ] 9.3 Note for a future change: the `live`/`liveEpoch` marker is the mechanism that could strand a session as genuinely live — out of scope here, unexamined
