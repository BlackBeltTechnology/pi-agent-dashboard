## 1. Resolve blocking decisions (gate — complete before any code)

- [ ] 1.1 Resolve the session-token-dies-with-session vs device-token-has-no-identity contradiction; record the outcome in design.md Decision 4 and update the affected spec scenarios
- [ ] 1.2 Answer test-plan C1: specify the per-session token minting channel, what authenticates the mint, and how the mint is attributed to the caller's live session; unblocks M1 and M4
- [ ] 1.3 Answer test-plan C2: specify token format, expiry, and restart persistence; unblocks M5 and X9
- [ ] 1.4 Answer test-plan C3: specify the revocation mechanism and its relationship to session end; unblocks A6, S9, X8
- [ ] 1.5 Answer test-plan C4: define the subscriptions/listen session-filter param name and shape, and the meaning of an absent or empty filter; unblocks S1, S2, S3
- [ ] 1.6 Answer test-plan C5: decide whether legacy revisions 2025-06-18 and 2025-11-25 are served, and align the server/discover requirement; unblocks E19
- [ ] 1.7 Answer test-plan C6: fix the reserved mcpServers key name for the dashboard entry; unblocks J6
- [ ] 1.8 Answer test-plan C7: set performance thresholds for token verification, tools/list, concurrent streams, and soak; unblocks P1 through P4
- [ ] 1.9 Decide whether MCP needs a force-kill path, given abortSession is soft-only and the excluded abortSpawnedRun holds the only kill ladder; record the outcome and align X4

## 2. Correct known artifact defects

- [ ] 2.1 Fix the plugin-route precedent count in design.md from nine to eight and drop subagents-plugin, whose server entry registers no custom REST routes
- [ ] 2.2 Correct the ServerPluginContext member count in design.md from 18 to 19 and extend the allowlist and denylist tables to cover getPluginConfig, updatePluginConfig, and logger
- [ ] 2.3 Reword the /mcp auth carve-out: createNetworkGuard is applied per-route, so /mcp sits outside it rather than opting out of it, and must self-guard
- [ ] 2.4 Add the missing 2026-07-28 conformance requirements to the spec deltas: MCP-Protocol-Version required per POST, header-versus-body mismatch returning 400 HeaderMismatch, and unknown method returning 404 with JSON-RPC -32601
- [ ] 2.5 Add a spec scenario requiring the mcp.json entry to use an HTTP-server shape with a url rather than the stdio command shape ensureMcpEntry writes
- [ ] 2.6 Add a spec scenario pinning the reserved mcpServers key decided in 1.7

## 3. Plugin scaffold and route registration

- [ ] 3.1 Scaffold packages/mcp-server-plugin/ with a manifest and server entry, following packages/kb-plugin/src/server/index.ts for the ctx.fastify registration pattern
- [ ] 3.2 Register POST /mcp on the Fastify instance supplied by ServerPluginContext
- [ ] 3.3 Register explicit GET and DELETE handlers on /mcp returning 405 so the method never falls through to setNotFoundHandler
- [ ] 3.4 Decide and implement the response for PUT, PATCH, and HEAD on /mcp per the decision in 2.4

## 4. Stateless protocol conformance

- [ ] 4.1 Implement JSON-RPC dispatch with no initialize handshake, reading protocol version and client capabilities from params._meta
- [ ] 4.2 Ignore inbound Mcp-Session-Id and never mint or echo one on a response
- [ ] 4.3 Ignore inbound Last-Event-ID and never attempt stream resumption
- [ ] 4.4 Implement MCP-Protocol-Version header validation, header-versus-body mismatch handling, and UnsupportedProtocolVersionError
- [ ] 4.5 Implement unknown-method handling returning 404 with JSON-RPC -32601
- [ ] 4.6 Implement bounded request-body limits and malformed-payload handling

## 5. server/discover

- [ ] 5.1 Implement the server/discover RPC advertising supported protocol versions, capabilities, and serverInfo identifying the dashboard and its version
- [ ] 5.2 Ensure server/discover creates no server-side state

## 6. Auth boundary

- [ ] 6.1 Implement credential verification local to the /mcp handler, reading the Authorization header directly and never trusting request.isAuthenticated
- [ ] 6.2 Implement constant-time token comparison following the timingSafeEqual discipline in packages/server/src/pairing/paired-devices.ts
- [ ] 6.3 Verify no OAuth flow is introduced and no OAuth callback port is bound

