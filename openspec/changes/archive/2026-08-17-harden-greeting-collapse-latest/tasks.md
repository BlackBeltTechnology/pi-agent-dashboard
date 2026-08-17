# Tasks

## 1. Reproduce (TDD)

- [x] 1.1 Add a failing reducer unit test: a newer `ib-greeting` (higher ts)
  arrives first, then a stale one (lower ts) arrives late; assert the shown
  greeting stays the newest.
- [x] 1.2 Add a test proving a newer greeting still replaces an older shown one.
- [x] 1.3 Add a test proving an equal-ts greeting replaces in place (idempotent
  re-replay tolerant).

## 2. Fix

- [x] 2.1 Add a monotonicity guard to the `message_end` `ib-greeting` collapse:
  skip the replace when the incoming event timestamp is older than the shown
  greeting's timestamp.
- [x] 2.2 Persist the greeting row's timestamp and advance it on every accepted
  replacement.

## 3. Verify

- [x] 3.1 Scoped tests green: `event-reducer.custom-display-message.test.ts` +
  `state-replay-custom-message.test.ts`.
- [x] 3.2 `npm run build` succeeds.
