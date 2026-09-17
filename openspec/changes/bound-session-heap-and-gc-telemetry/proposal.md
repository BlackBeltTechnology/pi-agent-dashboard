## Why

Every pi session the dashboard spawns silently inherits the **server's**
`NODE_OPTIONS=--max-old-space-size=8192`. `process-manager.ts buildSpawnEnv`
spreads `process.env` and nothing strips it, so a flag sized for the server's
event store also governs every agent process — and, transitively, every node
process an agent starts.

Measured on this host (64 GB, Node v25.8.1; heap figures via
`v8.getHeapStatistics().heap_size_limit`, the clean baseline taken with
`env -u NODE_OPTIONS` — inheriting the ambient `NODE_OPTIONS` is exactly how
this measurement gets faked):

| | `heap_size_limit` |
|---|---|
| clean Node (`env -u NODE_OPTIONS`) | 4288 MB |
| dashboard-spawned pi session | **8384 MB** |

The headroom is unused. Across 11 live sessions (`/api/health` `agents[]`)
`heapUsed` peaked at **148 MB** (range 74–148), `heapTotal` 83–266 MB, `rss`
161–512 MB. A churn benchmark shows the GC consequence: at `=8192` the heap
settles at 56 MB used / 169 MB total after 2 major GCs; at `=1024` the same
workload settles at 4 MB used / 134 MB total after 4 major GCs, for +3 ms total
pause. V8 sizes major-GC aggressiveness against the ceiling, so an 8 GB ceiling
buys laziness nobody asked for.

Nobody can see any of this. `ProcessMetrics` carries `rss`, `heapUsed`,
`heapTotal`, `cpuPercent`, `eventLoopMaxMs`, `loadAvg1m` — but **no heap
ceiling** (so "148 MB" is unreadable without knowing the limit), **no GC
counters**, and **no `external`/`arrayBuffers`**, which is where the bytes
actually are: the worst session is 512 MB RSS against 148 MB `heapUsed`, so
~360 MB sits outside the knob this change tunes. Lowering a ceiling without that
telemetry would be guessing.

## What Changes

**The cap travels as node argv, not `NODE_OPTIONS`.** Three measured facts
force this and rule the env-var approach out:

1. `NODE_OPTIONS` has an allow-list. `NODE_OPTIONS=--initial-old-space-size=64`
   → `node: --initial-old-space-size= is not allowed in NODE_OPTIONS`, child
   refuses to boot (`--max-heap-size` likewise). The same flag on argv works.
2. `NODE_OPTIONS` is inherited by **every** node grandchild — the vitest, tsc,
   vite and npm processes an agent runs would silently inherit the session cap,
   dropping them *below* the clean default. Argv binds to the pi process only.
3. tmux panes never see it. `buildTmuxCommand` only scopes vars per window via
   `-e` (the spawn token); pane env otherwise comes from the long-lived tmux
   **server**. Argv rides the pane command string, which does reach the pane.

Verified precedence: argv beats `NODE_OPTIONS` (`NODE_OPTIONS=8192` +
`argv 1024` → 1216 MB).

- The resolved pi argv carries the heap flags, on every spawn mechanism:
  headless/keeper (the **default** `spawnStrategy`), tmux, WSL-tmux, Windows
  Terminal, Electron execpath-fallback. `resolver.resolvePi()` returns either a
  bare `["<pi>"]` shebang script or a `[<node>, <script>.js]` pair, so the stamp
  normalizes to `[<node>, <flags…>, <entry>]`.
  - On the default headless strategy the argv reaches pi through the keeper,
    which spawns pi **once** (`keeper.cjs:447`) and exits with it — there is no
    keeper-side respawn to leave a stale invocation behind. A reload is a
    server-side kill plus a fresh `spawnPiSession`, so the boundary is simply
    "the next spawn", reload included.
  - The tmux family is the exception: `spawnWslTmux` hardcodes `["pi"]` so the
    name resolves inside the WSL namespace, and plain tmux takes pane env from
    the long-lived tmux server. Both use tmux's per-window
    `-e NODE_OPTIONS=--max-old-space-size=<n>` — the same mechanism the spawn
    token already relies on. Inside those panes the ceiling *is* inherited by
    descendants; that is the price of reaching the pane at all.
  - A last-resort `NODE_OPTIONS` fallback exists for a mechanism with neither
    route, logged rather than silent, and forbidden on the headless strategy
    where it would cap the keeper along with pi.
