# launch-source-effective.ts — index

`computeEffectiveLaunchSource({raw, activeBridgeCount, uptimeMs})` → `LaunchSourceEffective` (`electron\|standalone\|bridge\|bridge-orphaned`). Promotes `bridge`→`bridge-orphaned` when 0 bridges AND uptime > `BRIDGE_ORPHAN_GRACE_MS` (30_000; absorbs restart→reconnect race); else returns `raw`. Pure; static `launchSource` left untouched for `decideShutdownOnQuit` back-compat. See change: electron-attach-ownership-fixes.
