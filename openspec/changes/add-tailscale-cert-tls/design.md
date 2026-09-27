## Context

See proposal.md — Why. Current state relevant to the approach:

- One Fastify instance (`server.ts` ~1331, `keepAliveTimeout: 30_000`, `connectionTimeout: 10_000`) bound by `fastify.listen({ port, host })`. WebSocket traffic is routed by a single `fastify.server.on("upgrade", …)` switch (~2944). `stop()` closes `secondFastify` then `fastify`.
- The model-proxy second port is a *separate*, loopback-only Fastify instance with its own gate — not a template here: the TLS listener must expose the full route set under the full guard chain.
- Request gate chain: host admission (`auth/host-admission.ts` — loopback, IP literal, bindHost, `.local`, `publicBaseUrls`, CORS origins, live-tunnel origins, `allowedHosts`) → universal network guard → auth. A `*.ts.net` name is not admitted today.
- Pairing: `PairingManager` is constructed with a `getReachableUrls` closure (`server.ts` ~460) = tunnel URL + `resolvePublicBaseUrls()`. It does **not** read `collectEndpoints()`; that function only feeds `GET /api/tunnel/endpoints`. `reachableUrls()` filters by scheme only.
- `DEFAULTS.bindHost` is `127.0.0.1`.
- `writeConfigPartial` (`config-api.ts`) shallow-merges top-level keys; nested blocks survive only via explicit per-key deep-merge branches.
- `/api/health` has no auth preHandler; topology-bearing fields are gated with `canDiscloseAccessPosture(request)` (authenticated or genuinely local).
- `TailscaleProvider` owns an injectable `CmdRunner`; the readiness `asyncRunner` defaults to a 4 s timeout. `deriveEndpoints()` tags `magicdns` `tls:true` in funnel mode always, and in serve mode only when serve terminates :443.

## Goals / Non-Goals

**Goals**
- One route table, one gate chain, one upgrade switch — served over two transports with identical server-level timeouts.
- A certificate lifecycle (issue, store, renew, single-flight, backoff, hot-swap) behind a `CertSource` interface rich enough that `add-acme-dns01-certs` plugs in without modifying this capability.
- Independence from the tunnel provider lifecycle (`serve reset` cannot break it).

**Non-Goals**
- Replacing or redirecting the main HTTP listener (no HTTP→HTTPS redirect, no HSTS).
- Absolute-URL minting that is port-aware of the TLS listener: `host.httpPort`, `servers_discovered`, and OAuth `resolveRedirectBase` keep deriving from the main port. Provider OAuth logins are done from the local machine; they are out of scope over the TLS listener.
- Binding privileged port 443 (operator may configure it; no privilege escalation).
- mTLS, local CA, self-signed certificates.

## Decisions

### D1 — Second `https.Server` dispatching into the existing Fastify instance
`https.createServer({ SNICallback }, …)`, then the main server's timeouts applied from one shared constant the same way Fastify applies them: `server.keepAliveTimeout = 30_000` and `server.setTimeout(10_000)` (Fastify's `connectionTimeout` is `server.setTimeout`, not a constructor option). Traffic is forwarded into the already-built app:
- `request` → `fastify.server.emit("request", req, res)` (verified: Fastify registers its `httpHandler` as the `'request'` listener), so hooks, host gate, network guard and routes all run.
- `upgrade` → the handler currently inlined in `fastify.server.on("upgrade", …)`, extracted to a named function and attached to both servers.

`request.protocol` reads `socket.encrypted` (no `trustProxy` configured), and the guard sees the real `remoteAddress`. `stop()` closes the TLS server (`closeAllConnections()`) alongside `secondFastify`/`fastify`.

*Alternatives:* (a) Fastify `https` option on the main instance — makes the main listener TLS-only, breaks localhost/bridge clients. (b) A second Fastify instance re-registering routes — duplicated registration and hooks, drift-prone. (c) Local reverse proxy → `http://127.0.0.1:port` — every request looks loopback, collapsing the network guard. Rejected.

