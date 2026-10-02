# server-restart — delta

## REMOVED Requirements

### Requirement: A changed server heap ceiling requires a cold start
**Reason**: The restart respawn now re-reads `serverHeap.maxOldSpaceMb` from configuration and re-stamps it through the provenance-aware `stampHeapFlag`, so an in-place restart applies a changed ceiling (design D5). Superseded by `server-launch` "A restarted server SHALL keep the configured ceiling".
**Migration**: None for operators — a `serverHeap` edit now takes effect on `/api/restart` instead of requiring a full stop/start. The config write reports it as `restartRequired`; `coldStartRequired` is no longer emitted.
