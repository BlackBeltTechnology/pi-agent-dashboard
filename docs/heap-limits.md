# V8 Heap Limits & GC Telemetry

Configuration, delivery mechanisms, sizing rationale, and telemetry for V8 heap limits in pi-agent-dashboard.

## Configuration Keys

Two top-level keys in `~/.pi/dashboard/config.json`:

- `sessionHeap`: governs spawned pi sessions.
  - `maxOldSpaceMb`: V8 old space ceiling in MB (default `512`).
  - `initialOldSpaceMb`: initial V8 old space in MB (default unset).
  - `maxSemiSpaceMb`: V8 semi-space ceiling in MB (default unset).
- `serverHeap`: governs dashboard server process.
  - `maxOldSpaceMb`: V8 old space ceiling in MB (default `1536`). Replaced hardcoded `8192`.

Floor: `64` MB for all heap values.
Invalid, absent, or below-floor values fall back to defaults inside `loadConfig` (`packages/shared/src/config.ts`).
Never throws. Fallback is silent — the settings panel refuses a below-floor entry at the point of edit instead.
No "unlimited" sentinel: explicit `0` is invalid and falls back, unlike the `memoryLimits` byte budgets.

### Heap Limits vs Memory Limits

`sessionHeap` and `serverHeap` bound V8 runtime memory allocations.
`memoryLimits` bounds event store (`maxEventsPerSession`, `maxBytesPerSession`, `maxTotalEventBytes`, `maxWsBufferBytes`, `maxReplayEvents`).
Names close; operational concerns unrelated. Do not conflate.

## Flag Delivery Mechanics

Transport uses CLI `argv`, not `NODE_OPTIONS`.
Three measured reasons:
1. `NODE_OPTIONS` allow-list rejects `--initial-old-space-size` (`node: --initial-old-space-size= is not allowed in NODE_OPTIONS`); child refuses boot.
2. `NODE_OPTIONS` leaks down process tree; child vitest, tsc, and vite inherit restricted heap below clean defaults.
3. tmux panes do not see spawn-time env; pane env derives from long-lived tmux server.

CLI `argv` overrides `NODE_OPTIONS` (measured: `NODE_OPTIONS=--max-old-space-size=8192` + argv `1024` yields `heap_size_limit` 1216 MB).

### Per-Mechanism Delivery

- `headless` / keeper + `wt`: argv array `[<node>, <flags>, <entry>]`. Flags placed strictly before entrypoint.
- `tmux` + `wsl-tmux`: tmux window option `-e NODE_OPTIONS=--max-old-space-size=<n>`. Pane descendants inherit flag; accepted tradeoff to cross tmux server boundary.
- Fallback: last-resort `NODE_OPTIONS` env injection. Logs `[heap]` warning line. Reports `sessionHeapFallback: { used, mechanism, detail }` at `/api/health` root. Forbidden on `headless` mechanism (would cap keeper process).

### Inherited Flag Scrubbing

Server process runs with own `--max-old-space-size`.
Server launcher marks spawned token via env var `PI_DASHBOARD_HEAP_FLAG`.
Session spawner inspects child env. Exact match against `PI_DASHBOARD_HEAP_FLAG` strips flag.
Marker absent or value mismatch indicates operator-provided flag; spawner preserves flag verbatim.

### Effect Boundaries

- `sessionHeap`: applies to next spawned session. Session reload triggers kill + fresh spawn; inherits updated config.
- `serverHeap`: cold-start only. `/api/restart` respawns server with `env: process.env`; ignores changed `serverHeap` until full process relaunch.

### Known gap: Electron-hosted server

`packages/electron` spawns its server without the stamp.
An Electron-hosted server therefore runs at the bare V8 default; `serverHeap` has no effect there.
`/api/health` reports `effectiveMaxOldSpaceMb: null` on that arm — the honest answer, not a fiction.
Stamping the Electron launch path belongs to `guard-server-heap-and-store-coupling` (design D10).
Named here so it is a known gap, not an unnoticed one.

## V8 Overhead & Sizing Realities

`heap_size_limit` does not match requested `maxOldSpaceMb`.
V8 runtime adds ~192 MB fixed internal overhead.
Measured requested vs effective `heap_size_limit`:
- Request `1024` MB → effective `1216` MB.
- Request `256` MB → effective `448` MB.
- Request `64` MB → effective `256` MB.
- Request `16` MB → effective `208` MB.

### Server Sizing Rationale (1536 MB)

Server baseline requires ~112 MB non-store heap.
Event store budget: 768 MiB serialized `data`. Expressed as V8 objects with object overhead requires ~1024 MB heap.
`GLOBAL_TRIM_SLACK`: ~51 MB buffer.
Steady state target: ~1187 MB heap.
Occupancy at 1536 MB: ~84% of crash threshold (~1417 MB).
84% occupancy represents deliberate trade-off, not safe margin.
Operator action: raise `serverHeap.maxOldSpaceMb` to `2048` (~65% occupancy) if metrics show sustained `heapUsed > 1200` MB or rising `gcMajorCount`.

### Percentage Bases Differ

Occupancy percentages use two distinct bases:
- Internal formula (D9): 84% occupancy calculated against estimated crash threshold (~1417 MB).
- UI dashboard panel: calculates `heapUsed / heapSizeLimit`. Same steady state reads ~69%.

## Subagent Coupling

Pi `Agent` subagents run in-process. All subagents share parent session V8 heap.
`maxConcurrentSubagents` operates as memory-safety control.
Guidance: keep `maxOldSpaceMb / (maxConcurrentSubagents + 1) >= 100` MB. `+ 1` accounts for the parent itself.
Settings panel warns below 100 MB per concurrent child. Warning is non-blocking; both values stay saveable.
Shared formula: `subagentHeapBudget` (`packages/shared/src/heap-limits.ts`).

## Telemetry Metrics

### Session Metrics (`ProcessMetrics`)

Session heartbeats stream telemetry to server:
- `heapSizeLimit`: effective V8 limit in bytes.
- `external`: memory allocated outside V8 heap (C++ buffers) in bytes.
- `arrayBuffers`: ArrayBuffer backing store memory in bytes.
- `gcCount`: total GC cycles during heartbeat window (delta, read-and-reset).
- `gcMajorCount`: full mark-sweep/compact GC cycles during heartbeat window (delta, read-and-reset).
- `gcPauseMsTotal`: cumulative GC pause time in ms during heartbeat window (delta, read-and-reset).

### Server Metrics (`/api/health`)

Server `server` block reports process health:
- `gcMajorCount`: cumulative major GC cycles since process start (monotonic, polled GET idempotent).
- `gcMajorPauseMsTotal`: cumulative major GC pause duration in ms since process start (monotonic, polled GET idempotent).
- `effectiveMaxOldSpaceMb`: active V8 limit parsed from running process `argv` and `process.env`, not raw config file.

See change: bound-session-heap-and-gc-telemetry.
