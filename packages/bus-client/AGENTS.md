# packages/bus-client

`@blackbelt-technology/pi-dashboard-bus-client`. Headless ticket-authenticated WebSocket bus client for the dashboard control plane.
Imports `packages/shared` protocol types. One connection carries: typed `send`, correlated `await`/`until`, bus-consistent `read`, `plugin` passthrough.
See change: add-dashboard-bus-client-scripting.

| File | Purpose |
|------|---------|
| `src/index.ts` | Barrel. Exports `BusClient`, `connect()` factory, error classes, `Ticket`, denylist, port helpers, `GENERATED_VERBS`/`VERB_INTERFACE`. |
| `src/client.ts` | `BusClient` class. `connect()`/`mintTicket()`/`connectWithTicket()` (ticket→WS→snapshot); `send<T extends BrowserToServerMessage>`; `waitFor`/`await`/`until` (structural, session-id keyed); `spawn`/`resume` (exact-correlated on spawnRequestId / resume_result.requestId, spawn fails fast on spawn_result failure — exact echo needs headless strategy); `prompt`; `plugin` (goal only, else NoPluginHandlerError); `read.sessions/session` (snapshot+deltas, metadata only). |
| `src/ticket.ts` | `Ticket` type, `TICKET_TTL_MS`=15000, `isTicketExpired`. Local mint-time + TTL used to classify expired vs consumed before open. |
| `src/errors.ts` | `BusError` + `.code`; `TicketExpiredError`, `TicketConsumedError`, `OffBoxError`, `BusTimeoutError`, `NoPluginHandlerError`. |
| `src/port-discovery.ts` | `discoverPort`/`discoverHost`. Order: explicit → DASHBOARD_PORT/DASHBOARD_HOST env → ~/.pi/dashboard/config.json → 8000/localhost. |
| `src/denylist.ts` | `CLIENT_INTERCEPTED_DENYLIST` (`plugin_config_write`), `isDenylisted`. Members intercepted to REST client-side; excluded from codegen. |
| `src/codegen/generate-verbs.ts` | `enumerateUnion(file,name)` via TS compiler API; `generate()` writes `src/generated/verbs.ts`. Enumerates `BrowserToServerMessage` minus denylist. Run: `npm run codegen`. |
| `src/generated/verbs.ts` | GENERATED — do not edit. `GENERATED_VERBS` (74 verb strings), `GeneratedVerb`, `VERB_INTERFACE`. |
| `src/__tests__/support/mock-server.ts` | L1 fixture. http `POST /api/ws-ticket` mint (or `denyMint`), WS upgrade validates+consumes ticket, sends sessions_snapshot on connect. `push`/`waitForMessage`/`setSessions`/`makeSession`. |
| `src/__tests__/connect.test.ts` | C1 — connect mints ticket, opens WS, resolves on snapshot. |
| `src/__tests__/ticket-expiry.test.ts` | C2 — expired ticket → TicketExpiredError (distinct from close). |
| `src/__tests__/ticket-reuse.test.ts` | C3 — consumed single-use ticket reuse → TicketConsumedError. |
| `src/__tests__/offbox-ticket-denied.test.ts` | C4 (L1 companion) — denied mint → OffBoxError, no hang. |
| `src/__tests__/send-types.test.ts` | S1 — runs `tsc -p tsconfig.fixtures.json` over the type-negative fixture; exit 0 proves bad sends rejected. |
| `src/__tests__/fixtures/bad-send.ts` | S1 fixture. `@ts-expect-error`-guarded malformed sends + well-formed sends. |
| `src/__tests__/verb-completeness.test.ts` | S2 — every GENERATED_VERBS entry has a server receiver (gateway switch / handlePiGatewayForward / registerHandler / plugin registerBrowserHandler). |
| `src/__tests__/codegen-denylist.test.ts` | S3 — plugin_config_write in raw union but excluded from GENERATED_VERBS. |
| `src/__tests__/spawn-correlation.test.ts` | A1 — spawn resolves on matching spawnRequestId, ignores decoy; + fail-fast on spawn_result failure. |
| `src/__tests__/until-convergence.test.ts` | A2 — until(s1,idle) resolves on s1 only, session-id keyed. |
| `src/__tests__/until-timeout.test.ts` | A3 — until timeout rejects naming (sid,status). |
| `src/__tests__/uncorrelated-request.test.ts` | A4 — request_models has no requestId; structural models_list match only. |
| `src/__tests__/plugin-unknown-id.test.ts` | P2 — plugin("flows",…) → NoPluginHandlerError, nothing sent. |
| `src/__tests__/read-live-consistent.test.ts` | R1 — read.sessions() reflects delta, no extra fetch. |
| `src/__tests__/read-metadata-only.test.ts` | R2 — read.session returns metadata+status, no messages/lastResponse. |
| `package.json` | `@blackbelt-technology/pi-dashboard-bus-client`. Deps: shared, ws. Scripts: build (tsc), codegen, test (vitest). |
| `tsconfig.json` | NodeNext, emits dist, excludes `src/__tests__`. |
| `tsconfig.fixtures.json` | noEmit typecheck over `src/__tests__/fixtures/**` for S1. |
| `vitest.config.ts` | node env, forks pool, include `src/**/__tests__/**/*.test.ts`. |
