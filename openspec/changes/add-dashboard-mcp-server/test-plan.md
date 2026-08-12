# Test Plan — add-dashboard-mcp-server

Stage: apply   Generated: 2026-08-11

## ⚠ Clarifications needed (7)

- [ ] **C1** — Token minting flow is unspecified, blocking M1–M4. Which channel mints a session-scoped token: the bridge WebSocket (the only path that proves session identity server-side, `pi-gateway.ts` `connections.get(sessionId)`), a REST endpoint authenticated by a device token, or the spawn path? Without this the "unspoofable" property has no test.
- [ ] **C2** — Token format, expiry, and restart persistence are unspecified, blocking M5, X9. Is the token opaque-256-bit like `paired-devices.ts`? Does it expire independently of its session? Does the registry survive a server restart, or do all tokens die on restart?
- [ ] **C3** — Revocation mechanism is unspecified, blocking A6, X8. Is there a revoke endpoint, a Settings surface, or is session-end the only invalidation path?
- [ ] **C4** — `subscriptions/listen` session-filter wire shape is unspecified, blocking S1–S6. The base `2026-07-28` params carry a fixed `notifications` filter with no session notion, so the per-session filter is a custom extension. What is the param name and shape, and what does an absent/empty filter mean — all sessions, no sessions, or a request error?
- [ ] **C5** — Legacy revision support is undecided, blocking D3. Does the server also serve 2025-06-18 / 2025-11-25? `server/discover` must list every supported version, so this must be answered before that scenario is concrete.
- [ ] **C6** — The reserved `mcpServers` key name is unspecified, blocking J6. What is the dashboard's entry name, and what makes it collision-safe against `iMCP` and future provisioners?
- [ ] **C7** — No performance thresholds exist anywhere in the spec, blocking P1–P4. What are the acceptable bounds for token verification per request, `tools/list` response, concurrent `subscriptions/listen` streams, and stream memory over a soak window?

