## Why

The dashboard server listens on plain HTTP only; HTTPS exists solely when a tunnel terminates TLS in front of it. A tailnet with HTTPS certificates enabled can already issue a browser-trusted `*.ts.net` certificate, but the only way to use it today is `tailscale serve`. That path is fragile: the tailscale provider's `disconnect()` runs `serve reset`, only one provider can be primary, and `serve` is invisible to the dashboard when configured by hand. Mesh devices therefore see `http://<name>.ts.net:8000`, which `PairingManager.reachableUrls()` drops, and phones lose secure-context APIs (WebCrypto, service worker, push).

Terminating TLS inside the dashboard, using a certificate the local `tailscaled` issues (`tailscale cert`), yields a stable `https://<name>.ts.net:<port>` endpoint that works independently of which tunnel provider is primary.

## What Changes

- Add an optional, off-by-default **native TLS listener**: a second listener on `tls.port` (default `8443`) that serves the same HTTP routes and WebSocket upgrades as the main listener, with certificates hot-swapped per SNI name without a restart.
- Add a **certificate-source abstraction** feeding that listener, plus the first source: **tailscale** — runs `tailscale cert` for the node's MagicDNS name, stores the PEM pair under `~/.pi/dashboard/tls/` (mode `0600`), and renews it before expiry.
- Certificate lifecycle hooks shared by all future sources: single-flight per name, operator "issue now", source-imposed retry delay, per-certificate `advertise` flag and endpoint `kind`, single-label wildcard SNI matching.
- Report listener and certificate state through `/api/health.tls` (detail only to authenticated/genuinely-local callers, incl. per-name next retry time and source-level details such as the tailnet IPv4); tailscale not running, tailnet HTTPS not enabled, loopback bind, and no sources are reported as unmet gates, not crashes.
- Add `POST /api/tls/issue` (operator-only, same authorization as `PUT /api/config`) for "Renew now / Try again now / Check now"; it joins a running issuance and bypasses backoff. Shared with `add-acme-dns01-certs`.
- Add a **Built-in HTTPS** section to the Gateway page (approved mockup: `mockups/tls.html`, plan `mockups/ui-plan.md`): status pill, enable switch, address with connect-by-name note, gates with one-click fixes, port/listen-on fields, a Certificates list grouped by source. "Accessible at" labels kinds in words (incl. Domain) on the neutral contract chip instead of raw hex. The section shell is source-neutral; `add-acme-dns01-certs` adds its editor as a second source group.
- Admit certificate names through host admission, and feed advertisable certificate-backed names both into "Accessible at" enumeration and into the pairing payload's reachable-URL source (the https/wss gate still applies). New endpoint kind `domain` for non-tailscale names.
- New config block `tls` (additive; absent = today's behaviour) with validation and deep-merge on partial writes.

## Capabilities

### New Capabilities
- `dashboard-tls-listener`: optional in-process TLS listener, pluggable certificate sources, the tailscale certificate source, renewal, status reporting, and failure isolation.

### Modified Capabilities
- `tunnel-provider`: Accessible-endpoint enumeration additionally lists the TLS listener's certificate-backed names as `tls: true` endpoints.
- `host-admission`: the admissible-hostname set includes TLS-listener certificate names (source `tls-listener`).
- `settings-panel`: the Security tab's Currently-admitted list shows those names with pill `TLS certificate`.
- `shared-config`: `allowedHosts` need not duplicate TLS-listener certificate names.

## Impact

- **Code**: `packages/server/src/server.ts` (second listener wired to the existing Fastify instance, shared upgrade handler, pairing `getReachableUrls` closure, shutdown), new `packages/server/src/tls/` (listener, cert store, cert manager, cert-source interface, tailscale source), `packages/server/src/auth/host-admission.ts`, `packages/shared/src/host-admission.ts` (`tls-listener` source), `packages/shared/src/route-tiers.ts` (`POST /api/tls/issue`), `packages/server/src/tunnel-providers/tailscale.ts` (`tailnetHttpsEnabled` replaces the `CapMap` heuristic in `checkFunnelGates`), `packages/server/src/config-api.ts` (`tls` deep-merge + reconcile), `packages/server/src/routes/system-routes.ts` (`/api/health.tls`), `packages/server/src/tunnel/tunnel-endpoints.ts`, `packages/shared/src/config.ts` (`tls` block), `packages/shared/src/tunnel-provider.ts` (`EndpointKind` + `domain`), new `routes/tls-routes.ts` (`POST /api/tls/issue`), Gateway `GatewayTlsSection.tsx` + `GatewayEndpoints.tsx` token cleanup in `packages/client/`.
- **Dependencies**: none (Node `https`/`tls`, existing tailscale CLI runner).
- **APIs**: `/api/health` gains a `tls` object; new `POST /api/tls/issue`; `GET /api/tunnel/endpoints` may list extra `magicdns` `tls:true` entries.
- **Compatibility**: fully additive; `tls.enabled` defaults to `false`. Main HTTP listener unchanged. Rollback = set `tls.enabled: false` (or remove the block) and restart; stored certs are inert files.
- **Follow-up**: `add-acme-dns01-certs` adds a second certificate source (own domains via ACME DNS-01) on top of this listener.

## Discipline Skills

- `security-hardening` — new network-facing listener: universal network guard and auth must apply identically on both listeners; private keys stored `0600`; no plain-HTTP fallback on the TLS port; `POST /api/tls/issue` authorized exactly like `PUT /api/config`.
- `observability-instrumentation` — new background job (cert issue/renew via external CLI): structured log line per attempt, expiry and last error exposed in `/api/health.tls`.
- `doubt-driven-review` — routing a second Node server into the existing Fastify instance is an architectural seam; review the dispatch and upgrade-sharing approach before it stands.
