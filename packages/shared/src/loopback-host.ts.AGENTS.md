# loopback-host.ts — index

`isLoopbackHost(host)`, `isLoopbackEndpoint(url)`. One loopback predicate (localhost, 127/8, ::1, ::ffff:127.x, bracketed ok). Bridge `isRemoteBridge` and server admission share it; never disagree. See change: mirror-dashboard-trust-live-remote.
