## Why

The automation plugin re-armed **every** automation config watcher on a 2-second
timer. `attachWatchers()` called `watcher.detachAll()` and then re-attached one
recursive `fs.watch` per scope base:

```ts
function attachWatchers(): void {
  watcher.detachAll();
  for (const s of listScopes()) watcher.attach(s.base);
}
```

On a machine with ~300 workspace folders that is ~300 recursive FSEvents handles
closed and reopened **every 2 s**, forever, with no configuration change to
justify a single one of them. Steady state — the overwhelmingly common case,
where the folder set has not changed at all — paid the full teardown/rebuild
cost.

This surfaced during a server memory-leak investigation (RSS growth ending in a
4 GB crash). Measured live, the fix cuts re-arm cycles **7×** (54 → 8 per
120 s) and removes the constant FSEvents/CPU churn.

**It is not the memory leak.** With the fix in place RSS still grew ~276 MB over
the same window; growth tracks active-session event ingestion, not the re-arm
timer. That investigation stays open. This proposal claims only what was
measured: the churn is gone.

## What Changes

- **Reconcile the watcher set incrementally.** New exported
  `reconcileWatchers(watcher, wantBases)` detaches bases no longer wanted and
  attaches newly-wanted ones. When the wanted set equals the attached set the
  call is a **no-op** — no handle is closed and reopened.
- **Expose the attached set.** `AutomationWatcher` gains `attachedBases(): string[]`
  so the reconcile can diff without owning the watcher's internals.
- **Lengthen the rescan debounce 2 s → 15 s** (`RESCAN_DEBOUNCE_MS`). The
  reconcile is now near-free in steady state, so the only remaining per-tick
  work is the scope re-scan. A newly added folder arming its automations within
  15 s instead of 2 s is operationally negligible; keeping the scan off the hot
  activity path is not.

Behaviour that does **not** change: which paths are watched, the artifact filter
(`<name>/automation.yaml` | `<name>/prompt.md`), the 300 ms change debounce,
degrade-on-`fs.watch`-failure semantics, and the eventual re-arm of an edited
automation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `automation-trigger-registry`: add `Requirement: Config watchers reconcile incrementally`.
  The existing re-arm-on-config-change requirement is unchanged — this states the
  cost bound it always assumed: watchers are rebuilt when the *folder set* changes,
  not on a wall-clock tick.

## Non-Goals

- **Finding the server memory leak.** Open, separate, and not resolvable from this
  change. See the note in Why.
- **Replacing `fs.watch` with a different watch strategy** (chokidar, polling,
  a single watcher with path prefix routing). Larger surface, no measured need.
- **Re-arming a silently-stalled `fs.watch` handle.** The old 2 s detach-all/
  re-attach-all cycle incidentally healed a handle that stopped delivering events
  without emitting `error` (FSEvents-after-sleep, inotify exhaustion). The
  steady-state no-op removes that accidental self-heal. Consciously accepted:
  the stall mode is unobserved in this codebase, and paying ~300 handle rebuilds
  every 2 s as an unmeasured insurance premium is what this change exists to
  stop. A watch-liveness probe or a low-frequency forced re-arm is the follow-up
  if the mode is ever observed.
- **The identical pattern in `openspec-change-watcher.ts`**, which this module was
  cloned from. It is already guarded against re-attach and is a bounded one-time
  cost — mentioned, not touched.

## Impact

- `packages/automation-plugin/src/server/automation-watcher.ts` — `attachedBases()`
  on the interface + implementation; new exported `reconcileWatchers()`.
- `packages/automation-plugin/src/server/index.ts` — `attachWatchers()` delegates
  to `reconcileWatchers()`; `RESCAN_DEBOUNCE_MS = 15_000` replaces the inline `2000`.
- `packages/automation-plugin/src/__tests__/automation-watcher.test.ts` — 3 tests:
  `attachedBases()` reflects the attached set; reconcile attaches new / detaches
  removed; **repeated reconcile in steady state performs no detach** (the regression
  guard for this exact bug).
- `openspec/specs/automation-trigger-registry/spec.md` — added requirement (via delta).
- No client, shared-protocol, persistence, or config-format changes. No breaking changes.

## Discipline Skills

- `performance-optimization` — the change is a measured churn reduction; the 7×
  re-arm-rate drop was verified against the running server, not assumed.
- `systematic-debugging` — this fix came out of a leak hunt whose original
  hypothesis was **wrong**; the proposal deliberately separates what was measured
  from what was inferred.
- `review-code` — touches shared server-plugin lifecycle wiring.
