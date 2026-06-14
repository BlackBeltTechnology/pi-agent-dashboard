# spawn-correlation

## Purpose

Strong correlation of every dashboard-initiated spawn to the eventual `session_register` from the bridge, using a server-minted UUIDv4 `spawnToken` injected via the `PI_DASHBOARD_SPAWN_TOKEN` environment variable, plus a client-minted UUIDv4 `requestId` for browser→server result echo and `session_added` broadcast correlation. Eliminates cwd-FIFO ambiguity when multiple spawns share a cwd.
## Requirements
### Requirement: Server mints a `spawnToken` for every spawn invocation
The server SHALL mint a UUIDv4 (`crypto.randomUUID()`) `spawnToken` for every call to `spawnPiSession()`, regardless of strategy (`tmux`, `wt`, `wsl-tmux`, `headless`) and regardless of trigger (`spawn_session`, `resume_session`, auto-resume-on-prompt, headless reload, jj workspace operations). The token SHALL be passed to `spawnPiSession` (or generated inside it) and SHALL be used to populate every registry entry related to that spawn invocation.

#### Scenario: Token minted on browser-initiated spawn
- **WHEN** `handleSpawnSession` invokes `spawnPiSession(cwd, opts)`
- **THEN** a unique `spawnToken` SHALL be generated using `crypto.randomUUID()`
- **AND** the token SHALL be attached to the `headlessPidRegistry` entry created for the spawned PID (when applicable)
- **AND** the token SHALL be stored in the spawn-register-watchdog entry armed for this spawn

#### Scenario: Token minted on resume/fork
- **WHEN** `handleResumeSession` invokes `spawnPiSession(cwd, { sessionFile, mode })`
- **THEN** a unique `spawnToken` SHALL be generated for the new pi process
- **AND** for `mode: "fork"`, the token SHALL be used as the key in `pendingForkRegistry.recordFork(token, parentSessionId)`

#### Scenario: Token minted on auto-resume-on-prompt
- **WHEN** `handleSendPrompt` detects `status: "ended"` and triggers an auto-resume spawn
- **THEN** a unique `spawnToken` SHALL be generated and used to populate registries
- **AND** the absence of a client-issued `requestId` SHALL NOT prevent token minting

#### Scenario: Token minted on headless reload
- **WHEN** `handleHeadlessReload` kills and respawns a headless session
- **THEN** a unique `spawnToken` SHALL be generated for the respawned process and attached to the new `headlessPidRegistry` entry

### Requirement: `PI_DASHBOARD_SPAWN_TOKEN` env-var injection
The `spawnPiSession` function SHALL inject the minted `spawnToken` into the spawned process's environment as `PI_DASHBOARD_SPAWN_TOKEN`. The injection SHALL happen via the existing `buildSpawnEnv` flow so it applies to every spawn mechanism. The token SHALL NOT be passed via argv or via the session JSONL file.

#### Scenario: Token present in spawned process env
- **WHEN** `spawnPiSession(cwd, opts)` runs and produces a spawned process
- **THEN** `process.env.PI_DASHBOARD_SPAWN_TOKEN` in the spawned process SHALL equal the `spawnToken` minted for that invocation

#### Scenario: Existing env vars preserved
- **WHEN** the dashboard server has its own environment containing `PI_DASHBOARD_URL`, `PATH`, etc.
- **THEN** the spawned process SHALL receive those vars unchanged in addition to `PI_DASHBOARD_SPAWN_TOKEN`

#### Scenario: Token is not echoed to argv
- **WHEN** the server inspects the spawned process command line
- **THEN** the `spawnToken` SHALL NOT appear as a CLI argument

### Requirement: Bridge reads `PI_DASHBOARD_SPAWN_TOKEN` and includes it on first register only
The bridge extension SHALL read `process.env.PI_DASHBOARD_SPAWN_TOKEN` at registration time. The bridge SHALL include `spawnToken` in `session_register` IFF `bc.hasRegisteredOnce === false` (the very first register for this bridge process). For all subsequent registers — including reattach (after dashboard restart), `handleSessionChange` (in-process new/fork/resume), and any other path — the `spawnToken` field SHALL be omitted.

After reading the token on the first register, the bridge SHALL scrub it by deleting `process.env.PI_DASHBOARD_SPAWN_TOKEN` from its own process environment, so that any pi process the bridge's pi later spawns (subagent, nested `pi`, reload) does NOT inherit the single-use token. The token SHALL NOT be re-reported by any descendant process.

