# Test Plan — add-blackhole-session-pipeline

Stage: design   Generated: 2026-02-10

All clarifications resolved before writing (cursor-ahead-of-history boundary → stale-cursor state, pinned into the spec).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Detection is a global installed-check | decision-table | L1 | automated | injected ctx with `isPiExtensionInstalled` resolving `true` | `GET /api/plugins/blackhole/status` | `200 { installed: true }` |
| E2 | Detection (negative not overridden) | decision-table | L1 | automated | capability resolves `false`; `pi-blackhole-config.json` exists | `GET …/status` | `200 { installed: false }` — file does not override registry |
| E3 | Detection (degraded fallback) | decision-table | L1 | automated | ctx without the capability; config file exists | `GET …/status` | `200 { installed: true }` |
| E4 | Detection (fails closed) | decision-table | L1 | automated | ctx without capability; no config file | `GET …/status` | `200 { installed: false }` |
| E5 | Validation accepts every UUID version pi emits | BVA | L1 | automated | id `019fe770-a0a4-70bb-ac85-2e92e6aa8216` (v7) | `GET …/session/:id` | `200`, file read attempted at exact `<id>-pending.json` path |
| E6 | Validation accepts every UUID version | BVA (partition sweep) | L1 | automated | syntactically valid UUIDs with version nibbles 1,4,7,8 | `GET …/session/:id` | all accepted (no version-nibble restriction) |
| E7 | Session id validated before fs access | BVA (invalid partitions) | L1 | automated | 35-char truncated id, non-hex chars, empty, uppercase-mixed garbage | `GET …/session/:id` | `4xx`; fs spy records zero calls |
| E8 | Traversal attempt rejected | security/BVA | L1 | automated | ids containing `..`, `/`, `\`, `%2e%2e` | `GET …/session/:id` | `4xx`; fs spy records zero calls |
| E9 | Resolved path confined | invariant assert | L1 | automated | validated id | path built | resolved absolute path asserted inside `<agentDir>/pi-blackhole/` before read |
| E10 | Degraded and pending states conditional | decision-table | L1 | automated | response fixtures: {healthy}, {memory:false}, {compaction:manual + pending batches}, {active cooldown} | subcard renders | healthy → single row, no advisory; workers-off → off copy + "compaction still runs", no meter; manual → advisory with batch count + flush hint; cooldown → degraded indicator + advisory naming model + remaining time |
| E11 | Cursor lag exact + stale-cursor boundary | BVA | L1 | automated | (a) cursor 412 / tip 450; (b) cursor 450 / tip 450; (c) cursor 450 / tip 412 | subcard renders | (a) "38", not marked approximate; (b) "0"; (c) distinct stale-cursor indicator, no numeric/negative/zero lag |
| E12 | Does not outrank content-view owner on tie | relational assert | L1 | automated | `packages/blackhole-plugin/package.json` manifest + flows manifest | manifest test | blackhole `priority` strictly > flows' `priority`; no claim entry carries a `priority` field |
| E13 | No shared slot definitions change | repo-lint | L1 | automated | change diff | lint test | `packages/shared/src/dashboard-plugin/slot-types.ts` + `slot-props.ts` unmodified |
| E14 | Registry union across scopes | decision-table | L1 | automated | fake `listInstalled`: package present in `local` only, matched by displayName | `isPiExtensionInstalled("pi-blackhole")` | resolves `true` (union + `installedMatchesName`, not source-only) |
| E15 | Answers are cached (success-only) | state | L1 | automated | (a) two calls within 30 s; (b) first scan throws, second succeeds | repeated capability calls | (a) exactly one scan; (b) rejection not cached — second call rescans and resolves |

### Performance

None — the specs define no latency/throughput/soak thresholds for this change (registry-scan cost is bounded by the E15 cache scenario).

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Gate is synchronous and fails closed | state-transition | L1 | automated | unresolved module state | `shouldRenderMemorySubcard()` called during render | returns `false` synchronously (no promise, no throw) |
| F2 | Bump re-evaluates gates without broadcast | state-convergence | L1 | automated | mounted gate wrapper for an idle session emitting no broadcasts; gate initially false | `bumpSlotClaimsVersion()` after resolve flips module state | wrapper re-invokes `shouldRender`; subcard mounts with zero session messages |
| F3 | Unbumped store changes nothing | invariant | L1 | automated | store never bumped | existing gate/slot test suite runs | behaviour identical — pre-change tests stay green |
| F4 | Boot check does not run under test env | guard | L1 | automated | client entry imported under vitest/jsdom, fetch spied | module import | fetch spy uncalled; `resolveInstalled({ fetchImpl })` still explicitly invokable |
| F5 | Proximity approximation constraints | invariant sweep | L1 | automated | response with `compactAfterTokens` + session `contextTokens` | meter renders | visible approximate label; reachable non-convertibility explanation; no exact token count, no percentage, no threshold marks/scale; exact lag rendered in same subcard |
| F6 | Proximity omitted when inputs unavailable | decision-table | L1 | automated | (a) `contextTokens` unknown; (b) `compactAfterTokens` unreadable | subcard renders | meter absent in both; worker indicators + lag still render |
| F7 | Worker state not colour-alone | a11y assert | L1 | automated | each worker state fixture | indicator renders | textual worker identifier present; accessible name describes state |
| F8 | Detail view not active unbidden + return path | state-transition | L1 | automated | installed, no navigation | content-view predicate evaluated | `false` by default; explicit navigation → active with return-to-chat affordance; return restores chat |
| F9 | Non-users see no new session-card chrome | e2e negative | L3 | automated | docker harness (no `pi-blackhole` installed), seeded sessions | dashboard loads | no MEMORY subcard on any session card (see tests/e2e/ exemplar; port from `.pi-test-harness.json`) |
| F10 | Detail affordance always reachable | invariant sweep | L1 | automated | every subcard state fixture from E10 | subcard renders | detail-view affordance present in all states, independent of proximity value |
| F11 | Provenance + at-rest-only detail content | content assert | L1 | automated | detail view with pending + cooldown fixtures | detail renders | cursors attributed to pending file; resolved model + reason to cooldown file; proximity to dashboard accounting with caveat; no `consolidationInFlight`/counts/last-error; transcript pointer present |
| M1 | Installed end-to-end appearance | manual smoke | — | manual-only | real env with `pi-blackhole` installed | dashboard boot | [judgment: subcard appears, including on an idle card after late resolve — needs a real installed extension] |
| M2 | Approximate vs exact visually distinguishable | visual/subjective | — | manual-only | rendered subcard | human looks | [judgment: the two readouts read as approximate vs exact] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Transient failure not a permanent false negative | fault-injection (abort→recover) | L1 | automated | injected fetch: fails ×4 (network err), then succeeds | boot resolve with fake timers | 3 capped-backoff retries, then slow-interval attempt; on success gate flips true + one `bumpSlotClaimsVersion()`; no further polling after success |
| X2 | Non-200/malformed treated transient | fault-injection | L1 | automated | injected fetch returns 404, 500, and `200` with garbage body | boot resolve | each treated transient — retry continues, gate stays `false`, value never finalized |
| X3 | Capability failure retryable, not false negative | fault-injection | L1 | automated | ctx capability rejects | `GET …/status` | `5xx` response; body is NOT `{ installed: false }` |
| X4 | Scan failure rejects rather than resolving false | fault-injection | L1 | automated | wired `listInstalled` throws | `isPiExtensionInstalled()` | promise rejects; never resolves `false` |
| X5 | Absent/torn per-session state is normal | fault-injection | L1 | automated | (a) no pending file; (b) pending file with truncated JSON | `GET …/session/:id` | `200` indicating no recorded activity; subcard renders no-activity-yet state distinct from workers-off and not-installed; no error rendered |
| X6 | Global config parse failure degrades | fault-injection | L1 | automated | malformed `pi-blackhole-config.json` | `GET …/session/:id` | `200` with null global fields, not a 500 |
| X7 | Cooldown file missing/malformed degrades | fault-injection | L1 | automated | absent or garbage `pi-blackhole-cooldown.json` | `GET …/session/:id` + subcard render | no cooldown advisory; healthy render path unaffected |
| X8 | Per-session route read-only | invariant | L1 | automated | pending file with known bytes+mtime | route enumeration + a served `GET` | only `GET` handlers registered on both routes; file bytes + mtime unchanged after request |

---

## Coverage summary

- Requirements covered: 12/12 (both spec files; every SHALL block has ≥1 row)
- Scenarios by class: edge 15 · perf 0 (none specced) · frontend 13 · error 8
- Scenarios by level: L1 33 · L2 0 · L3 1 · — 2
- Scenarios by disposition: automated 34 · manual-only 2

## New infra needed

None. L1 rows extend existing vitest suites (`packages/blackhole-plugin/src/server/__tests__/routes.test.ts`, client jsdom config, `packages/dashboard-plugin-runtime` tests). F9 extends the existing Playwright harness (`tests/e2e/`, port from `.pi-test-harness.json`).
