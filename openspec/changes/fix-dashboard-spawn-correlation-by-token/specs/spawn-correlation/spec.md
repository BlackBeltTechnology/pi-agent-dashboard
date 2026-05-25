## ADDED Requirements

### Requirement: Source-tag stamp gated by strong identity match
When `event-wiring.ts` receives `session_register`, the server SHALL stamp `source: "dashboard"` on the session (in-memory state, broadcast, and `.meta.json` sidecar) IFF a pending dashboard spawn is matched via the three-tier identity chain `spawnToken → pid → cwd-FIFO`. Cwd-only matches SHALL be treated as a legacy fallback, SHALL be logged with a single-line warning identifying `sessionId`, `cwd`, and the absence of token/pid, and SHALL be gated by the `STRICT_SPAWN_CORRELATION` server flag.

When `STRICT_SPAWN_CORRELATION` is `false` (default during migration window), a cwd-FIFO match SHALL still stamp `dashboard` for backward compatibility with bridges that emit neither `spawnToken` nor `pid`. When `STRICT_SPAWN_CORRELATION` is `true`, a cwd-FIFO-only match SHALL NOT stamp; the server SHALL leave the bridge's own `detectSessionSource` verdict intact.

#### Scenario: Token match stamps dashboard
- **WHEN** `event-wiring` receives `session_register { sessionId: "S", cwd: "/p", spawnToken: "tok_abc" }`
- **AND** `PendingDashboardSpawns` contains an entry `{ token: "tok_abc", cwd: "/p" }`
- **THEN** the entry SHALL be consumed by token
- **AND** the server SHALL set the session's `source` to `"dashboard"` in `sessionManager`, broadcast `session_updated { source: "dashboard" }`, and write `{ source: "dashboard" }` into the session's `.meta.json` sidecar

#### Scenario: PID match stamps dashboard when token is absent
- **WHEN** `event-wiring` receives `session_register { sessionId: "S", cwd: "/p", pid: 1234 }` with no `spawnToken`
- **AND** `PendingDashboardSpawns` contains an entry `{ token: "tok_x", cwd: "/p", pid: 1234 }`
- **THEN** the entry SHALL be consumed by pid
- **AND** the server SHALL stamp `source: "dashboard"` exactly as in the token-match scenario

#### Scenario: CLI register in spawn-pending cwd is NOT stamped
- **WHEN** a CLI-launched pi process registers via `session_register { sessionId: "S", cwd: "/p" }` carrying neither `spawnToken` nor `pid`
- **AND** `PendingDashboardSpawns` contains an entry `{ token: "tok_x", cwd: "/p" }` from a recent dashboard Spawn whose token was not propagated to this register
- **AND** `STRICT_SPAWN_CORRELATION === true`
- **THEN** no `PendingDashboardSpawns` entry SHALL be consumed
- **AND** the server SHALL NOT stamp `source: "dashboard"` on `sessionManager`
- **AND** the server SHALL NOT broadcast `session_updated { source: "dashboard" }`
- **AND** the server SHALL NOT write `source: "dashboard"` into the `.meta.json` sidecar
- **AND** a single-line warning SHALL be logged identifying the unstamped session

#### Scenario: Legacy bridge cwd-FIFO match logged but accepted
- **WHEN** a register without `spawnToken` and without `pid` arrives in a cwd that has a pending dashboard spawn
- **AND** `STRICT_SPAWN_CORRELATION === false` (default during migration window)
- **THEN** the oldest pending entry in that cwd SHALL be consumed by cwd-FIFO
- **AND** the server SHALL stamp `source: "dashboard"` as today
- **AND** a single-line `[event-wiring] cwd-FIFO source-stamp fallback` warning SHALL be logged identifying `sessionId`, `cwd`, and that neither token nor pid was present

#### Scenario: No pending entry → no stamp
- **WHEN** any `session_register` arrives and the three-tier matcher finds no entry in `PendingDashboardSpawns`
- **THEN** the server SHALL NOT stamp `source: "dashboard"` regardless of the register's contents

### Requirement: `PendingDashboardSpawns` registry shape and lifecycle
The server SHALL maintain a `PendingDashboardSpawns` registry replacing the legacy `Map<cwd, count>`. Entries SHALL be records of `{ token: string; cwd: string; pid?: number; createdAt: number }`. The registry SHALL expose `add(entry)`, `consumeByToken(token)`, `consumeByPid(pid)`, `consumeByCwd(cwd)` (FIFO), and `size()`. All four consume operations SHALL remove the matched entry on success. Entries older than 60 seconds SHALL be dropped by a periodic sweeper that SHALL run independently of incoming registers.