> Resolve before the blocked scenarios (marked below) can be authored. C1–C3 correspond to tasks 1.2/1.3, C4 to task 1.4, C5 to task 1.5.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Req 1 405 | state-transition (illegal edge) | L1 | automated | running server, production mode | `GET /mcp` | status `405`, body is not SPA HTML |
| E2 | Req 1 405 | state-transition (illegal edge) | L1 | automated | running server, production mode | `DELETE /mcp` | status `405` |
| E3 | Req 1 405 dev | state-transition (illegal edge) | L2 | automated | server started with `--dev`, Vite proxy live | `GET /mcp` with no `Accept` header | status `405`, body is not the SPA document, request never reaches the not-found handler |
| E4 | Req 1 405 | decision-table (method × mode) | L1 | automated | server in dev and production | `PUT`, `PATCH`, `HEAD` on `/mcp` | documented status per method; no method silently falls through to the SPA fallback |
| E5 | Req 1 session id | EP (present/absent) | L1 | automated | valid `tools/list` POST carrying `Mcp-Session-Id: abc` | request dispatched | request succeeds, response carries no `Mcp-Session-Id` header |
| E6 | Req 1 session id | EP (invalid partition) | L1 | automated | POST carrying `Mcp-Session-Id` that is empty string | request dispatched | header ignored, no error raised on account of the header |
| E7 | Req 1 resume | EP | L1 | automated | POST carrying `Last-Event-ID: 42` | request dispatched | header ignored, no resumption attempted, response is a fresh result |
| E8 | Req 1 no handshake | state-transition (illegal edge) | L1 | automated | fresh client that has never called `initialize` | first-ever request is `tools/call` with `params._meta` protocol version | call executes, no handshake error |
| E9 | Req 1 no handshake | state-transition (illegal edge) | L1 | automated | client calls `initialize` explicitly | request dispatched | method reported unsupported, not silently accepted |
| E10 | Req 1 version | BVA (supported boundary) | L1 | automated | POST declaring `2026-07-28` | request dispatched | request succeeds |
| E11 | Req 1 version | BVA (just outside) | L1 | automated | POST declaring `2025-11-25` | request dispatched | `UnsupportedProtocolVersionError` |
| E12 | Req 1 version | BVA (malformed) | L1 | automated | POST declaring `"banana"`, and separately a null and a numeric version | request dispatched | `UnsupportedProtocolVersionError` for each, no unhandled exception |
| E13 | Req 1 version | EP (absent) | L1 | automated | POST with `params._meta` entirely absent | request dispatched | documented refusal, not a default-to-latest silent accept |
| E14 | Req 1 header/body | decision-table | L1 | automated | `MCP-Protocol-Version` header disagrees with `params._meta` version | request dispatched | `400 HeaderMismatch` |
| E15 | Req 1 header | EP (absent) | L1 | automated | POST with no `MCP-Protocol-Version` header | request dispatched | documented refusal per the 2026-07-28 MUST |
| E16 | Req 1 unknown method | state-transition (illegal edge) | L1 | automated | POST with `method: "tools/nope"` | request dispatched | `404` with JSON-RPC error `-32601` |
| E17 | Req 1 malformed | EP (invalid) | L1 | automated | body is not valid JSON; separately valid JSON that is not JSON-RPC | request dispatched | JSON-RPC parse/invalid-request error, no 500, no unhandled rejection |
| E18 | Req 1 statelessness | state-convergence | L1 | automated | two `tools/call` requests on separate connections, no shared state | second request issued after first completes | second result identical to issuing it first; no cross-request dependency |
| E19 | Req 2 discover | state-transition | L1 | automated | running server | `server/discover` | response carries supported versions, capabilities, and `serverInfo` naming the dashboard and its version |
| E20 | Req 2 discover | state-convergence | L1 | automated | two separate connections | `server/discover` on each | responses equivalent; no server-side state created (verify via a state probe before/after) |
| E21 | Req 3 allowlist | decision-table (verb class × exposure) | L1 | automated | advertised tool table | `tools/list` | contains no UI-only verb (`reorder_pinned_dirs`, `set_session_process_drawer`) and no transport verb (`subscribe`, `watch_files`, `worktree_init_subscribe`) |
| E22 | Req 3 completeness | decision-table | L1 | automated | advertised tool table enumerated at build time | completeness check runs | every entry resolves to an invocable handler; an entry without one fails the build |
| E23 | Req 3 completeness | fault-injection (negative control) | L1 | automated | a deliberately unresolvable tool added to the table in a fixture | completeness check runs | check FAILS — proves the gate is not vacuous |
| E24 | Req 3 denylist | decision-table | L1 | automated | advertised tool table | `tools/list` | does not expose `registerPiHandler`, `registerBrowserHandler`, `broadcastToSubscribers`, `emitEventToSession`, the raw Fastify instance, `getPluginConfig`, `updatePluginConfig`, or `logger` |
| E25 | Req 3 abort mapping | state-transition | L1 | automated | a live session | `abort` tool invoked | the general session-abort primitive is called, not the plugin-spawned-run hard-kill primitive |
| E26 | Req 3 handle arg | EP (valid/invalid/absent) | L1 | automated | `tools/call` with a valid `sessionId`, an unknown `sessionId`, and no `sessionId` | each dispatched | valid succeeds; unknown returns a not-found error; absent returns an invalid-params error; none falls back to connection-scoped state |
| E27 | Req 9 naming | decision-table | L1 | automated | plugin manifest claims | manifest loaded | no `command-route` claim equal to `/mcp` |
| E28 | Req 9 OAuth | state-transition | L2 | automated | MCP endpoint started, ports enumerated | endpoint boots | no OAuth callback port bound; no contention with the adapter's callback server |

