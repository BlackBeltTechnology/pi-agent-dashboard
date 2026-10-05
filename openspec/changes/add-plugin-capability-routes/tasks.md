> Consumers: `add-voice-wall-plugin` (hard dependency). `add-team-plugin` may adopt `serveApp` and `requestPrincipal`.

## 1. Registry and stamping hook

- [ ] 1.1 `packages/server/src/auth/capability-routes.ts`: `createCapabilityRegistry()` (per-plugin tracking, literal own-namespace check, id regex, nested-prefix refusal, sweep by plugin id) (design D1, D2).
- [ ] 1.2 Stamping onRequest hook, registered right after the host gate: GET/HEAD, both views under one prefix, verifier called once, throw → refusal, `request.capability` stamp (D1, D3).
- [ ] 1.3 Rate-limited `[capability]` log lines: admit (debug), reject (warn, one per prefix per minute, with a count, no header or query values) (D3).
- [ ] 1.4 Config `auth.capabilityRoutePlugins: string[]` (default `[]`): add it to `AuthConfig`, to the `parseAuthConfig` content predicate (`packages/shared/src/config.ts:1263`) and to the returned object; merge it in `writeConfigPartial` (`packages/server/src/config-api.ts:229-237`, `!== undefined` so `[]` clears it). Trust = package dir in `bundledPlugins` or manifest id in `capabilityRoutePlugins`, read at activation (D2).

## 2. Admission checks read the stamp

- [ ] 2.1 `identity-floor.ts` `identityFloorAllows` gains a `capabilityAdmitted` input; the floor hook (`server.ts:1816`) passes the stamp (D6).
- [ ] 2.2 `auth-plugin.ts` onRequest: skip when stamped, and skip `serveApp` mount paths (D5).
- [ ] 2.3 `localhost-guard.ts` `createNetworkGuardHook`: a stamped request is a public exception; `createNetworkGuard` (per-route) admits a stamped request; a denial under a registered prefix logs the prefix only and skips the ring buffer and trust prompt (D3).
- [ ] 2.4 `identity-road-gate.ts`: a stamped request skips the host-policy branch (D6).
- [ ] 2.5 `server.ts`: one registry, the hook registration order, and injection into the plugin context deps.

## 3. Plugin context

- [ ] 3.1 `ServerPluginContext.registerCapabilityRoute` with the trust gate, inert handle and sweep on disable, teardown or failed activation (D2).
- [ ] 3.2 `ServerPluginContext.requestPrincipal(request)`, trust-gated (D4).
- [ ] 3.3 `ServerPluginContext.serveApp({ dir, csp, appId? })`: trust gate, mount registry, `appId` uniqueness, `dir` confined to the package root, extension allowlist, 308, GET+HEAD, `index.html` fallback, cache headers, 503 for a missing build, enforced CSP (D5).
- [ ] 3.4 `csp.ts`: leave a `serveApp` response's enforcing header intact in every mode (D7).
- [ ] 3.5 `packages/server/src/__tests__/network-guard-namespace-coverage.test.ts`: consult the `serveApp` mount registry with prefix matching, so only those `/apps/*` routes pass (`trusted-networks` delta).

## 4. Docs

- [ ] 4.1 DocScribe: `docs/architecture.md` network-access section (stamp, five checks, `/apps/*`) and the plugin-context API table.
- [ ] 4.2 DOX rows: `packages/server/src/auth/AGENTS.md`, `identity/AGENTS.md`, the `dashboard-plugin-runtime` server-context row, and the dashboard-plugin-scaffold `references/` server-API table.

## 5. Discipline checkpoints

- [ ] 5.1 `security-hardening` pass: smuggling corpus, method restriction, verifier failure, trust list, log hygiene, `serveApp` confinement.
- [ ] 5.2 `review-code` before commit.

## 6. Tests (folded from test-plan.md)

