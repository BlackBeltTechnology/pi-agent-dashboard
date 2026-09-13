## Why

GitHub issue #637 — the residual that `fix-ws-origin-cswsh` (#625 / PR #636) deliberately left open. Admission rule 1 in `packages/server/src/auth/cors-origin.ts` (`isSameOriginByHost`) admits any request whose `Origin` host equals its `Host` header. That treats the `Host` header as proof the page was served by this dashboard, and DNS rebinding forges exactly that proof: a page at `http://rebind.example:8000` whose name re-resolves to `127.0.0.1` reaches `/ws` and every mutating `/api/*` route.

Verified during exploration that the residual is wider than #637 states. A rebinding page is *same-origin* with the dashboard from the browser's point of view, so its plain `GET fetch("/api/…")` carries **no `Origin` header at all** — the `origin === undefined → allow` branch. The request arrives from a loopback peer with no forwarding header, and `networkGuard` (`auth/localhost-guard.ts`) returns on `isGenuinelyLocal` before checking any credential. Reads (sessions, transcripts, config) are open to a rebinding page today, and no Origin-side rule can close them. Only a gate on the `Host` header itself can.

## What Changes

- **Host admission gate.** A Fastify `onRequest` hook on the dashboard listener, registered before the CORS plugin and applied to every HTTP request and every WebSocket upgrade — including requests with no `Origin` — SHALL refuse a `Host` header whose hostname is not admissible, with `403 {error:"host_not_allowed"}` plus a hint naming the config key to add. Matching is on **hostname only**, never `host:port` (a reverse proxy elides the port; the port carries no rebinding signal).
- **Admissible hostnames** (first match wins, all read live):
  - loopback literals (`localhost`, `127.0.0.1`, `::1`), **any IP literal** (an IP `Host` carries no rebinding signal — rebinding needs a name; this keeps the `0.0.0.0` docker bind and raw-IP LAN pairing working), and the configured bind address when it is a name;
  - any `*.local` name (the mDNS name the dashboard advertises via `mdns-discovery`; `.local` is mDNS-only on macOS/Linux resolvers, so an attacker cannot rebind one through public DNS — residuals in design D3);
  - the hostnames of `publicBaseUrls` (via `resolvePublicBaseUrls`, so legacy `pairing.publicBaseUrls` entries count), of `cors.allowedOrigins`, and of every live tunnel origin (`getLiveTunnelOrigins`) — **derived at read time, never copied into config** (see design D2);
  - a new top-level `allowedHosts: string[]` config field for names that are not public base URLs (an internal reverse-proxy name such as `dash.home.arpa`).
