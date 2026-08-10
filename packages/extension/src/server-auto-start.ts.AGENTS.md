# server-auto-start.ts — index

Auto-start orchestration: discover dashboard via mDNS → health-check fallback → spawn server process. Exports `DiscoveredServer`, `AutoStartDeps`, `AutoStartResult`, `autoStartServer`. Honors `PI_DASHBOARD_NO_MDNS` opt-out gate, `shouldSuppressAutoStart` restart-quiesce hook, `onServerSpawned` PID exclusion callback, `onLaunchStart`/`onLaunchEnd` spinner hooks. Surfaces `getDashboardServerLogPath()` on launch failure.
