## Context

See proposal.md — Why. Current state relevant to the approach:

- One Fastify instance (`packages/server/src/server.ts:1799`, `keepAliveTimeout: 30_000`, `connectionTimeout: 10_000`) bound by `fastify.listen({ port, host })`. WebSocket traffic is routed by a single `fastify.server.on("upgrade", …)` switch (`server.ts:4122`). `stop()` closes `secondFastify` then `fastify`.
- The model-proxy second port is a *separate*, loopback-only Fastify instance with its own gate — not a template here: the TLS listener must expose the full route set under the full guard chain.
- Request gate chain: host admission (`auth/host-admission.ts` — loopback, IP literal, bindHost, `.local`, `publicBaseUrls`, CORS origins, live-tunnel origins, `allowedHosts`) → universal network guard → auth. A `*.ts.net` name is not admitted today.
- Pairing: `PairingManager` is constructed with a `getReachableUrls` closure (`server.ts:703`) = tunnel URL + `resolvePublicBaseUrls()`. It does **not** read `collectEndpoints()`; that function only feeds `GET /api/tunnel/endpoints`. `reachableUrls()` filters by scheme only.
- `DEFAULTS.bindHost` is `127.0.0.1`; the main listener binds the effective `config.host` (`server.ts:4451`, via `listenWithProofFloor`, which records `httpBoundAt` — the local-credential proof floor stamped on every request/upgrade at `server.ts:1817` and `:4125`).
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
- Absolute-URL minting that is port-aware of the TLS listener: `host.httpPort`, `servers_discovered`, and OAuth `resolveRedirectBase` keep deriving from the main port. Provider OAuth logins are done from the local machine; they are out of scope over the TLS listener (a login started from the TLS origin returns to the resolved redirect base, as from any other non-base origin). Cookies are keyed by name + domain + path, not port: the device cookie `pi_dash_device` is set `Secure` over a TLS socket (`packages/server/src/auth/bearer-auth.ts:56`, as `bearer-device-auth` requires), so after pairing over `https://<name>:8443` the same browser profile cannot use a device login over `http://<name>:8000` (the Secure cookie is not sent over http and cannot be overwritten from it). Accepted: a device paired over TLS uses the TLS origin. Sign-in (OAuth) is not supported from the TLS origin (the routes exist — same route table — but a login returns to the resolved redirect base), so the UI copy speaks of pairing only. The OAuth session cookie's `Secure` flag follows the resolved base, not the transport (`auth-plugin.ts`), so a session minted over TLS under an http base is also valid over `http://<name>:8000` when the main listener is reachable under that name — accepted: the tailnet wire is encrypted, and the network guard still applies.
- Binding privileged port 443 (operator may configure it; no privilege escalation).
- mTLS, local CA, self-signed certificates.

## Decisions

### D1 — Second `https.Server` dispatching into the existing Fastify instance
`https.createServer({ SNICallback }, …)`, then the main server's timeouts applied from one shared constant the same way Fastify applies them: `server.keepAliveTimeout = 30_000` and `server.setTimeout(10_000)` (Fastify takes `connectionTimeout` as a constructor option and applies it with `server.setTimeout`, `fastify/lib/server.js`; the TLS server gets the same call). Full parity list from `fastify/lib/server.js`: `keepAliveTimeout`, `setTimeout(connectionTimeout)`, `requestTimeout = 0` (Node's https default is 300 s, Fastify's 0), and Fastify's `clientError` handler (408/431 JSON) forwarded via `tlsServer.on("clientError", (e, s) => fastify.server.emit("clientError", e, s))`. Traffic is forwarded into the already-built app:
- `request` → `fastify.server.emit("request", req, res)` (verified: Fastify registers its `httpHandler` as the `'request'` listener), so hooks, host gate, network guard and routes all run.
- `upgrade` → the handler currently inlined in `fastify.server.on("upgrade", …)`, extracted to a named function and attached to both servers.
- Local-credential proof floor per transport: the TLS server records its own `tlsBoundAt` immediately BEFORE its bind call (same contract as `listenWithProofFloor`, `auth/local-credential.ts`), with the TLS port as the listener's diagnostic port; the `onRequest` stamp (`server.ts:1817`) and the extracted upgrade handler (`:4125`) pass `boundAt = socket.encrypted ? tlsBoundAt : httpBoundAt`. The proof binding already derives from the socket's local address/port (`auth/local-credential.ts`), so a proof for the main port never verifies on the TLS port.
- Start order: the TLS server listens only after `fastify.ready()` and the main `listen` resolved (no `emit` into an unready app); reconcile before that is a no-op that runs again after ready.