The registry SHALL be in-memory only and SHALL NOT be persisted across server restart.

#### Scenario: add then consumeByToken returns the entry and empties the slot
- **WHEN** `add({ token: "tok_a", cwd: "/p", createdAt: now })` is called
- **AND** `consumeByToken("tok_a")` is subsequently called
- **THEN** the call SHALL return the matching entry
- **AND** a second call SHALL return `undefined`

#### Scenario: consumeByPid uses the entry's stored pid
- **WHEN** `add({ token: "tok_a", cwd: "/p", pid: 1234, createdAt: now })` is called
- **AND** `consumeByPid(1234)` is subsequently called
- **THEN** the call SHALL return the matching entry
- **AND** `consumeByToken("tok_a")` SHALL then return `undefined`

#### Scenario: consumeByCwd is FIFO
- **WHEN** two entries are added for `cwd: "/p"` with `createdAt` 100ms apart
- **AND** `consumeByCwd("/p")` is called twice
- **THEN** the first call SHALL return the older entry
- **AND** the second call SHALL return the newer entry

#### Scenario: Sweeper drops stale entries
- **WHEN** an entry has `createdAt` older than 60 seconds
- **AND** the periodic sweeper tick runs
- **THEN** the entry SHALL be removed from the registry
- **AND** subsequent `consumeBy*` calls for that entry's identifiers SHALL return `undefined`

#### Scenario: Restart drops all entries
- **WHEN** the server restarts
- **AND** the new server process initializes `PendingDashboardSpawns`
- **THEN** `size()` SHALL be `0`
- **AND** no on-disk artifact SHALL contain registry contents

### Requirement: Spawn-issuing handlers register a PendingSpawn (not bump a counter)
Every server handler that initiates a dashboard spawn SHALL call `pendingDashboardSpawns.add({ token, cwd, pid?, createdAt })` using the same `spawnToken` it already mints for `headlessPidRegistry` and related token-keyed registries. The legacy pattern `pendingDashboardSpawns.set(cwd, (get(cwd) ?? 0) + 1)` SHALL NOT appear anywhere in the codebase after this change.

#### Scenario: Spawn handler uses the same token across registries
- **WHEN** `handleSpawnSession` mints `spawnToken: "tok_z"` for a new spawn
- **THEN** the same `"tok_z"` SHALL be passed to `headlessPidRegistry.add(...)` AND to `pendingDashboardSpawns.add({ token: "tok_z", cwd, createdAt })`
- **AND** the same `"tok_z"` SHALL be injected into the spawned process as `PI_DASHBOARD_SPAWN_TOKEN`

#### Scenario: Resume handler registers a PendingSpawn
- **WHEN** `handleResumeSession` invokes `spawnPiSession` for a `mode: "resume"` or `mode: "fork"`
- **THEN** the handler SHALL call `pendingDashboardSpawns.add(...)` with the minted token

#### Scenario: Attach-spawn handler registers a PendingSpawn
- **WHEN** the attach-and-spawn proposal flow invokes a fresh spawn
- **THEN** the handler SHALL call `pendingDashboardSpawns.add(...)` with the minted token

#### Scenario: Auto-resume-on-prompt registers a PendingSpawn
- **WHEN** `handleSendPrompt` detects `status: "ended"` and triggers an auto-resume spawn
- **THEN** the auto-resume code path SHALL call `pendingDashboardSpawns.add(...)` with the freshly minted token

### Requirement: One-shot cleanup utility for legacy mis-stamped `.meta.json` files
The repository SHALL ship a standalone Node script `scripts/repair-meta-source.mjs` that scans every `*.meta.json` under `~/.pi/agent/sessions/`. For each file with `source: "dashboard"`, the script SHALL inspect the corresponding `*.jsonl` for evidence that the originating pi process had a TUI attached; when such evidence is found, the script SHALL remove the `source` field from the `.meta.json`. The script SHALL be idempotent, SHALL print a summary `kept N / cleaned M / errors E`, and SHALL exit with code 0 on success.

#### Scenario: Removes dashboard tag when TUI evidence present
- **WHEN** a `.meta.json` has `source: "dashboard"`
- **AND** the corresponding `.jsonl` contains a state-sync entry with `hasUI: true`
- **THEN** the script SHALL remove the `source` field from that `.meta.json`
- **AND** the rest of the file SHALL be preserved byte-for-byte (modulo JSON re-serialization)

#### Scenario: Leaves dashboard tag intact when no TUI evidence
- **WHEN** a `.meta.json` has `source: "dashboard"`
- **AND** the corresponding `.jsonl` does not contain any `hasUI: true` marker
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
