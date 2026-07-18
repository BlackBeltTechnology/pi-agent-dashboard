# DOX — packages/server/src/tunnel

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `tunnel-block-events.ts` | `BlockEventBuffer` (+ `blockEvents` singleton) — bounded, anti-poisoning ring buffer of network-guard… → see `tunnel-block-events.ts.AGENTS.md` |
| `tunnel-core.ts` | Provider-neutral child-tunnel lifecycle. Exports `ChildTunnelRuntime` (PID helpers,… `processMarker: string\|RegExp` (regex-aware scavenge matcher); crash-exit retry guards `!callerProvidedToken` (reserved name re-served, never released). See change: support-zrok-v2. → see `tunnel-core.ts.AGENTS.md` |
| `tunnel-endpoints.ts` | "Accessible at" enumeration — `collectEndpoints` merges provider endpoints + manual `pairing.publicBaseUrls`… → see `tunnel-endpoints.ts.AGENTS.md` |
| `tunnel-enroll.ts` | Whitelisted `(provider,step)` enroll executor — `runEnrollStep`, `ENROLL_STEPS`, `isEnrollStepWhitelisted`. v2: zrok recipe resolves `zrok2`\|`zrok` lazily + appends `--headless`; `zrokToken` min length 8 (was 20). See change: support-zrok-v2. → see `tunnel-enroll.ts.AGENTS.md` |
| `tunnel-watchdog.ts` | Tunnel watchdog. Probes `${publicUrl}/api/health` on `intervalMs` (default 60000); 5xx/network/timeout count… → see `tunnel-watchdog.ts.AGENTS.md` |
| `tunnel.ts` | Tunnel ("Gateway") integration — thin delegation layer over `tunnel-core.ts` + `tunnel-providers/zrok.ts`… re-exports `ensureReservedName`/`mintReservedName` for the connect path. See change: support-zrok-v2. → see `tunnel.ts.AGENTS.md` |
