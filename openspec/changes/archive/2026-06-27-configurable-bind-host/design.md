## Context

Issue #48 asks for a loopback default. Three listeners exist today with inconsistent binding:

| Listener | Current bind | File |
|---|---|---|
| HTTP (fastify) | `0.0.0.0` (explicit) | `server.ts` `fastify.listen` |
| pi gateway (ws) | all interfaces (host omitted) | `pi-gateway.ts` `new WebSocketServer({ port })` |
| model-proxy 2nd port | `127.0.0.1` (explicit) | `server.ts` proxy block |

The app already enforces trust at request time (loopback + `resolvedTrustedNetworks` + optional `auth.secret` cookie) in the `onRequest` hook and the WS-upgrade guard. Binding loopback is **defense-in-depth**, not the only line of defense — it removes the port from the wire so a guard regression cannot leak.

## Goals

- Loopback default for HTTP + pi gateway.
- Single resolution chain identical in shape to the existing `port`/`piPort` chain — no new config idiom.
- One knob (`bindHost`) for both primary listeners; they share a trust boundary.
- Reachable Docker/remote via env var, not a code special-case.

## Decisions

### One `bindHost` for HTTP + pi gateway, not per-listener
Both serve the same clients across the same trust boundary; splitting them invites a footgun where one is loopback and the other is exposed (the exact inconsistency that exists today). The model-proxy second port stays hardcoded `127.0.0.1`: it is an SDK-local convenience already loopback, and exposing it has no use case. A future per-listener override can layer on if a need appears; not now (simplicity).

### Resolution precedence mirrors `port`
```
  --host <ip>          (CLI, one-off, highest)
    ?? PI_DASHBOARD_HOST    (env, deployment-level — Docker)
    ?? config.bindHost      (config.json, persistent per-user via Settings UI)
    ?? "127.0.0.1"          (hardcoded safe default, lowest)
```
This is the `buildConfig()` pattern already used for `port` and `piPort`. No validation framework added — an invalid host string surfaces as a normal `listen` EADDRNOTAVAIL at startup, same as a bad port.

### `bindHost` is restart-required
A listening socket cannot rebind. `config-api.ts` already models this with `RESTART_FIELDS = {"port","piPort"}`; add `"bindHost"`. The Settings UI reuses the existing restart-required banner. No hot-rebind logic.

### Settings UI is a 3-way picker, not free text
```
  ○ Local only          127.0.0.1     ← default
  ○ All interfaces      0.0.0.0       ← warns when no auth + no trusted nets
  ○ Specific interface  [ NIC ▼ ]     ← options from GET /api/network-interfaces
```
A constrained picker prevents typos and makes the security decision legible. `GET /api/network-interfaces` already exists (feeds the "Add Local Network" button) — reuse it for the NIC dropdown. The warning is advisory copy only; it does not change guard behavior.

### Docker opts into exposure explicitly
The all-in-one image must be reachable from outside its loopback, so `docker/compose.yml` / `.env.example` set `PI_DASHBOARD_HOST=0.0.0.0`. This inverts today's implicit-exposure-for-everyone into explicit-exposure-for-containers. Electron local mode inherits the loopback default and keeps working unchanged.

## Risks / Trade-offs

- **Breaking change for anyone relying on LAN reach of a native install.** Mitigated: documented in CHANGELOG + Settings picker + env var. The set of users who intentionally hit a native dashboard over the LAN without a tunnel is small; zrok tunnel users are unaffected (zrok proxies to localhost).
- **Docker regression if env var missed.** Mitigated: set in committed compose + `.env.example`; an E2E health check against the container catches a missed binding.
- **pi-gateway signature change** (`start(port)` → `start(port, host)`). Internal, single caller; update the call site and the `PiGateway` interface.

## Open Questions

- Should `bindHost` accept a comma list for multi-interface binding? Defer — no demand; Node `listen` is single-host. Out of scope.
- Surface the effective bind host in `GET /api/health` for diagnostics? Reasonable add; track as a follow-up task, not a blocker.
