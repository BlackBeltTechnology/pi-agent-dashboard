# Test Plan — wire-mcp-session-token

Stage: design   Generated: 2025-09-14

Gate answers folded in (no open clarifications):

- **D7 per-ip ceiling = 100 failures / 60 s**, on top of the existing
  per-`(ip, fingerprint)` bucket of `MAX_AUTH_FAILURES=10` /
  `AUTH_FAILURE_WINDOW_MS=60_000` / `AUTH_LOCKOUT_MS=60_000`
  (`packages/mcp-server-plugin/src/server/rate-limit.ts`).
- **No latency budget.** The measured per-request header-command cost is a
  recorded regression baseline only; the transport stays `requestHeadersCommand`
  regardless of the Task 1.3 `bearerTokenEnv` probe outcome (the probe result is
  informational, recorded in design.md § Open Questions).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | R3 stale credential / D4 | state-transition (illegal edge) | L1 | automated | registry holds one row for session `A`, token `T1` | `mintForSession(A)` runs again on reconnect, returning `T2` | rows for `A` == 1; `resolve(T1)` returns undefined; `resolve(T2)` returns `A` |
| E2 | R5 operator fields survive | decision-table | L1 | automated | `mcp.json` entry `pi-dashboard` in 3 states: absent · `{url, protocolVersion}` · `{url, protocolVersion, disabled:true, headers:{X-Op:"1"}}` | provisioning write runs | every state ends with the auth field present, `disabled` and `X-Op` preserved verbatim, sibling entries byte-identical |
| E3 | R2 caller resolves to its session | EP (valid/invalid identity claim) | L1 | automated | token minted for session `A` | request presents `A`'s bearer with an RPC body naming `sessionId: "B"` | resolved caller is `{session: A}`; the body's `B` never becomes the caller |
| E4 | R2 self-target guard | decision-table | L1 | automated | session `A`, its delivered bearer | `send_prompt` with `sessionId: A` | call refused; one log line carrying caller `A`, target `A`, tool name; no prompt dispatched |
| E5 | R1 unauthenticated still refused | EP (invalid) | L1 | automated | no `Authorization` header; and a well-formed but unminted `mcp_`-prefixed bearer | POST `/mcp` | both → `401`, identical to pre-change behaviour; no token row created |
| E6 | R4 per-credential bucket | BVA | L1 | automated | one ip `127.0.0.1`, one credential fingerprint `F` | 9 failures in 60 s, then a 10th request · 10 failures, then an 11th | at 9 → served (401, not 429); at 10 → `429` with `Retry-After` ≈ 60 |
| E7 | R4 per-ip ceiling (gate: 100/60 s) | BVA | L1 | automated | `127.0.0.1` rotating a fresh fingerprint every failure | 99 failures then one more · 100 failures then one more | at 99 → request reaches auth (`401`); at 100 → `429` even though that fingerprint's own bucket is empty |
| E8 | R4 valid credential never throttled | EP | L1 | automated | session `A` locked out on fingerprint `F1`; session `B` holds a valid token | `B` issues a tool call from the same `127.0.0.1` | `B` is served; `A`'s lockout unchanged |
| E9 | D2 transport shape | decision-table | L1 | automated | provisioned entry after the write | inspect the serialized entry | `env` map contains exactly `${PI_DASHBOARD_MCP_TOKEN}`; **no** `args` entry carries an interpolation form (upstream `.map` bug, findings Q1a); no literal `mcp_` value anywhere in the file |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | D2 accepted cost / Task 1.2 | tail-latency baseline | L2 | automated | 20 sequential `tools/list` round trips through the real provisioned `pi-dashboard` entry | record median + p95 ms per request; **no pass/fail threshold** — recorded as a regression baseline, printed to the qa log | single run |
| P2 | D4 registry growth | timed unit | L1 | automated | 200 re-mints for one session, then 1000 rows from distinct sessions | rows per session == 1 after the loop; `resolve()` p95 < 1 ms at 1000 rows | in-process |
| P3 | D7 memory amplification | bounded-growth | L1 | automated | 20 000 distinct fingerprints from one ip inside the window | tracked-source count ≤ `MAX_TRACKED_SOURCES` (10 000); the per-ip ceiling record is never evicted by fingerprint churn | in-process |

