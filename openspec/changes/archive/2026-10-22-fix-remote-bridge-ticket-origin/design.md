# Design — fix-remote-bridge-ticket-origin

## Context

Two listeners, two ports:

| Listener | Default port | Serves | Code |
|---|---|---|---|
| Dashboard HTTP (Fastify) | `8000` | `/api/*`, browser `/ws` | `packages/server/src/server.ts` |
| Pi gateway | `9999` | bridge WebSocket only | `packages/server/src/pi/pi-gateway.ts:1165-1167` (`new WebSocketServer({ port, host, verifyClient })`) |

A remote bridge dials the gateway: `PI_DASHBOARD_URL=ws://host:9999`. The
codebase says this endpoint is not the HTTP port
(`packages/extension/src/command-handler.ts:1342`). The HTTP listener rejects
`/ws/bridge` upgrades with `400`, on purpose, so a ticket is never burned on
the wrong listener (`packages/server/src/server.ts:4642-4657`). A bridge
therefore has exactly one place to dial: the gateway.

Three remote HTTP calls derive their origin from that gateway endpoint through
`httpBaseUrlFor` (`packages/extension/src/remote-registration-gate.ts:34-43`:
swaps `ws:`→`http:`, keeps `u.host`, i.e. host **and port**):

| Call | Path | Site |
|---|---|---|
| Bridge ticket mint | `POST /api/ws-ticket` | `packages/extension/src/bridge.ts:1047-1057` → `bridge-ticket-client.ts:66` |
| Server identity challenge | `POST /api/pair/challenge` | `packages/extension/src/remote-registration-gate.ts:91` → `packages/shared/src/server-pinning.ts:144` |
| pi-trust live query | `POST /api/pi-trust/query` | `packages/extension/src/project-trust-live.ts:81` |

Measured: `POST /api/ws-ticket` against a bare `ws` `WebSocketServer({port})`
returns `426 "Upgrade Required"`. `bridge-ticket-client.ts:77-83` maps every
non-2xx to `cause: "refused"` with reason "the bearer may be unpaired or
revoked". `prepareRemoteUpgrade` throws, and `ConnectionManager` backs off and
re-mints forever (`bridge.ts:1037-1046`).

The local live query already does this right. It builds
`http://<localDialHost>:<cfg.port>` from the HTTP port
(`project-trust-live.ts:86-87`), not from the endpoint.

Why tests missed it:
- `packages/extension/src/__tests__/remote-registration-gate.test.ts:13,33` uses `ws://dash.example:8000` as the
  bridge endpoint (one port for both roles).
- The L3 helper `tests/e2e/helpers/bridge-credential.ts` mints the ticket
  itself from the harness HTTP port, so the extension's derivation never runs.

## Goals / Non-Goals

Goals:
- A remote bridge with a valid `PI_DASHBOARD_TOKEN` and the documented
  `PI_DASHBOARD_URL=ws://host:<gatewayPort>` connects, with no new setup on the
  default ports.
- One resolver feeds all three remote HTTP calls.
- A wrong origin is reported as a wrong origin, not as a credential refusal.

Non-goals:
- No server change. The gateway gains no HTTP routes (option C was rejected:
  it would add a bearer-authenticated surface to the gateway).
- No discovery protocol: no HTTP-port advertisement over the gateway or mDNS.
- Endpoint resolution (`endpoint-resolution.ts` ladder) is unchanged: which
  WebSocket endpoint is dialled stays as it is.
- Local bridges are unchanged.

## Decisions

### D1 — Resolver `resolveDashboardHttpOrigin(endpoint, env)`

New module `packages/extension/src/dashboard-http-origin.ts`. Pure:
`env` is an argument, never read from `process.env` inside the module. No
`import.meta`, no top-level `process.env` (jiti CJS transpile safety). Returns

```ts
type HttpOriginResult =
  | { ok: true; origin: string; source: "PI_DASHBOARD_HTTP_URL" | "endpoint-host+http-port" | "endpoint-origin" }
  | { ok: false; cause: "bad-http-url" | "no-http-origin"; reason: string };
```

Invoked **only for remote endpoints**. Every caller already gates on
`isRemoteEndpoint` or the live query's `remote` flag first (`bridge.ts:1048`,
`remote-registration-gate.ts:62`). So a bad override can never affect a local
(unix socket or loopback) bridge.