### D2 — SNI map, deterministic, fail-closed
`TlsCertStore` holds `Map<name, { ctx: tls.SecureContext; meta }>`. `SNICallback`: exact name → single-label wildcard (`*.parent`, RFC 6125) → error (handshake fails). No SNI → the callback is not invoked and no default `cert`/`key` is configured, so the handshake fails. Swapping an entry is atomic; existing connections keep their context. Scope: new *full* handshakes; resumed sessions keep the prior certificate until their ticket expires (default Node ticket lifetime), which is acceptable because both certificates are valid.

### D3 — Certificate source interface + manager
```ts
interface CertSource {
  readonly id: string;                                // stable; tailscale → "tailscale"
  readonly type: "tailscale" | "acme";
  names(): Promise<string[]>;
  configFingerprint(name: string): string;            // hash of settings affecting THIS name's cert
  obtain(name: string, onStage: (stage: string) => void): Promise<ObtainedCert>;
  readiness(): Promise<{ gates: Gate[] }>;            // cached by the source; status never calls out
  onRemoved?(): Promise<void>;                        // source-owned cleanup outside <sourceId>/
}
interface Gate { id: string; ok: boolean; name?: string; hint?: string }   // name → name-scoped gate
interface ObtainedCert {
  certPem: string; keyPem: string;
  advertise: boolean;                                  // false → served, never enumerated/paired
  kind: "magicdns" | "domain";
  details?: Record<string, string | boolean>;          // source-declared, non-secret status fields
}
class RetryAfterError extends Error { retryAfterMs: number }   // source-imposed minimum delay
```
`CertManager`: on start, on reconcile, and every 12 h, per `(source, name)`: load from disk → `obtain()` if missing, < 1/3 validity left, **or `meta.fingerprint ≠ source.configFingerprint(name)`**. Reconcile also **prunes**: any held name no longer returned by its source's `names()` is dropped from the store and its files deleted. Single-flight is keyed `(sourceId, name)`; `trigger(sourceId, name?)` joins a running issuance or starts immediately, bypassing backoff — without `name` it triggers every due name of that source.

Ownership: source `id`s are unique across all sources (`"tailscale"` reserved for the tailscale type); a name is owned by the first source in `tls.sources` order that returns it — a later source returning the same name gets an unmet `name-conflict` gate for it and does not issue. Failures back off exponentially (5 min, doubling, cap 6 h), floored by `RetryAfterError.retryAfterMs`. Expiry read via `crypto.X509Certificate` (no dependency). `meta` (`source`, `fingerprint`, `advertise`, `kind`, `details`, `notAfter`, `stage`, `lastError`) persisted next to the PEMs in `meta.json`; a missing `fingerprint` (older meta) is adopted from the current source, not treated as a change. Removing a source deletes `~/.pi/dashboard/tls/<sourceId>/` and awaits `onRemoved()`.

### D4 — Tailscale source uses the CLI with its own timeout
`tailscale cert --cert-file <tmp> --key-file <tmp> <MagicDNSName>` into a `0700` temp dir under `~/.pi/dashboard/tls/`, then atomic rename; runner timeout 120 s (NOT the 4 s readiness default). MagicDNS name from `tailscale status --json` via the existing `selfDnsName()` helper (strips the trailing dot, so SNI keys and URLs match). The HTTPS-enabled check is one shared helper used by both this source and `checkFunnelGates` (so the two surfaces cannot disagree); spike 1.1 confirms which field (`CertDomains` vs `Self.CapMap`) is authoritative on current CLI versions. Unmet gate → `RetryAfterError(15 min)`; a `tls` config change or `trigger()` re-checks immediately.

### D5 — Endpoint emission and pairing wiring
One function `tlsListenerUrls(): TunnelEndpoint[]` — empty when the listener is not bound or its bind host is loopback; otherwise every held, unexpired, `advertise: true`, non-wildcard cert → `https://<name>[:port]`, `kind` from meta, `tls:true`. It feeds **both**:
- `collectEndpoints()` → `GET /api/tunnel/endpoints`;
- the `PairingManager` `getReachableUrls` closure in `server.ts` (new push next to tunnel URL + `publicBaseUrls`).
`reachableUrls()` still filters at read time; no gate relaxed. `EndpointKind` gains `domain` (client label: "Domain") for non-tailscale sources.

