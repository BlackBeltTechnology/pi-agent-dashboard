# recovery-timing.ts — index

The two cold-start recovery windows in one module so their relation is testable. `RESTART_QUIESCE_MS` (5000), `RECONNECT_HEADROOM_MS` (2000), `RECOVERY_REATTACH_GRACE_MS` = quiesce + headroom. Grace MUST outlast quiesce or bridge-reattach retraction can never fire on the restart path. See change: fix-recovery-exit-intent.

Also owns `RECOVERY_SHUTDOWN_WINDOW_MS` (60_000): max |endedAt − boot exit `at`| for shutdown-window recovery; unrelated to quiesce/grace pair. See change: fix-recovery-pi-signal-unregister.

Also owns `SHUTDOWN_QUIESCE_MS` (60_000, moved from `routes/system-routes.ts`), `MAX_QUIESCE_MS` (120_000 hard cap on any bridge auto-start pause; must stay ≥ 2× the largest announced window) and `normalizeQuiesceMs(value: unknown)` (non-number/NaN/≤0 ⇒ `undefined`; fraction ⇒ ceil; `Infinity`/huge ⇒ clamp). See change: harden-bridge-inbound-and-discovery (D17).
