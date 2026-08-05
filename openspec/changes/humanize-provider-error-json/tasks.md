# Tasks

## 1. Humanizer helper + wiring

- [x] 1.1 Add exported pure `humanizeProviderError(raw: string): string` in `event-reducer.ts` (parse JSON envelope → `type: message` / `message`; pass through non-JSON / malformed / no-message).
- [x] 1.2 Route `extractAgentEndError` return through it.
- [x] 1.3 Route the `auto_retry_waiting` and `auto_retry_start` `reason` assignments through it.

## 2. Tests

- [x] 2.1 Unit tests: JSON envelope → `overloaded_error: Overloaded`; plain string unchanged; malformed JSON unchanged; envelope without `error.message` unchanged.
- [x] 2.2 `npm test` green (SessionBanner + event-reducer suites).

## 3. Build & verify

- [x] 3.1 `npm run build` (client) succeeds.
- [x] 3.2 `review-code` pass on the diff.