- The **inherited** server heap flag is stripped from the child `NODE_OPTIONS`
  so it stops reaching grandchildren. Two constraints on that rule:
  - Presence is not provenance. The dashboard stamps that same flag into its own
    environment, so "is `--max-old-space-size` present?" matches the dashboard's
    own stamp and would make the feature a no-op. The strip must distinguish the
    flag the dashboard wrote from one the operator pinned, must remove only that
    token, and must survive `/api/restart`, which re-spawns with
    `env: process.env`.
  - Only the standalone wrapper stamps a ceiling today.
    `extension/src/server-launcher.ts` exports and tests `buildSpawnEnv`, but
    `launchServer` delegates to `launchDashboardServer` **without** an `env`
    option, so it never runs in production. That path must gain the stamp in
    this change: once the strip lands, a bridge-auto-started server inherits a
    stripped environment and would otherwise drop to the runtime default on the
    recovery path where the event store is hottest.
- New config, two **top-level** keys (settings-page attribution in
  `CONFIG_FIELD_PAGE` is per top-level key, so one shared key would strand
  session fields on the Server page):
  - `sessionHeap` → page `sessions`: `maxOldSpaceMb` (default **1024**),
    `initialOldSpaceMb` (the `-Xms` analogue, unset), `maxSemiSpaceMb`
    (young-gen, unset).
  - `serverHeap` → page `server`: `maxOldSpaceMb` (default **8192**, preserving
    today's behavior) replacing the hardcoded `8192` in `server-launcher.ts`
    (`DEFAULT_SERVER_MAX_OLD_SPACE_MB`) and `bin/pi-dashboard.mjs`.

  Distinct from the existing `memoryLimits` key, which bounds the **event
  store** (events/session, WS buffer, replay window) and is unrelated to V8
  heap. Naming must not blur the two.
- Invalid values follow the established `shared-config` convention: **fall back
  to the default inside `loadConfig`** (as `spawnStrategy`/`reattachPlacement`
  do), not merely rejected in the UI. Floor 64 MB — below that V8's ~192 MB
  fixed overhead dominates (requested→effective: 1024→1216, 256→448, 64→256,
  16→208).
- Settings gains the fields with an explicit **applies-to-next-spawn** semantic.
  No running process is resized. `serverHeap` additionally does **not** take
  effect on `/api/restart` (`restart-helper.ts` re-spawns with
  `env: process.env`) — cold start only, and the UI must say so.
- `ProcessMetrics` gains `heapSizeLimit`, `external`, `arrayBuffers`,
  `gcCount`, `gcMajorCount`, `gcPauseMsTotal`, all **optional** — backward
  compatible in *both* directions (old bridge → new server: fields absent; new
  bridge → old server: unknown fields ignored, no strict parsing). Counters are
  scalars accumulated in a `PerformanceObserver("gc")` callback and
  read-and-reset per heartbeat, like the existing event-loop histogram — so
  nothing buffers. Major-GC classification reads `entry.detail.kind` against
  `perf_hooks.constants.NODE_PERFORMANCE_GC_MAJOR` (=4); `entry.kind` is
  `undefined` on this Node and must not be used.
- `/api/health` `agents[]` surfaces the new fields.

Not in scope: pushing metrics live to the browser (today `processMetrics`
reaches it only in the connect snapshot) and any per-session memory UI. Both are
follow-ups gated on this telemetry existing.

## Capabilities

### New Capabilities
- `heap-limits`: configurable V8 heap sizing for **both** spawned pi sessions
  and the dashboard server — the flag set, the argv transport and its
  per-mechanism reach, the degrade path, the inherited-flag strip and its
  provenance rule, defaults, validation bounds, and the apply-on-next-spawn
  semantic. Named without `session-` because its scope is not session-only.

### Modified Capabilities
- `shared-config`: adds `sessionHeap` and `serverHeap` top-level blocks, with
  defaults applied on partial config and fallback-on-invalid in `loadConfig`.
- `shared-protocol`: `ProcessMetrics` on the session heartbeat gains six
  optional memory/GC fields.
- `settings-panel`: Memory fields on the Sessions and Server pages, wired into
  `CONFIG_FIELD_PAGE` so Save-Bar dirty attribution resolves.
- `process-manager`: the resolved pi argv and the child env shaping change.
- `headless-spawn`: its requirement that "the existing `prependManagedNodeToPath`
  and other env-shaping behaviors SHALL be preserved unchanged" is exactly what
  the inherited-flag strip modifies, and the invocation handed to the keeper now
  carries heap arguments.
- `server-launch`: the hardcoded `8192` becomes config-derived, and the
  bridge-initiated path gains the stamp it never actually applied.
- `server-restart`: `/api/restart` inherits `env: process.env`, so a changed
  `serverHeap` is cold-start-only — a stated requirement, not an accident.

## Impact

- `packages/server/src/spawn-process/process-manager.ts` — argv heap stamp +
  inherited-flag strip (the behavioral core).
- `packages/shared/src/config.ts` — `sessionHeap`/`serverHeap` types, defaults,
  parsers. Browser-safe defaults may need a `memory-limits.ts`-style split if
  the settings panel needs them as values.
- `packages/server/src/config-api.ts` — config write/validation path.
- `packages/extension/src/server-launcher.ts` +
  `packages/extension/src/__tests__/server-launcher.test.ts` — two tests assert
  the literal `8192` (default + append) and one asserts a user-pinned `2048` is
  never overridden; all three move with the constant.
- `packages/server/src/rpc-keeper/keeper-manager.ts` — the
  `PI_KEEPER_PI_CMD`/`PI_KEEPER_PI_ARGS` invocation the keeper spawns pi from.
- `packages/shared/src/server-launcher.ts` — the caller-`env` seam the bridge
  launch path must start using.
- `packages/server/bin/pi-dashboard.mjs` — standalone launch path; it runs
  before jiti, so it must read the config by plain JSON parse, not by importing
  the shared TS config module.
- `packages/extension/src/process-metrics.ts` — GC observer + new fields.
- `packages/shared/src/protocol.ts` — `ProcessMetrics` shape.
- `packages/server/src/routes/system-routes.ts` — `/api/health` `agents[]`.
- `packages/client/src/components/settings/SettingsPanel.tsx` — fields,
  `CONFIG_FIELD_PAGE` entries, and `computeConfigPartial`, which must learn the
  new top-level keys or Save silently drops them.
- **Accepted trade-off:** subagents run **in-process** in the parent pi session
  and share its single heap, so a wide fan-out on a 1216 MB ceiling turns what
  used to be heap growth into a fatal OOM. Accepted because the observed peak is
  148 MB (7× headroom), the cap is user-adjustable, and the telemetry shipped
  here is what makes an OOM diagnosable instead of mysterious. Revisit the
  default from `heapSizeLimit`/`external` data, not intuition.
  **Sample bias, stated plainly:** those 11 sessions are one host, one user, one
  plugin mix, and shipping a ~7× lower ceiling *by default* generalizes from
  that sample to every user of the next release. Decision (reviewed, accepted):
  **ship 1024**. The escape hatch is the config key itself, and the telemetry in
  this change is what turns a resulting OOM from a mystery into a reading. If
  field reports contradict the sample, raising a default is a one-line follow-up.
- **Unverified (needs real-machine QA):** whether `wt.exe` hands new tabs to an
  existing Windows Terminal process (same env-reach class as tmux); and whether
  the WSL-tmux path can name a valid node binary — normalizing to
  `[<node>, flags, <entry>]` requires a node path valid *inside* WSL, which a
  host-resolved `resolveNode()` is not. Argv transport is expected to sidestep
  the first; the second may need the flags to ride the pane command instead.

## Discipline Skills

- `observability-instrumentation` — `ProcessMetrics`/GC counters and the
  `/api/health` surface are new runtime-visibility paths.
- `performance-optimization` — the default is a measure-first decision; any
  revision must be driven by the telemetry this change adds.
- `security-hardening` — config-derived numbers are interpolated into a spawned
  process argv and, on the tmux path, into a shell-escaped pane command string;
  the values must be validated as integers at the boundary, not passed through.
- `doubt-driven-review` — lowering a heap ceiling for every spawned session
  converts a slowdown into a crash for anything near the old ceiling.