### Frontend-quirk (async / state-convergence)

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | R3 restart re-delivers | state-transition | L3 | automated | a live pi session authenticated to `/mcp` | `POST /api/restart`; bridge reconnects | converges to: a fresh token minted for that session, and a `tools/list` through the provisioned entry succeeds with **no** operator action; the pre-restart token is refused |
| F2 | D6 reconnect ordering | state-transition (illegal edge) | L1 | automated | delivery handler with spies on the env write and `reconnect()` | mint reply arrives | `process.env.PI_DASHBOARD_MCP_TOKEN` is assigned **before** `reconnect()` is called; reconnect is never issued while the entry is still 401ing (findings Q3 step 4) |
| F3 | D6 `connection.status` is not a health signal | invariant assertion | L1 | automated | the delivery/recovery module | any recovery decision | no code path branches on `connection.status`; the mint reply is the sole recovery trigger (status was measured to read `connected` while every request 401s) |
| F4 | D5 session-private lane | invariant assertion | L1 | automated | bridge receives the new server→extension mint message | handler runs | the plaintext reaches the env assignment **and** `pi.events.emit` is never called with it (measured broadcast leak, findings Q4b); a subscriber spy receives nothing |
| F5 | R2 two sessions, one cwd | state-transition | L3 | automated | sessions `A` and `B` started in the same directory, one identical Pi-global command line | each invokes a tool through the provisioned entry | `A`'s call resolves caller `A`, `B`'s resolves `B`; the two bearers differ |
| F6 | R1 works out of the box | convergence | L3 | automated | a fresh harness with no operator-edited MCP config | a pi session connects `pi-dashboard` and calls `tools/list` | the 4 advertised tools are returned; the on-disk `mcp.json` was never hand-edited |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | R3 delivery failure surfaced | fault-injection (abort) | L1 | automated | the extension WS is closed at the moment the mint reply is sent | mint completes server-side | a log line naming the affected session id; `/mcp` keeps serving other callers; no plaintext in the line |
| X2 | R3 logged by the side that can see it | fault-injection (abort) | L1 | automated | the header command exits non-zero (env var unset in that session) | a tool call is attempted | the request 401s **and** the failure is recorded by the session-id-holding component — the command's discarded stderr (`stdio[2]="ignore"`) is never the only record |
| X3 | R3 session end revokes | state-transition | L1 | automated | session `A` holds token `T` | `onSessionEnded(A)` | `resolve(T)` → undefined; a `/mcp` call with `T` → `401` |
| X4 | R3 / R5 no stale secret at rest | fs scan | L1 | automated | a session that has minted and had its token revoked | scan `mcp.json` and the agent config dir | no `mcp_`-prefixed value present at any point — before, during or after revocation |
| X5 | R5 credential never logged | log capture | L1 | automated | the mint → deliver → fail paths, all three exercised | capture every log sink | the plaintext and its `mcp_` prefix appear in zero lines |
| X6 | D7 fingerprint never logged | log capture | L1 | automated | throttle records a failure and a lockout | capture the warn lines | the line carries no plaintext credential and no reversible form of it |
| X7 | R5 atomic + owner-only write | fault-injection (abort) + permissions | L1 | automated | the write is interrupted mid-flight (tmp file present, rename not yet done) | a concurrent reader opens the config | the reader never observes a partial file; after the write the file's mode is owner-only (`0600`) |
| X8 | R1 unbridged session | fault-injection (dependency absent) | L2 | automated | a pi session started while the dashboard is down, with the Pi-global entry already present | the session attempts an MCP call | a single clean `401` surfaced once; no retry storm, no crash, no lockout of the loopback source |
| X9 | D2 argv/env exposure on Linux | process-surface probe | L2 | automated | a live adapter child on a Linux qa VM | `ps -ww -o args=` on that pid, and `stat /proc/<pid>/environ` | argv contains no token; `environ` is owner-only — closes the "non-macOS `ps` semantics unmeasured" risk |
| X10 | D2 subprocess env inheritance | security-note review | — | manual-only | the shipped security notes / docs | a human reads them | [judgment: the accepted exposure — any subprocess the agent spawns can read `PI_DASHBOARD_MCP_TOKEN` — is stated plainly for the operator] |

---

## Coverage summary

- Requirements covered: 5/5 (R1 E5·F6·X8 · R2 E3·E4·F5 · R3 E1·F1·X1–X4 · R4 E6–E8·P3 · R5 E2·X4·X5·X7)
- Scenarios by class: edge 9 · perf 3 · frontend 6 · error 10
- Scenarios by level: L1 20 · L2 3 · L3 3 · manual-only 1
- Scenarios by disposition: automated 27 · manual-only 1

## New infra needed

- **P1** needs a qa script that drives a real provisioned entry end to end and
  prints a timing line. Nearest existing shape: `qa/tests/04-ws-ticket-auth.sh`.
  If the qa VM cannot host a real adapter child, P1 downgrades to a scripted
  local measurement recorded in design.md rather than a standing qa test — decide
  when authoring, do not silently drop the number.
- **X9** needs the Linux qa VM lane only (`qa/tests/*.sh`); no new harness.
- Everything else extends existing suites:
  `packages/mcp-server-plugin/src/server/__tests__/` (tokens · provisioning ·
  provisioning-fs · rate-limit · guard · mint-attribution · routes · performance),
  `packages/extension/src/__tests__/` (bridge-* specs), and `tests/e2e/`
  (`mcp-client-harness-integration.spec.ts`, `keeper-restart-survival.spec.ts`).