## 7. Per-session tokens

- [ ] 7.1 Implement the token registry with opaque tokens hashed at rest, following packages/server/src/pairing/paired-devices.ts
- [ ] 7.2 Implement the minting flow decided in 1.2
- [ ] 7.3 Implement revocation and session-end invalidation decided in 1.4
- [ ] 7.4 Implement restart persistence behaviour decided in 1.3
- [ ] 7.5 Resolve caller identity from the presented token only, never from a client-supplied claim

## 8. Self-target refusal

- [ ] 8.1 Refuse any session-targeting tool call whose target equals the caller's server-resolved originating session
- [ ] 8.2 Ensure refusal happens before extension-command dispatch for slash-prefixed prompt text
- [ ] 8.3 Record each refusal with resolved caller session, target session, and tool name
- [ ] 8.4 Document in design.md that the guard catches direct self-targeting only, and state explicitly whether an indirect two-session loop is in or out of scope

## 9. Tool surface

- [ ] 9.1 Define the allowlist mapping ServerPluginContext members to MCP tools, using abortSession rather than abortSpawnedRun for the general abort tool
- [ ] 9.2 Implement tools/list and tools/call taking the target session as an ordinary sessionId argument
- [ ] 9.3 Implement the build-failing completeness check asserting every advertised tool resolves to an invocable handler

## 10. Event streaming

- [ ] 10.1 Implement subscriptions/listen as a long-lived POST-response stream over ServerPluginContext.onEvent using the filter contract from 1.5
- [ ] 10.2 Filter delivery per subscription so a subscriber receives only its requested sessions' events
- [ ] 10.3 Release the underlying subscription when the response stream closes from either the client or the transport
- [ ] 10.4 Report resources/subscribe and resources/unsubscribe as unsupported
- [ ] 10.5 Implement a bounded backpressure policy for a slow consumer

## 11. mcp.json provisioning

- [ ] 11.1 Implement the provisioning writer using the merge-only, atomic-rename, refuse-unparseable discipline of packages/apple-tools/src/mcp-config.ts
- [ ] 11.2 Write the entry with the HTTP-server shape and a protocolVersion of auto or a pinned 2026-07-28, never omitted
- [ ] 11.3 Implement the runtime probe for the installed pi-mcp-adapter version with a clear diagnostic below 2.20.0
- [ ] 11.4 Decide and implement whether PluginRequirements gains a version-floor field or the floor stays a documented prerequisite, updating packages/shared/src/recommended-extensions.ts accordingly

## 12. Tests — protocol conformance (L1)