- [ ] 6.E1 Level L1: prefixes in own namespace (EP). Triple: input plugin `voice-wall`, prefix `/api/plugins/flows/s/` · trigger `registerCapabilityRoute` · observable throws; `registry.list()` empty. Harness exemplar: see `packages/server/src/identity/__tests__/resolver-registry.test.ts`. (test-plan #E1)
- [ ] 6.E2 Level L1: prefixes in own namespace (BVA (look-alike)). Triple: input plugin `a`, prefix `/api/plugins/ab/s/` · trigger register · observable throws. Harness exemplar: see `packages/server/src/identity/__tests__/resolver-registry.test.ts`. (test-plan #E2)
- [ ] 6.E3 Level L1: prefixes in own namespace (EP). Triple: input prefixes `/api/plugins/x/s` (no trailing slash), `/api/plugins/x/S/`, `/api/plugins/x/s/` · trigger register each · observable first two throw; third registers. Harness exemplar: see `packages/server/src/identity/__tests__/resolver-registry.test.ts`. (test-plan #E3)
- [ ] 6.E4 Level L1: nested prefix refused (state). Triple: input `/api/plugins/x/s/` registered · trigger register `/api/plugins/x/s/sub/`, then `/api/plugins/x/` · observable both throw. Harness exemplar: see `packages/server/src/identity/__tests__/resolver-registry.test.ts`. (test-plan #E4)
- [ ] 6.E5 Level L1: trust (decision table). Triple: input {dir in `bundledPlugins`, id in `auth.capabilityRoutePlugins`, `priority: 1`} × yes/no · trigger register · observable effective iff dir-listed OR id-listed; `priority:1` alone → inert handle + one warning. Harness exemplar: see `packages/server/src/identity/__tests__/resolver-registry.test.ts`. (test-plan #E5)
- [ ] 6.E6 Level L1: trust config survives parse/write (EP). Triple: input config `{ auth: { capabilityRoutePlugins: ["x"] } }` only; then `writeConfigPartial({ auth: { capabilityRoutePlugins: [] } })` · trigger `parseAuthConfig`, write · observable parsed list `["x"]`; after write the list on disk is `[]`. Harness exemplar: see `packages/server/src/__tests__/config-api.test.ts`. (test-plan #E6)
- [ ] 6.E7 Level L1: one evaluation, every check (decision table). Triple: input identity enforced + host policy, OAuth on, route with `ctx.networkGuard`; untrusted remote IP; valid token header · trigger `GET /api/plugins/x/s/events` via `fastify.inject` with forwarding headers · observable 200 from handler; verifier spy called exactly once. Harness exemplar: see `packages/server/src/identity/__tests__/identity-road-gate.test.ts`. (test-plan #E7)
- [ ] 6.E8 Level L1: one evaluation, every check (decision table). Triple: input same setup · trigger `HEAD`, `POST`, `PUT` with valid token · observable HEAD 200; POST/PUT denied with the normal 401/403 body; verifier not called for POST/PUT. Harness exemplar: see `packages/server/src/__tests__/localhost-guard.test.ts`. (test-plan #E8)
- [ ] 6.E9 Level L1: both views (EP (smuggling corpus)). Triple: input `/api/plugins/x/s/../../sessions`, `/api/plugins/x/s/%2e%2e/%2e%2e/sessions`, `/foo/../api/plugins/x/s/events` · trigger anonymous GET with valid token · observable first two denied; third admitted only if both views lie under the prefix (resolved yes, raw no → denied). Harness exemplar: see `packages/server/src/__tests__/localhost-guard.test.ts`. (test-plan #E9)
- [ ] 6.E10 Level L1: no registrations (regression). Triple: input empty registry · trigger full existing guard corpus from `localhost-guard.test.ts`, `identity-floor.test.ts`, `auth-plugin.test.ts` · observable every decision identical to baseline snapshot. Harness exemplar: see `packages/server/src/identity/__tests__/identity-floor.test.ts`. (test-plan #E10)
- [ ] 6.E11 Level L1: requestPrincipal (decision table). Triple: input {trusted, untrusted plugin} × {principal set, D23 local-token, inert+loopback, inert+remote cookie, none} · trigger `requestPrincipal(req)` · observable untrusted → always `null`; trusted → principal / local-operator / local-operator / `null` / `null`. Harness exemplar: see `packages/server/src/identity/__tests__/session-access.test.ts`. (test-plan #E11)
- [ ] 6.E12 Level L1: serveApp mount (EP). Triple: input `dir` with `index.html`, `assets/app.3f9a.js`, `config.json`, `app.js.map`, `.env`, symlink → `/etc` · trigger GET each + `/apps/wall/m/abc` + `/apps/wall` · observable assets 200 immutable; json/map/dotfile/symlink 404; deep link → index `no-store`; bare → 308. Harness exemplar: see `packages/server/src/__tests__/csp.test.ts`. (test-plan #E12)
- [ ] 6.E13 Level L1: serveApp guards (EP). Triple: input `dir: "/"`; second mount of `appId: "wall"`; untrusted plugin `appId: "wall"` first · trigger `serveApp` · observable throws; throws; untrusted mounts nothing, trusted mount then succeeds. Harness exemplar: see `packages/server/src/identity/__tests__/resolver-registry.test.ts`. (test-plan #E13)
- [ ] 6.E14 Level L1: serveApp + CSP modes (decision table). Triple: input baseline mode ∈ {report, enforce, off}, mount with `csp: "default-src 'self'"` · trigger GET `/apps/wall/` · observable enforcing `Content-Security-Policy` equals the app value in all three; report mode also has the baseline `-Report-Only`. Harness exemplar: see `packages/server/src/__tests__/csp.test.ts`. (test-plan #E14)
- [ ] 6.E15 Level L1: auth plugin skips mounts (EP). Triple: input OAuth configured, no cookie, remote IP · trigger GET `/apps/wall/` with `Accept: text/html`, GET `/apps/wall/assets/a.js` · observable 200 for both (no 302 to `/auth/login`, no 401). Harness exemplar: see `packages/server/src/auth/__tests__/auth-plugin.test.ts`. (test-plan #E15)
- [ ] 6.E16 Level L1: namespace coverage (regression). Triple: input a `serveApp` mount and a hand-rolled `fastify.get("/apps/rogue/*")` · trigger run `network-guard-namespace-coverage` enumeration · observable `serveApp` route passes; rogue route reported as offender. Harness exemplar: see `packages/server/src/__tests__/network-guard-namespace-coverage.test.ts`. (test-plan #E16)
- [ ] 6.P1 Level L1: verifier cheap / hook overhead (micro-benchmark). Triple: workload 10 000 injected GETs to non-matching paths, 3 registered prefixes vs none · metric added p95 per request — measure only, printed · window single run. Harness exemplar: see `packages/server/src/__tests__/localhost-guard.test.ts`. (test-plan #P1)
- [ ] 6.X1 Level L1: throwing verifier denies (fault-injection (abort)). Triple: input verifier throws `Error("boom")` · trigger anonymous GET under prefix · observable normal denial body; exactly one `[capability] reject` warn line without header values. Harness exemplar: see `packages/server/src/__tests__/localhost-guard.test.ts`. (test-plan #X1)
- [ ] 6.X2 Level L1: capability logging (fault-injection (burst)). Triple: input 50 invalid-token GETs within 1 min · trigger sequential inject · observable ≤ 1 `[capability] reject` line for that prefix, containing count `50`; no token substring in any captured log line. Harness exemplar: see `packages/server/src/__tests__/localhost-guard.test.ts`. (test-plan #X2)
- [ ] 6.X3 Level L1: path redaction (EP). Triple: input GET `/api/plugins/x/s/abc123secret` with no/invalid token · trigger guard denial · observable denial line names `/api/plugins/x/s/`; captured logs contain no `abc123secret`. Harness exemplar: see `packages/server/src/__tests__/localhost-guard.test.ts`. (test-plan #X3)
- [ ] 6.X4 Level L1: no trust prompt (fault-injection). Triple: input LAN peer `192.168.1.50` (no forwarding headers), invalid token under prefix · trigger GET · observable ring buffer unchanged; denial observer not called. Harness exemplar: see `packages/server/src/__tests__/network-denial-queue.test.ts`. (test-plan #X4)
- [ ] 6.X5 Level L1: disable sweeps (state-transition). Triple: input trusted plugin registered prefix; activation then disable (and a failed activation) · trigger anonymous GET with a token the verifier accepts · observable denied after disable and after failed activation; re-activation can register again. Harness exemplar: see `packages/server/src/identity/__tests__/identity-registration-tracker.test.ts`. (test-plan #X5)
- [ ] 6.X6 Level L3: end-to-end over the guard (fault-injection (untrusted network)). Triple: input docker harness, fixture trusted plugin registering `/api/plugins/fixture/s/` with a static token, request from a non-trusted client with `X-Forwarded-For` · trigger browser `fetch` of `/api/plugins/fixture/s/ping` with and without the header, and `/apps/fixture/` · observable with header 200; without 403 `network_not_allowed`; `/apps/fixture/` loads. Harness exemplar: see `tests/e2e/network-guard.spec.ts`. (test-plan #X6)
