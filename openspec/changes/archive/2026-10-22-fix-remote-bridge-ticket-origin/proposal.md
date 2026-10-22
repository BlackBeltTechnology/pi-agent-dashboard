# Proposal

## Why

A remote bridge can never connect. It sends every HTTP call (bridge ticket
mint, server identity challenge, pi-trust live query) to an origin derived from
its WebSocket endpoint by swapping `ws:`→`http:` and keeping host **and port**.
That endpoint (`PI_DASHBOARD_URL`) is the pi gateway port (default `9999`), not
the dashboard HTTP port (default `8000`). The gateway is a bare WebSocket server
and answers `426 Upgrade Required`, so the mint fails, the bridge logs
`bridge ticket refused … the bearer may be unpaired or revoked`, and retries
forever. The operator is pointed at pairing when the real fault is the address.
Every remote bridge has been unable to connect since bridge tickets became
mandatory (`add-pi-gateway-transport-identity`, #534). Unit fixtures and E2E
specs did not catch it: unit fixtures use one port for both roles, and E2E
specs mint tickets themselves from the HTTP port.

## What Changes

- New shared resolver for a remote bridge's **dashboard HTTP origin**:
  1. `PI_DASHBOARD_HTTP_URL` (new env, explicit, pinned): its origin wins for
     endpoints on the operator's own hosts, meaning the host of
     `PI_DASHBOARD_URL` or of the override itself. A re-targeted bridge never
     carries it to another host. An unusable value fails closed for every
     endpoint, with a named cause and no fallback.
  2. Otherwise, for a plaintext `ws://host:<port>` endpoint: the same host,
     with the HTTP port taken from `PI_DASHBOARD_PORT` / `DASHBOARD_PORT`,
     else `8000`.
  3. `wss://` endpoints (the gateway has no TLS, so a proxy always fronts
     them) and port-less `ws://` keep their origin, as today.
- All three remote HTTP call sites use the resolver: bridge ticket mint
  (`bridge.ts` `prepareRemoteUpgrade`), server identity challenge
  (`remote-registration-gate.ts` `gateRemoteRegistration`, called from
  `bridge-handlers/lifecycle.ts`), pi-trust live query
  (`project-trust-live.ts` `prepareRequest`, constructed in
  `bridge-handlers/lifecycle.ts`). `httpBaseUrlFor` is deleted.
- Ticket-mint failures say where they went: only `401`/`403` report `refused`
  (a credential problem). Any other non-2xx (including `426`) reports a new
  `wrong-origin` cause. Its reason names the URL tried and the origin source,
  and says to set `PI_DASHBOARD_HTTP_URL` or, if the URL is already right, to
  check the server log.
- The bridge logs the resolved HTTP origin, and its source, next to the
  existing endpoint line.
- Fixtures model the real topology: gateway port ≠ HTTP port.
- Docs: `PI_DASHBOARD_HTTP_URL` in README, `docs/faq.md`, `docker/README.md`.

Narrow **BREAKING**: a plaintext `ws://host:<port>` reverse proxy serving both
`/api` and the bridge path on that one non-default port now needs
`PI_DASHBOARD_HTTP_URL`. The direct gateway topology, the documented one,
never worked and now does. `wss://`, port-less endpoints and local bridges
(unix socket, loopback) are unchanged.

## Capabilities

### New Capabilities
- none

### Modified Capabilities
- `pi-gateway-auth`: adds a requirement that a remote bridge sends its HTTP
  credential calls to the dashboard's HTTP origin, not the gateway origin, and
  reports a wrong-origin failure distinctly from a refused credential.

## Impact

- Code: `packages/extension/src/remote-registration-gate.ts`, `bridge.ts`,
  `bridge-handlers/lifecycle.ts`, `project-trust-live.ts`,
  `bridge-ticket-client.ts`. A new resolver module in `packages/extension/src/`.
  Tests: `__tests__/remote-registration-gate.test.ts` (its `httpBaseUrlFor`
  cases migrate), `__tests__/bridge-ticket-client.test.ts`, and the remote
  live-query fixtures in `packages/extension/src/__tests__/project-trust.test.ts`
  and `packages/server/src/__tests__/pi-trust-live-integration.test.ts`. Ports come from `resolveDashboardPorts` in
  `packages/shared/src/config.ts`.
- Server: no change.
- Env: new optional `PI_DASHBOARD_HTTP_URL` (bridge side).
- Compatibility: see the narrow BREAKING note above. On a bridge machine that
  runs its own dashboard, a local `PI_DASHBOARD_PORT` would be borrowed for the
  remote HTTP port. The docs advise `PI_DASHBOARD_HTTP_URL` for that case.
- Rollback: revert the extension commit and `npm run reload`. No persisted
  state or migration.

## Discipline Skills

- `security-hardening`: the resolver decides which host receives the durable
  paired-device bearer.
- `observability-instrumentation`: new wrong-origin cause, and the resolved
  origin is logged.
- `doubt-driven-review`: run in planning (fallback-heuristic trade-off).
