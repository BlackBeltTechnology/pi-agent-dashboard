## ADDED Requirements

### Requirement: Connect snapshot openspec frames are delivered as state

The per-cwd `openspec_update` frames the server emits on browser connect SHALL be delivered under the `state` class defined in `ws-frame-delivery-policy`: they SHALL be sent before `sessions_snapshot` and SHALL never be shed under back-pressure. The scope of the connect snapshot is unchanged — one frame per known cwd (pinned directories and cwds of non-ended sessions).

#### Scenario: Every known cwd reaches the browser regardless of registry size
- **GIVEN** a server holding N known cwds and a session registry whose snapshot alone exceeds the back-pressure threshold
- **WHEN** a browser connects
- **THEN** the browser SHALL receive exactly one `openspec_update` for each of the N cwds

### Requirement: Browser can fetch cached OpenSpec state for a cwd on demand

The server SHALL accept `openspec_get { requestId, cwd }` from a browser and reply to that browser only with `openspec_get_result { requestId, cwd, data, final }`. On a cache hit, one reply with the cached payload and `final: true` SHALL be sent. On a cache miss, the server SHALL first reply immediately with a placeholder payload (`initialized: false`, `changes: []`, `hasOpenspecDir`, and a `readiness` value derived from the same fold used by polling) and `final: false`; then, only if all of the following hold — OpenSpec is globally enabled, the cwd is not opted out, the cwd is present in the session registry (any status) or pinned, and `<cwd>/openspec/` exists — it SHALL run one mtime-gated poll for that cwd, serialized by the existing spawn concurrency cap, and reply with the outcome and `final: true`. If any gate fails, the placeholder reply SHALL itself carry `final: true` and its readiness SHALL name the gate (`GLOBAL_OFF`, `OPTED_OUT`, or `ABSENT`) and no process SHALL be spawned. `openspec_get` SHALL NOT bypass the mtime gate, SHALL NOT add the cwd to the periodic poll set, and SHALL NOT broadcast the poll's final outcome to other browsers unless it differs from the previously cached payload. The existing transitional `pending: true` broadcast that any poll of a discovered directory emits is unchanged.

#### Scenario: Cache hit
- **GIVEN** the server holds cached OpenSpec data for `/repo/a`
- **WHEN** a browser sends `openspec_get { requestId: "r1", cwd: "/repo/a" }`
- **THEN** that browser SHALL receive `openspec_get_result { requestId: "r1", cwd: "/repo/a", final: true }` with the cached data
- **AND** no OpenSpec CLI process SHALL be spawned
- **AND** no other browser SHALL receive a frame for this request

#### Scenario: Cold cache for a tracked cwd with an openspec directory
- **GIVEN** `/repo/b` has ended sessions in the registry, is not pinned, has `openspec/`, and has no cached data
- **WHEN** a browser sends `openspec_get` for `/repo/b`
- **THEN** the browser SHALL receive a placeholder reply with `final: false` and `readiness.state` of `PENDING`
- **AND** subsequently a reply with `final: true` carrying the poll outcome
- **AND** at most one poll SHALL be run for this request

#### Scenario: Cold cache without an openspec directory
- **GIVEN** `/repo/c` is tracked but has no `openspec/` directory
- **WHEN** a browser sends `openspec_get` for `/repo/c`
- **THEN** the browser SHALL receive a single reply with `final: true`, `hasOpenspecDir: false`, and `readiness.state` of `ABSENT`
- **AND** no process SHALL be spawned

#### Scenario: Untracked cwd is refused without spawning
- **GIVEN** `/tmp/anywhere` is neither pinned nor present in the session registry
- **WHEN** a browser sends `openspec_get` for it
- **THEN** the reply SHALL be a single `final: true` placeholder with `readiness.state` of `ABSENT`
- **AND** no process SHALL be spawned

#### Scenario: Globally disabled or opted out
- **WHEN** a browser sends `openspec_get` while `openspec.enabled` is `false`, or for a cwd listed in `openspec.optOutDirectories`
- **THEN** the reply SHALL be a single `final: true` placeholder whose `readiness.state` is `GLOBAL_OFF` or `OPTED_OUT` respectively
- **AND** no process SHALL be spawned

#### Scenario: Poll outcome that changes cached data is broadcast
- **GIVEN** a cold-cache `openspec_get` whose poll yields data
- **WHEN** the poll completes
- **THEN** other connected browsers SHALL receive an `openspec_update` for that cwd
- **AND** if a second `openspec_get` for the same cwd completes with identical data, other browsers SHALL NOT receive another `openspec_update`

#### Scenario: Never a force poll
- **WHEN** `openspec_get` triggers a poll for a cwd whose tracked artifacts are unchanged since the last successful poll
- **THEN** the mtime gate SHALL apply exactly as for a periodic poll
