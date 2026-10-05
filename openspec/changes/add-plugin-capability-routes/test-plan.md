# Test Plan — add-plugin-capability-routes

Stage: design   Generated: 2026-10-05

Hard gate passed. Performance thresholds were answered "measure only" (P1): the row records the number and does not fail.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | prefixes in own namespace | EP | L1 | automated | plugin `voice-wall`, prefix `/api/plugins/flows/s/` | `registerCapabilityRoute` | throws; `registry.list()` empty |
| E2 | prefixes in own namespace | BVA (look-alike) | L1 | automated | plugin `a`, prefix `/api/plugins/ab/s/` | register | throws |
| E3 | prefixes in own namespace | EP | L1 | automated | prefixes `/api/plugins/x/s` (no trailing slash), `/api/plugins/x/S/`, `/api/plugins/x/s/` | register each | first two throw; third registers |
| E4 | nested prefix refused | state | L1 | automated | `/api/plugins/x/s/` registered | register `/api/plugins/x/s/sub/`, then `/api/plugins/x/` | both throw |
| E5 | trust | decision table | L1 | automated | {dir in `bundledPlugins`, id in `auth.capabilityRoutePlugins`, `priority: 1`} × yes/no | register | effective iff dir-listed OR id-listed; `priority:1` alone → inert handle + one warning |
| E6 | trust config survives parse/write | EP | L1 | automated | config `{ auth: { capabilityRoutePlugins: ["x"] } }` only; then `writeConfigPartial({ auth: { capabilityRoutePlugins: [] } })` | `parseAuthConfig`, write | parsed list `["x"]`; after write the list on disk is `[]` |
| E7 | one evaluation, every check | decision table | L1 | automated | identity enforced + host policy, OAuth on, route with `ctx.networkGuard`; untrusted remote IP; valid token header | `GET /api/plugins/x/s/events` via `fastify.inject` with forwarding headers | 200 from handler; verifier spy called exactly once |
| E8 | one evaluation, every check | decision table | L1 | automated | same setup | `HEAD`, `POST`, `PUT` with valid token | HEAD 200; POST/PUT denied with the normal 401/403 body; verifier not called for POST/PUT |
| E9 | both views | EP (smuggling corpus) | L1 | automated | `/api/plugins/x/s/../../sessions`, `/api/plugins/x/s/%2e%2e/%2e%2e/sessions`, `/foo/../api/plugins/x/s/events` | anonymous GET with valid token | first two denied; third admitted only if both views lie under the prefix (resolved yes, raw no → denied) |
| E10 | no registrations | regression | L1 | automated | empty registry | full existing guard corpus from `localhost-guard.test.ts`, `identity-floor.test.ts`, `auth-plugin.test.ts` | every decision identical to baseline snapshot |
| E11 | requestPrincipal | decision table | L1 | automated | {trusted, untrusted plugin} × {principal set, D23 local-token, inert+loopback, inert+remote cookie, none} | `requestPrincipal(req)` | untrusted → always `null`; trusted → principal / local-operator / local-operator / `null` / `null` |
| E12 | serveApp mount | EP | L1 | automated | `dir` with `index.html`, `assets/app.3f9a.js`, `config.json`, `app.js.map`, `.env`, symlink → `/etc` | GET each + `/apps/wall/m/abc` + `/apps/wall` | assets 200 immutable; json/map/dotfile/symlink 404; deep link → index `no-store`; bare → 308 |
| E13 | serveApp guards | EP | L1 | automated | `dir: "/"`; second mount of `appId: "wall"`; untrusted plugin `appId: "wall"` first | `serveApp` | throws; throws; untrusted mounts nothing, trusted mount then succeeds |
| E14 | serveApp + CSP modes | decision table | L1 | automated | baseline mode ∈ {report, enforce, off}, mount with `csp: "default-src 'self'"` | GET `/apps/wall/` | enforcing `Content-Security-Policy` equals the app value in all three; report mode also has the baseline `-Report-Only` |
| E15 | auth plugin skips mounts | EP | L1 | automated | OAuth configured, no cookie, remote IP | GET `/apps/wall/` with `Accept: text/html`, GET `/apps/wall/assets/a.js` | 200 for both (no 302 to `/auth/login`, no 401) |
| E16 | namespace coverage | regression | L1 | automated | a `serveApp` mount and a hand-rolled `fastify.get("/apps/rogue/*")` | run `network-guard-namespace-coverage` enumeration | `serveApp` route passes; rogue route reported as offender |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | verifier cheap / hook overhead | micro-benchmark | L1 | automated | 10 000 injected GETs to non-matching paths, 3 registered prefixes vs none | added p95 per request — measure only, printed | single run |

### Frontend-quirk

_none (no UI in this change)_

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | throwing verifier denies | fault-injection (abort) | L1 | automated | verifier throws `Error("boom")` | anonymous GET under prefix | normal denial body; exactly one `[capability] reject` warn line without header values |
| X2 | capability logging | fault-injection (burst) | L1 | automated | 50 invalid-token GETs within 1 min | sequential inject | ≤ 1 `[capability] reject` line for that prefix, containing count `50`; no token substring in any captured log line |
| X3 | path redaction | EP | L1 | automated | GET `/api/plugins/x/s/abc123secret` with no/invalid token | guard denial | denial line names `/api/plugins/x/s/`; captured logs contain no `abc123secret` |
| X4 | no trust prompt | fault-injection | L1 | automated | LAN peer `192.168.1.50` (no forwarding headers), invalid token under prefix | GET | ring buffer unchanged; denial observer not called |
| X5 | disable sweeps | state-transition | L1 | automated | trusted plugin registered prefix; activation then disable (and a failed activation) | anonymous GET with a token the verifier accepts | denied after disable and after failed activation; re-activation can register again |
| X6 | end-to-end over the guard | fault-injection (untrusted network) | L3 | automated | docker harness, fixture trusted plugin registering `/api/plugins/fixture/s/` with a static token, request from a non-trusted client with `X-Forwarded-For` | browser `fetch` of `/api/plugins/fixture/s/ping` with and without the header, and `/apps/fixture/` | with header 200; without 403 `network_not_allowed`; `/apps/fixture/` loads |

---

## Coverage summary

- Requirements covered: 12/12 (plugin-capability-routes 6, trusted-networks 3, baseline-csp 1, oauth-authentication 1, + logging/redaction via D3)
- Scenarios by class: edge 16 · perf 1 · frontend 0 · error 6
- Scenarios by level: L1 22 · L2 0 · L3 1
- Scenarios by disposition: automated 23 · manual-only 0

## New infra needed

- A fixture trusted plugin for X6 in the docker harness (register a capability prefix and a `serveApp` mount). Extends the existing harness; no new level.
