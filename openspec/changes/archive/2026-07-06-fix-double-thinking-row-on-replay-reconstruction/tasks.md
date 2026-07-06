# Tasks

## 1. Reproduce (red)

- [x] 1.1 Run `HOME=$(mktemp -d) npx vitest run src/lib/__tests__/event-reducer-streaming-text-flush.test.ts src/lib/__tests__/event-reducer-interactive-ui-order.test.ts` in `packages/client` → confirm 3 failures (duplicate thinking row).
- [x] 1.2 Add a focused regression test in `event-reducer.test.ts`: stream `thinking_delta`/`thinking_end`, then feed `message_end` (default `isLive` false) carrying the same `{type:"thinking"}` block → assert exactly one `role:"thinking"` row. Confirm it fails first.

## 2. Fix reducer (green)

- [x] 2.1 In `event-reducer.ts` `message_end` reconstruction block, replace/augment the `!isLive` guard: skip reconstruction when a `role:"thinking"` row for the current assistant turn already exists (dedupe against streamed rows).
- [x] 2.2 Keep real cold-replay behavior: no `thinking_*` events → no prior row → reconstruction still fires.

## 3. Verify

- [x] 3.1 Re-run the two previously-failing test files → all pass.
- [x] 3.2 Run full `npm test` for `packages/client` → green.
- [x] 3.3 Run repo `npm test` (or rely on CI) → `CI / npm test` green on the branch.
- [x] 3.4 `npm run quality:changed` clean on the diff.