`request.protocol` reads `socket.encrypted` (no `trustProxy` configured), and the guard sees the real `remoteAddress`. `stop()` closes the TLS server (`closeAllConnections()`) alongside `secondFastify`/`fastify`.

*Alternatives:* (a) Fastify `https` option on the main instance — makes the main listener TLS-only, breaks localhost/bridge clients. (b) A second Fastify instance re-registering routes — duplicated registration and hooks, drift-prone. (c) Local reverse proxy → `http://127.0.0.1:port` — every request looks loopback, collapsing the network guard. Rejected.

### D2 — SNI map, deterministic, fail-closed
`TlsCertStore` holds `Map<name, { ctx: tls.SecureContext; meta }>`. `SNICallback`: exact name → single-label wildcard (`*.parent`, RFC 6125) → error (handshake fails). No SNI → the callback is not invoked and no default `cert`/`key` is configured, so the handshake fails. Swapping an entry is atomic; existing connections keep their context. `SNICallback` also runs on session resumption (checked on Node 24), so a pruned or replaced name takes effect for every new connection, resumed or not.

### D3 — Certificate source interface + manager
```ts
interface CertSource {
  readonly id: string;                                // stable; tailscale → "tailscale"
  readonly type: string;                              // registered type, see registry below
  names(): Promise<string[] | null>;                  // null = cannot tell right now (daemon down) → no prune
  configFingerprint(name: string): string;            // hash of settings affecting THIS name's cert
  obtain(name: string, onStage: (stage: string) => void): Promise<ObtainedCert>;
  readiness(opts?: { force?: boolean }): Promise<{ gates: Gate[]; details?: Record<string, string | boolean> }>; // cached by the source (force = re-check now); status never calls out. details = source-level, non-secret (tailscale: ipv4)
  readonly attemptTimeoutMs?: number;                 // manager abandons an attempt after this (default 10 min)
  onReconciled?(): Promise<void>;                     // source-owned GC after each reconcile (e.g. stale account keys)
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
interface CertSourceType {                            // registry: registerCertSourceType(t)
  type: string;                                        // "tailscale" here; "acme" registered by add-acme-dns01-certs
  defaultId?: string;                                  // tailscale → "tailscale"
  validate(entry: Record<string, unknown>): string | null;   // per-type config check → 400 message
  create(entry: Record<string, unknown>, deps): CertSource;
}
```
Source types are pluggable: config validation (D7) checks the common fields (`type` registered, `id` `^[a-z0-9][a-z0-9-]{0,31}$`, unique, defaulted from `defaultId`, `"tailscale"` only for that type) and delegates the rest to `validate()`. `add-acme-dns01-certs` registers its type; nothing in this capability changes. `configFingerprint(name)` MUST hash only settings that affect THAT name's certificate — for a list-valued entry, the shared settings plus that one name, never the list (e.g. ACME: directory/advertise/solver + name), so adding or removing one name never re-issues others.

