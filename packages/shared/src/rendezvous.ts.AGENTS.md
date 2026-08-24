# rendezvous.ts — index

HOME-derived rendezvous: how a bridge learns where its dashboard is WITHOUT asking the network (D0).

## Exports

- `getRendezvousRecordPath(env)` → `<configDir>/server.lock.meta.json`, written by the lock HOLDER only.
- `readRendezvousRecord(env)` → `{piPort, httpPort, pid, instanceId}` or `null`. Absent, truncated and malformed all collapse to `null` — a partial record is never partially trusted (D15).
- `rendezvousEndpoint(env)` → `{endpoint, instanceId}` or `null`. POSIX resolves the per-instance UDS path; Windows and the `sun_path` fallback resolve `ws://127.0.0.1:<piPort>` (D6, D15).

`null` means "no local dashboard", NEVER "ask the network" — that substitution is the hijack.

Tests: `__tests__/rendezvous.test.ts`. See change: add-pi-gateway-transport-identity.