#### Scenario: First register includes the token then scrubs it
- **WHEN** a bridge process boots and `sendStateSync` runs for the first time
- **AND** `process.env.PI_DASHBOARD_SPAWN_TOKEN` is set to a non-empty string
- **THEN** the emitted `session_register` SHALL include `spawnToken` equal to the env-var value
- **AND** `bc.hasRegisteredOnce` SHALL be `true` after the call
- **AND** `process.env.PI_DASHBOARD_SPAWN_TOKEN` SHALL be unset (deleted) after the call

#### Scenario: Descendant pi does not inherit the token
- **WHEN** a dashboard-spawned pi (whose bridge has completed its first register) spawns a child pi process (subagent, nested `pi`, or reload)
- **THEN** the child's `process.env.PI_DASHBOARD_SPAWN_TOKEN` SHALL be absent
- **AND** the child's `session_register` SHALL NOT include a `spawnToken` field

#### Scenario: Reattach register omits the token
- **WHEN** the bridge reconnects after dashboard restart and `sendStateSync` runs again
- **THEN** the emitted `session_register` SHALL have `registerReason: "reattach"` and SHALL NOT include `spawnToken`

#### Scenario: In-process session change omits the token
- **WHEN** the user triggers Ctrl+F (fork), `/resume`, or `/new` inside the bridge's pi process and `handleSessionChange` runs
- **THEN** the emitted `session_register` for the new sessionId SHALL NOT include `spawnToken`

#### Scenario: Missing env-var produces no token field
- **WHEN** the bridge boots inside a pi process whose env does not contain `PI_DASHBOARD_SPAWN_TOKEN` (e.g. user-launched pi outside the dashboard, or a scrubbed descendant)
- **THEN** the emitted `session_register` SHALL NOT include a `spawnToken` field
- **AND** the protocol message SHALL still validate

### Requirement: Three-tier link in `headlessPidRegistry`
The `headlessPidRegistry` SHALL expose three link methods used by `event-wiring.ts` upon receipt of `session_register`. The methods SHALL be tried in priority order: `linkByToken` → `linkByPid` → `linkSession` (existing cwd-FIFO). The first method that finds a match SHALL set `entry.sessionId` and return; subsequent tiers SHALL NOT be tried for the same register.

The registry's `register(pid, cwd, proc, token?)` signature SHALL accept an optional `spawnToken` and SHALL store it on the entry alongside `pid`, `cwd`, `sessionId?`, and `spawnedAt`.

#### Scenario: Token match wins over pid and cwd
- **WHEN** `event-wiring` receives `session_register { sessionId: "S", cwd: "/p", pid: 1234, spawnToken: "tok_abc" }`
- **AND** `headlessPidRegistry` contains an entry `{ pid: 1234, cwd: "/p", sessionId: undefined, spawnToken: "tok_abc" }`
- **THEN** `linkByToken("tok_abc", "S", 1234)` SHALL set that entry's `sessionId = "S"` and return
- **AND** `linkByPid` and `linkSession` SHALL NOT be invoked for this register

#### Scenario: Pid match used when token is absent
- **WHEN** `event-wiring` receives `session_register { sessionId: "S", cwd: "/p", pid: 1234 }` with no `spawnToken` (legacy bridge)
- **AND** `headlessPidRegistry` contains an entry with `pid: 1234, sessionId: undefined`
- **THEN** `linkByPid("S", 1234)` SHALL set that entry's `sessionId = "S"` and return
- **AND** `linkSession` SHALL NOT be invoked for this register

#### Scenario: Cwd-FIFO fallback used when token and pid both absent
- **WHEN** `event-wiring` receives `session_register { sessionId: "S", cwd: "/p" }` with no `spawnToken` and no `pid` (e.g. tmux strategy with legacy server)
- **THEN** the existing cwd-FIFO `linkSession("S", "/p")` SHALL be invoked
- **AND** the first unsessioned entry in cwd `/p` SHALL be tagged

#### Scenario: Stale token degrades to lower tier
- **WHEN** a bridge sends `session_register` with a `spawnToken` that the server does not have any entry for (e.g. server was restarted mid-spawn)
- **THEN** `linkByToken` SHALL return `false` without modifying any entry
- **AND** the next tier (`linkByPid` or `linkSession`) SHALL be tried

