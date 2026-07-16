# Test Plan — add-dashboard-bus-client-scripting

Standalone scenario catalog (not tasks.md). Each row: id · class · technique ·
level · disposition · Triple (input · trigger · observable). Levels per repo
routing: L1 = `packages/*/src/**/__tests__/*.test.ts` (vitest), L2 =
`qa/tests/*.sh|*.ps1` (CLI/process smoke), L3 = `tests/e2e/*.spec.ts` (Playwright
vs docker harness, port from `.pi-test-harness.json`, never hardcode `:18000`).

No hard-gate gaps: every scenario Triple fills from spec/design or discoverable
source. No `manual-only` rows (the client is a headless library — all observables
are automatable).

## Requirement: connect obtains a ticket and subscribes

| id | class | technique | level | disposition | input · trigger · observable |
|---|---|---|---|---|---|
| C1 | edge-case | state-transition | L1 | automated | valid minted ticket · `connect()` opens WS with it · client reaches `subscribed`, receives a `sessions_snapshot` frame |
| C2 | error-handling | fault-injection (delay past TTL) | L1 | automated | ticket minted, then 15 001 ms elapse (TTL=15 000) · `connect()` presents the expired ticket · server rejects the upgrade, client raises a distinct `ticket-expired` error (not a generic socket close) |
| C3 | error-handling | state-transition (illegal edge) | L1 | automated | already-consumed single-use ticket · second `connect()` reuse · rejected, `ticket-consumed` error |
| C4 | edge-case | fault-injection (auth boundary) | L2 | automated | request from a non-loopback / untrusted origin · `POST /api/ws-ticket` via `connect()` · `networkGuard` denies mint (no bearer), client surfaces explicit "off-box needs pairing" error, does NOT hang |

## Requirement: typed command send + generated verb helpers

| id | class | technique | level | disposition | input · trigger · observable |
|---|---|---|---|---|---|
| S1 | edge-case | type-level (tsc) | L1 | automated | a `send()` call with a bogus `type` or missing required field · `tsc --noEmit` over the test fixture · compile error emitted (type-negative test) |
| S2 | edge-case | contract/completeness | L1 | automated | the generated verb set · enumerate every generated helper · each resolves to a server receiver (browser-gateway switch case or plugin `registerBrowserHandler`); test FAILS if any generated verb has no handler |
| S3 | edge-case | denylist assertion | L1 | automated | `plugin_config_write` (client-intercepted-to-REST union member) · run codegen · verb is EXCLUDED from the generated helpers (no WS helper emitted for it) |

## Requirement: correlated awaits

| id | class | technique | level | disposition | input · trigger · observable |
|---|---|---|---|---|---|
| A1 | edge-case | exact correlation | L1 | automated | `spawn({cwd})` mints `requestId=X` · server echoes `session_added.spawnRequestId=X` (plus a decoy `session_added` with a different id) · `spawn` resolves with the X-matched session id only, ignores the decoy |
| A2 | frontend-quirk | state-convergence | L1 | automated | two concurrent sessions s1,s2 each mid-turn · `until(s1,"idle")` while s2 also transitions · resolves exactly when s1→idle, does NOT resolve on s2's transition (session-id keyed) |
| A3 | edge-case | BVA (timeout boundary) | L1 | automated | `until(sid,"idle",{timeout:100})` and the transition never arrives · 100 ms elapse · rejects with a timeout error naming the awaited (sid,status) |
| A4 | error-handling | negative correlation | L1 | automated | `request_models` (no `requestId` in protocol) · caller attempts an exact await · client does NOT expose an exact requestId round-trip; resolves by structural `models_list` match or documents REST-twin fallback |

## Requirement: plugin-action passthrough (goal today)

| id | class | technique | level | disposition | input · trigger · observable |
|---|---|---|---|---|---|
| P1 | edge-case | integration (real handler) | L3 | automated | `plugin("goal", <goal action>, payload)` against the docker harness with goal-plugin loaded · message sent · goal plugin's `plugin_action` handler receives it (observable via goal state change / server log), no silent drop |
| P2 | error-handling | decision (unknown id) | L1 | automated | `plugin("flows", …)` while flows has no working handler · send · client surfaces explicit "no handler for pluginId: flows" error rather than a silent drop |

## Requirement: reads are bus-consistent

| id | class | technique | level | disposition | input · trigger · observable |
|---|---|---|---|---|---|
| R1 | frontend-quirk | state-convergence | L1 | automated | subscribed client, a session transitions active→idle on the stream · `read.sessions()` called after the delta · returned row shows `idle`, no separate REST fetch issued |
| R2 | edge-case | scope assertion | L1 | automated | a session with chat history · `read.session(id)` · returns registry metadata + status only; result has NO `messages`/`lastResponse` field (chat-read is out of scope, not silently faked) |

## New infra needed

- None beyond existing tiers. L1 uses a mock WS server fixture; L3 P1 reuses the
  docker harness (`docker/test-up.sh` derived port). L2 C4 extends an existing
  `qa/tests/*.sh` auth/loopback smoke if present, else a new small one.