### D6 — Host admission and same-origin
Both option objects gain `tlsListenerNames: () => string[]` (held cert names; wildcard patterns matched single-label): `HostAdmissionOptions` (host gate, `getHostGateCtx()`) **and** `CorsOriginOptions` (built in `corsOpts()`, consumed by `isSameOriginByHost` for WS upgrades and mutating requests). The thunk is wrapped fail-empty (a throw yields `[]`, logged once), mirroring `safeLiveTunnelOrigins`, so a cert-store fault can never 5xx the main listener's request path. `classifyAdmittedHostname` returns `"tls-listener"`; the shared `HostGateAdmittedSource` union and the Settings host-gate renderer gain that value. Admission is hostname-only (existing convention), so the names are also admitted on the plain-HTTP port — accepted: host admission defends against DNS rebinding, and these are operator-owned names.

### D7 — Config shape, validation, deep-merge
```jsonc
"tls": { "enabled": false, "port": 8443, "host": "<main bindHost>", "sources": [{ "type": "tailscale" }] }
```
- Validation runs in the `PUT /api/config` route **before** `writeConfigPartial` and answers 400 naming the entry: `port` 1–65535; port uniqueness among `port`, `piPort`, `modelProxy.secondPort` and `tls.port` is checked against the **merged** config on every write touching any of them (so a later change of `port` cannot silently collide with a stored `tls.port`); `sources[].type` ∈ known set; `sources[].id` unique across all sources, `"tailscale"` only for the tailscale type.
- `writeConfigPartial` gets a `tls` deep-merge branch (`{ ...existing.tls, ...partial.tls }`; `sources` replaced as a whole array).
- `PUT /api/config` touching `tls` calls `tlsListener.reconcile()` after the write (`tls` is applied live, not a `RESTART_FIELDS` entry). Startup runs the same reconcile, so a restart reproduces the outcome already shown in status. Reconcile failure is reported in TLS status; config stays as written (the operator sees enabled + unbound + error).

### D8 — Status and disclosure
`/api/health.tls = { enabled, bound }` always; the detailed object (port, bind host, gates incl. name-scoped ones, certs[] with `source`, `sourceType`, `notAfter`, `advertise`, `stage`, `lastError`, and the source's `details`) only when `canDiscloseAccessPosture(request)`. `lastError` truncated to 500 chars. Gateway UI TLS panel reads it from the authenticated dashboard (always disclosed there).

### D9 — Bind host
Default `tls.host` = main `bindHost` (secure default, no surprise exposure). When it is loopback the listener still binds (useful for local testing) but the `bind-reachable` gate is unmet and D5 emits nothing. Gateway UI offers the node's Tailscale IPv4 as a one-click `tls.host` value when the tailscale source is configured (narrowest reachable exposure). Binding to the IP is separate from how clients connect: clients must use the certificate name (an IP URL sends no SNI and fails closed per D2); the UI states this next to the option.

## Risks / Trade-offs

- [macOS tailscale GUI build may restrict where `tailscale cert` writes] → spike 1.1; fall back to a path it permits and move the result; surface error in status.
- [Tailnet source IPs not in `trustedNetworks`] → requests are subject to the normal guard: unpaired devices are refused, paired devices authenticate via bearer — same as over any tunnel. Status shows a hint when `100.64.0.0/10` is not trusted; not a gate.
- [Certificate name leaks to public CT logs] → setup guidance; opt-in only.
- [`emit("request")` couples to Fastify internals] → integration test over TLS for a guarded route, a blocked network, and one WS path; Fastify `serverFactory` is the fallback.
- [Operator also lists the same host in `publicBaseUrls`] → that path is operator-asserted and bypasses the `advertise` flag; documented.
- [CLI/daemon version skew breaks `tailscale cert`] → error surfaced; backoff prevents storms.

## Migration Plan

No data migration. Ship disabled. Enable via Gateway UI or `tls.enabled: true`. Rollback: `tls.enabled: false` → reconcile closes the listener; removing the source deletes its keys. Reverting the code leaves an ignored `tls` config key.
