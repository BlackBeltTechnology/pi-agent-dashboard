# Test Plan — extract-standalone-app-kit

Stage: design   Generated: 2026-10-03

All scenarios are L1 (vitest, `packages/app-kit/src/__tests__/`): the kit is client
plumbing with injected `fetch`, sockets and timers; its cross-origin behaviour against a
real host is exercised end to end by `add-team-plugin` (L3).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Runtime dashboard endpoint | EP | L1 | automated | config `{dashboardUrl:"https://dash.example.com"}` | `apiUrl("/api/sessions")`, `wsUrl("/ws")` | `https://dash.example.com/api/sessions`; `wss://dash.example.com/ws` |
| E2 | Runtime dashboard endpoint | EP | L1 | automated | config `{dashboardUrl:"http://10.0.0.5:8000"}` | `wsUrl("/ws")` | `ws://10.0.0.5:8000/ws` |
| E3 | Runtime dashboard endpoint | EP (invalid) | L1 | automated | `dashboardUrl` = `javascript:alert(1)`, `https://u:p@dash.example.com`, `ftp://x` | `configureDashboard` | throws `invalid_dashboard_url` for each; fetch spy called 0 times |
| E4 | Runtime dashboard endpoint | decision table | L1 | automated | `/config.json` responses: `{}` · `{"dashboardUrl":""}` · 404 · 200 HTML · network error · `[]` — each with and without `allowMissing` | `loadAppConfig` | `{}`/`""` → same origin (both); 404/HTML → `app_config_unavailable` without, same origin with `allowMissing`; network error and `[]` → `app_config_unavailable` (both) |
| E5 | Runtime dashboard endpoint | EP | L1 | automated | base `https://dash.example.com`; absolute `wss://other.example.com/ws` | `wsUrl(abs)` | returned unchanged |
| E6 | Identity mode | decision table | L1 | automated | descriptor bodies: none yet · `{active:false}` · `{active:true,issuer,clientId}` · `{active:true,loginUrl}` · malformed JSON · 500 | read descriptor | modes `unknown` · `none` · `oidc` · `unavailable` · `unavailable` · `unavailable` |
| E7 | Authenticated transport | decision table | L1 | automated | mode × token × explicit header: (oidc,t1,–) (oidc,–,–) (unknown,–,–) (unavailable,–,–) (none,–,–) (oidc,t1,`Authorization: X`) | `authedFetch("/api/x")` | `Bearer t1` · throws `NoCredentialError`, 0 fetches · throws, 0 · throws, 0 · sent without `Authorization` · header `X` kept |
| E8 | Authenticated transport | EP | L1 | automated | mode `oidc`, token `t1` | `authedFetch("https://evil.example/x")` | request sent with no `Authorization` header |
| E9 | Authenticated transport | EP | L1 | automated | any mode | `authedFetch` | fetch init has `credentials: "omit"` |
| E10 | WebSocket ticket and URL | decision table | L1 | automated | mode × ticket mint result: (oidc, `k1`) (oidc, mint fails) (none, –) (unknown, –) (unavailable, –) | `ticketSocketUrl("/ws")` | `<wsBase>/ws?ticket=k1` with no token substring · `null` · plain `<wsBase>/ws` · `null` · `null` |
| E11 | WebSocket ticket and URL | EP | L1 | automated | mode `oidc`, ticket available | `ticketSocketUrl("wss://other.example.com/ws")` | URL returned with no `ticket` param; mint endpoint not called |
| E12 | OIDC PKCE configuration | EP | L1 | automated | descriptor `{issuer:"https://kc/realms/r",clientId:"team-web"}`, redirect `https://app/auth/callback` | `buildOidcConfig` | `authority`=issuer, `client_id`=`team-web`, `response_type:"code"`, no `client_secret`, user store backed by `sessionStorage`, `redirect_uri` as given, `automaticSilentRenew:true` |
| E13 | Product-neutral package | static scan | L1 | automated | kit `src/**` | grep | no `/api/plugins/` literal, no `@blackbelt-technology/pi-dashboard-web` import, no issuer/client-id literal; `.` entry files import neither `react` nor `react-oidc-context` |
| E14 | Product-neutral package | static check | L1 | automated | `packages/app-kit/package.json` | read | `private` absent, `publishConfig.access:"public"`, `license` set, `files` excludes `**/AGENTS.md` and `**/*.AGENTS.md`, exports `.` and `./react` |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Identity context | state-transition | L1 | automated | `OidcIdentityBridge` with fake OIDC user token `a` | user renews to token `b` | next `authedFetch` carries `Bearer b` |
| F2 | Identity context | state-transition | L1 | automated | signed-in bridge | `signOut()`; separately a `401` refusal | identity-state token cleared; following `authedFetch` throws `NoCredentialError` |
| F3 | Identity context | EP | L1 | automated | mode `none` | render bridge | no OIDC redirect started (signinRedirect spy 0 calls); operator exposed as local operator |
| F4 | Identity context | EP | L1 | automated | bridge with `resolveRole` resolving `"admin"`; without `resolveRole` | render | role `"admin"`; role `null` — no network call to any `/api/plugins/` path |
| F5 | Reconnecting socket | state-transition | L1 | automated | fake socket + injected timers, `resolveUrl` returns `ws://h/ws?ticket=k1`, `k2`, `k3` | drop twice | `resolveUrl` called 3×, sockets opened with `k1`,`k2`,`k3` in order |
| F6 | Reconnecting socket | BVA | L1 | automated | every attempt fails, `maxRetries` = 0 · 1 · 3 | run | total attempts 1 · 2 · 4, then status `disconnected`, no further timer scheduled |
| F7 | Reconnecting socket | state-transition (illegal edge) | L1 | automated | open socket | `close()` then fake close event | no retry timer scheduled; status not `reconnecting` |
| F8 | Reconnecting socket | state-transition | L1 | automated | open socket | `error` then `close` events | exactly one retry timer scheduled |
| F9 | Reconnecting socket | compatibility | L1 | automated | InvoiceBot option shape `{url, resolveUrl, createSocket, setTimer, clearTimer, random, baseDelayMs, maxDelayMs, jitterRatio}` | type-check + run ported `chat-session-reconnect` cases | compiles; ported cases green |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Login descriptor fails closed | fault-injection (abort) | L1 | automated | descriptor fetch rejects (network) | read, then `authedFetch` | mode `unavailable`; `authedFetch` throws `NoCredentialError`, 0 fetches |
| X2 | Identity mode | fault-injection | L1 | automated | mode `none`, host answers 403 | `authedFetch` | caller receives `not_admitted`; no sign-in started |
| X3 | Authenticated transport | fault-injection | L1 | automated | host answers 401 to `Bearer t1` | `authedFetch` | session-refused listener called once for that request |
| X4 | Reconnecting socket | fault-injection (abort) | L1 | automated | `resolveUrl` returns `null`; separately rejects | connect | status `disconnected` immediately; 0 retry timers |

---

## Coverage summary

- Requirements covered: 9/9
- Scenarios by class: edge 14 · perf 0 · frontend 9 · error 4
- Scenarios by level: L1 27 · L2 0 · L3 0
- Scenarios by disposition: automated 27 · manual-only 0

## New infra needed

- none (vitest + jsdom, injected fetch/socket/timers)
