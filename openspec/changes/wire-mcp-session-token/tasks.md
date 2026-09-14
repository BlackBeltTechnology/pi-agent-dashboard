## 1. Close the two gaps the spike left open

`spike-mcp-credential-delivery/findings.md` already measured the invocation
model (per request), env freshness (live), argv exposure (none in the `env`
slot), 401 behaviour (never self-heals) and the broadcast risk (real). Only the
following remain.

- [x] 1.1 Measure the one unmeasured leg (findings §7): a token written into `process.env` by an extension *after* session start reaches `/mcp` as a bearer; verify against a real pi session and a local HTTP sink, observing the header on the first MCP request
- [x] 1.2 Probe `bearerTokenEnv` re-resolution on `reconnect()` (informational only — per the planning gate the transport stays `requestHeadersCommand` regardless); rotate the env value between connect and reconnect, observe which value the sink receives, record the outcome in design.md § Open Questions

## 2. Mint over the bridge

- [x] 2.1 Implement the `mcp/mint-token` call on bridge registration in `packages/extension/src/`; the returned plaintext is held in memory only and the server logs `mcp-server: minted a token for session <id>`
- [x] 2.2 (D5) Add the session-private `…ExtensionMessage` interface and its `ServerToExtensionMessage` union member in `packages/shared/src/protocol.ts`, the bridge handler in `packages/extension/src/bridge.ts`, and the send in `packages/mcp-server-plugin/src/server/index.ts` (mirroring `credentials_updated`); remove the dead `return { token }` at `index.ts:144`
- [x] 2.3 (D4) Make `mintForSession` replace the session's existing row instead of `rows.push` (`tokens.ts:91`)

## 3. Deliver the credential to the adapter

- [x] 3.1 Extend `packages/mcp-server-plugin/src/server/provisioning.ts` to write the `requestHeadersCommand` entry with the credential in the `env` slot as `${PI_DASHBOARD_MCP_TOKEN}`; merge-only, no `args` interpolation, no literal token
- [x] 3.2 Implement the header command the adapter invokes — it echoes `{"Authorization": "Bearer …"}` read from its own environment, never from argv
- [x] 3.3 Ensure the config write keeps the existing hardened atomic path and owner-only mode

## 4. Lifecycle

- [x] 4.1 (D6) Trigger recovery from the mint reply: assign the env var, then call `reconnect()` on the `pi-dashboard` entry; never derive a health decision from `connection.status`
- [x] 4.2 (D7) Re-key the pre-auth throttle in `packages/mcp-server-plugin/src/server/rate-limit.ts` + `routes.ts:205` to `(ip, SHA-256 credential fingerprint)` at the existing 10 / 60 s bucket, plus a coarser per-ip ceiling of **100 failures / 60 s**; the fingerprint is never logged in a reversible form

## 5. Integration + docs

- [x] 5.1 Update `docs/architecture.md` §MCP endpoint minting sequence to describe the shipped path (delegate the prose to DocScribe, caveman style)
- [x] 5.2 Update `packages/mcp-server-plugin/src/server/AGENTS.md` and `packages/extension/src/AGENTS.md` rows for every touched file; verify `kb dox lint` is clean
- [x] 5.3 Document the accepted subprocess env-inheritance exposure in the security notes (test-plan X10 reviews it)
- [x] 5.4 Run `npm test` and `npm run quality:changed`; verify both green before shipping (npm test: 19,780 pass / 1 fail — the PRE-EXISTING `openspec-poller-parity` failure, verified identical on develop in the main repo before this branch's code changes; quality:changed: no diagnostics in this change's files, safe-fixes applied to them, pre-existing warnings in unrelated branch files reverted rather than churned)

## 6. Folded test scenarios

Every row in `test-plan.md` maps to exactly one task below. Manifest dispositions
live in `test-plan.md`; these tasks carry the harness exemplar and the Triple.

### 6.1 L1 — vitest (`packages/mcp-server-plugin/src/server/__tests__/`, `packages/extension/src/__tests__/`)