- [ ] 12.1 Assert GET /mcp returns 405 in production mode — running server, production mode · GET /mcp · status 405 and body is not SPA HTML — see packages/kb-plugin/src/server/__tests__/kb-routes.test.ts (test-plan #E1)
- [ ] 12.2 Assert DELETE /mcp returns 405 — running server, production mode · DELETE /mcp · status 405 — see packages/kb-plugin/src/server/__tests__/kb-routes.test.ts (test-plan #E2)
- [ ] 12.3 Assert PUT, PATCH and HEAD on /mcp behave per decision 2.4 — server in dev and production · each method issued · documented status per method with no silent SPA fallback — see packages/server/src/__tests__/tool-routes.test.ts (test-plan #E4)
- [ ] 12.4 Assert an inbound Mcp-Session-Id is ignored — valid tools/list POST carrying Mcp-Session-Id abc · request dispatched · succeeds and response carries no Mcp-Session-Id — see packages/server/src/__tests__/tool-routes.test.ts (test-plan #E5)
- [ ] 12.5 Assert an empty Mcp-Session-Id is ignored without error — POST with empty-string Mcp-Session-Id · request dispatched · header ignored, no error raised on account of it — see packages/server/src/__tests__/tool-routes.test.ts (test-plan #E6)
- [ ] 12.6 Assert Last-Event-ID is ignored and no resumption occurs — POST carrying Last-Event-ID 42 · request dispatched · header ignored, fresh result returned — see packages/server/src/__tests__/tool-routes.test.ts (test-plan #E7)
- [ ] 12.7 Assert a first-ever request succeeds with no handshake — fresh client that never called initialize · first request is tools/call with params._meta version · call executes with no handshake error — see packages/kb-plugin/src/server/__tests__/kb-routes.test.ts (test-plan #E8)
- [ ] 12.8 Assert an explicit initialize call is reported unsupported — client calls initialize · request dispatched · method reported unsupported, not silently accepted — see packages/server/src/__tests__/tool-routes.test.ts (test-plan #E9)
- [ ] 12.9 Assert the supported version boundary — POST declaring 2026-07-28 · request dispatched · request succeeds — see packages/server/src/__tests__/tool-routes.test.ts (test-plan #E10)
- [ ] 12.10 Assert the just-outside version boundary — POST declaring 2025-11-25 · request dispatched · UnsupportedProtocolVersionError — see packages/server/src/__tests__/tool-routes.test.ts (test-plan #E11)
- [ ] 12.11 Assert malformed versions are refused — POST declaring banana, null, and a numeric version · each dispatched · UnsupportedProtocolVersionError each time with no unhandled exception — see packages/server/src/__tests__/tool-routes.test.ts (test-plan #E12)
- [ ] 12.12 Assert an absent params._meta is refused rather than defaulting to latest — POST with params._meta absent · request dispatched · documented refusal, no silent default — see packages/server/src/__tests__/tool-routes.test.ts (test-plan #E13)
- [ ] 12.13 Assert header-versus-body version mismatch returns 400 HeaderMismatch — MCP-Protocol-Version header disagrees with params._meta · request dispatched · 400 HeaderMismatch — see packages/server/src/__tests__/tool-routes.test.ts (test-plan #E14)
- [ ] 12.14 Assert an absent MCP-Protocol-Version header is refused — POST with no such header · request dispatched · documented refusal per the 2026-07-28 MUST — see packages/server/src/__tests__/tool-routes.test.ts (test-plan #E15)
- [ ] 12.15 Assert an unknown method returns 404 with -32601 — POST with method tools/nope · request dispatched · 404 and JSON-RPC error -32601 — see packages/server/src/__tests__/tool-routes.test.ts (test-plan #E16)
- [ ] 12.16 Assert malformed bodies produce JSON-RPC errors not 500s — body is invalid JSON, and separately valid JSON that is not JSON-RPC · request dispatched · parse or invalid-request error, no 500, no unhandled rejection — see packages/server/src/__tests__/tool-routes.test.ts (test-plan #E17)
- [ ] 12.17 Assert request independence — two tools/call requests on separate connections · second issued after the first · result identical to issuing it first, no cross-request dependency — see packages/kb-plugin/src/server/__tests__/kb-routes.test.ts (test-plan #E18)
- [ ] 12.18 Assert oversized and deeply-nested payloads are bounded — body at the limit, just over it, and deeply nested · dispatched · bounded rejection, no unbounded memory growth, no stack overflow — see packages/server/src/__tests__/browser-gateway-load.test.ts (test-plan #X11)
- [ ] 12.19 Assert concurrent calls do not bleed state — 50 concurrent tools/call requests with distinct handles · dispatched simultaneously · all resolve correctly, no cross-request state bleed, no unhandled rejection — see packages/server/src/__tests__/browser-gateway-load.test.ts (test-plan #X7)

## 13. Tests — protocol conformance in dev mode and at process level (L2)

- [ ] 13.1 Assert 405 holds in dev mode behind the Vite proxy — server started with --dev and Vite proxy live · GET /mcp with no Accept header · status 405, body is not the SPA document, request never reaches the not-found handler — see qa/tests/02-server-start.sh (test-plan #E3)
- [ ] 13.2 Assert no OAuth callback port is bound — MCP endpoint started and ports enumerated · endpoint boots · no OAuth callback port bound and no contention with the adapter callback server — see qa/tests/02-server-start.sh (test-plan #E28)

## 14. Tests — server/discover and tool surface (L1)

- [ ] 14.1 Assert discover advertises versions, capabilities and identity — running server · server/discover · response carries supported versions, capabilities, and serverInfo naming the dashboard and its version — see packages/server/src/__tests__/tool-routes.test.ts (test-plan #E19)
- [ ] 14.2 Assert discover is repeatable and side-effect free — two separate connections · server/discover on each · responses equivalent and no server-side state created, verified by a state probe before and after — see packages/kb-plugin/src/server/__tests__/kb-routes.test.ts (test-plan #E20)
- [ ] 14.3 Assert UI-only and transport verbs are absent from tools/list — advertised tool table · tools/list · contains no reorder_pinned_dirs, set_session_process_drawer, subscribe, watch_files or worktree_init_subscribe — see packages/server/src/__tests__/tool-routes.test.ts (test-plan #E21)
- [ ] 14.4 Assert the completeness check passes for the real table — advertised tool table enumerated at build time · completeness check runs · every entry resolves to an invocable handler — see packages/bus-client/src/codegen for the existing verb-completeness pattern (test-plan #E22)
- [ ] 14.5 Assert the completeness check is not vacuous — a deliberately unresolvable tool added to the table in a fixture · completeness check runs · the check FAILS — see packages/bus-client/src/codegen for the existing verb-completeness pattern (test-plan #E23)
- [ ] 14.6 Assert denylisted context members are not exposed — advertised tool table · tools/list · does not expose registerPiHandler, registerBrowserHandler, broadcastToSubscribers, emitEventToSession, the raw Fastify instance, getPluginConfig, updatePluginConfig or logger — see packages/server/src/__tests__/tool-routes.test.ts (test-plan #E24)
- [ ] 14.7 Assert abort maps to the general primitive — a live session · abort tool invoked · the general session-abort primitive is called, not the plugin-spawned-run hard-kill primitive — see packages/automation-plugin/src/server/__tests__/plugin-action-handler.test.ts (test-plan #E25)
- [ ] 14.8 Assert sessionId is an ordinary argument with proper validation — tools/call with a valid sessionId, an unknown one, and none · each dispatched · valid succeeds, unknown returns not-found, absent returns invalid-params, none falls back to connection state — see packages/server/src/__tests__/tool-routes.test.ts (test-plan #E26)
- [ ] 14.9 Assert no command-route claim equals /mcp — plugin manifest claims · manifest loaded · no command-route claim equal to /mcp — see packages/apple-tools/src/__tests__/package-manifest.test.ts (test-plan #E27)

## 15. Tests — auth boundary (L1)

- [ ] 15.1 Assert a missing credential is refused and no tool runs — POST with no Authorization from a non-local address · request dispatched · refused and no tool executes, asserted via a handler spy — see packages/server/src/__tests__/bearer-auth.test.ts (test-plan #A1)
- [ ] 15.2 Assert bad and unknown credentials are refused — POST with garbage bearer, and separately a well-formed unknown token · request dispatched · refused in both cases — see packages/server/src/__tests__/bearer-auth.test.ts (test-plan #A2)
- [ ] 15.3 Assert loopback does not bypass auth on /mcp — POST to /mcp from a genuinely-local address with no Authorization · request dispatched · refused, the loopback allowance does not apply — see packages/server/src/__tests__/genuine-local.test.ts (test-plan #A3)
- [ ] 15.4 Assert a cookie-authenticated browser cannot reach /mcp — request carrying a valid pi_dash_token cookie but no Authorization · POST /mcp · refused, proving the handler does not trust request.isAuthenticated set by the global hooks — see packages/server/src/__tests__/auth-plugin.test.ts (test-plan #A4)
- [ ] 15.5 Assert the loopback allowance is unchanged elsewhere — genuinely-local request with no credential to a non-/mcp route that previously allowed it · request dispatched · still allowed — see packages/server/src/__tests__/localhost-guard.test.ts (test-plan #A5)
- [ ] 15.6 Assert a revoked credential loses access immediately — a credential valid at T0 and revoked at T1 · request at T2 presenting it · refused — see packages/server/src/__tests__/paired-devices.test.ts (test-plan #A6)
- [ ] 15.7 Assert credentials are per-request not per-connection — one successful authenticated request · second request on the same connection with no Authorization · refused — see packages/server/src/__tests__/bearer-auth.test.ts (test-plan #A7)
- [ ] 15.8 Assert the suite catches a removed auth check — the handler auth check removed in a fixture · any unauthenticated POST · the test FAILS, proving a forgotten hook would be caught given /mcp sits outside createNetworkGuard — see packages/server/src/__tests__/bearer-auth.test.ts (test-plan #A8)
- [ ] 15.9 Assert malformed Authorization values are handled safely — values empty, Bearer, Bearer with trailing space, Basic xyz, and a very long token · each dispatched · each refused with no crash and the constant-time path preserved — see packages/server/src/__tests__/bearer-auth.test.ts (test-plan #A9)
- [ ] 15.10 Assert token comparison is constant-time — comparisons against a valid and an invalid token of equal length · many comparisons timed · constant-time behaviour matching the paired-devices timingSafeEqual discipline — see packages/server/src/__tests__/paired-devices.test.ts (test-plan #X10)

## 16. Tests — per-session tokens and self-target guard (L1)

- [ ] 16.1 Assert a minted token resolves to its session — a live session with a proven identity channel · token minted · token resolves server-side to that session — see packages/server/src/__tests__/paired-devices.test.ts (test-plan #M1)
- [ ] 16.2 Assert caller identity is resolved from the token — request presenting a session-scoped token · request dispatched · originating session resolved from server-side records — see packages/server/src/__tests__/paired-devices.test.ts (test-plan #M2)
- [ ] 16.3 Assert a client-supplied session claim is ignored — request presenting a device token but carrying a field asserting a session id · request dispatched · the asserted field is ignored and the caller is treated as sessionless — see packages/server/src/__tests__/bearer-auth.test.ts (test-plan #M3)
- [ ] 16.4 Assert minting for a foreign session is refused — a mint request attempting to mint for a session other than the caller's own · mint attempted · refused — see packages/server/src/__tests__/pairing.test.ts (test-plan #M4)
- [ ] 16.5 Assert a device token yields no originating session — request presenting a device-scoped paired-device token · request dispatched · caller has no originating session — see packages/server/src/__tests__/paired-devices.test.ts (test-plan #M5)
- [ ] 16.6 Assert a token dies with its session — a session with a live token · that session ends · token no longer authenticates any request — see packages/server/src/__tests__/automation-session-close.test.ts (test-plan #M6)
- [ ] 16.7 Assert no use-after-end authentication race — a request in flight when its session ends · session-end fires mid-request · documented outcome with no authentication against a dead session — see packages/server/src/__tests__/automation-session-close.test.ts (test-plan #M7)
- [ ] 16.8 Assert a self-targeted call is refused — caller whose token resolves to session A · session-targeting tool invoked with sessionId A · refused and prompt not delivered, asserted via a sendToSession spy — see packages/automation-plugin/src/server/__tests__/plugin-action-handler.test.ts (test-plan #G1)
- [ ] 16.9 Assert a self-targeted slash command is refused before dispatch — caller resolving to session A · prompt tool targeting A with text beginning with a slash · refused before reaching extension-command dispatch — see packages/automation-plugin/src/server/__tests__/plugin-action-handler.test.ts (test-plan #G2)
- [ ] 16.10 Assert cross-session control is permitted — caller resolving to session A · tool targeting session B · permitted subject to remaining authorization — see packages/automation-plugin/src/server/__tests__/plugin-action-handler.test.ts (test-plan #G3)
- [ ] 16.11 Assert a sessionless caller is unaffected by the guard — caller with no originating session using a device token · tool targeting any session · guard does not refuse — see packages/automation-plugin/src/server/__tests__/plugin-action-handler.test.ts (test-plan #G4)
- [ ] 16.12 Assert refusals are observable — a refused self-targeted call · refusal occurs · recorded with resolved caller session, target session and tool name — see packages/server/src/__tests__/spawned-turn-log.test.ts (test-plan #G5)
- [ ] 16.13 Assert the documented indirect-loop limit — caller A targets B and a caller resolving to B targets A · both dispatched · both permitted, encoding the scope limit so a future change is a deliberate spec edit — see packages/automation-plugin/src/server/__tests__/plugin-action-handler.test.ts (test-plan #G6)
- [ ] 16.14 Assert identifier equality is not bypassable — target sessionId differing from the caller's only by case, whitespace or surrounding quotes · tool invoked · still refused — see packages/server/src/__tests__/auto-attach-slug-defense.test.ts (test-plan #G7)
- [ ] 16.15 Assert no stale token survives a plugin load failure — the MCP plugin fails to load after tokens were minted · server runs without the plugin · no stale token authenticates anything — see packages/server/src/__tests__/boot-state.test.ts (test-plan #X8)
- [ ] 16.16 Assert restart leaves no partially-valid registry — tokens minted then server restarted · restart completes · tokens either all survive or all die, never partially valid — see packages/server/src/__tests__/boot-state.test.ts (test-plan #X9)

## 17. Tests — event streaming (L1)

- [ ] 17.1 Assert subscribed session events are delivered — client opens subscriptions/listen scoped to session A · A emits an event · event delivered on that request's response stream — see packages/server/src/__tests__/browser-gateway-snapshot-on-connect.test.ts (test-plan #S1)
- [ ] 17.2 Assert unsubscribed sessions do not leak — subscription scoped to A · session B emits an event · B's event is not delivered on A's stream — see packages/server/src/__tests__/browser-gateway-plugin-action-fanout.test.ts (test-plan #S2)
- [ ] 17.3 Assert the empty-filter case is not fan-out-everything — subscriptions/listen with an absent or empty filter · any session emits · documented behaviour that is not defaulting to every session — see packages/server/src/__tests__/browser-gateway-plugin-action-fanout.test.ts (test-plan #S3)
- [ ] 17.4 Assert clean teardown releases the subscription — an open stream · client closes the response stream · underlying onEvent subscription released with listener count back to baseline — see packages/server/src/__tests__/browser-gateway-shutdown-reject.test.ts (test-plan #S4)
- [ ] 17.5 Assert an aborted transport still releases the subscription — an open stream · transport drops without a clean close · subscription released with no listener leak — see packages/server/src/__tests__/browser-gateway-shutdown-reject.test.ts (test-plan #S5)
- [ ] 17.6 Assert repeated stream churn does not leak — open and abandon a stream 1000 times · churn loop · listener count returns to baseline with no unbounded growth — see packages/server/src/embed-lifecycle/__tests__/reclamation-soak.test.ts (test-plan #S6)
- [ ] 17.7 Assert legacy subscription methods are unsupported — client calls resources/subscribe then resources/unsubscribe · each dispatched · reported unsupported — see packages/server/src/__tests__/tool-routes.test.ts (test-plan #S7)
- [ ] 17.8 Assert there is no standalone GET event stream — client attempts a standalone HTTP GET event stream · request dispatched · 405 — see packages/kb-plugin/src/server/__tests__/kb-routes.test.ts (test-plan #S8)
- [ ] 17.9 Assert revocation affects a live stream — stream opened with a valid token then the token revoked · events emitted after revocation · documented behaviour, stream terminated or refusal on next event — see packages/server/src/__tests__/paired-devices.test.ts (test-plan #S9)
- [ ] 17.10 Assert a slow consumer is bounded — a subscriptions/listen client that stops reading while events keep arriving · backpressure builds · bounded buffering with a documented drop or disconnect policy and no unbounded memory growth — see packages/server/src/__tests__/browser-gateway-dropped-frames.test.ts (test-plan #X12)

## 18. Tests — provisioning and tool error handling

- [ ] 18.1 Assert the entry uses the HTTP-server shape — provisioning writer runs · entry written · entry carries a url and not the stdio command shape used for iMCP — see packages/apple-tools/src/__tests__/mcp-config.test.ts (test-plan #J1)
- [ ] 18.2 Assert protocolVersion is never omitted — provisioning writer runs · entry written · protocolVersion is auto or a pinned 2026-07-28 — see packages/apple-tools/src/__tests__/mcp-config.test.ts (test-plan #J2)
- [ ] 18.3 Assert the reserved key does not clobber a foreign entry — existing config already containing an entry under the dashboard's intended key · writer runs · documented outcome with no silent clobber — see packages/apple-tools/src/__tests__/mcp-config.test.ts (test-plan #J6)
- [ ] 18.4 Assert siblings survive a real-filesystem write — existing mcp.json with an iMCP entry and one unrelated entry · writer runs against the real filesystem · both siblings preserved byte-identical — see qa/tests/13-openspec-offline-regen.sh (test-plan #J3)
- [ ] 18.5 Assert the write is atomic under interruption — writer interrupted between temp-file write and rename · interruption injected · original intact and no partial file observable at the destination — see packages/apple-tools/src/__tests__/env-atomic-write.test.ts (test-plan #J4)
- [ ] 18.6 Assert an unparseable config is refused not repaired — existing mcp.json with invalid JSON, and separately valid JSON whose root is an array · writer runs · write refused and surfaced with the file left unmodified in both cases — see packages/apple-tools/src/__tests__/mcp-config.test.ts (test-plan #J5)
- [ ] 18.7 Assert an unwritable config directory fails cleanly — ~/.pi/agent/ not writable · writer runs · clear surfaced error, no partial state, server continues running — see qa/tests/01-install.sh (test-plan #J7)
- [ ] 18.8 Assert first-run creation with no existing file — no mcp.json present · writer runs · file created with only the dashboard entry, valid JSON, correct permissions — see qa/tests/01-install.sh (test-plan #J8)
- [ ] 18.9 Assert the adapter version floor is diagnosed — installed pi-mcp-adapter is 2.19.0 · runtime probe runs · clear diagnostic naming required floor 2.20.0 and the installed version, not a silent legacy-handshake failure — see qa/tests/01-install.sh (test-plan #X1)
- [ ] 18.10 Assert the version floor boundary — adapter at 2.19.x, 2.20.0 and 2.21.0 · probe runs at each · refusal or warning below 2.20.0 and acceptance at and above it — see qa/tests/01-install.sh (test-plan #X2)
- [ ] 18.11 Assert an absent adapter is diagnosed — adapter not installed at all · probe runs · actionable diagnostic with no crash — see qa/tests/01-install.sh (test-plan #X3)
- [ ] 18.12 Assert abort on a disconnected session reports honestly — target session registered but its bridge disconnected · abort tool invoked · caller learns the abort did not take effect rather than seeing a false success — see packages/automation-plugin/src/server/__tests__/plugin-action-handler.test.ts (test-plan #X4)
- [ ] 18.13 Assert spawn failure surfaces cleanly — spawn fails or times out · spawn_session tool invoked · error surfaced as a JSON-RPC error with no orphan process — see packages/server/src/__tests__/spawned-turn-log.test.ts (test-plan #X5)
- [ ] 18.14 Assert closed trust gate degrades per contract — the first-party trust gate denies the plugin · spawn_session and abort invoked · tools degrade per the gate contract rather than throwing — see packages/automation-plugin/src/server/__tests__/plugin-action-handler.test.ts (test-plan #X6)

## 19. Tests — performance

- [ ] 19.1 Assert token verification stays within budget — sustained authenticated tools/call · p95 added latency of token verification within the threshold set in 1.8 — see packages/server/src/__tests__/browser-gateway-load.test.ts (test-plan #P1)
- [ ] 19.2 Assert tools/list stays within budget — repeated tools/list · p95 response time within the threshold set in 1.8 — see packages/server/src/__tests__/browser-gateway-load.test.ts (test-plan #P2)
- [ ] 19.3 Assert concurrent streams meet the throughput budget — N concurrent subscriptions/listen streams with steady event flow · delivery latency and dropped-event count within the thresholds set in 1.8 — see qa/tests/16-e2e-memory-bound.sh (test-plan #P3)
- [ ] 19.4 Assert streams survive a soak without growth — long-running streams under continuous events · RSS growth and listener count within the thresholds set in 1.8 — see qa/tests/16-e2e-memory-bound.sh (test-plan #P4)

## 20. Manual verification (deferred post-merge)

- [ ] 20.1 Verify end-to-end interop with a real external MCP client — connect Claude Desktop or Cursor to a running dashboard, discover, list tools, call one, open a subscription (test-plan: manual-only)
- [ ] 20.2 Verify a local pi session drives another session through the provisioned entry with adapter 2.20.0 or newer (test-plan: manual-only)
- [ ] 20.3 Verify the command palette shows no confusing duplicate or shadowed /mcp entry with both the plugin and pi-mcp-adapter present (test-plan: manual-only)

## 21. Documentation and closeout

- [ ] 21.1 Update docs/architecture.md with the MCP endpoint, its protocol revision, and the auth boundary
- [ ] 21.2 Update README.md with setup and the adapter version prerequisite
- [ ] 21.3 Add directory AGENTS.md rows for every new file
- [ ] 21.4 Run the full test suite and confirm no regression
