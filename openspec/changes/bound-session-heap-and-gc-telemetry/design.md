## Context

See `proposal.md` — Why. The design-relevant constraints, all verified on host
(Node v25.8.1, macOS, 64 GB):

| Constraint | Evidence |
|---|---|
| `NODE_OPTIONS` has a flag allow-list | `NODE_OPTIONS=--initial-old-space-size=64` → `node: --initial-old-space-size= is not allowed in NODE_OPTIONS`; `--max-heap-size` likewise. `--max-old-space-size` and `--max-semi-space-size` are accepted. |
| argv outranks `NODE_OPTIONS` | `NODE_OPTIONS=--max-old-space-size=8192` + argv `--max-old-space-size=1024` → `heap_size_limit` 1216 MB |
| V8 adds fixed overhead to the request | 1024→1216, 256→448, 64→256, 16→208 MB |
| semi-space participates in the reported ceiling | argv `1024` + `--max-semi-space-size=8` → 1048 MB, not 1216 |
| `NODE_OPTIONS` is inherited by all descendants | the dashboard's 8192 reaches an agent's shell and every node tool it runs |
| tmux pane env comes from the tmux **server**, but `-e` scopes a var per window | `buildTmuxCommand` already uses `-e` for the spawn token precisely because of this |
| the keeper spawns pi exactly **once** and exits with it | `keeper.cjs:447` is the only `spawnPi()` call; `c.on("exit")` → `shutdown()`. There is **no** keeper-side respawn |
| a headless reload is a kill + **fresh** `spawnPiSession` | `session-action-handler.ts` |
| only the standalone wrapper stamps a heap flag today | `bin/pi-dashboard.mjs`. `extension/server-launcher.ts buildSpawnEnv` is exported and tested but **never called in production** — `launchServer` invokes `launchDashboardServer` without an `env` option |
| `launchDashboardServer` accepts caller `env`, merged over the resolver's | `packages/shared/src/server-launcher.ts:102,238` |
| `spawnWslTmux` hardcodes `["pi"]` | `process-manager.ts:712` — `resolvePi()` is deliberately not consulted; the name must resolve inside the WSL namespace |
| `/api/restart` inherits the environment | `restart-helper.ts` spawns with `env: process.env` |
| GC entry shape | `entry.kind` is `undefined`; `entry.detail.kind` is populated; `NODE_PERFORMANCE_GC_MAJOR` = 4 |

## Goals / Non-Goals

**Goals:**
- One place decides the session heap arguments; every spawn mechanism consumes it.
- The ceiling binds the pi process and nothing below it.
- The telemetry can answer "was this OOM the ceiling, or was it non-heap growth?"

**Non-Goals:**
- Resizing a live process. V8 cannot.
- Capping non-heap allocation. `external`/`arrayBuffers` are measured here, not bounded.
- Per-subagent limits. Subagents are in-process; one heap, by construction.
- Making the tmux path's stale multiplexer environment correct. Out of reach.

## Decisions

### D1 — argv transport, not `NODE_OPTIONS`

`NODE_OPTIONS` fails three ways at once: it rejects `--initial-old-space-size`
outright, it leaks the ceiling to every descendant, and it never reaches a tmux
pane. argv has none of those properties and outranks `NODE_OPTIONS` where both
are present, so the inherited server flag does not have to be defeated for the
pi process — only for its descendants.

*Alternative rejected:* keep `NODE_OPTIONS` and drop the `-Xms` analogue. It
still caps the agent's build and test subprocesses below the clean default,
which is a worse bug than the one being fixed.

### D2 — normalize the invocation to `[runtime, …heapArgs, entry, …piArgs]`

`resolver.resolvePi()` returns either `["/abs/pi"]` (a shebang script) or
`[node, "/abs/cli.js"]`. A single normalization step produces the runtime slot;
`applySpawnRuntimeToPiArgv` already establishes that re-pointing the runtime is
legitimate. Heap args go *before* the entry point — after it they are pi's
arguments, and pi would reject them.

*Alternative rejected:* a wrapper script per spawn. More moving parts, a
temp-file lifecycle, and a new failure mode on every platform.

### D3 — the tmux family uses tmux's own per-window env, not a process argument

`spawnWslTmux` hardcodes `["pi"]` so the name resolves inside the WSL namespace;
a host-resolved runtime path is meaningless there, so D2's normalization cannot
apply. Plain tmux has the same shape at one remove — its pane environment comes
from the long-lived tmux server, so the spawn-time environment does not reach
the pane at all.

Both are solved by the mechanism the spawn token already uses:
`tmux new-session|new-window -e VAR=VALUE`, which scopes a variable to that
window regardless of the tmux server's environment. The heap limit rides
`-e NODE_OPTIONS=--max-old-space-size=<n>`.