Seams the follow-up relies on (generic, no per-type branch in the manager or shell):
- **Config change** → reconcile rebuilds each source instance from its entry (`create`) and calls `readiness({ force: true })`, then `onReconciled()`.
- **Gate-before-obtain** → before every attempt (scheduled or triggered) the manager reads `readiness()`; an unmet source-wide gate, or an unmet gate scoped to that name, skips the attempt without calling `obtain()` and without advancing `failures`; the name is re-checked after 15 min, on reconcile, or on trigger.
- **Attempt deadline** → the manager races `obtain()` with `attemptTimeoutMs`; on timeout it records a failure (`lastError: "timed out"`), frees the single-flight slot (a later trigger starts a new attempt, never joins the abandoned one) and discards a late result.
- **Stage** → `"idle"` when no attempt runs; any other string = running, source-defined; the UI maps known values through a per-type client registry and shows "Working…" for unknown ones.
- **Status per name** → every name from the source's last `names()` list appears in status (held, waiting on a gate, or being issued), plus held names kept while `names()` is `null`.
- **UI** → the Certificates list renders each source group through a client-side `registerTlsSourceGroup(type, Component)`; tailscale registers its group here; an unregistered type gets the generic row group.

`CertManager`: on start, on reconcile, and every 12 h, per `(source, name)`: load from disk → `obtain()` if missing, < 1/3 validity left, **or `meta.fingerprint ≠ source.configFingerprint(name)`**. Reconcile also **prunes**: any held name no longer returned by its source's `names()` is dropped from the store and its files deleted — only when `names()` returned a list; `null` keeps every held name of that source serving (a daemon outage never deletes keys). `enabled` with no sources → manager emits gate `no-sources` and binds nothing. A stored entry that fails validation (hand-edited file) is skipped at reconcile and reported as gate `invalid-source` naming the entry; the rest still run. An exact name and a wildcard covering it (from any sources) are not a conflict: both held, D2 picks exact first; `name-conflict` is exact-name only. Single-flight is keyed `(sourceId, name)`; `trigger(sourceId, name?)` joins a running issuance or starts immediately, bypassing backoff — without `name` it covers every name of that source that is missing, failed, fingerprint-changed or inside the renewal window; a valid, current certificate is never re-issued by a trigger.

Ownership: source `id`s are unique across all sources (`"tailscale"` reserved for the tailscale type); a name is owned by the first source in `tls.sources` order that returns it — a later source returning the same name gets an unmet `name-conflict` gate for it and does not issue. Failures back off exponentially (5 min, doubling, cap 6 h), floored by `RetryAfterError.retryAfterMs`. Expiry read via `crypto.X509Certificate` (no dependency). Write order per name: cert + key to tmp files in the name dir → explicit `fs.chmod(key, 0o600)` → rename key → rename cert → `meta.json` last. Sources return PEM strings; only the manager writes files, and only for the attempt that currently owns the single-flight slot (each attempt has an id; a result whose id is no longer current is dropped unwritten — the "discard late result" mechanism). Tmp names carry the attempt id. The tailscale source runs `tailscale cert` into its own per-attempt private temp dir and reads the PEMs back. Load verifies `x509.checkPrivateKey(createPrivateKey(keyPem))`; a parse error or mismatch (crash between renames) is logged and treated as missing → re-obtain. The manager keeps `failures` and `nextAttemptAt` per `(source, name)` whenever an attempt is scheduled (backoff, retry floor, or renewal due time), persists both in that name's `meta.json` (which may exist before any PEM), honours a persisted `nextAttemptAt` on start (a restart loop cannot reset backoff), and exposes `nextAttemptAt` in status. `meta` (`source`, `fingerprint`, `advertise`, `kind`, `details`, `notAfter`, `stage`, `lastError`) persisted next to the PEMs in `meta.json`. Removing a source deletes `~/.pi/dashboard/tls/<sourceId>/` and awaits `onRemoved()`.

