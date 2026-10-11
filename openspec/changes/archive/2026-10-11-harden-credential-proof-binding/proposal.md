## Why

An audit of the shipped `loopback-credential-proof` (#854) found four residual
defects that survive on `develop`:

1. **Spawn marker from the wrong host.** The spawner derives the spawned
   bridge's URL and enforcement marker from `config.host`, but the gateway's
   real TCP host comes from `decideGatewayListeners`: with no unix socket and no
   `PI_GATEWAY_TCP` it binds `127.0.0.1` whatever `config.host` says. On a
   Windows dashboard bound to a LAN address the spawned bridge gets
   `ws://localhost:<piPort>` and NO marker, so it accepts a squatter on `[::1]`.
   With `config.host = ::1` the bridge is marked for an address nothing listens on.
2. **The edge stamp is redefinable.** The verdict Symbol is defined
   `configurable: true, writable: true`; in-process code that obtains the Symbol
   can overwrite a verdict with `proof`.
3. **Proof floor taken too early.** `httpBoundAt` is set before `fastify.listen()`,
   which first awaits `ready()` (plugin boot, possibly seconds); a proof captured
   by the previous port holder during that window passes `before-start`.
4. **A DNS-name `config.host` breaks every proof call.** `localDialHost` passes a
   name through unchanged and `canonicalBinding` then throws, so CLI/Electron
   calls fail (Electron swallows it: the server is silently not stopped).

## What Changes

- The spawner is given the gateway's ACTUAL TCP host (`policy.tcp?.host`,
  defaulting to `127.0.0.1`; `localhost` keeps the legacy unmarked URL because it
  may bind only `::1`) instead of `config.host`.
- The verdict stamp is defined non-configurable and non-writable.
- The HTTP proof floor is taken after `fastify.ready()`, immediately before the
  bind, via one small helper that is unit-testable.
- `localDialHost` maps a DNS name to `127.0.0.1`, so a proof binding is always an
  IP literal.

No wire/format change; no config change; no migration. Rollback = revert.

## Capabilities

### Modified Capabilities

- `pi-gateway-auth`: three ADDED requirements (spawn endpoint tracks the
  gateway's real host; verdict immutable and floor after readiness; dial host is
  an IP literal).

## Impact

- Server: `server.ts` (spawn host, listen helper), `auth/local-credential.ts`
  (immutable stamp, `listenWithProofFloor`), `pi/gateway-transport-policy.ts`
  (`spawnDialHost`).
- Shared: `local-credential-proof.ts` (`localDialHost`).

## Discipline Skills

- `security-hardening` — the defects are credential/binding gaps; each fix is
  test-first.
