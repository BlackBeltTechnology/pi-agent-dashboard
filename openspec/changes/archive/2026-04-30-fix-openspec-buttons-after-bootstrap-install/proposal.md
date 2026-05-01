## Why

When the dashboard server starts on a fresh machine and runs the degraded-mode bootstrap install (`pi-coding-agent` + `openspec` + `tsx` into `~/.pi-dashboard/`), the OpenSpec session-card buttons (`P/D/T/S` artifact letters, refresh, attach) never appear until the user manually reloads the dashboard or the server is restarted. The install succeeds, the bootstrap state flips to `"ready"`, but every directory's cached `OpenSpecData` stays at `{ initialized: false, changes: [] }` because the `ToolRegistry` cached `{ ok: false, path: null }` Resolutions for `openspec` (and `tsx`) at boot — and the post-install `rescan` only invalidates `pi`, leaving every subsequent `openspec list` call short-circuited to `not-found`. The exact same gap exists in the `triggerUpgradePi` / `triggerRetry` REST callbacks (no rescan at all). The `unified-bootstrap-install` spec's task 4.3 originally read "registry rescan" with no name; the implementation narrowed it to `rescan("pi")`, breaking the contract.

## What Changes

- `bootstrap-install` capability gains a new requirement: on every `installing → ready` transition, the server SHALL invalidate the entire `ToolRegistry` cache (not just `pi`).
- `server-openspec-polling` capability gains a new requirement: on every `installing → ready` transition, the server SHALL force-refresh OpenSpec data for every known directory and broadcast `openspec_update` so session-card buttons populate without waiting for the next poll tick (up to 30 s).
- The post-install rescan + force-refresh logic is centralized in `server.ts`'s existing `bootstrapState.subscribe` callback so all three callers (`runDegradedModeBootstrap` in cli.ts, `triggerUpgradePi`, `triggerRetry`) get the fix uniformly. The narrow `rescan("pi")` block in `cli.ts` is removed (becomes redundant).
- Force-refresh on this specific transition is bounded by the existing `maxConcurrentSpawns` semaphore — same load profile as the user-clicked refresh button, fired once per first-run, not periodically.

## Capabilities

### New Capabilities
<!-- none — this change refines existing requirements only -->

### Modified Capabilities
- `bootstrap-install`: post-install rescan SHALL cover the entire registry, not only `pi`.
- `server-openspec-polling`: a new "post-bootstrap-install force-refresh" requirement triggers an immediate force-refresh of every known directory on the `installing → ready` transition.

## Impact

- **Code**: `packages/server/src/server.ts` (subscribe callback gains rescan + force-refresh + broadcast); `packages/server/src/cli.ts` (drops local `rescan("pi")` — now redundant).
- **Tests**: new unit tests in `packages/server/src/__tests__/` covering (a) registry rescan fires once on `installing → ready`, never on other transitions; (b) directory-service `refreshOpenSpec` is invoked for every known cwd and broadcasts on change.
- **APIs / protocol**: no changes. Existing `openspec_update` broadcast is reused.
- **Config**: no changes.
- **User-visible**: OpenSpec buttons appear within ~1 second of the bootstrap install completing instead of "after manual reload" / "after up-to-30 s wait".
- **Risk**: bounded — the force-refresh is one-shot per `installing → ready` transition, semaphore-capped, and matches the load profile the `optimize-openspec-poll-burst` spec already accepts for the user-click refresh path.