This accepts the descendant-inheritance property inside that pane — the subset
`NODE_OPTIONS` accepts is the only thing that can cross the boundary. It is the
price of reaching the pane at all, it is confined to the tmux strategies (not
the default), and it is recorded.

*Alternative rejected:* injecting a host node path into the WSL pane command.
It names a binary that does not exist in the guest.

### D3a — last-resort fallback

If a mechanism offers neither a runtime slot nor per-window env, the limit rides
the child `NODE_OPTIONS` with `--max-old-space-size` only, and the fallback is
logged. The alternative is no cap at all. This SHALL NOT be used on the headless
strategy, where the keeper would otherwise be capped along with pi (the keeper
re-passes its environment to pi, so an env-borne cap binds both).

### D4 — provenance via an explicit marker, not by sniffing the flag

"Is `--max-old-space-size` present?" cannot work: the dashboard puts that same
flag into its own environment, so the test matches the dashboard's own stamp and
the strip would either never fire or would eat the operator's pin.

The launcher that stamps the flag also exports a marker naming the exact flag
token it wrote. The strip removes that token only when the marker matches the
token actually present, and removes **only** that token — any other
`NODE_OPTIONS` content the operator set is preserved verbatim, as
`headless-spawn` requires. No marker, or a mismatch, means the operator owns it.

The marker rides in the environment, so it survives `/api/restart`'s
`env: process.env` inheritance alongside the flag it describes.

The marker is itself an inherited variable and therefore reaches pi sessions. A
session that later bridge-launches a server must not treat the inherited marker
as its own: the launcher overwrites the marker whenever it stamps, so the marker
always describes the most recent stamp.

The two existing detectors disagree — the wrapper uses a substring test, the
extension a dash-or-underscore regex. The marker comparison replaces both, so
there is one detection rule rather than two that drift.

*Alternative rejected:* comparing the value against the configured default. An
operator who pins the same number as the default would have their pin silently
reclassified.

### D5 — heap args reach pi through the invocation handed to the keeper

The keeper receives the pi invocation as `PI_KEEPER_PI_CMD`/`PI_KEEPER_PI_ARGS`
and spawns pi from it. Putting the heap args in that invocation is sufficient.

There is **no keeper-side respawn** to reason about: `keeper.cjs` calls
`spawnPi()` exactly once, and pi's exit shuts the keeper down. A headless reload
is a server-side kill followed by a fresh `spawnPiSession`, which rebuilds the
invocation from current configuration. The effective boundary is therefore
simply “the next spawn” — including a reload — with no stale-keeper caveat, and
the settings copy says exactly that.

The keeper process itself is spawned separately and stays uncapped, which is
correct for a supervisor. That property depends on the limit travelling as a pi
argument; it is why D3a forbids the env fallback on this strategy.

### D5a — the bridge launch path gains the stamp it never had

`launchServer` calls `launchDashboardServer` without an `env` option, so the
extension's `buildSpawnEnv` never runs in production and only the standalone
wrapper stamps a ceiling today. `launchDashboardServer` already merges a caller
`env` over the resolver's, so wiring the config-derived stamp in is a matter of
passing it.

This is not optional tidying. Once the strip lands, a bridge-auto-started server
inherits a *stripped* environment from its pi session, so without its own stamp
it would run at the clean V8 default rather than the intended server ceiling —
losing event-store headroom on precisely the recovery path where the store is
hottest. The strip and this stamp must land together.

### D6 — GC counters are scalars accumulated in the observer callback

The observer callback receives entries and the handler folds them into three
numbers, reset on each heartbeat read — the same read-and-reset shape the
existing event-loop histogram uses. Nothing accumulates between heartbeats, so
the memory-observation path cannot itself become a memory leak.

Major collections are classified by `entry.detail.kind === NODE_PERFORMANCE_GC_MAJOR`.
`entry.kind` is `undefined` on the supported runtime and must not be used; a
`detail`-less entry is counted in `gcCount` and skipped for `gcMajorCount`
rather than throwing.

### D7 — two top-level config keys, not one nested block

Settings page attribution (`CONFIG_FIELD_PAGE`) resolves per *top-level* key. A
single `heapLimits` block would force the session fields onto whichever page the
key was assigned. `sessionHeap` → Sessions, `serverHeap` → Server.

Naming avoids `memoryLimits`, which already exists and means the event store.
Defaults that the settings panel needs as values follow the existing
`memory-limits.ts` precedent: a browser-safe module, because a value import of
`config.ts` drags `node:fs` into the SPA bundle.

Both keys are sub-block objects, so the config write path deep-merges them the
way it already deep-merges `memoryLimits` — otherwise saving `maxOldSpaceMb`
alone would drop a sibling `initialOldSpaceMb`. `serverHeap` sets the
restart-required indicator; `sessionHeap` does not, because it needs no server
restart to take effect on the next spawn.

