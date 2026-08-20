# spawn-correlation

## Purpose

Strong correlation of every dashboard-initiated spawn to the eventual `session_register` from the bridge, using a server-minted UUIDv4 `spawnToken` injected via the `PI_DASHBOARD_SPAWN_TOKEN` environment variable, plus a client-minted UUIDv4 `requestId` for browser→server result echo and `session_added` broadcast correlation. Eliminates cwd-FIFO ambiguity when multiple spawns share a cwd.
## Requirements
### Requirement: Server mints a `spawnToken` for every spawn invocation
The server SHALL mint a UUIDv4 (`crypto.randomUUID()`) `spawnToken` for every call to `spawnPiSession()`, regardless of strategy (`tmux`, `wt`, `wsl-tmux`, `headless`) and regardless of trigger (`spawn_session`, `resume_session`, auto-resume-on-prompt, headless reload). The token SHALL be passed to `spawnPiSession` (or generated inside it) and SHALL be used to populate every registry entry related to that spawn invocation.

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

The `session_added` browser message SHALL include `spawnRequestId?: string` populated from this map when known. This SHALL hold for any register arriving while the correlation is alive — before the watchdog fires, or after it inside the recovery window. A fired watchdog SHALL NOT by itself be a reason to omit the field.

The correlation SHALL be consumed exactly once, on the existing `session_register` handling path that performs the broadcast. No other component SHALL consume it; in particular the watchdog's clear path SHALL NOT, since a second consumer would starve the broadcast of the value it must carry.

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

#### Scenario: Register after the fire still auto-selects
- **WHEN** the watchdog has already fired for the spawn minted for `requestId: "rq_42"` and the fire-time reclaim did not terminate the process
- **AND** the bridge registers with the matching `spawnToken` inside the recovery window
- **THEN** the `session_added` broadcast SHALL include `spawnRequestId: "rq_42"`
- **AND** the client SHALL clear the spawning placeholder and navigate to the new session

#### Scenario: Correlation is consumed once
- **WHEN** a late register triggers both a watchdog recovery emission and the `session_register` broadcast path
- **THEN** the correlation SHALL be consumed by the broadcast path only
- **AND** `session_added` SHALL carry the `spawnRequestId`

#### Scenario: server-initiated spawn omits spawnRequestId
- **WHEN** auto-resume-on-prompt or any other server-only flow spawns a session (no client requestId exists)
- **THEN** the resulting `session_added` broadcast SHALL omit `spawnRequestId`

### Requirement: Client auto-selects newly registered session by requestId match
The client `useMessageHandler.ts` SHALL, on receipt of `session_added`, look up `msg.spawnRequestId` in its `pendingSpawns` map. If found, the client SHALL: (a) remove the entry from `pendingSpawns`, (b) navigate to `/session/<msg.session.id>`, (c) cancel the spawn-timeout timer for that requestId. If `spawnRequestId` is absent or unknown, the client SHALL NOT auto-navigate (existing behavior preserved for natural session arrivals).

When `msg.session.hidden === true`, the client SHALL NOT auto-navigate AND SHALL NOT consume any correlation state for that message — it SHALL NOT remove a `pendingSpawns` entry, SHALL NOT clear `spawningCwds`, and SHALL NOT cancel any spawn-timeout timer. A hidden session SHALL still be added to the session map and rendered in the Hidden tier; only the correlation+navigation cascade is suppressed. This prevents a headless worker (subagent, `memory` tool, nested `pi -p`) that shares its parent session's `cwd` from stealing focus or consuming the correlation token minted for the real visible spawn.

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

#### Scenario: Hidden session never auto-navigates
- **WHEN** `session_added { session, hidden: true }` arrives (e.g. an auto-hidden headless worker)
- **THEN** the client SHALL NOT navigate, regardless of whether `spawnRequestId` or the session `cwd` would otherwise match a `pendingSpawns` entry
- **AND** the session SHALL still be added to the session map and rendered in the Hidden tier

#### Scenario: Hidden session does not consume a real spawn's correlation
- **WHEN** a visible session was spawned with `requestId: "rq_99"` (placeholder live in `pendingSpawns`)
- **AND** a headless worker in the SAME `cwd` registers and arrives first as `session_added { session, hidden: true }` with no matching `spawnRequestId`
- **THEN** the `rq_99` `pendingSpawns` entry SHALL remain intact, its timer SHALL NOT be cancelled, and `spawningCwds` SHALL NOT be cleared
- **AND** when the real visible `session_added { session, spawnRequestId: "rq_99" }` later arrives it SHALL still auto-select and clear its placeholder