### Access-control

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| A1 | Req 4 missing cred | EP (invalid partition) | L1 | automated | POST with no `Authorization` header, from a non-local address | request dispatched | refused; no tool executes (assert via a handler spy, not just status) |
| A2 | Req 4 bad cred | EP (invalid partition) | L1 | automated | POST with `Authorization: Bearer <garbage>`, and separately a well-formed but unknown token | request dispatched | refused in both cases |
| A3 | Req 4 loopback | EP (the carve-out boundary) | L1 | automated | POST to `/mcp` from a genuinely-local address, no `Authorization` header | request dispatched | refused — the loopback allowance does not apply to `/mcp` |
| A4 | Req 4 cookie leak | fault-injection (adjacent auth path) | L1 | automated | request carrying a valid `pi_dash_token` cookie but no `Authorization` header | POST `/mcp` | refused — proves the handler does not trust `request.isAuthenticated`, which the global hooks in `auth-plugin.ts` and `bearer-auth.ts` set for cookies and device tokens |
| A5 | Req 4 non-regression | EP (the invariant) | L1 | automated | genuinely-local request, no credential, to a non-`/mcp` route that previously allowed it | request dispatched | still allowed — the guard is unchanged elsewhere |
| A6 | Req 4 revocation | state-transition | L1 | automated | a credential valid at T0, revoked at T1 | request at T2 presenting it | refused [NEEDS CLARIFICATION: input — revocation mechanism for a session token, see C3] |
| A7 | Req 4 per-request | state-transition (illegal edge) | L1 | automated | one successful authenticated request on a connection | second request on the same connection with no `Authorization` header | refused — credential is per-request, not per-connection |
| A8 | Req 4 open-endpoint guard | fault-injection (negative control) | L1 | automated | the handler's auth check removed in a fixture | any unauthenticated POST | test FAILS — proves the suite would catch a forgotten auth hook, given `/mcp` sits outside `createNetworkGuard` |
| A9 | Req 4 header parsing | EP (malformed) | L1 | automated | `Authorization` values: empty, `Bearer`, `Bearer ` with trailing space, `Basic xyz`, a very long token | each dispatched | each refused, no crash, constant-time comparison path preserved |
| M1 | Req 5 mint | state-transition | L1 | automated | a live session with a proven identity channel | token minted | token resolves server-side to that session [NEEDS CLARIFICATION: trigger — minting channel, see C1] |
| M2 | Req 5 resolve | state-transition | L1 | automated | request presenting a session-scoped token | request dispatched | caller's originating session resolved from server-side records |
| M3 | Req 5 no self-claim | fault-injection (spoof attempt) | L1 | automated | request presenting device token but carrying a client-supplied field asserting a session id | request dispatched | the asserted field is ignored for identity; caller treated as sessionless |
| M4 | Req 5 mint attribution | fault-injection (spoof attempt) | L1 | automated | a mint request attempting to mint for a session other than the caller's own | mint attempted | refused [NEEDS CLARIFICATION: trigger — depends on minting channel, see C1] |
| M5 | Req 5 device token | EP | L1 | automated | request presenting a device-scoped paired-device token | request dispatched | caller has no originating session |
| M6 | Req 5 session end | state-transition | L1 | automated | a session with a live token | that session ends | token no longer authenticates any request |
| M7 | Req 5 session end race | state-transition (illegal edge) | L1 | automated | a request in flight when its session ends | session-end fires mid-request | documented outcome; no use-after-end that authenticates on a dead session |
| G1 | Req 6 self-target | decision-table (caller × target) | L1 | automated | caller whose token resolves to session A | session-targeting tool invoked with `sessionId: A` | refused; prompt not delivered (assert via `sendToSession` spy) |
| G2 | Req 6 slash command | state-transition (the aggravated path) | L1 | automated | caller resolving to session A | prompt tool targeting A with text beginning `/` | refused before reaching extension-command dispatch |
| G3 | Req 6 cross-session | decision-table | L1 | automated | caller resolving to session A | tool targeting session B | permitted, subject to remaining authorization |
| G4 | Req 6 sessionless | decision-table | L1 | automated | caller with no originating session (device token) | tool targeting any session | guard does not refuse |
| G5 | Req 6 observability | state-transition | L1 | automated | a refused self-targeted call | refusal occurs | refusal recorded with resolved caller session, target session, and tool name |
| G6 | Req 6 indirect loop | state-transition (the documented limit) | L1 | automated | caller A targets B, and a caller resolving to B targets A | both calls dispatched | both permitted — encodes the documented scope limit so a future force-kill/depth change is a deliberate spec edit, not an accident |
| G7 | Req 6 case/format | EP (identifier equality) | L1 | automated | target `sessionId` differing from the caller's only by case, whitespace, or surrounding quotes | tool invoked | still refused — equality is not bypassable by trivial mutation |

