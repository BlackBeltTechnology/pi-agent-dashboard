## 1. Widen the tool schema type

- [ ] 1.1 Widen `McpToolDef.inputSchema.properties` in `tools.ts` beyond `{ type: string; description: string }` to carry `enum`, `minimum`, `maximum` and array item types; verify every existing entry in `MCP_TOOLS` still typechecks unchanged
- [ ] 1.2 Author test: existing allowlist tools still validate and dispatch as before (regression guard on the widening) — see `packages/mcp-server-plugin/src/server/__tests__/dispatch.test.ts` — input: existing tools `send_prompt`, `spawn_session`, `abort` · trigger: invoked with argument sets valid before this change · observable: each accepted and dispatched as before, no `-32602` (test-plan #E27)

## 2. Strict argument validation in dispatch.ts

- [ ] 2.1 Extend the `dispatch.ts` argument check to validate optional args from `inputSchema` (type, enum, range, array items) and to reject unknown argument names, enforcing the already-declared `additionalProperties: false`; each failure returns `-32602` without executing the handler
- [ ] 2.2 Author test: a zero limit is rejected, not defaulted — see `dispatch.test.ts` — input: store seeded with 100 sessions · trigger: `limit: 0` · observable: error `-32602`, response carries no `sessions` array and no 25-row default page (test-plan #E3)
- [ ] 2.3 Author test: a negative limit is rejected — see `dispatch.test.ts` — input: store seeded with 100 sessions · trigger: `limit: -1` · observable: error `-32602`, no result page (test-plan #E4)
- [ ] 2.4 Author test: a limit above the hard maximum is rejected, not clamped — see `dispatch.test.ts` — input: store seeded with 300 sessions · trigger: `limit: 201` · observable: error `-32602`, no page returned and no clamped 200-row result (test-plan #E6)
- [ ] 2.5 Author test: a non-integer limit is rejected — see `dispatch.test.ts` — input: store seeded with 100 sessions · trigger: `limit: 25.5` · observable: error `-32602` (test-plan #E7)
- [ ] 2.6 Author test: a numeric string limit is rejected, not coerced — see `dispatch.test.ts` — input: store seeded with 100 sessions · trigger: `limit: "25"` · observable: error `-32602`, no page returned (test-plan #E8)
- [ ] 2.7 Author test: a non-numeric limit is rejected — see `dispatch.test.ts` — input: store seeded with 100 sessions · trigger: `limit: "abc"` · observable: error `-32602` (test-plan #E9)
- [ ] 2.8 Author test: an unknown status enum value is rejected — see `dispatch.test.ts` — input: store seeded with 100 sessions · trigger: `status: ["running"]` · observable: error `-32602`, no unfiltered page returned (test-plan #E12)
- [ ] 2.9 Author test: an unknown argument name is rejected, not ignored — see `dispatch.test.ts` — input: store seeded with 100 sessions · trigger: `statuss: ["active"]` (misspelled) · observable: error `-32602`, NOT a silently unfiltered 25-row page (test-plan #E17)
- [ ] 2.10 Author test: a malformed cursor is rejected — see `dispatch.test.ts` — input: store seeded with 100 sessions · trigger: `cursor: "!!!not-base64!!!"` · observable: error `-32602` (test-plan #E24)
- [ ] 2.11 Author test: a cursor replayed with different filters is rejected — see `dispatch.test.ts` — input: cursor obtained from a `status: ["active"]` page · trigger: same cursor replayed with `status: ["ended"]` · observable: error `-32602`, no page from the different result set (test-plan #E25)
- [ ] 2.12 Author test: a cursor replayed with a different limit is rejected — see `dispatch.test.ts` — input: cursor obtained from a `limit: 25` page · trigger: same cursor replayed with `limit: 50` · observable: error `-32602` (test-plan #E26)

## 3. Bounded, filtered listing

- [ ] 3.1 Implement the `{ sessions, nextCursor, total }` envelope in the `list_sessions` handler with default limit 25 and hard maximum 200; `total` is the post-filter count and `nextCursor` is absent (not null) on the final page
- [ ] 3.2 Implement the `status` (array, any-match), `cwd` (normalized via `pathKey`) and `since` (epoch ms, compared against the sort key) filters, and exclude `hidden` sessions by default
- [ ] 3.3 Author test: the default call is bounded — see `packages/mcp-server-plugin/src/server/__tests__/server-index.test.ts` — input: store seeded with 100 visible sessions · trigger: `list_sessions` with no arguments · observable: exactly 25 sessions, `total` = 100, `nextCursor` present (test-plan #E1)
- [ ] 3.4 Author test: minimum valid limit — see `server-index.test.ts` — input: store seeded with 100 sessions · trigger: `limit: 1` · observable: exactly 1 session returned, `nextCursor` present (test-plan #E2)
- [ ] 3.5 Author test: maximum valid limit — see `server-index.test.ts` — input: store seeded with 300 sessions · trigger: `limit: 200` · observable: exactly 200 sessions returned, `nextCursor` present (test-plan #E5)
- [ ] 3.6 Author test: a status filter narrows results and `total` — see `server-index.test.ts` — input: 10 `active` + 90 `ended` sessions · trigger: `status: ["active"]` · observable: 10 sessions, all `active`, `total` = 10 not 100 (test-plan #E10)
- [ ] 3.7 Author test: the status filter accepts multiple values — see `server-index.test.ts` — input: 5 `active`, 5 `streaming`, 3 `idle`, 90 `ended` · trigger: `status: ["active","idle","streaming"]` · observable: 13 sessions returned, none `ended`, `total` = 13 (test-plan #E11)
- [ ] 3.8 Author test: cwd matches via path normalization — see `server-index.test.ts` — input: sessions with `cwd` `/tmp/proj` · trigger: `cwd: "/tmp/proj/"` with trailing slash · observable: those sessions returned, matched via `pathKey` not raw string equality (test-plan #E13)
- [ ] 3.9 Author test: `since` boundary against the sort key — see `server-index.test.ts` — input: sessions with sort keys 1000, 2000, 3000 · trigger: `since: 2000` · observable: the two rows with sort key >= 2000 returned, the 1000 row absent (test-plan #E14)
- [ ] 3.10 Author test: combined filters conjoin — see `server-index.test.ts` — input: mixed store across status/cwd/since · trigger: all three filters supplied together · observable: only sessions satisfying all three returned, `total` equals that conjunction count (test-plan #E15)
- [ ] 3.11 Author test: hidden sessions excluded and uncounted — see `server-index.test.ts` — input: 10 visible + 3 `hidden: true` sessions · trigger: no-argument call · observable: 10 sessions returned, no hidden row, `total` = 10 (test-plan #E16)
- [ ] 3.12 Author test: an empty filtered result is a clean exhausted list — see `server-index.test.ts` — input: store with zero `active` sessions · trigger: `status: ["active"]` · observable: `sessions` is `[]`, `total` = 0, `nextCursor` absent (test-plan #E18)
- [ ] 3.13 Author test: an exactly-full page is not reported as truncated — see `server-index.test.ts` — input: store seeded with exactly 25 visible sessions · trigger: no-argument call · observable: 25 sessions returned and `nextCursor` absent (test-plan #E19)

## 4. Keyset cursor and walk stability

- [ ] 4.1 Implement the keyset cursor over the repo recency convention (`endedAt ?? lastActivityAt ?? startedAt`, descending) with `id` as tiebreak; encode the key pair plus a digest of the filter arguments and limit, base64-wrapped; sort rows with a non-finite key deterministically last
- [ ] 4.2 Author test: the final page carries no continuation cursor — see `server-index.test.ts` — input: store seeded with 60 sessions · trigger: walk to the final page via cursors · observable: final response carries no `nextCursor` key (test-plan #E20)
- [ ] 4.3 Author test: a full walk yields every session exactly once — see `server-index.test.ts` — input: store seeded with 103 sessions, limit 25 · trigger: page through using each returned cursor until exhausted · observable: union of pages equals the 103 seeded ids exactly, no id twice, 5 pages (test-plan #E21)
- [ ] 4.4 Author test: sessions sharing a sort timestamp across a page boundary each appear once — see `server-index.test.ts` — input: 30 sessions where ids #25 and #26 share an identical sort key · trigger: walk with limit 25 so the tie straddles the page-1/page-2 boundary · observable: both tied sessions appear, each exactly once (test-plan #E22)
- [ ] 4.5 Author test: a non-finite sort key does not corrupt the walk — see `server-index.test.ts` — input: 100 sessions, one with a `NaN` sort key · trigger: full cursor walk · observable: the non-finite row sorts last deterministically and appears exactly once, no id skipped or repeated (test-plan #E23)
- [ ] 4.6 Author test: a session created mid-walk does not corrupt the walk — see `packages/server/src/__tests__/memory-session-manager.test.ts` for store-seeding glue — input: a new session registered between page 1 and page 2 · trigger: resume the walk with page 1's cursor · observable: every session present for the whole walk appears exactly once, no unrelated row duplicated or skipped (test-plan #X1)
- [ ] 4.7 Author test: a session ending mid-walk does not corrupt the walk — see `memory-session-manager.test.ts` — input: a walked session transitions to `ended` between pages, changing its sort key · trigger: resume the walk with page 1's cursor · observable: no unrelated session duplicated or skipped across remaining pages (test-plan #X2)
- [ ] 4.8 Author test: a session removed mid-walk does not corrupt the walk — see `memory-session-manager.test.ts` — input: the archive sweeper removes a not-yet-walked session between pages · trigger: resume the walk with page 1's cursor · observable: the walk continues from the cursor position, no unrelated session duplicated or skipped (test-plan #X3)
- [ ] 4.9 Author test: removing the exact row the cursor names still resumes correctly — see `memory-session-manager.test.ts` — input: the session whose key the cursor encodes is removed between pages · trigger: resume the walk with that cursor · observable: the walk resumes at the next key strictly past the cursor, no unrelated row duplicated or skipped (test-plan #X4)

## 5. Contract surface

- [ ] 5.1 Update the `list_sessions` `inputSchema` and description in `tools.ts` to advertise the default (25), the hard maximum (200), the `cursor` argument and the BREAKING bounded default
- [ ] 5.2 Author test: the advertised schema documents the bound — see `packages/mcp-server-plugin/src/server/__tests__/tools.test.ts` — input: the `MCP_TOOLS` table · trigger: `tools/list` / `listTools()` output read for `list_sessions` · observable: advertised `inputSchema` + description state default 25, maximum 200, and the `cursor` argument (test-plan #E28)

## 6. Performance budgets

- [ ] 6.1 Author test: the default page stays within its payload budget — see `packages/mcp-server-plugin/src/server/__tests__/performance.test.ts` and follow its anti-vacuous rule (assert the work actually happened, not just the budget) — workload: store seeded with 538 realistic rows including `notifyLog` and `sessionFile` at production weight · metric: serialized default-page envelope < 64 KB · window: single call (test-plan #P1)
- [ ] 6.2 Author test: a default page over a 10x store stays within its latency budget — see `performance.test.ts` and inherit its headroom doctrine (threshold set so a regression trips it but scheduling noise does not) — workload: store seeded with 5,400 rows · metric: single default page returns in < 50 ms · window: single call (test-plan #P2)
- [ ] 6.3 Measure the default response against the live store and record the before/after payload bytes in the PR (test-plan: manual-only) (test-plan #X5)

## 7. Closeout

- [ ] 7.1 Update `packages/mcp-server-plugin/src/server/AGENTS.md` rows for `tools.ts`, `dispatch.ts`, `index.ts`; verify `kb dox lint` is clean
- [ ] 7.2 Update `docs/architecture.md` §MCP tool surface with the bounded contract (delegate prose to DocScribe, caveman style)
- [ ] 7.3 Run `npm test` and `npm run quality:changed`; verify both green before shipping
