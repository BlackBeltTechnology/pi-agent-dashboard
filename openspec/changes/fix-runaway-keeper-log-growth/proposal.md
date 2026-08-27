## Why

`~/.pi/dashboard/sessions` is **17 GB** on a normal developer machine. Measured breakdown:

| | |
|---|---|
| `keeper-a76e4913-….log` | **12.3 GB** (single file, last written 2026-08-13) |
| `keeper-bfad2bee-….log` | 2.9 GB |
| `keeper-ecd98cfc-….log` | 2.3 GB |
| `keeper-b03b08c2-….log` | 18.8 MB |
| all 2 762 remaining non-keeper files, combined | **0.1 MB** |

Three files account for ~99.9 % of the directory.

The cause is understood and half-mitigated. `keeper.cjs` opens its log append-only:

```js
logFd = fs.openSync(logPath, "a");
```

There is **no rotation and no size cap** — ever. When `capturePiOutput` is enabled, pi's entire stdout/stderr is redirected into that same fd (`stdio: ["pipe", logFd, logFd]`). The code comments already name the hazard:

> *"Default OFF: pi's output is discarded (stdio "ignore" → /dev/null) so the log can't balloon to GB."*

That mitigation (`add-keeper-output-capture-toggle`) stops the *default* path from ballooning, and `capturePiOutput` is indeed `false` in the config on the measured machine. But it leaves two live problems:

1. **Nothing reclaims what already exists.** 17 GB of dead residue from before the toggle, with no cleanup path. It is simply lost disk until someone finds it by hand — which is how this was found.
2. **The hazard is still reachable.** `capturePiOutput` is a supported, documented, user-settable option. Anyone who turns it on — exactly the user who is debugging and most needs the dashboard to behave — re-enters unbounded growth. A default is not a bound.

The project already has the right pattern in-tree: `model-proxy/request-log.ts` rotates at 50 MB to a dated suffix. The keeper log simply does not use it.

## What Changes

- **Bound the keeper log.** A size cap enforced by in-place truncation, with no retained generation (see `design.md` D1/D2 — the `request-log.ts` rename+generation pattern is unsafe here, and a copy step stalls the RPC path). Applies whether or not `capturePiOutput` is on — the keeper's own lifecycle lines are unbounded today too, merely slower.
- **Rotation must be safe for a redirected fd.** `stdio: [_, logFd, logFd]` hands the raw descriptor to a child process, so naive rename-and-reopen leaves pi writing into the old inode. The rotation strategy has to account for this; it is the non-obvious part of the change and the reason this is not a two-line fix.
- **The cap is a config knob, not a literal.** `config.keeperLog` gains `maxBytes` / `checkIntervalMs`, plumbed to the CJS keeper as env vars via the existing `capturePiOutput` path, so the keeper and the server sweep share one source of truth.
- **Reclaim existing residue.** A bounded startup sweep that reports and reclaims oversized pre-existing keeper logs — by **truncating**, never unlinking (see `design.md` D5: no available liveness predicate can prove nobody holds the fd, and an unlinked-but-written inode is worse than the bug).
- **Surface the growth.** Keeper-log size becomes observable in `/api/health` alongside `storeTrim`, including a `runawayFiles` signal for "rotation is not working here" — the keeper is a separate process and cannot report a failed truncation itself.

Not in scope: changing what the keeper logs, changing the `capturePiOutput` default, or altering keeper lifecycle and discovery.

## Capabilities

### Modified Capabilities

- `rpc-keeper-sidecar`: the keeper log gains a defined growth bound, a rotation contract that is correct while the descriptor is shared with a child process, and a retention policy.

### New Capabilities

- `keeper-log-maintenance`: reclaiming pre-existing oversized logs — liveness checks before reclaiming, what is reported, and the guarantee that a live session's log is never removed underneath it.

## Impact

- `packages/server/src/rpc-keeper/keeper.cjs` — rotation at the write path and at the `stdio` handoff. CJS-pure; this constraint is deliberate and must hold.
- `packages/server/src/rpc-keeper/keeper-manager.ts` — the sweep, and surfacing size.
- `packages/server/src/routes/system-routes.ts` — health/telemetry exposure.
- `packages/shared/src/config.ts` — `keeperLog.maxBytes` / `keeperLog.checkIntervalMs`, additive with defaults.
- **Data loss**: rotation discards the whole preceding window by design (no generation is retained). Nothing else reads these files programmatically (they are a human debugging aid); the 128 MiB cap is set so the surviving window stays useful for the debugging session that motivated enabling capture in the first place.
- **Cross-platform**: Windows cannot rename an open file the way POSIX can. The rotation strategy must work on both, or degrade explicitly rather than silently failing to rotate on one platform.

## Discipline Skills

- `systematic-debugging` — a shared, inherited file descriptor across a process boundary is precisely the setting where a plausible-looking rotation silently does nothing. Evidence that rotation actually took effect, not just that the code ran.
- `observability-instrumentation` — the whole point is that 17 GB accumulated invisibly. The fix is not complete until growth is legible.
- `review-code` — touches the CJS keeper, which has hard constraints and its own lifecycle contract.
- `doubt-driven-review` — reclaiming files is irreversible; the liveness check that protects an active session's log deserves stress-testing before it stands.
