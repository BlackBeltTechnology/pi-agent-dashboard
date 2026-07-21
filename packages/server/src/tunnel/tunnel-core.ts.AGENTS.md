# tunnel-core.ts — index

Provider-neutral child-tunnel lifecycle. Exports `ChildTunnelRuntime` (PID helpers, spawn→timeout→retry→URL-match state machine, `cleanupStale`, `scavengeOrphans`, `createTunnel`/`deleteTunnel`/`getTunnelUrl`) + `ChildProviderSpec` interface (binary, buildArgs, urlRegex, optional `normalizeUrl` post-match hook — e.g. prepend scheme to a bare host, reserve/release, markers, toEndpoints). Daemon providers skip this entirely (`kind==='daemon'`). See change: add-tunnel-providers.