- [x] 6.1.1 (test-plan #E1) Re-mint replaces the row — see `packages/mcp-server-plugin/src/server/__tests__/tokens.test.ts`. Triple: registry holds one row for session A with token T1 · `mintForSession(A)` runs again returning T2 · rows for A == 1, `resolve(T1)` undefined, `resolve(T2)` → A
- [x] 6.1.2 (test-plan #E2) Provisioning decision table — see `packages/mcp-server-plugin/src/server/__tests__/provisioning.test.ts`. Triple: entry absent / `{url,protocolVersion}` / with `disabled:true`+`headers:{X-Op:"1"}` · provisioning write runs · auth field present in all three, `disabled` and `X-Op` preserved verbatim, sibling entries byte-identical
- [x] 6.1.3 (test-plan #E3) Body-asserted session id is ignored — see `packages/mcp-server-plugin/src/server/__tests__/mint-attribution.test.ts`. Triple: token minted for A · request presents A's bearer with RPC body `sessionId:"B"` · resolved caller is A
- [x] 6.1.4 (test-plan #E4) Self-target guard on the local path — see `packages/mcp-server-plugin/src/server/__tests__/guard.test.ts`. Triple: session A + its delivered bearer · `send_prompt` with `sessionId:A` · refused, one log line carrying caller/target/tool, no prompt dispatched
- [x] 6.1.5 (test-plan #E5) Unauthenticated and unminted callers still refused — see `packages/mcp-server-plugin/src/server/__tests__/routes.test.ts`. Triple: no `Authorization` header, and a well-formed unminted `mcp_` bearer · POST `/mcp` · both 401, no token row created
- [x] 6.1.6 (test-plan #E6) Per-credential bucket boundary — see `packages/mcp-server-plugin/src/server/__tests__/rate-limit.test.ts`. Triple: one ip + one fingerprint F · 9 failures then a request, and 10 failures then a request · at 9 → 401, at 10 → 429 with `Retry-After` ≈ 60
- [x] 6.1.7 (test-plan #E7) Per-ip ceiling boundary at 100/60 s — see `packages/mcp-server-plugin/src/server/__tests__/rate-limit.test.ts`. Triple: `127.0.0.1` rotating a fresh fingerprint per failure · 99 failures then one more, and 100 then one more · at 99 → 401, at 100 → 429 despite an empty bucket for that fingerprint
- [x] 6.1.8 (test-plan #E8) A locked-out session never denies a healthy one — see `packages/mcp-server-plugin/src/server/__tests__/rate-limit.test.ts`. Triple: session A locked out on F1, session B holds a valid token · B issues a tool call from the same ip · B served, A's lockout unchanged
- [x] 6.1.9 (test-plan #E9) Provisioned entry shape — see `packages/mcp-server-plugin/src/server/__tests__/provisioning.test.ts`. Triple: the serialized entry after the write · inspect it · `env` carries exactly `${PI_DASHBOARD_MCP_TOKEN}`, no `args` interpolation form, no literal `mcp_` value in the file
- [x] 6.1.10 (test-plan #P2) Registry growth and resolve cost — see `packages/mcp-server-plugin/src/server/__tests__/performance.test.ts`. Triple: 200 re-mints for one session then 1000 rows from distinct sessions · measure · rows per session == 1, `resolve()` p95 < 1 ms at 1000 rows
- [x] 6.1.11 (test-plan #P3) Throttle map stays bounded under fingerprint churn — see `packages/mcp-server-plugin/src/server/__tests__/rate-limit.test.ts`. Triple: 20 000 distinct fingerprints from one ip inside the window · measure · tracked sources ≤ `MAX_TRACKED_SOURCES` (10 000), the per-ip ceiling record never evicted
- [x] 6.1.12 (test-plan #F2) Env write precedes `reconnect()` — see `packages/extension/src/__tests__/mcp-token-delivery.test.ts`. Triple: delivery handler with spies · mint reply arrives · env assigned before `reconnect()` is called, never while the entry is still 401ing
- [x] 6.1.13 (test-plan #F3) `connection.status` is never a health signal — see `packages/extension/src/__tests__/mcp-token-delivery.test.ts`. Triple: the delivery/recovery module · any recovery decision · no branch reads `connection.status`; the mint reply is the sole trigger
- [x] 6.1.14 (test-plan #F4) Mint reply stays off `pi.events` — see `packages/extension/src/__tests__/mcp-token-delivery.test.ts`. Triple: bridge receives the private mint message · handler runs · env assignment happens and `pi.events.emit` is never called with the plaintext; a subscriber spy receives nothing
- [x] 6.1.15 (test-plan #X1) Delivery abort is logged with the session id — see `packages/mcp-server-plugin/src/server/__tests__/server-index.test.ts`. Triple: extension WS closed as the mint reply is sent · mint completes server-side · a log line names the session, `/mcp` keeps serving other callers, no plaintext in the line
- [x] 6.1.16 (test-plan #X2) Header-command failure is not invisible — see `packages/mcp-server-plugin/src/server/__tests__/adapter-diagnostic.test.ts`. Triple: the header command exits non-zero (env var unset) · a tool call is attempted · request 401s **and** the session-id-holding component records it; the discarded stderr is never the only record
- [x] 6.1.17 (test-plan #X3) Session end revokes — see `packages/mcp-server-plugin/src/server/__tests__/tokens.test.ts`. Triple: session A holds token T · `onSessionEnded(A)` · `resolve(T)` undefined and a `/mcp` call with T → 401
- [x] 6.1.18 (test-plan #X4) No plaintext at rest, ever — see `packages/mcp-server-plugin/src/server/__tests__/provisioning-fs.test.ts`. Triple: a session that minted and was revoked · scan `mcp.json` + the agent config dir before/during/after · no `mcp_`-prefixed value present at any point
- [x] 6.1.19 (test-plan #X5) Credential never logged — see `packages/mcp-server-plugin/src/server/__tests__/server-index.test.ts`. Triple: mint → deliver → fail paths all exercised · capture every log sink · plaintext and `mcp_` prefix appear in zero lines
- [x] 6.1.20 (test-plan #X6) Fingerprint never logged reversibly — see `packages/mcp-server-plugin/src/server/__tests__/rate-limit.test.ts`. Triple: throttle records a failure and a lockout · capture the warn lines · no plaintext credential and no reversible form of it
- [x] 6.1.21 (test-plan #X7) Atomic + owner-only write — see `packages/mcp-server-plugin/src/server/__tests__/provisioning-fs.test.ts`. Triple: write interrupted mid-flight (tmp present, rename pending) · a concurrent reader opens the config · never observes a partial file; final mode is owner-only (0600)

### 6.2 L2 — qa smoke (`qa/tests/*.sh`)

- [x] 6.2.1 (test-plan #P1) Per-request header-command baseline — see `qa/tests/33-mcp-session-token.sh` (P1 leg). Triple: 20 sequential `tools/list` round trips through the real provisioned entry · run once · median + p95 ms per request printed to the qa log as a recorded baseline (no pass/fail threshold). If the VM cannot host a real adapter child, record the number in design.md instead of dropping it
- [x] 6.2.2 (test-plan #X8) Unbridged session degrades cleanly — see `qa/tests/33-mcp-session-token.sh` (X8 leg). Triple: pi session started while the dashboard is down, Pi-global entry already present · the session attempts an MCP call · one clean 401 surfaced once, no retry storm, no crash, no loopback lockout
- [x] 6.2.3 (test-plan #X9) Linux process-surface probe — see `qa/tests/33-mcp-session-token.sh` (X9 leg). Triple: a live adapter child on a Linux qa VM · `ps -ww -o args=` on that pid and `stat /proc/<pid>/environ` · argv carries no token, `environ` is owner-only

### 6.3 L3 — Playwright e2e (`tests/e2e/*.spec.ts`, docker harness)

- [x] 6.3.1 (test-plan #F1) Restart re-delivers — see `tests/e2e/mcp-session-token.spec.ts`. Triple: a live pi session authenticated to `/mcp` · `POST /api/restart`, bridge reconnects · a fresh token is minted and `tools/list` succeeds with no operator action; the pre-restart token is refused
- [x] 6.3.2 (test-plan #F5) Two sessions in one cwd stay distinct — see `tests/e2e/mcp-session-token.spec.ts`. Triple: sessions A and B started in the same directory behind one identical Pi-global command line · each invokes a tool · A resolves A, B resolves B, the two bearers differ
- [x] 6.3.3 (test-plan #F6) Works out of the box — see `tests/e2e/mcp-session-token.spec.ts`. Triple: fresh harness, no operator-edited MCP config · a session connects `pi-dashboard` and calls `tools/list` · the 4 advertised tools are returned and `mcp.json` was never hand-edited

### 6.4 Manual (deferred post-merge by `ship-change`)

- [ ] 6.4.1 (test-plan #X10) (test-plan: manual-only) Read the shipped security notes and confirm the accepted exposure — any subprocess the agent spawns can read `PI_DASHBOARD_MCP_TOKEN` — is stated plainly for the operator