#### Scenario: Already-linked entry is skipped at every tier
- **WHEN** any link tier inspects an entry whose `sessionId` is already set
- **THEN** that entry SHALL NOT be relinked at any tier

### Requirement: Client mints `requestId` on every browser-initiated spawn or resume
The client SHALL generate a UUIDv4 (`crypto.randomUUID()`) `requestId` whenever it dispatches a `spawn_session` or `resume_session` message. The `requestId` SHALL be sent as part of the message and tracked in a client-side `pendingSpawns: Map<requestId, { cwd, startedAt, attachProposal? }>` map (replacing today's `spawningCwds: Set<cwd>`).

#### Scenario: Spawn dispatch generates and tracks requestId
- **WHEN** the user clicks "New session" in a folder group
- **THEN** the client SHALL generate a fresh `requestId`
- **AND** the client SHALL add `(requestId, { cwd, startedAt: now() })` to `pendingSpawns`
- **AND** the dispatched `spawn_session` message SHALL contain the `requestId`

#### Scenario: Resume dispatch generates and tracks requestId
- **WHEN** the user clicks Resume or Fork on a session card
- **THEN** the client SHALL generate a fresh `requestId`
- **AND** the dispatched `resume_session` message SHALL contain the `requestId`

#### Scenario: Concurrent spawns produce distinct requestIds
- **WHEN** the user (or programmatic flow) issues two `spawn_session` calls in the same cwd within milliseconds
- **THEN** each call SHALL generate a distinct `requestId`
- **AND** `pendingSpawns` SHALL contain two entries simultaneously

### Requirement: Server echoes `requestId` and broadcasts `spawnRequestId`
When the server receives a `spawn_session` or `resume_session` carrying `requestId`, it SHALL:

1. Echo the `requestId` field in the corresponding `spawn_result` or `resume_result` message.
2. Associate the `requestId` with the minted `spawnToken` in an internal map (`pendingClientCorrelations: Map<spawnToken, requestId>`) so a later `session_register` carrying the token can be broadcast as `session_added` with the matching `spawnRequestId`.

The `session_added` browser message SHALL include `spawnRequestId?: string` populated from this map when known.

#### Scenario: spawn_result echoes requestId
- **WHEN** the server processes `spawn_session { cwd, requestId: "rq_42" }` and emits `spawn_result`
- **THEN** the emitted `spawn_result` SHALL include `requestId: "rq_42"`

#### Scenario: resume_result echoes requestId
- **WHEN** the server processes `resume_session { sessionId, mode, requestId: "rq_99" }` and emits `resume_result`
- **THEN** the emitted `resume_result` SHALL include `requestId: "rq_99"`

#### Scenario: session_added carries spawnRequestId
- **WHEN** a bridge later registers with `spawnToken` matching the token minted for `requestId: "rq_42"`
- **AND** the new session is broadcast via `session_added`
- **THEN** the broadcast SHALL include `spawnRequestId: "rq_42"`

#### Scenario: server-initiated spawn omits spawnRequestId
- **WHEN** auto-resume-on-prompt or any other server-only flow spawns a session (no client requestId exists)
- **THEN** the resulting `session_added` broadcast SHALL omit `spawnRequestId`

### Requirement: Client auto-selects newly registered session by requestId match
The client `useMessageHandler.ts` SHALL, on receipt of `session_added`, look up `msg.spawnRequestId` in its `pendingSpawns` map. If found, the client SHALL: (a) remove the entry from `pendingSpawns`, (b) navigate to `/session/<msg.session.id>`, (c) cancel the spawn-timeout timer for that requestId. If `spawnRequestId` is absent or unknown, the client SHALL NOT auto-navigate (existing behavior preserved for natural session arrivals).

#### Scenario: Auto-select after spawn
- **WHEN** the user spawned a session with `requestId: "rq_42"`
- **AND** `session_added { session, spawnRequestId: "rq_42" }` arrives
- **THEN** the client SHALL navigate to that session's URL
- **AND** the matching placeholder card SHALL be removed

#### Scenario: Auto-select after fork
- **WHEN** the user forked a session with `requestId: "rq_77"`
- **AND** `session_added { session, spawnRequestId: "rq_77" }` arrives for the forked session
- **THEN** the client SHALL navigate to the new (forked) session's URL
- **AND** the parent session's resuming flag SHALL be cleared

#### Scenario: No auto-select for natural sessions
- **WHEN** `session_added { session }` arrives without `spawnRequestId` (e.g. a TUI-spawned session)
- **THEN** the client SHALL NOT change the active route

#### Scenario: Unknown spawnRequestId tolerated
- **WHEN** `session_added { session, spawnRequestId: "rq_unknown" }` arrives but `pendingSpawns` has no matching entry (e.g. timeout already cleared)
- **THEN** the client SHALL NOT throw and SHALL NOT navigate

### Requirement: Token TTL aligned with `spawn-register-watchdog`
The effective TTL of a `spawnToken` SHALL equal the spawn-register-watchdog timeout (default 30s, configurable via `config.spawnRegisterTimeoutMs` in the range 5000–120000). When the watchdog timer fires for a spawn, the corresponding registry entries (headlessPidRegistry, pendingForkRegistry, pendingAttachRegistry, pendingClientCorrelations) keyed by that spawnToken SHALL be cleared as part of timeout cleanup. No separate token-TTL machinery SHALL be introduced.

#### Scenario: Token cleared on watchdog timeout
- **WHEN** a spawn's watchdog fires after 30s with no `session_register` arriving
- **THEN** the `pendingClientCorrelations` entry for that spawnToken SHALL be deleted
- **AND** any unsessioned `headlessPidRegistry` entry holding that token SHALL be cleaned up by existing process-exit hooks

#### Scenario: Token persists across late-recovery window
- **WHEN** a bridge registers with a `spawnToken` after the watchdog already fired but within the 60s `recentlyFired` recovery window
- **THEN** the watchdog SHALL emit `spawn_register_recovered`
- **AND** the `pendingClientCorrelations` entry MAY still be queryable for the recovery emission (best-effort; recovery does not require token identity to be intact)

### Requirement: No persistence of tokens or correlation state
Tokens, requestIds, and the `pendingClientCorrelations` map SHALL be in-memory only. Server restart SHALL drop all in-flight correlation state. Bridges holding a stale token in their env after a server restart SHALL fall through to lower-tier matching (pid → cwd-FIFO).

#### Scenario: Server restart drops correlations
- **WHEN** the server restarts mid-spawn (after `spawnPiSession` returned but before bridge registered)
- **THEN** the in-memory token map SHALL be empty after restart
- **AND** when the bridge eventually registers with the now-stale token, `linkByToken` SHALL fail and `linkByPid` SHALL be tried next

#### Scenario: No token written to disk
- **WHEN** any registry persists state to disk (e.g. `~/.pi/dashboard/headless-pids.json`)
- **THEN** the persisted shape SHALL NOT contain a `spawnToken` field

### Requirement: Source-tag stamp gated by strong signal; legacy fallback logged and non-persistent

When `event-wiring.ts` receives `session_register`, the server SHALL
delegate the `source: "dashboard"` stamp decision to
`decideDashboardSource`. The function SHALL accept four inputs:
`dashboardSpawned` (strong signal), `pendingCount` (legacy cwd-FIFO
counter snapshot), `isNewSession`, and `strictCorrelation` (server env
flag).

The function SHALL return `{ shouldStamp, consumeLegacyCounter,
persistMeta }`:

- **Strong-signal branch:** when `dashboardSpawned === true`,
  `shouldStamp = true`, `consumeLegacyCounter = false`,
  `persistMeta = true`. The server SHALL update `sessionManager`,
  broadcast `session_updated`, AND persist `{ source: "dashboard" }`
  to the session's `.meta.json` sidecar via `mergeSessionMeta`.

- **Legacy fallback branch:** when `dashboardSpawned !== true` AND
  `pendingCount > 0` AND `isNewSession === true` AND
  `strictCorrelation === false`, `shouldStamp = true`,
  `consumeLegacyCounter = true`, `persistMeta = false`. The server
  SHALL update `sessionManager`, broadcast `session_updated`, decrement
  the cwd counter, AND log a single-line warning identifying
  `sessionId` and `cwd`. The server SHALL NOT write the sidecar.

- **Strict-mode suppression:** when `dashboardSpawned !== true` AND
  `strictCorrelation === true`, the legacy branch SHALL be suppressed
  regardless of `pendingCount`. Return value SHALL be
  `{ shouldStamp: false, consumeLegacyCounter: false,
  persistMeta: false }`. The server SHALL NOT update state, broadcast,
  consume the counter, or write the sidecar.

- **No-match branch:** otherwise return all-`false`.

The server SHALL read `strictCorrelation` once at module init from
`process.env.STRICT_SPAWN_CORRELATION === "1"`.

#### Scenario: Strong signal stamps and persists
- **WHEN** `session_register { sessionId: "S", cwd: "/p", dashboardSpawned: true }` arrives
- **THEN** `sessionManager.update(S, { source: "dashboard" })` SHALL be called
- **AND** `broadcastSessionUpdated(S, { source: "dashboard" })` SHALL be called
- **AND** `mergeSessionMeta(sessionFile, { source: "dashboard" })` SHALL be called
- **AND** the legacy cwd counter SHALL NOT be decremented
- **AND** no fallback log line SHALL be emitted

#### Scenario: Strong signal on reattach re-stamps without persisting twice
- **WHEN** the same session reattaches with `dashboardSpawned: true` and current `source === "dashboard"`
- **THEN** `sessionManager.update` SHALL NOT be invoked (idempotent guard already in code)
- **AND** `broadcastSessionUpdated` SHALL NOT be invoked
- **AND** `mergeSessionMeta` MAY still be invoked (best-effort, idempotent for identical content)

#### Scenario: Legacy fallback stamps in memory but not on disk
- **WHEN** `session_register { sessionId: "S", cwd: "/p" }` arrives without `dashboardSpawned`
- **AND** `pendingDashboardSpawns.get("/p") === 1`
- **AND** `isNewSession === true`
- **AND** `STRICT_SPAWN_CORRELATION !== "1"`
- **THEN** `sessionManager.update(S, { source: "dashboard" })` SHALL be called
- **AND** `broadcastSessionUpdated(S, { source: "dashboard" })` SHALL be called
- **AND** the counter for `/p` SHALL be decremented (entry removed when reaching 0)
- **AND** `mergeSessionMeta` SHALL NOT be called
- **AND** exactly one log line matching `[event-wiring] cwd-FIFO source-stamp fallback sessionId=S cwd=/p` SHALL be emitted

#### Scenario: Strict mode suppresses legacy fallback entirely
- **WHEN** the same legacy register arrives but `STRICT_SPAWN_CORRELATION === "1"`
- **THEN** `sessionManager.update` SHALL NOT be called
- **AND** `broadcastSessionUpdated` SHALL NOT be called
- **AND** the counter for `/p` SHALL NOT be decremented
- **AND** `mergeSessionMeta` SHALL NOT be called
- **AND** no fallback log line SHALL be emitted

#### Scenario: No pending entry → no stamp
- **WHEN** any `session_register` arrives, `dashboardSpawned !== true`, and `pendingCount === 0`
- **THEN** the server SHALL NOT stamp `source: "dashboard"` regardless of `strictCorrelation`

### Requirement: One-shot cleanup utility for legacy mis-stamped `.meta.json` files

The repository SHALL ship a standalone Node script
`scripts/repair-meta-source.mjs` that scans every `*.meta.json` under
`~/.pi/agent/sessions/`. For each file with `source: "dashboard"`, the
script SHALL remove the `source` field and write the file back
atomically.

Rationale: there is no reliable JSONL signal that distinguishes
TUI-origin from dashboard-origin sessions after the fact. Live
dashboard-spawned sessions re-stamp themselves on the next bridge
reattach via `PI_DASHBOARD_SPAWN_TOKEN` (the strong signal landed in
`5a31daa6`). Dead/archived sessions lose the tag permanently —
acceptable, because they cannot be reattached or interacted with and
the icon mapping for historical sessions is a cosmetic concern only.

The script SHALL be idempotent (a second run after a successful first
run MUST report `cleaned 0`), SHALL print a summary
`kept N / cleaned M / errors E`, and SHALL exit with code 0 on
success.

#### Scenario: Removes dashboard tag unconditionally
- **WHEN** a `.meta.json` has `source: "dashboard"`
- **THEN** the script SHALL remove the `source` field from that `.meta.json`
- **AND** all other fields SHALL be preserved (modulo JSON re-serialization)
- **AND** the file SHALL be written via atomic tmp+rename

#### Scenario: Leaves non-dashboard sources intact
- **WHEN** a `.meta.json` has `source: "tui"`, `source: "tmux"`, `source: "cli"`, or no `source` field at all
- **THEN** the script SHALL leave the file unchanged

#### Scenario: Idempotent re-run
- **WHEN** the script has already cleaned a session's `.meta.json`
- **AND** the script is run again
- **THEN** that file SHALL be classified as `kept`
- **AND** the file content SHALL NOT change

#### Scenario: Tolerates malformed files
- **WHEN** a `.meta.json` or `.jsonl` fails to parse
- **THEN** the script SHALL increment the `errors` counter
- **AND** SHALL continue processing remaining files
- **AND** SHALL NOT exit with a non-zero code solely because of parse failures

### Requirement: `dashboardSpawned` derived from a capture-once boolean, not live token presence
The bridge SHALL determine `dashboardSpawned` by capturing `!!process.env.PI_DASHBOARD_SPAWN_TOKEN` ONCE, at process startup / first register, BEFORE the token is scrubbed. The bridge SHALL reuse that captured boolean for `dashboardSpawned` on every subsequent register. The bridge SHALL NOT re-read the env var for `dashboardSpawned` after scrubbing, because the token is single-use and intentionally removed.

This decouples the persistent "was I dashboard-spawned?" signal from the single-use token's lifetime, so scrubbing the token (to stop descendant/respawn leakage) does not regress `source: "dashboard"` labelling for the spawned process.

The capture-once boolean is derived from the SINGLE-USE token ONLY, never from `PI_DASHBOARD_SPAWNED`. `PI_DASHBOARD_SPAWNED=1` is inherited un-scrubbed by descendants (subagents, nested `pi`), so deriving `dashboardSpawned` from it would wrongly mark those children `true`. A keeper respawn therefore captures `dashboardSpawned: false` exactly like a descendant (the token is scrubbed in both cases); the respawned session nonetheless retains `source: "dashboard"` because the source was already stamped and persisted to `.meta.json` on the first launch, and `decideDashboardSource` only ever UPGRADES to `"dashboard"` — it never downgrades an existing dashboard session on a later register that lacks the signal.

#### Scenario: dashboardSpawned stays true across registers after scrub
- **WHEN** a dashboard-spawned pi's bridge completes its first register (token read + scrubbed)
- **AND** the bridge later emits a second `session_register` (reattach or in-process change)
- **THEN** the second register SHALL carry `dashboardSpawned: true` (from the captured boolean)
- **AND** SHALL NOT carry a `spawnToken`

#### Scenario: Descendant child captures dashboardSpawned false
- **WHEN** a child pi is spawned by a dashboard-spawned pi after the token was scrubbed
- **THEN** the child captures `dashboardSpawned: false` at its own startup
- **AND** the server SHALL NOT stamp `source: "dashboard"` on the child from this signal

#### Scenario: Keeper respawn keeps dashboard source without re-emitting token
- **WHEN** the rpc-keeper respawns pi after a crash/restart
- **AND** the keeper has deleted `PI_DASHBOARD_SPAWN_TOKEN` from the respawn env but kept `PI_DASHBOARD_SPAWNED=1`
- **THEN** the respawned pi's `session_register` SHALL NOT include `spawnToken`
- **AND** the respawned pi MAY report `dashboardSpawned: false` (token-only capture, scrubbed)
- **AND** the session SHALL retain `source: "dashboard"` from the first-launch stamp persisted to `.meta.json`, because `decideDashboardSource` never downgrades an already-`"dashboard"` session

### Requirement: Keeper injects the spawn token into the first pi launch only
`keeper.cjs spawnPi()` SHALL include `PI_DASHBOARD_SPAWN_TOKEN` in the spawned pi's environment only for the FIRST pi launch of the keeper. For every subsequent respawn within the same keeper, `spawnPi()` SHALL delete `PI_DASHBOARD_SPAWN_TOKEN` from the child environment so the consumed single-use token is never re-reported. The keeper SHALL continue to strip `PI_KEEPER_PI_ARGS` and `PI_KEEPER_PI_CMD`, and SHALL continue to set `PI_DASHBOARD_SPAWNED=1` on every (re)spawn.

#### Scenario: First launch carries the token
- **WHEN** the keeper launches pi for the first time
- **THEN** the child env SHALL contain `PI_DASHBOARD_SPAWN_TOKEN` equal to the server-minted token
- **AND** SHALL contain `PI_DASHBOARD_SPAWNED=1`

#### Scenario: Respawn omits the token
- **WHEN** pi exits and the keeper respawns it
- **THEN** the respawn child env SHALL NOT contain `PI_DASHBOARD_SPAWN_TOKEN`
- **AND** SHALL still contain `PI_DASHBOARD_SPAWNED=1`