### D4 — Tailscale source uses the CLI with its own timeout
`tailscale cert --cert-file <tmp> --key-file <tmp> <MagicDNSName>` into a `0700` temp dir under `~/.pi/dashboard/tls/`, then the D3 write order (the CLI sets no key mode, so the explicit `chmod` applies); its own runner `asyncRunner(getBinary, 120_000)` (`packages/server/src/tunnel-providers/daemon-exec.ts:32`), NOT the provider's default 4 s `runAsync` (`tailscale.ts:218`). Runs in the background job, never inside a request. MagicDNS name from `tailscale status --json` via the existing `selfDnsName()` helper (strips the trailing dot, so SNI keys and URLs match). The HTTPS-enabled check is one new shared helper `tailnetHttpsEnabled(statusJson)` used by both this source and `checkFunnelGates` (so the two surfaces cannot disagree). It replaces today's heuristic `Self.CapMap ? true : …` (`tailscale.ts:97`), which reports enabled for every running node: signal = top-level `CertDomains` is a non-empty array (`null` and `[]` = disabled — `null` is what an HTTPS-disabled tailnet returns, `docs/research/neutral-shell-deploy-and-pairing-durability.md:206`); spike 1.1 confirms that a tailnet with HTTPS disabled yields empty/absent `CertDomains` and records any fallback. No tunnel-provider spec requirement describes the old heuristic (checked `openspec/specs/tunnel-provider/spec.md`), so the funnel gate only becomes accurate: a node whose tailnet has HTTPS off now shows `https-certs` unmet in Funnel setup too (intended, same gate id and hint). Daemon down, binary missing, or `BackendState ≠ "Running"` (logged out) → unmet `tailscale-running` gate, `names()` returns `null` (no prune), no `tailscale cert` call. `readiness().details.ipv4` = first `Self.TailscaleIPs` IPv4 from the same cached `status --json` (feeds the UI's one-click `tls.host`). Unmet gates are handled by the manager's gate-before-obtain rule (D3): no `tailscale cert` call while `tailscale-running` or `https-certs` is unmet; a `tls` config change or `trigger()` re-checks immediately. Only when the `CertDomains` key is missing entirely (older CLI) does the helper fall back to today's heuristic, so nothing regresses there.

### D5 — Endpoint emission and pairing wiring
One function `tlsListenerUrls(): TunnelEndpoint[]` — empty when the listener is not bound or its bind host is loopback; otherwise every held, unexpired, `advertise: true`, non-wildcard cert → `https://<name>` plus `:<port>` unless the port is `443`, `kind` from meta, `tls:true`. It feeds **both**:
- `collectEndpoints()` → `GET /api/tunnel/endpoints`;
- the `PairingManager` `getReachableUrls` closure in `server.ts` (new push next to tunnel URL + `publicBaseUrls`).
`reachableUrls()` still filters at read time; no gate relaxed. `EndpointKind` gains `domain` (client label: "Domain") for non-tailscale sources.

### D6 — Host admission and same-origin
Both option objects gain `tlsListenerNames: () => string[]` — the exact (non-wildcard) names of held certificates, and only while the listener is enabled AND bound (empty otherwise, so disabling or a bind failure restores today's admission exactly) — used ONLY inside the admissibility check `isHostAdmitted` — the CORS allow-list is unchanged, and `cross-site-request-gate` already defers same-origin trust to host admission, so it needs no delta (wildcard certificates are NOT admitted: a wildcard zone may contain records the operator does not control, and admitting them would re-open DNS rebinding on the main port; an operator who wants `x.example.com` admitted adds it to `allowedHosts`): `HostAdmissionOptions` (host gate, `getHostGateCtx()`) **and** `CorsOriginOptions` (built in `corsOpts()`, consumed by `isSameOriginByHost` for WS upgrades and mutating requests). The thunk is wrapped fail-empty (a throw yields `[]`, logged once), mirroring `safeLiveTunnelOrigins`, so a cert-store fault can never 5xx the main listener's request path. `classifyAdmittedHostname` returns `"tls-listener"`; the shared `HostGateAdmittedSource` union and the Settings host-gate renderer gain that value. Admission is hostname-only (existing convention, `openspec/specs/host-admission/spec.md` "port SHALL NOT participate"), so the names are also admitted on the plain-HTTP port — accepted and stated in the spec as the one exception to "main listener unaffected": host admission defends against DNS rebinding, and these are operator-owned names. MODIFIED deltas: `host-admission` (admissible set + `tls-listener` source, exact names only), `settings-panel` (pill `TLS certificate`, link to Gateway) and `shared-config` (`allowedHosts` need not duplicate TLS names).

### D7 — Config shape, validation, deep-merge
```jsonc
"tls": { "enabled": false, "port": 8443, "host": "127.0.0.1", "sources": [{ "type": "tailscale" }] }
```
- Validation runs in the `PUT /api/config` route **before** `writeConfigPartial` and answers 400 naming the entry: `port` 1–65535 (443 and other privileged ports allowed on purpose — a bind without privilege fails into `bindError`, never escalates); port uniqueness among the EFFECTIVE `port`, `piPort` (env overrides `PI_DASHBOARD_PORT` / `DASHBOARD_PORT` / `PI_DASHBOARD_PI_PORT` applied, `packages/shared/src/config.ts`), `modelProxy.secondPort` and `tls.port` is checked against the **merged** config; `tls.host` must be an IP literal or `localhost` (loopback = `localhost`, `127.0.0.0/8`, `::1`; `0.0.0.0` / `::` accepted but shown as "all interfaces" in the UI) on every write touching any of them (so a later change of `port` cannot silently collide with a stored `tls.port`); `sources[].type` registered (D3 registry) and the entry passes that type's `validate()`; `sources[].id` per D3 (pattern, unique, defaulted, `"tailscale"` only for the tailscale type).
- Other runtime `writeConfigPartial` callers bypass route validation (pre-existing pattern); reconcile re-validates and reports `invalid-source` / `bindError`, so a bypass degrades to a reported error, not a crash.
- `writeConfigPartial` gets a `tls` deep-merge branch (`{ ...existing.tls, ...partial.tls }`; `sources` replaced as a whole array).
- `PUT /api/config` touching `tls` calls `tlsListener.reconcile()` after the write and awaits only the listener (re)bind — readiness checks and issuance are scheduled, never awaited inside the request (`tls` is applied live, not a `RESTART_FIELDS` entry). Startup runs the same reconcile, so a restart reproduces the outcome already shown in status. Reconcile failure is reported in TLS status; config stays as written (the operator sees enabled + unbound + error). A failed bind (`EADDRNOTAVAIL` — e.g. tailscaled not up yet at boot — or `EADDRINUSE`) is retried 1 min, doubling, cap 15 min, and immediately on reconcile or trigger, so the listener comes up once the address exists. `POST /api/tls/issue` precedence: `409` (disabled) before `404`.

### D8 — Status and disclosure
`/api/health.tls = { enabled, bound }` always; the detailed object (port, bind host, `bindError`, gates incl. name-scoped ones, `sources[]` with `id`, `type`, source-level `details`, and certs[] with `source`, `sourceType`, `notAfter`, `advertise`, `stage`, `lastError`, `nextAttemptAt`, and the cert's `details`) only when `canDiscloseAccessPosture(request)`. `lastError` truncated to 500 chars. Gateway UI TLS panel reads it from the authenticated dashboard (always disclosed there).

### D9 — Bind host
Default `tls.host` = `127.0.0.1`, independent of the main listener's bind (a main bind of `0.0.0.0` must not silently expose the new port on every interface). When it is loopback the listener still binds (useful for local testing) but the `bind-reachable` gate is unmet and D5 emits nothing. Gateway UI offers the node's Tailscale IPv4 as a one-click `tls.host` value when the tailscale source is configured (narrowest reachable exposure). Binding to the IP is separate from how clients connect: clients must use the certificate name (an IP URL sends no SNI and fails closed per D2); the UI states this next to the option.

### D10 — Operator-triggered issuance route
`POST /api/tls/issue { sourceId, name? }`: synchronous checks only (listener enabled → else `409`; source id known and, when the source's last `names()` was a list, `name` in it → else `404`; with no list yet the request is accepted), then `202`; after the reply, a forced `readiness()` refresh and `certManager.trigger(sourceId, name)` (so "Check now" on a gate and "Renew now" on a row are the same call). Same authorization as `PUT /api/config`: `ROUTE_TIERS` row `{ method: "POST", path: "/api/tls/issue", tier: "operate" }` in `packages/shared/src/route-tiers.ts` (completeness test `mcp-manifest-completeness.test.ts` fails without it). Single-flight makes repeated clicks harmless; no extra rate limit. Owned here so `add-acme-dns01-certs` reuses it for its "Issue now" instead of adding its own.

### D11 — Gateway UI: Built-in HTTPS section
Approved board: `mockups/tls.html` (states, copy, tokens in `mockups/ui-plan.md`). New `GatewayTlsSection.tsx` in `GatewayPage` between `GatewayUrlManager` and `GatewayEndpoints`. Source-neutral shell: heading + status pill, switch (writes `tls.enabled` immediately — D7 reconciles live; seeds `sources:[{type:"tailscale"}]` when empty; a failed write reverts the switch and shows the error inline), address inset, listener gates, Port/Listen-on with explicit Apply (400 → field error), status re-read every 5 s while mounted (no overlap; immediately after its own writes/issue calls — same cadence as `GatewayConnectToggle`'s status-detail poll), **Certificates** grouped by source with one shared row anatomy (name · state pill · facts · Renew now / Try again now → D10). Recipes from `connectivity/connectivity-ui.ts` (`severityPill`, `callout`, `BTN_*`, `INPUT`, `ROW`, `INSET`); section heading per ui-contract (12 px, no uppercase). `GatewayEndpoints` kind pills become the contract's neutral chip with a word label (Local / LAN / Mesh / MagicDNS / Public / Domain — the identity tints are reserved for other meanings in `ui-contract.md` § Colour roles) and TLS badges become severity pills (lock + "HTTPS" / alert + "No TLS") (removes raw hex + undefined `--border`/`--green`/`--amber`; the 10.5 px help line moves to `text-xs`). Three commit models on one page (switch = immediate, Port/Listen-on = Apply, ACME editor = Save) are a deliberate trade-off: each matches the effect size of its control (NN/g toggle guideline), none joins the page's provider/mode Save bar. `add-acme-dns01-certs` renders its Domain-certificate editor as a second source group inside **Certificates**; the shell is owned here.

## Risks / Trade-offs

- [macOS tailscale GUI build may restrict where `tailscale cert` writes] → spike 1.1; fall back to a path it permits and move the result; surface error in status.
- [Tailnet source IPs not in `trustedNetworks`] → requests are subject to the normal guard: unpaired devices are refused, paired devices authenticate via bearer — same as over any tunnel. Status shows a hint when `100.64.0.0/10` is not trusted; not a gate.
- [Certificate name leaks to public CT logs] → setup guidance; opt-in only.
- [`emit("request")` couples to Fastify internals] → integration test over TLS for a guarded route, a blocked network, and one WS path; Fastify `serverFactory` is the fallback.
- [Operator also lists the same host in `publicBaseUrls`] → that path is operator-asserted and bypasses the `advertise` flag; documented.
- [CLI/daemon version skew breaks `tailscale cert`] → error surfaced; backoff prevents storms.

## Migration Plan

No data migration. Ship disabled. Enable via Gateway UI or `tls.enabled: true`. Rollback: `tls.enabled: false` → reconcile closes the listener; removing the source deletes its keys. Reverting the code leaves an ignored `tls` config key.