### Requirement: Token TTL aligned with `spawn-register-watchdog`
The effective TTL of a `spawnToken` SHALL be **derived** from the spawn-register
timeout — not from a literal, and not from a value captured once at server
construction.

For any one spawn, the timeout value used to arm that spawn's watchdog and the
timeout value used to derive the TTL of every correlation recorded for it SHALL
come from the **same configuration read**. Re-reading configuration between the
arm and the record SHALL NOT satisfy this requirement, because an operator
changing the setting in between would desynchronize the two.

The derived TTL SHALL equal that timeout plus the shared recovery grace window
plus an ordering margin sufficient that the correlation outlives the watchdog's
recovery window regardless of whether `record` runs before or after `arm` — both
orderings occur on existing paths.

This SHALL hold on **every** correlation-recording path — the spawn path, the
resume/fork path, and the degrade path — not only the spawn path.

When the watchdog timer fires, the `pendingClientCorrelations` entry SHALL NOT
be deleted as part of fire handling; it SHALL be evicted only by its own derived
TTL.

#### Scenario: Token outlives the timeout at the default
- **WHEN** `spawnRegisterTimeoutMs` is the default `30000`
- **THEN** the TTL recorded for a correlation SHALL exceed `30000` plus the recovery grace window
- **AND** the token SHALL still resolve at any instant before the watchdog fires

#### Scenario: Raising the timeout does not disable correlation
- **WHEN** `spawnRegisterTimeoutMs` is configured to `90000`
- **AND** a bridge registers at `t+70s` — after the old 60 s literal but BEFORE the watchdog fires
- **THEN** the correlation SHALL still resolve to the originating `requestId`
- **AND** the resulting `session_added` SHALL carry that `spawnRequestId`

#### Scenario: A live raise is honoured without a restart
- **WHEN** the server started with `spawnRegisterTimeoutMs: 30000`
- **AND** an operator raises it to `120000` without restarting
- **AND** a spawn is then issued whose bridge registers at `t+100s`
- **THEN** the correlation SHALL still resolve, its TTL having been derived from `120000`

#### Scenario: A live lowering does not desynchronize arm and TTL
- **WHEN** a spawn is in flight, armed from a configuration read of `120000`
- **AND** the operator lowers `spawnRegisterTimeoutMs` to `30000` before the correlation is recorded
- **THEN** the correlation TTL SHALL be derived from the same `120000` that armed the watchdog
- **AND** the correlation SHALL still outlive that spawn's fire

#### Scenario: Resume, fork and degrade paths derive their TTL too
- **WHEN** a correlation is recorded on the resume/fork path or the degrade path at `spawnRegisterTimeoutMs: 90000`
- **AND** the bridge registers at `t+70s`
- **THEN** the correlation SHALL still resolve
- **AND** the resulting `session_added` SHALL carry `spawnRequestId`

#### Scenario: Ordering margin covers arm-before-record
- **WHEN** a spawn is recorded on a path where `arm` runs before `record`
- **AND** a register arrives in the final milliseconds of the watchdog's recovery window
- **THEN** the correlation SHALL still be resolvable
- **AND** a `spawn_register_recovered` SHALL NOT be emitted without the accompanying `session_added` carrying `spawnRequestId`

#### Scenario: Token survives the watchdog fire
- **WHEN** a spawn's watchdog fires with no `session_register` arriving
- **THEN** the `pendingClientCorrelations` entry SHALL NOT be deleted by the fire
- **AND** it SHALL be deleted when its derived TTL elapses

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

### Requirement: The fork registry derives its expiry from the same timeout
`pendingForkRegistry` SHALL derive its per-entry expiry from the spawn-register
timeout in force for that spawn, by the same rule as
`pendingClientCorrelations`. The hardcoded `30000` it replaced was shorter than
the default timeout itself, so a fork whose bridge registered late lost its
parent placement even at the default configuration.

This requirement SHALL NOT be generalized to every `pending*` registry. A TTL
that exists to *bound* the damage of a failed spawn is a different mechanism
from one that must survive until the bridge registers, and lengthening the
former is a regression. Specifically, `pendingAttachRegistry` (whose TTL stops a
failed spawn stranding an intent that would later attach to an unrelated
session) and `pendingResumeIntentRegistry` (whose TTL stops a failed spawn
poisoning a later legitimate reattach, and which is consumed on the ended→alive
transition rather than on register) SHALL retain their current bounds.