"Set" means non-empty after trim. An empty or whitespace-only
`PI_DASHBOARD_HTTP_URL` reads as unset, following the repo convention: an
empty `PI_DASHBOARD_SOCKET=` cancels the variable
(`packages/server/src/spawn-process/process-manager.ts:636-642`), and
`endpoint-resolution.ts` `present()` trims.

Precedence:
0. **Validate first.** If `env.PI_DASHBOARD_HTTP_URL` is set and non-empty but
   invalid (see step 1's rules), return `bad-http-url` **before any scope
   check**, for every endpoint. An unparseable value has no hostname to scope
   on, and ignoring it would silently override an explicit operator choice.
1. `env.PI_DASHBOARD_HTTP_URL` valid **and in scope for this endpoint**. In
   scope means the endpoint's `hostname` equals the hostname of
   `env.PI_DASHBOARD_URL` or of `PI_DASHBOARD_HTTP_URL` itself. Out-of-scope
   endpoints skip to step 2. Why: the resolver also runs for endpoints the
   operator did not pin. `credentialsFor` re-mints for every accepted
   re-target, such as an mDNS-discovered candidate
   (`packages/extension/src/bridge.ts:1205-1212`). The live query and identity
   gate read `inst.dashboardUrl` per call (`bridge-handlers/lifecycle.ts:213`,
   `:474-477`). Without the scope check, a bridge re-targeted to dashboard B
   would send A's bearer to A and present A's ticket to B's gateway. Steps 2
   and 3 keep the bearer on the endpoint's own host. Scope is by hostname, not
   `host:port`: a second dashboard on the same host would be misrouted (wrong
   port) but the bearer never crosses to another host. The `wrong-origin` cause
   surfaces that case.
   - Parses with `new URL`, protocol is `http:` or `https:`, and the URL has no
     credentials (`username`/`password` empty): `{ ok, origin: u.origin,
     source: "PI_DASHBOARD_HTTP_URL" }`. Path, query and fragment are ignored;
     only the origin is used.
   - Anything else: `{ ok: false, cause: "bad-http-url" }`. **No fallback.** An
     explicit operator choice is pinned, the same as `PI_DASHBOARD_URL`
     (`docs/architecture.md:6073-6084`, "Endpoint resolution ladder":
     PINNED = explicit human choice, nothing automatic replaces it). Silently replacing it would send the bearer
     somewhere the operator did not choose.
2. Endpoint is **plaintext `ws:` with an explicit port** (`u.port !== ""`):
   origin `http://${u.hostname}:${port}`, with `port`
   taken from `resolveDashboardPorts(env).port`
   (`packages/shared/src/config.ts:1626`; reads `PI_DASHBOARD_PORT` →
   `DASHBOARD_PORT` → `8000`). Source `endpoint-host+http-port`. **No
   `fileConfig` argument**: the bridge machine's `~/.pi/dashboard/config.json`
   describes its own local dashboard, not the remote one.
3. Endpoint is `wss:` (any port), or `ws:` without an explicit port:
   origin is the endpoint origin with the scheme swapped. Source
   `endpoint-origin`. `wss:` always lands here because the gateway has no TLS
   (a plain `new WebSocketServer({ port, host, verifyClient })`,
   `packages/server/src/pi/pi-gateway.ts:1164-1166`). So a `wss://` endpoint
   always has a TLS proxy in front, and that proxy decides `/api` routing.
   Example: `wss://dash:8443` with `/api` and the bridge path on one port keeps
   working as today. WHATWG URL normalises a scheme-default port away
   (`ws://h:80`, `wss://h:443` → `u.port === ""`), so those also land here.
   That is correct: a gateway is never published on 80/443 without a
   fronting proxy. Byte-identical to today's `httpBaseUrlFor` for this case.
4. Any other endpoint (unparseable, `ws+unix:`, other scheme):
   `{ ok: false, cause: "no-http-origin" }`.

IPv6: the endpoint origin is rebuilt from `u.hostname`, which keeps its
brackets in WHATWG URL (`[::1]`), so `http://[fd00::1]:8000` is formed
correctly. Covered by a test.

Rationale for step 2 over keeping the origin: an explicit-port plaintext
`ws://` endpoint is, in every shipped topology, the gateway listener directly.
The HTTP listener refuses bridge upgrades
(`packages/server/src/server.ts:4642-4657`), so a direct "same port for both"
setup cannot work. The one setup step 2 breaks is a plaintext reverse proxy
that multiplexes `/api` and the bridge path on one explicit non-default port.
It needs `PI_DASHBOARD_HTTP_URL` (narrow **BREAKING**, see proposal).

### D2 — All three call sites use D1; `httpBaseUrlFor` is removed

- `bridge.ts` `prepareRemoteUpgrade`: extracted from its closure into a
  testable factory, `createRemoteUpgradePreparer({ env, fetchImpl?, log,
  record })`, in a new module `packages/extension/src/remote-upgrade-preparer.ts`.
  It owns the D4 dedupe state. `bridge.ts` wires it with `process.env`,
  `console` and `transportDiagnostics.record`, so behaviour is unchanged apart
  from D2–D4. It resolves the origin, then mints. An
  `ok: false` result logs `[dashboard] bridge ticket <cause>: <reason>` and
  throws, the same as an existing mint failure (fail closed, retried on
  backoff).
  Today a null origin returns `undefined`, so there is no mint and the dial
  goes out without a ticket; that changes here to log-and-throw, on purpose.
  Both fail closed. The new form names the cause instead of surfacing as a
  bare gateway `401`.
- `remote-registration-gate.ts` `gateRemoteRegistration`: takes the origin from
  D1. On `ok: false` the gate refuses with the **D1 cause itself**
  (`bad-http-url` or `no-http-origin`, added to `GateCause`), not `unreachable`.
  A pinned bridge runs this gate before connecting
  (`bridge-handlers/lifecycle.ts:471-494`), so the gate is where an operator
  first sees a bad override. `GateInput` gains a required `env` field. The only production
  caller, `packages/extension/src/bridge-handlers/lifecycle.ts:474`, passes
  `process.env`. Required, not optional: an omitted `env` would silently drop
  `PI_DASHBOARD_HTTP_URL`.
- `project-trust-live.ts` `prepareRequest` (remote branch): origin from D1,
  read from `deps.env`. On `ok: false` it returns `{ early: { kind: "error" } }`,
  as it does today for a null base. Its constructor call at
  `bridge-handlers/lifecycle.ts:213` passes no `env` today, and `readDeviceToken`
  falls back to `process.env`. That call site gains `env: process.env`
  explicitly.
- `httpBaseUrlFor` is deleted. Its production callers are the three above
  (`rg httpBaseUrlFor packages/`). `packages/electron/resources/server/` also
  contains copies, but it is a gitignored build snapshot (`.gitignore:27`) and
  is not edited. Collateral:
  `packages/extension/src/__tests__/remote-registration-gate.test.ts:10,31-38`
  imports and tests it, so those cases migrate to resolver tests.
  `packages/extension/src/AGENTS.md:90` and
  `remote-registration-gate.ts.AGENTS.md` name it, so those rows are updated.
  The existing `gateRemoteRegistration` calls in that test gain the now-required
  `env`.
- Fixture collateral from step 2: these tests build a remote live query with
  endpoint `ws://127.0.0.1:<testHttpPort>` and would now resolve to `:8000`:
  `packages/extension/src/__tests__/project-trust.test.ts:592` and
  `packages/server/src/__tests__/pi-trust-live-integration.test.ts:117,142`.
  Each gains `PI_DASHBOARD_PORT: String(<testHttpPort>)` in its `env`. The
  intent is unchanged: those tests address the HTTP listener on purpose.

### D3 — Mint failure taxonomy in `bridge-ticket-client.ts`

| HTTP outcome | cause | reason names |
|---|---|---|
| network error | `unreachable` (unchanged) | URL tried |
| `401` / `403` | `refused` (unchanged wording) | bearer unpaired/revoked |
| any other non-2xx (`404`, `426`, `5xx`, …) | **`wrong-origin`** (new) | URL tried + status + origin source + "if this is not the dashboard's HTTP address set `PI_DASHBOARD_HTTP_URL`; if it is, check the server log" |
| 2xx, non-JSON / no ticket | `malformed` (unchanged) | — |

The mint passes `redirect: "error"`, as the live query already does
(`project-trust-live.ts:107`). Today `bridge-ticket-client.ts:66` follows
redirects by default. A same-origin 307/308 would re-send the bearer, and the
reason would name a URL the operator never configured. A redirect throws, and
the catch maps it to `wrong-origin` with the URL tried; real network errors
stay `unreachable`.

`5xx` counts as `wrong-origin`, not `refused`. A credential cannot cause it, and
naming the URL lets the operator tell "wrong host" from "server error". A
right-origin `400` (the route's "invalid scope", `packages/server/src/server.ts`
`/api/ws-ticket`) also lands here. The bridge always sends `scope: "bridge"`,
so that is not expected in practice, and the reason text's "if the URL is
right, check the server log" covers it.

### D4 — Observability

At endpoint resolution (`bridge.ts:1030-1035`), for a remote endpoint, emit one
more line through both channels, the console and
`transportDiagnostics.record`: `http origin <origin> (<source>)`, or the D1
failure cause. The origin can change after startup. `prepareRemoteUpgrade`
runs per dial and per accepted re-target (`credentialsFor`), so it emits the
same line whenever the resolved origin or source differs from the last one
emitted (dedupe on `origin|source`, so no per-retry spam). The live-query and
identity-gate resolver failures, which otherwise fail silently
(`{ early: { kind: "error" } }`), log once per distinct cause. The bearer is
never logged.

## Risks / Trade-offs

- **Bearer destination.** D1 decides which host receives `Authorization:
  Bearer <PI_DASHBOARD_TOKEN>`. Steps 2 and 3 keep the endpoint's hostname, so
  the bearer never leaves the host of the endpoint being dialled. Only step 1
  can name another host. Step 1 is the operator's explicit choice, scoped to
  the operator's own hosts (D1 step 1 scope check), so a re-target or move
  never carries it to a different host. Userinfo in `PI_DASHBOARD_HTTP_URL` is refused so
  no second credential rides along.
- **Plain HTTP.** For a `ws://` endpoint the bearer travels over plain `http://`.
  The chosen design keeps the existing transport class; it neither adds nor
  removes exposure.
- **Heuristic miss.** Gateway and HTTP on non-default ports without
  `PI_DASHBOARD_PORT` gives the `wrong-origin` cause. The reason names the URL,
  the origin source and the fix.
- **Local env-port ambiguity.** On a bridge machine that also runs its own
  dashboard, `PI_DASHBOARD_PORT`/`DASHBOARD_PORT` may describe that local
  dashboard, and step 2 would borrow it for the remote one. The host stays the
  endpoint's, so this misroutes but never leaks. The D4 log and the D3 reason
  name the origin source. Docs advise `PI_DASHBOARD_HTTP_URL` for this case.
- **Bearer on an unpinned re-target (pre-existing, not widened).** An
  unpinned remote bridge adopting an mDNS candidate re-mints for it
  (`bridge.ts:1205-1215`) after a health probe only
  (`bridge-handlers/lifecycle.ts:854-866`). That sends the bearer to the
  candidate's host before identity verification. That happens today too:
  `httpBaseUrlFor` sends it to the same host on the gateway port. This change
  only moves it to that host's HTTP port, so the exposure class is unchanged.
  The documented remote setup sets `PI_DASHBOARD_URL`, which is pinned and
  refuses every re-target (`bridge-handlers/lifecycle.ts:839-852`). Verifying
  identity before any bearer-backed request on a re-target is a follow-up,
  out of scope here.
- **Identity-challenge diagnostics.** `challengePinnedServer`
  (`packages/shared/src/server-pinning.ts:144`) keeps its generic non-2xx
  reason. The D4 origin log line is enough to diagnose it, so it is left
  unchanged to keep the shared module out of scope.
- **Out of scope: dashboard-spawned panes on a LAN gateway.** When the
  gateway's TCP host is a non-loopback address, a spawned pane's
  `PI_DASHBOARD_URL` (`packages/server/src/spawn-process/process-manager.ts:639-642`)
  classifies as remote and needs a device token it is never given. That gap
  exists today, is unrelated to the origin, and is not touched.
- **Identity challenge order.** The challenge also moves to the HTTP origin.
  That is the listener that holds the server key, so a correct origin is what
  makes the pin check meaningful (today it is sent to the gateway and fails).

## Migration / Compatibility / Rollback

- No persisted state, no server change, no protocol change.
- `wss:` endpoints, and `ws:` endpoints without an explicit port, behave as
  before.
- Remote bridges on a plaintext explicit-port gateway endpoint start working.
  That path could not work before.
- Narrow **BREAKING**: a plaintext `ws://host:<port>` reverse proxy that
  serves both `/api` and the bridge path on that same non-default port now
  needs `PI_DASHBOARD_HTTP_URL` (or `PI_DASHBOARD_PORT=<port>`).
- Rollback: revert the extension commit, then `npm run reload`.
