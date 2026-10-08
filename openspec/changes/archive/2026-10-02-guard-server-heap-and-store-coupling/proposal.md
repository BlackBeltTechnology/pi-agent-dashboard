# Guard the server heap against the store budget, and close the stamp gaps

## Why

`bound-session-heap-and-gc-telemetry` lowers the dashboard server's ceiling from
`8192` to `1536`. That default is only correct while the event store is bounded
to 768 MiB by `bound-event-store-by-bytes`, and three gaps sit between the two:

- **Nothing enforces the pairing.** `serverHeap.maxOldSpaceMb` and
  `memoryLimits.maxTotalEventBytes` are independently editable, and
  `maxTotalEventBytes: 0` means *unlimited* — which under a 1536 ceiling is a
  guaranteed OOM rather than a degraded-retention mode. The sibling change ships
  exactly this guard shape for `sessionHeap` × `maxConcurrentSubagents`; the
  server-side twin was missing.
- **Nothing enforces the ordering.** Reverting `bound-event-store-by-bytes`
  after the ceiling has landed leaves `1536` over an unbounded store — the
  "strictly worse than 8192" case, reached faster than the leak it replaced.
- **The stamp does not reach everywhere, and reaches somewhere it should not.**
  The Electron shell spawns the server through `launchDashboardServer` with no
  heap flag at all, so an Electron-spawned server runs at the runtime default.
  `/api/restart` then drops the ceiling on *every* path: `restart-helper.ts`
  builds its `spawnArgs` from the CLI arguments only (`restart-helper.ts:102`)
  and never carries `process.execArgv`, so under the sibling's argv transport a
  restarted server silently reverts to the runtime default. Meanwhile
  `terminal-manager.ts` spreads `process.env` wholesale
  (`terminal-manager.ts:264`), so a stamped old-space token leaks into every
  dashboard terminal — the same grandchild-capping failure the session-spawn
  strip exists to prevent.

These were scoped out of the ceiling change deliberately: every mechanism here
keys on `maxTotalEventBytes`, which does not exist in `packages/shared/src`
until `bound-event-store-by-bytes` merges, so none of it could be implemented or
tested there.

## What Changes

- **Coupling guard.** A pure shared helper warns when the store budget,
  converted to heap, cannot fit under the server ceiling. Non-blocking; the
  value stays saveable. Surfaced on both the Server heap field and the Memory
  Limits budget field — both already live on the Server settings page.
- **Ordering invariant.** A build-time assertion ties the lowered server default
  to the presence *and boundedness* of `maxTotalEventBytes`, so the inversion
  cannot ship. Presence alone is insufficient: a default of `0` is the exact
  guaranteed-OOM case.
- **Three launch paths, not two.** The Electron path gains the heap stamp it has
  never had.
- **The ceiling survives a restart.** `restart-helper.ts` re-stamps the
  configured ceiling onto the respawn, so `/api/restart` stops silently
  reverting every launch path to the runtime default.
- **Terminal strip.** Dashboard terminals stop carrying the dashboard's *own*
  stamped old-space token, identified by the sibling's provenance marker rather
  than by sniffing the flag; any operator-set flag is preserved verbatim.

### Shared constants

The guard, its tests and any future re-derivation read one source rather than
re-deriving the factors:

| constant | value | origin |
|---|---|---|
| `HEAP_MB_PER_BUDGET_MIB` | `1.33` | 768 MiB of serialized budget ≈ 1 GiB of heap |
| `BASELINE_MB` | `112` | 798 MB live set − 686 MB strings, heap snapshot |
| `CRASH_RATIO` | `0.82` | OOM at ~1000 MB of a 1216 MB limit, measured |

The multiplier is **per MiB of budget, not per byte** — `maxTotalEventBytes` is
byte-denominated on the wire, so the guard divides by `1024²` before applying
it. A name ending in `_BYTE` invited exactly the ×2²⁰ error no pinned scenario
would have caught.

`BASELINE_MB` is a single-host figure and the other heap consumers (session
index, WS buffers, terminal/diff state) scale with workload, so the guard is a
tripwire, not a proof of fit.

## Impact

- **Depends on:** `bound-event-store-by-bytes` (provides `maxTotalEventBytes`)
  and `bound-session-heap-and-gc-telemetry` (provides the lowered default and
  the server-side telemetry). Landing before either is a no-op at best.
- `packages/shared/src` — the three constants, the guard helper, the invariant.
- `packages/client/src/components/settings/SettingsPanel.tsx` — the warning on
  two fields, plus i18n keys in every locale file.
- `packages/electron/src/lib/launch-source.ts` — the missing stamp.
- `packages/server/src/spawn-process/restart-helper.ts` — the restart re-stamp.
- `packages/server/src/terminal/terminal-manager.ts` — the strip.

**Not in scope — the sibling already owns it:** consolidating the server-heap
default. `bound-session-heap-and-gc-telemetry` D8 has `bin/pi-dashboard.mjs`
parse `config.json` itself (it runs pre-jiti and cannot import TypeScript) and
its task 8.5 asserts the wrapper literal against the shared config default. This
change *reads* that default rather than re-consolidating it; it only pins the
browser-safe split the client-side guard forces, since the panel needs the
ceiling as a **value** and `config.ts` imports `node:*` at module scope.

**Behaviour change worth stating:** the inherited-`8192` terminal headroom holds
only on the **standalone-wrapper** path — the bridge stamp is dead code (sibling
D5a: `launchServer` passes no env, so `buildSpawnEnv` never runs) and the
Electron path never stamped at all. On that one path, Node tooling in a terminal
has ~8 GB of headroom today; after the strip it falls back to the runtime
default, lower still on small-memory hosts where V8 scales its default down.
Heavy builds run inside a dashboard terminal could newly OOM. The alternative is
leaving every terminal grandchild silently capped at the dashboard's ceiling.

## Discipline Skills

- `security-hardening` — not triggered: no auth, secrets, PII or untrusted input
  in this change.
- `performance-optimization` — the guard arithmetic runs on settings edits, not
  on a hot path; no latency budget applies.
- `observability-instrumentation` — the telemetry this guard reads is built by
  `bound-session-heap-and-gc-telemetry`; nothing new is instrumented here.
- `doubt-driven-review` — applies to the invariant, which is irreversible in the
  sense that shipping it wrong blocks every build.
- `review-code` — standard pre-commit review once the tests pass.
