# Test Plan — paginate-mcp-list-sessions

Stage: design   Generated: 2025-06-12

All clarifications resolved before writing (HARD gate): default-page payload
budget pinned at **64 KB** (measured 51.4 KB at limit 25), and the 10x-growth
latency budget pinned at **< 50 ms for a single default page over 5,400 rows**.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Default call is bounded | BVA (default) | L1 | automated | store seeded with 100 visible sessions | `list_sessions` invoked with no arguments | response carries exactly 25 sessions, `total` = 100, `nextCursor` present |
| E2 | Default call is bounded | BVA (min valid) | L1 | automated | store seeded with 100 sessions | `limit: 1` | exactly 1 session returned, `nextCursor` present |
| E3 | Zero/negative limit rejected | BVA (just below min) | L1 | automated | store seeded with 100 sessions | `limit: 0` | error `-32602`; response contains no `sessions` array (NOT a 25-row default page) |
| E4 | Zero/negative limit rejected | BVA (below min) | L1 | automated | store seeded with 100 sessions | `limit: -1` | error `-32602`, no result page |
| E5 | Caller cannot exceed the hard maximum | BVA (max valid) | L1 | automated | store seeded with 300 sessions | `limit: 200` | exactly 200 sessions returned, `nextCursor` present |
| E6 | Caller cannot exceed the hard maximum | BVA (just above max) | L1 | automated | store seeded with 300 sessions | `limit: 201` | error `-32602`; no page returned and no clamped 200-row result |
| E7 | Malformed argument reported not coerced | EP (invalid class) | L1 | automated | store seeded with 100 sessions | `limit: 25.5` | error `-32602` |
| E8 | Numeric string rejected not coerced | EP (invalid class) | L1 | automated | store seeded with 100 sessions | `limit: "25"` | error `-32602`; no page returned |
| E9 | Malformed argument reported not coerced | EP (invalid class) | L1 | automated | store seeded with 100 sessions | `limit: "abc"` | error `-32602` |
| E10 | Filters narrow the result set | EP | L1 | automated | 10 `active`, 90 `ended` sessions | `status: ["active"]` | 10 sessions returned, all `active`, `total` = 10 (not 100) |
| E11 | Status filter accepts multiple values | decision-table | L1 | automated | 5 `active`, 5 `streaming`, 3 `idle`, 90 `ended` | `status: ["active","idle","streaming"]` | 13 sessions returned, none `ended`, `total` = 13 |
| E12 | Malformed argument reported not coerced | EP (enum violation) | L1 | automated | store seeded with 100 sessions | `status: ["running"]` | error `-32602`; no unfiltered page returned |
| E13 | Filters narrow the result set | EP (normalization) | L1 | automated | sessions with `cwd` `/tmp/proj` | `cwd: "/tmp/proj/"` (trailing slash) | the `/tmp/proj` sessions are returned — matched via `pathKey` normalization, not raw equality |
| E14 | Filters narrow the result set | BVA (boundary on sort key) | L1 | automated | sessions with sort keys 1000, 2000, 3000 | `since: 2000` | sessions with sort key >= 2000 returned (2 rows); the 1000 row is absent |
| E15 | Filters narrow the result set | decision-table (conjunction) | L1 | automated | mixed store across status/cwd/since | `status: ["active"]` + `cwd` + `since` together | only sessions satisfying all three returned; `total` equals that conjunction count |
| E16 | Hidden sessions excluded by default | EP | L1 | automated | 10 visible + 3 `hidden: true` sessions | `list_sessions` with no arguments | 10 sessions returned, no hidden row present, `total` = 10 (hidden not counted) |
| E17 | Unknown argument is rejected | EP (schema violation) | L1 | automated | store seeded with 100 sessions | `statuss: ["active"]` (misspelled) | error `-32602`; NOT a silently unfiltered 25-row page |
| E18 | Exhausted list distinguishable | EP (empty class) | L1 | automated | store with zero `active` sessions | `status: ["active"]` | `sessions` is `[]`, `total` = 0, `nextCursor` absent |
| E19 | Exhausted list distinguishable | BVA (exact fit) | L1 | automated | store seeded with exactly 25 visible sessions | `list_sessions` with no arguments | 25 sessions returned and `nextCursor` absent — an exactly-full page is not reported as truncated |
| E20 | Exhausted list distinguishable | state-transition | L1 | automated | store seeded with 60 sessions | walk to the final page via cursors | final response carries no `nextCursor` key |
| E21 | Cursor walks without gaps or repeats | state-transition | L1 | automated | store seeded with 103 sessions, limit 25 | page through using each returned cursor until exhausted | union of all pages equals the 103 seeded ids exactly; no id seen twice; 5 pages |
| E22 | Sessions sharing a sort timestamp walk exactly once | BVA (page boundary) | L1 | automated | 30 sessions where ids #25 and #26 share an identical sort key | walk with limit 25 so the tie straddles the page-1/page-2 boundary | both tied sessions appear, each exactly once, across the two pages |
| E23 | Cursor walks without gaps or repeats | EP (invalid class) | L1 | automated | store seeded with 100 sessions; one row has a non-finite (`NaN`) sort key | full cursor walk | the non-finite row sorts last deterministically and appears exactly once; no id is skipped or repeated |
| E24 | Malformed cursor is rejected | EP (invalid class) | L1 | automated | store seeded with 100 sessions | `cursor: "!!!not-base64!!!"` | error `-32602` |
| E25 | Cursor with different filters is rejected | decision-table | L1 | automated | cursor obtained from a `status: ["active"]` page | same cursor replayed with `status: ["ended"]` | error `-32602`; no page from the different result set |
| E26 | Cursor with different filters is rejected | decision-table | L1 | automated | cursor obtained from a `limit: 25` page | same cursor replayed with `limit: 50` | error `-32602` |
| E27 | Validation of other tools is unchanged | regression | L1 | automated | existing allowlist tools (`send_prompt`, `spawn_session`, `abort`) | invoked with argument sets that were valid before this change | each call is accepted and dispatched exactly as before; no `-32602` |
| E28 | The advertised schema documents the bound | EP | L1 | automated | the `MCP_TOOLS` table | `tools/list` / `listTools()` output read for `list_sessions` | the advertised `inputSchema` + description state default 25, maximum 200, and the `cursor` argument |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Default call is bounded | threshold (payload size) | L1 | automated | store seeded with 538 realistic rows (incl. `notifyLog` + `sessionFile` fields at production weight) | serialized default-page envelope < **64 KB** | single call |
| P2 | Default call is bounded | threshold (10x growth) | L1 | automated | store seeded with 5,400 rows | single default page returns in < **50 ms** | single call |