### Streaming

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| S1 | Req 7 delivery | state-convergence | L1 | automated | client opens `subscriptions/listen` scoped to session A | A emits an event | event delivered on that request's response stream [NEEDS CLARIFICATION: input — filter param shape, see C4] |
| S2 | Req 7 isolation | state-convergence (the leak case) | L1 | automated | subscription scoped to A | session B emits an event | B's event NOT delivered on A's stream |
| S3 | Req 7 empty filter | EP (the dangerous partition) | L1 | automated | `subscriptions/listen` with absent or empty filter | any session emits | documented behaviour, and it is not "fan out every session by default" [NEEDS CLARIFICATION: expected observable, see C4] |
| S4 | Req 7 teardown | state-transition | L1 | automated | an open stream | client closes the response stream | underlying `onEvent` subscription released (assert listener count returns to baseline) |
| S5 | Req 7 teardown fault | fault-injection (abort) | L1 | automated | an open stream | transport drops without a clean close | subscription still released; no listener leak |
| S6 | Req 7 repeated churn | soak | L1 | automated | open and abandon a stream 1000 times | churn loop | listener count returns to baseline; no unbounded growth [NEEDS CLARIFICATION: metric threshold, see C7] |
| S7 | Req 7 legacy methods | state-transition (illegal edge) | L1 | automated | client calls `resources/subscribe`, then `resources/unsubscribe` | each dispatched | reported unsupported |
| S8 | Req 7 GET stream | state-transition (illegal edge) | L1 | automated | client attempts a standalone HTTP GET event stream | request dispatched | `405` — covered by E1 but asserted here as the streaming-path invariant |
| S9 | Req 7 auth on stream | fault-injection | L1 | automated | stream opened with a valid token, token then revoked | events emitted after revocation | documented behaviour — stream terminated, or refusal on next event [NEEDS CLARIFICATION: expected observable, see C3] |

### Provisioning

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| J1 | Req 8 shape | decision-table | L1 | automated | provisioning writer runs | entry written | entry uses the HTTP-server shape with a `url`, not the stdio `command` shape `ensureMcpEntry` writes for `iMCP` |
| J2 | Req 8 protocol version | EP (the legacy trap) | L1 | automated | provisioning writer runs | entry written | `protocolVersion` is `auto` or a pinned `2026-07-28`, never omitted |
| J3 | Req 8 siblings | state-transition | L2 | automated | existing `mcp.json` containing an `iMCP` entry and one unrelated entry | writer runs against the real filesystem | both siblings preserved byte-identical |
| J4 | Req 8 atomicity | fault-injection (crash mid-write) | L2 | automated | writer interrupted between temp-file write and rename | interruption injected | original file intact; no partially-written file observable at the destination path |
| J5 | Req 8 unparseable | fault-injection (corrupt input) | L2 | automated | existing `mcp.json` containing invalid JSON, and separately valid JSON whose root is an array | writer runs | write refused and surfaced; existing file left unmodified in both cases |
| J6 | Req 8 name collision | decision-table | L1 | automated | existing config already containing an entry under the dashboard's intended key | writer runs | documented outcome; no silent clobber of a foreign entry [NEEDS CLARIFICATION: input — reserved key name, see C6] |
| J7 | Req 8 permissions | fault-injection (disk) | L2 | automated | `~/.pi/agent/` not writable | writer runs | clear surfaced error; no partial state; server continues to run |
| J8 | Req 8 absent file | EP (first-run partition) | L2 | automated | no `mcp.json` present at all | writer runs | file created with only the dashboard entry, valid JSON, correct permissions |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Prereq adapter floor | fault-injection (version) | L2 | automated | installed `pi-mcp-adapter` is 2.19.0 | runtime probe runs | clear diagnostic naming the required floor (2.20.0) and the installed version; not a silent legacy-handshake failure |
| X2 | Prereq adapter floor | BVA | L2 | automated | adapter at 2.19.x, 2.20.0, and 2.21.0 | probe runs at each | refusal/warn below 2.20.0, accept at and above it |
| X3 | Prereq adapter absent | fault-injection | L2 | automated | adapter not installed at all | probe runs | actionable diagnostic, no crash |
| X4 | Req 3 abort disconnected | fault-injection (dependency down) | L1 | automated | target session registered but its bridge is disconnected | `abort` tool invoked | documented outcome — `abortSession` returns false for a disconnected session, so the caller learns the abort did not take effect rather than seeing a false success |
| X5 | Req 3 spawn failure | fault-injection (subprocess) | L1 | automated | spawn fails or times out | `spawn_session` tool invoked | error surfaced to the MCP caller as a JSON-RPC error, no orphan process |
| X6 | Req 3 trust gate | fault-injection (gate closed) | L1 | automated | the first-party trust gate denies the plugin | `spawn_session` / `abort` invoked | tools degrade per the gate contract rather than throwing; behaviour documented |
| X7 | Req 1 concurrency | fault-injection (parallel) | L1 | automated | 50 concurrent `tools/call` requests with distinct handles | dispatched simultaneously | all resolve correctly; no cross-request state bleed; no unhandled rejection |
| X8 | Req 5 plugin load failure | fault-injection (lifecycle) | L1 | automated | the MCP plugin fails to load after tokens were minted | server runs without the plugin | no stale token authenticates anything [NEEDS CLARIFICATION: expected observable — depends on registry ownership, see C3] |
| X9 | Req 5 restart | state-transition (persistence) | L1 | automated | tokens minted, server restarted | restart completes | documented outcome — tokens either all survive or all die, never a partially-valid registry [NEEDS CLARIFICATION: expected observable, see C2] |
| X10 | Req 4 timing | fault-injection (side channel) | L1 | automated | token comparisons against a valid and an invalid token of equal length | many comparisons timed | comparison is constant-time, matching the `paired-devices.ts` `timingSafeEqual` discipline |
| X11 | Req 1 oversized input | BVA (size) | L1 | automated | request body at the limit, just over it, and a deeply-nested JSON payload | dispatched | bounded rejection, no unbounded memory growth, no stack overflow |
| X12 | Req 7 slow consumer | fault-injection (backpressure) | L1 | automated | a `subscriptions/listen` client that stops reading while events keep arriving | backpressure builds | bounded buffering with a documented drop or disconnect policy; server memory does not grow unbounded |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Req 4 auth cost | tail-latency | L1 | automated | sustained authenticated `tools/call` | p95 added latency of token verification | [NEEDS CLARIFICATION: threshold, see C7] |
| P2 | Req 3 tools/list | tail-latency | L1 | automated | repeated `tools/list` | p95 response time | [NEEDS CLARIFICATION: threshold, see C7] |
| P3 | Req 7 concurrent streams | throughput | L2 | automated | N concurrent `subscriptions/listen` streams with steady event flow | delivery latency and dropped-event count | [NEEDS CLARIFICATION: N and thresholds, see C7] |
| P4 | Req 7 soak | soak | L2 | automated | long-running streams under continuous events | RSS growth, listener count | [NEEDS CLARIFICATION: window and threshold, see C7] |