### D8 — the standalone launcher parses the config itself

`bin/pi-dashboard.mjs` runs before jiti, so it cannot import the shared
TypeScript config module. It reads `~/.pi/dashboard/config.json` with
`JSON.parse` inside a `try`, taking the `1536` default on any failure. Tolerated
duplication: one integer field, and the alternative is a bootstrap cycle. The
literal is duplicated in two places (wrapper + shared config), so task 8.5 keeps
them asserted against the same value.

### D9 — `serverHeap` defaults to 1536, gated on the event-store byte bound

**The budget is denominated in serialized `data` bytes; the ceiling is
denominated in V8 heap bytes.** `bound-event-store-by-bytes` documents the
conversion: a 768 MiB budget means *roughly 1 GiB of heap*. Any derivation that
adds 768 to a baseline is wrong by ~256 MB before it starts.

Steady state, with every term applied:

| term | MB | source |
|---|---|---|
| 768 MiB budget expressed as heap | ~1024 | sibling change, "roughly 1 GiB heap" |
| `GLOBAL_TRIM_SLACK` (reclaim is hysteretic) | ~+51 | enforced high-water is `budget + slack` |
| non-store baseline | ~112 | heap snapshot: 798 MB live set − 686 MB strings |
| **steady-state heapUsed** | **~1187** | |

A `1024` request (1216 MB limit, observed OOM ~1000 MB) puts that at **119%** —
it cannot hold the working set at all. `1536` (1728 MB limit, crash ~1417 MB at
the same 82% ratio) puts it at **~84%**.

**84% is an accepted trade-off, not a safe margin.** It is above the ~62-65%
that would be comfortable, and `2048` would deliver that (65%). 1536 was chosen
anyway to cap the process footprint, against three mitigations — the coupling
guard in D10, a one-line config escape hatch to `2048`, and **server-side heap
and GC telemetry that this change must now build** (D13).

**The crash ratio is an assumption, stated as one.** 1417 MB comes from applying
the synthetic benchmark's 82% (OOM at ~1000 of a 1216 limit) to the 1728 limit.
The *corpus* crashes died at ~97% of their limit (~8130 of 8384) — leak-mode,
where the process is driven into the ceiling rather than resting near it. 82% is
the conservative pick and is used deliberately; at 97% the occupancy figure
would be ~71% instead of 84%. The soak (X17) settles which regime applies.

Rejected alternative: `1024` with the store halved to 384 MiB. Even corrected
for the heap factor it does not fit, and it costs fidelity — at ~36 MB/session
it holds far fewer of the 19 pegged sessions, so the rest re-read from
transcript on open.

**The 768 MiB bound is soft, so peak exceeds steady state.** Global reclaim
skips *pinned* sessions (bridge-connected or browser-subscribed); when every
resident session is pinned the store prefers a bounded overshoot to data loss.
Rehydrating an evicted session re-inserts its transcript at the measured 3.0×
disk→heap ratio, a transient tens-of-MB spike on top of peak. Neither term is
budgeted here — both eat into the 16% remaining at 1536, which is precisely why
the telemetry, not the arithmetic, is the safety net.

This default is **ordered after** the byte bound. Against today's unbounded
store a 1536 ceiling is strictly worse than 8192 — the same leak, reached
sooner. D11 turns that from prose into an enforced gate.

It also bounds V8 only: the live server carries ~1.07 GB outside the heap, so
`serverHeap` is not an RSS budget — see D12 for the container consequence.

### D10, D11 — moved out

The `serverHeap` × `maxTotalEventBytes` coupling guard and the ordering
invariant both key on `maxTotalEventBytes`, which does not exist in
`packages/shared/src` until `bound-event-store-by-bytes` merges. They cannot be
implemented or tested from this change and have moved to
`guard-server-heap-and-store-coupling`, which lands after it. The terminal
environment strip and the Electron launch path moved with them: neither depends
on this change's ceiling value, and both were pulling scope into a change that
review had already overloaded.

### D12 — A heap ceiling is not a container memory limit

The live server runs ~1.07 GB outside V8. A 1536 heap therefore implies ~2.5-3
GB RSS, and Docker is a first-class target here. Under a 1-2 GB container limit
the kernel OOM-killer fires before V8 reaches its ceiling — no heap dump, no GC
telemetry, no `FATAL ERROR` line.

**The floor is 4 GB for the all-in-one image, and `docker/compose.yml` already
ships `MEM_LIMIT:-4g`** — so the default is adequate and the doc states why
rather than inventing a number. The caveat that belongs with it: 4 GB is shared
with the co-tenants (pi sessions at a 512 ceiling each plus their uncapped
keepers, zrok, tmux), so a server alone at ~2.5-3 GB leaves under 1 GB for
everything else.
Operators running several concurrent sessions raise `MEM_LIMIT`, and the doc
says so.