#### Scenario: Fork correlation survives a late register at the default timeout
- **WHEN** `spawnRegisterTimeoutMs` is the default `30000`
- **AND** a forked session's bridge registers at `t+29s`
- **THEN** the fork registry entry SHALL still be consumable
- **AND** the forked session SHALL be placed after its parent

#### Scenario: Fork correlation survives a raised timeout
- **WHEN** `spawnRegisterTimeoutMs` is `90000` and a forked session's bridge registers at `t+70s`
- **THEN** the fork registry entry SHALL still be consumable

#### Scenario: Attach registry keeps its anti-strand bound
- **WHEN** `spawnRegisterTimeoutMs` is raised to `120000`
- **THEN** the pending-attach expiry SHALL be unchanged
- **AND** a failed spawn's attach intent SHALL NOT remain eligible any longer than it does today

#### Scenario: Resume-intent registry keeps its anti-poison bound
- **WHEN** `spawnRegisterTimeoutMs` is raised to `120000`
- **THEN** the pending-resume-intent expiry SHALL be unchanged
- **AND** a failed spawn's intent SHALL NOT be able to mis-tag a later bridge reattach for longer than it can today

### Requirement: `hidden` is not decided from the bridge's self-reported source
The auto-hide heuristic in `memory-session-manager.register` SHALL NOT read the
bridge's self-reported `params.source`, which is evaluated before the server's
dashboard-source decision has been made and can therefore never be
`"dashboard"` at that point. It SHALL instead read the strong dashboard-spawn
signal the bridge carries on `session_register`.

That signal is not currently forwarded into `register`; forwarding it is part of
this requirement. Changing the heuristic without it would evaluate an absent
value and hide every dashboard-spawned headless session.

The signal is untrusted input and SHALL be normalized to a strict boolean on the
way in, exactly as `hasUI` and `visibilityIntent` already are, so a malformed
payload cannot skew visibility. Because the bridge omits the field rather than
sending `false`, an absent field SHALL be treated as "not dashboard-spawned".

The existing precedence SHALL be preserved exactly: a reattach with a prior
record keeps the prior `hidden`; an explicit `visibilityIntent` wins over the
heuristic; only when neither applies does the headless heuristic decide. The
value SHALL be computed once and SHALL NOT be recomputed or overwritten later.

#### Scenario: The dashboard-spawn signal reaches the register call
- **WHEN** a `session_register` carrying the dashboard-spawn signal is handled
- **THEN** that signal SHALL be passed into `memory-session-manager.register`
- **AND** the heuristic SHALL evaluate it rather than the self-reported source

#### Scenario: Dashboard spawn reporting hasUI=false is not hidden
- **WHEN** a bridge registers with `hasUI: false`, self-reported `source: "tui"`, and the dashboard-spawn signal set
- **AND** no `visibilityIntent` is supplied and this is a first register
- **THEN** the session SHALL be stored with `hidden: false`
- **AND** it SHALL appear in the sidebar through `filterSessions`

#### Scenario: Genuine headless worker is still hidden
- **WHEN** a bridge registers with `hasUI: false` and no dashboard-spawn signal
- **AND** no `visibilityIntent` is supplied and this is a first register
- **THEN** the session SHALL be stored with `hidden: true`

#### Scenario: Explicit visibilityIntent still wins
- **WHEN** a bridge registers with `hasUI: false`, no dashboard-spawn signal, and `visibilityIntent: "visible"`
- **THEN** the session SHALL be stored with `hidden: false`
- **AND** a register with `visibilityIntent: "hidden"` SHALL be stored with `hidden: true` regardless of the other inputs

#### Scenario: Reattach preserves a manual hide
- **WHEN** a session already recorded as `hidden: true` re-registers with `registerReason: "reattach"`
- **AND** the register reports `hasUI` as `undefined`
- **THEN** the stored `hidden` SHALL remain `true`
- **AND** the heuristic SHALL NOT have been consulted

#### Scenario: hasUI true is never hidden by the heuristic
- **WHEN** a bridge registers with `hasUI: true` on a first register with no `visibilityIntent`
- **THEN** the session SHALL be stored with `hidden: false`