### Frontend-quirk

None — `list_sessions` is an MCP tool surface with no rendered UI. No L3
Playwright scenario is warranted, and none is invented to pad coverage.

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Session created mid-walk | state-transition (concurrent insert) | L1 | automated | a new session registered into the store between page 1 and page 2 | resume the walk with page 1's cursor | every session present for the whole walk appears exactly once; no unrelated row duplicated or skipped |
| X2 | Session ended mid-walk | state-transition (status change) | L1 | automated | a walked session transitions to `ended` between pages (row retained, sort key changes) | resume the walk with page 1's cursor | no unrelated session is duplicated or skipped across the remaining pages |
| X3 | Session removed mid-walk | fault-injection (`sessionManager.remove`) | L1 | automated | the archive sweeper removes a not-yet-walked session between pages | resume the walk with page 1's cursor | the walk continues from the cursor position; no unrelated session is duplicated or skipped |
| X4 | Session removed mid-walk | fault-injection (cursor target removed) | L1 | automated | the exact session whose key the cursor encodes is removed between pages | resume the walk with that cursor | the walk resumes at the next key strictly past the cursor; no unrelated row is duplicated or skipped |
| X5 | Default call is bounded | measurement (live store) | — | manual-only | the live dashboard store | operator calls `list_sessions` before and after the change | [judgment: operator records the before/after payload bytes in the PR — needs a live populated store, not reproducible in CI] |

---

## Coverage summary

- Requirements covered: 17/17 spec scenarios mapped
- Scenarios by class: edge 28 · perf 2 · frontend 0 · error 5
- Scenarios by level: L1 34 · L2 0 · L3 0 · manual-only 1
- Scenarios by disposition: automated 34 · manual-only 1

## New infra needed

None. All automated scenarios are vitest unit tests colocated under
`packages/mcp-server-plugin/src/server/__tests__/`, exercising the real
`MemorySessionManager` plus the `dispatch.ts` validation path. No Playwright
spec, no `qa/` smoke test, and no new harness is required — the change has no
rendered-UI surface and no install/multi-OS dimension.
