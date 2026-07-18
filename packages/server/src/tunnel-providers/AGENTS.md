# tunnel-providers

`TunnelProvider` implementations behind the `tunnel-core.ts` seam. One file per
provider. Child-model providers (zrok, ngrok) wrap `ChildTunnelRuntime`;
daemon-model providers (tailscale, zerotier) drive a long-lived daemon and skip
the PID/watchdog paths. See change: add-tunnel-providers.

| File | Purpose |
|------|---------|
| `ngrok.ts` | ngrok provider (child, public-only). Exports `ngrokChildSpec`, `ngrokRuntime`, `NgrokProvider`, `detectNgrokBinary`/`isNgrokEnrolled`/`ngrokConfigCandidates`/`_setNgrokBinaryAvailable`. No reserve step — reserved domain rides the runtime `reservedToken` slot → `--url https://<domain>`; URL parsed from `--log-format json` via `urlRegex`. Enrolled when an `ngrok.yml` carries `authtoken:`. See change: add-tunnel-providers. |
| `tailscale.ts` | Tailscale provider (DAEMON, both modes). Exports `TailscaleProvider` + pure helpers `parseTailscaleAuthUrl`/`isBackendRunning`/`checkFunnelGates`/`deriveEndpoints`, `CmdRunner` (injectable CLI runner for tests). connect: `serve --bg` (private) / `funnel --bg` (public, gated); URL from `tailscale serve status --json`; emits `magicdns`+`mesh` endpoints (funnel magicdns tls:true, serve tls only with 443 handler). disconnect = idempotent `serve reset`. Skips PID/watchdog. See change: add-tunnel-providers. |
| `zerotier.ts` | ZeroTier provider (DAEMON, PRIVATE-ONLY). Exports `ZeroTierProvider` + pure helpers `parseAssignedIpv4`/`isNetworkAuthorized`/`deriveMeshEndpoint`. No URL/public mode — only a no-TLS/no-name mesh IP (`http://<ip>:PORT`) → Link-QR-only, dropped by the pairing gate. connect=`join <netid>` (idempotent) + IP from `zerotier-cli -j listnetworks`; disconnect=destructive `leave`. Needs out-of-band controller authorization. Reuses Tailscale's `CmdRunner`. See change: add-tunnel-providers. |
| `zrok.ts` | zrok provider (child, public-only). Exports `zrokChildSpec`, `zrokRuntime`, `ZrokProvider`, plus `detectZrokBinary`/`loadZrokEnv`/`releaseShare`/`mintReservedName`/`ensureReservedName` (re-exported by `../tunnel.ts`). v2: dual binary `zrok2`→`zrok`; named-share verbs (`create name`/`share -n public:<name>`/`delete name`); `ensureReservedName` gates on `persistent` + DNS-safe validate; anchored spoof-safe `urlRegex`. See change: add-tunnel-providers, zrok-v2-quick-connect, support-zrok-v2. |