- **Same-origin-by-Host rule tightened in enforce mode.** `isSameOriginByHost` SHALL admit only when the `Host` is itself admissible, when the host gate is in enforce mode; in report mode it keeps today's behaviour so the report-only release does not hard-refuse the population it exists to size. With the gate registered first the rule can no longer be reached by a non-admissible Host in enforce mode, but the helper is tightened too so the pure decision is correct in isolation (unit-tested against the real code).
- **Report-only first.** The gate ships report-only by default: a refused Host is logged (`[host-gate] refused host=<h> origin=<o> <method> <url>`, header values through `sanitizeHeaderForLog`) and the request proceeds. The mode is persisted as `hostGate.mode` in `config.json` (`report` | `enforce`), switchable from Settings ▸ Security; `PI_DASHBOARD_HOST_GATE`, when set to a recognised value, overrides the config (the same rollout shape as CSP, `PI_DASHBOARD_CSP`, `auth/csp.ts`). Flipping the default to enforce is a later, separate change once report-only logs are clean.
- **Operator UI.** Settings ▸ Security gains an **Allowed hostnames** section: mode control (disabled with reason when the env var overrides), a read-only *Currently admitted* list with one source pill per hostname (loopback / IP address / bind address / .local / public base URL / CORS origin / live tunnel / allowed host) and edit-at-source links, an *Additional hostnames* editor for `allowedHosts` with bare-hostname validation, and a *Recent refusals* list with a one-click **Allow** that appends to the panel draft (saved with the panel's Save). One read endpoint, `GET /api/host-gate`, returns the resolved mode, whether the env var overrides it, the server-derived admitted list, and the refusal ring. Browser navigations refused in enforce mode get a static HTML page (no client bundle) stating the received Host (escaped) and three ways in; it does not enumerate the admitted set. `fetch` callers keep the JSON body. A Gateway URL row whose hostname is in the live derived set gains an informational **Host admitted** pill. Mockups: this change's `mockups/` (`ui-plan.md`, three HTML surfaces).
- **Live config.** `allowedHosts` is read through the mtime-gated config snapshot (`config-snapshot.ts`) on every decision, like `cors.allowedOrigins` and `trustedNetworks`.

Out of scope (recorded in `design.md`): honouring `X-Forwarded-Host` (no `trustProxy` is configured; a rewriting proxy is its own gate); writing `allowedHosts` from the gateway "add URL" action (rejected — derived at read time instead); tightening `*.local` to the exact advertised name.

## Capabilities

### New Capabilities
- `host-admission`: the `Host`-header allow-list — admissible-hostname sources, hostname-only matching, the report-only/enforce mode switch (config + env override), the 403 shape (JSON and HTML), refusal logging, and the `GET /api/host-gate` read endpoint (mode, env override, admitted list, refusal ring).

### Modified Capabilities
- `settings-panel`: new *Allowed hostnames* section on the Security tab (draft-bound like every other field — `computeConfigPartial` / `CONFIG_FIELD_PAGE` gain `allowedHosts` + `hostGate`); Gateway URL row shows an informational *Host admitted* pill when its hostname is live-derived.
- `shared-config`: new top-level `allowedHosts: string[]` field (optional, default `[]`), new `hostGate.mode` (`report` default), and *Live config reads for CORS and the network guard* extends to the Host gate.
- `cross-site-request-gate`: *Hostname-addressed same-origin client is admitted* is conditioned on the hostname being admissible in enforce mode; new scenario — a rebinding Origin/Host pair is rejected on `/ws` and on a mutating `/api/*` route in enforce mode.

## Impact

- `packages/server/src/auth/cors-origin.ts` — `isSameOriginByHost` takes the admissible-host decision; new pure `isHostAdmitted(hostname, opts)` (or sibling `host-admission.ts`) with `allowedHosts`, `publicBaseUrls`, `bindHost` added to the live options; `auth/AGENTS.md` rows.
- `packages/server/src/server.ts` — `onRequest` hook registration before `cors`; Host check at the top of the `upgrade` handler before `isWsOriginTrusted`; `corsOpts()` gains the new live inputs; `config-snapshot.ts` gains `liveAllowedHosts()` / `livePublicBaseUrls()`.
- `packages/shared/src/config.ts` — `DashboardConfig.allowedHosts`, `DashboardConfig.hostGate.mode`, parse + default.
- `packages/server/src/routes/` — `GET /api/host-gate` (resolved mode, `envOverridden`, derived `admitted[]`, refusal ring `recent[]`) and the HTML refusal responder (content-negotiated on `Accept: text/html`, Host HTML-escaped). `config-api.ts` `writeConfigPartial` gains a `hostGate` branch (object written whole).
- `packages/client/src/components/settings/` — new `AllowedHostsSection.tsx` composed into the Security tab of `SettingsPanel.tsx` between Trusted networks and Pair a device; `Gateway/GatewayUrlManager.tsx` row pill; i18n keys.
- Tests: `packages/server/src/__tests__/cors.test.ts` pattern for the pure helper; `ws-upgrade-routing.test.ts` pattern (real upgrade handler) for the rebinding `/ws` case; `fastify.inject` for the REST hook and the report-only vs enforce modes; the archived change's test-plan scenarios #E6 (mDNS hostname) and #E16 (plain-LAN pairing) must stay green.
- Clients unaffected in either mode: Electron and Vite dev dial `localhost`; bridge/CLI/skills dial loopback or an IP; LAN clients on a `0.0.0.0` bind dial the host's IP (IP literal, admitted); tunnel clients arrive with the tunnel host; the docker/E2E harness dials `localhost:8000` / `localhost:18000`.
- Behavioural risk (enforce mode only): an operator reaching the dashboard by a hostname none of the sources cover — typically a reverse-proxy name that was never added as a public base URL — gets a 403 whose `hint` names `allowedHosts`. Report-only default plus the log line surface this before enforcement.
- Docs: `docs/architecture.md` security section — one paragraph on the Host gate beside the Origin gates; config reference gains `allowedHosts` and `PI_DASHBOARD_HOST_GATE`; issue #637 gets a response.

## Discipline Skills

- `security-hardening` — untrusted-input admission on the `Host` header; threat model is DNS rebinding against a loopback-trusting server.
- `doubt-driven-review` — ran at planning (cycle 1, single-model + cross-model on `@propose-review-1`/`-2`): produced the enforce-only helper tightening, the any-IP-literal rule, the escaped/non-enumerating 403 page, the single `GET /api/host-gate` endpoint, the draft-bound Allow, and the live-derived gateway pill. Re-run before the enforce-default flip (follow-up change).
- `observability-instrumentation` — the `[host-gate]` log line is the only evidence the report-only phase produces; it must be enough to decide when to flip to enforce.