This covers cgroup-limited deployments. A bare host with ≤2 GB of RAM is *not*
covered by any guard here — a 1728 MB limit plus ~1.07 GB of non-V8 exceeds
physical memory and the host swaps or the kernel kills. Out of scope for this
change; named so it is a known gap rather than an unnoticed one.

### D13 — The server process needs its own heap + GC telemetry

The existing telemetry work in this change instruments **pi sessions**
(`packages/extension/src/process-metrics.ts`). `packages/server/src` contains no
`v8.getHeapStatistics()` and no `PerformanceObserver('gc')` — the server's
`/api/health` reports only `rss`/`heapUsed`/`heapTotal`.

That gap invalidates D9's premise as originally written: 84% occupancy was
accepted *because* thrash would be visible before it became an OOM, and the
instrument to see it did not exist for the process being bounded. The server
therefore gains `heapSizeLimit` and a major-GC count on its own `/api/health`,
plus the **effective** ceiling, so a config value that diverges from the running
process (the cold-start-only case) is observable instead of silent.

Three semantics are pinned, because the session-side shape does not transfer:

- **`heapSizeLimit` is not the request.** It carries V8's own overhead (~192 MB
  on the measurement host) and semi-space. The **effective ceiling** is a
  distinct field, derived from the process's own argv/`NODE_OPTIONS` — not from
  the config file, which is exactly the value that may have diverged.
- **The GC count is cumulative, never read-and-reset.** The session-side counter
  resets on a heartbeat read; `/api/health` is a polled HTTP GET, so a
  read-and-reset counter would make the endpoint non-idempotent and let two
  pollers erase each other's signal. A monotonic counter is what "is it
  climbing?" requires.
- **Percentages are reported against `heapSizeLimit`.** D9's 84% is measured
  against the *estimated crash point* (~1417 MB), while the panel can only show
  `heapUsed / heapSizeLimit` — the same working set reads **~69%** there. Both
  are correct and they are not comparable; the doc states the pair so an operator
  does not read 69% as disagreement.

## Risks / Trade-offs

- **In-process subagent fan-out exceeds 1216 MB → fatal OOM instead of growth.**
  → Observed peak is 148 MB (7× headroom); `heapSizeLimit` + `gcMajorCount` make
  an approaching ceiling visible before it is hit; the config key is the escape
  hatch. Accepted deliberately — see proposal, Impact.
- **Both shipped defaults generalize from one host's workload mix** (macOS, Node
  v25.8.1, 64 GB). → Ship them (see proposal), and treat the shipped telemetry as
  the instrument for revising them.
- **The provenance marker and the flag could drift apart** (env edited between
  launch and spawn). → Mismatch is the safe case: mismatch means "operator owns
  it", so the worst outcome is the old inherited-flag behavior, not a wrong cap.
- **Windows Terminal and WSL-tmux env/argv reach is unverified.** → Both are
  argv-carrying command paths, which is the reason argv was chosen; still needs
  real-machine QA before the change is called done on Windows.
- **WSL needs a runtime path valid inside the guest.** → If a host-resolved node
  path cannot be used there, that mechanism keeps the D3 fallback rather than
  producing a broken invocation.
- **tmux panes from a pre-existing multiplexer keep a stale `NODE_OPTIONS`.** →
  The per-window `-e` value (D3) takes precedence for the pane's own pi process.
  Descendants in that pane inherit the ceiling too, which on this strategy is
  accepted rather than fixed — the alternative is not reaching the pane at all.
- **The provenance marker is inherited by pi sessions** and could be mistaken
  for a fresh stamp by a server that session launches. → The launcher rewrites
  the marker on every stamp, so it always describes the current process's stamp.

## Migration Plan

No data migration. Rollout is by process replacement: sessions started after the
change are capped, and on the default headless strategy the boundary is the next
keeper launch. Rollback is a config edit — set `sessionHeap.maxOldSpaceMb` to
`8192` to restore today's effective ceiling without redeploying.

The **server** ceiling rolls back via `serverHeap.maxOldSpaceMb`, a different
key, and unlike `sessionHeap` it is **cold-start-only**: an in-place
`/api/restart` inherits the current env, so the new ceiling requires a full
process start. Reverting `bound-event-store-by-bytes` after this change has
shipped leaves `1536` over an unbounded store — D9's "strictly worse than 8192"
case — so that revert MUST also restore `serverHeap` to `8192`. Nothing in this
change enforces that: the invariant that would have caught it moved to
`guard-server-heap-and-store-coupling`. Until that lands, the pairing is a
release checklist item, stated here so it is not mistaken for an automatic one.
