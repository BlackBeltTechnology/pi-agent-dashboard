# recovery-timing.ts — index

The two cold-start recovery windows in one module so their relation is testable. `RESTART_QUIESCE_MS` (5000), `RECONNECT_HEADROOM_MS` (2000), `RECOVERY_REATTACH_GRACE_MS` = quiesce + headroom. Grace MUST outlast quiesce or bridge-reattach retraction can never fire on the restart path. See change: fix-recovery-exit-intent.