### Manual

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| V1 | Req 1–7 interop | exploratory | — | manual-only | a real external MCP client (Claude Desktop or Cursor) against a running dashboard | operator connects, discovers, lists tools, calls one, opens a subscription | [judgment: end-to-end interop with a real third-party client behaves sanely — no automatable observable without vendoring that client] |
| V2 | Req 8 local pi | exploratory | — | manual-only | a local pi session with the provisioned `mcp.json` entry and adapter ≥ 2.20.0 | operator drives a second session through the MCP tools | [judgment: negotiation succeeds and the round trip feels correct in practice] |
| V3 | Req 9 palette | exploratory | — | manual-only | dashboard with both the plugin and `pi-mcp-adapter` present | operator opens the command palette | [judgment: no confusing duplicate or shadowed `/mcp` entry] |

---

## Coverage summary

- Requirements covered: 9/9
- Total scenarios: 87
- Scenarios by class: edge 28 · access-control 23 (A9 + M7 + G7) · streaming 9 · provisioning 8 · error 12 · perf 4 · manual 3
- Scenarios by level: L1 72 · L2 12 · L3 0 · manual 3
- Scenarios by disposition: automated 84 · manual-only 3
- L2 rows: E3, E28, J3, J4, J5, J7, J8, X1, X2, X3, P3, P4
- Rows carrying a clarification marker: 13 (A6, M1, M4, S1, S3, S6, S9, J6, X8, X9, P1, P2, P3, P4 — counted once per row)

## New infra needed

- **L3 is intentionally empty.** This change adds a headless HTTP endpoint with no rendered UI, so routing scenarios to Playwright would be padding. If a token-management Settings surface is added later, its scenarios route to L3.
- **Negative-control tests (E23, A8)** assert that a gate fails when deliberately broken. Check for an existing mutation/negative-control pattern before building one.
- **Fault injection for atomic-write interruption (J4)** and **adapter version pinning (X2)** may need a fixture harness that does not exist yet in `qa/`.
