## Context

See proposal.md — Why. Design-relevant current state, all verified live:

- `/mcp` self-guards and requires a bearer on every request, loopback included
  (`packages/mcp-server-plugin/src/server/auth.ts`). Confirmed: unauthenticated
  POST → `401`.
- `McpTokenRegistry` is in-memory, `mcp_`-prefixed, SHA-256 at rest, no expiry,
  dies with the plugin. A restart invalidates every token.
- `mcp/mint-token` is registered (`src/server/index.ts:136`) and attributes the
  caller from the **bridge socket key**, never the message body. It has **no
  caller** — `grep -rIl "mint-token"` outside the plugin finds only docs, tests
  and one QA script.
- Provisioning writes the Pi-global entry only: `{url, protocolVersion}`, merge-
  only, through `createMcpClientConfigService`. Layers the client core knows are
  `pi-global` / `pi-folder` / `shared` (`packages/mcp-client-plugin/src/core/effective-view.ts`)
  — **there is no per-session config layer**. That is the constraint that shapes
  the whole design.
- The adapter (`pi-mcp-adapter`) accepts more than a literal `headers` map. Its
  URL-bound auth fields are `["headers", "bearerToken", "bearerTokenEnv",
  "bearerTokenStore", "requestHeadersCommand"]` (`dist/config.js:390`), and it
  ships a keyring-backed bearer store (`mcp-bearer-store.ts`).

Facts added by doubt cycle 1, each verified against source. They invalidated the
first draft of D2 and D3:

- **`registerPiHandler` has no return channel.** `pluginPiHandlers` is
  `Array<(msg, sessionId) => void>` (`packages/server/src/server.ts:1082`) and
  `dispatchPluginPiMessage` calls `h(msg, sessionId)` discarding the result
  (`server.ts:1149-1155`). The `return { token }` in `index.ts:144` is dead code
  today — the plaintext never reaches the bridge.
- **There IS a server→session push channel:** `EmitEventToSessionFn(sessionId,
  eventType, data)` relays a `plugin_emit_event` control message whose in-session
  bridge does `pi.events.emit(eventType, data)`
  (`dashboard-plugin-runtime/src/server/server-context.ts:99-109`). Gated to
  first-party/trusted plugins — `mcp-server-plugin` qualifies.
- **The adapter's `requestHeadersCommand` child inherits the LIVE parent env**:
  it spawns with `env: { ...process.env, ...config.env }`
  (`request-headers-command.ts:177-178`), resolved per invocation. A runtime
  mutation of `process.env` inside the pi process is therefore visible to the
  next invocation.
- **The command is NOT self-identifying.** The child receives only the inherited
  env plus a stdin envelope `{version, method, url, bodyBase64}`. Since
  `mcp.json` is Pi-global, every session provisions an identical command line.
  Nothing about the spawn tells the server which session called.
- **Command stderr is discarded** (`stdio: ["pipe", "pipe", "ignore"]`), so a
  delivery failure inside the command is invisible to both sides.
- **The auth throttle is keyed on `request.ip`**
  (`packages/mcp-server-plugin/src/server/routes.ts:205`). Every local session
  shares `127.0.0.1`, so failures from one session throttle all of them.

Facts added by `spike-mcp-credential-delivery`, each **measured** against the
shipped adapter (`openspec/changes/spike-mcp-credential-delivery/findings.md`).
They settle both doubt cycles:

- **Interpolation works in the `command` and `env` slots, and is broken in
  `args`.** `resolvedCommand` does `(config.args ?? []).map(interpolateEnvVars)`;
  `Array.map` passes the index as the second argument, which that overload reads
  as the environment — so every recognised form in `args` resolves to `""`
  (upstream bug, Q1a). Bare `$VAR` never expands in any slot (no shell in
  `spawn`).
- **The `env` slot keeps the secret out of argv.** `ps -ww -o args=` shows no
  marker for `env`-slot delivery and does show it for `args`-slot delivery (Q1b).
  Residual exposure is same-uid `ps -E` only — identical to what the pi process's
  own environment already exposes.
- **The command runs once per HTTP request, and re-reads the live parent env
  each time.** 5 requests → 5 distinct child pids; a `process.env` value rotated
  mid-connection was presented on the very next request (Q2). This is the fact
  D2 is built on.
- **A header command costs ≥250 ms per HTTP request**, of which ~3 ms is the
  spawn; the rest is the adapter's own process-discovery machinery (≈3 full
  `ps axeww` scans per request) (Q2 overhead).
- **A non-OAuth 401 throws and never self-heals**: 0 unattended invocations in
  8 s under 401 and 0 in 4 s after the server was healthy again, while
  `connection.status` still read `connected` throughout. An explicit
  `reconnect()` does recover and presents the rotated credential (Q3).
- **`plugin_emit_event` is a broadcast, measured end-to-end.** An unrelated
  throwaway extension received a `mcp:token-minted` payload it was never the
  recipient of (Q4b).
- **A session-private server→extension lane already exists.** 9 of 21 inbound
  bridge message types never touch `pi.events`; `credentials_updated` is the
  precedent (Q4a).

## Goals / Non-Goals

**Goals:**
- A local pi session authenticates to `/mcp` with zero operator action.
- The credential resolves to that session, so the self-target guard stays live.
- Recovery after a dashboard restart is automatic, with no stale secret on disk.

**Non-Goals:**
- OAuth. The spec already forbids binding a callback port.
- Remote/tunnelled MCP clients — they keep using paired-device bearers.
- Changing the pairing flow or the device-token path.
- Making `/mcp` loopback-exempt. That trade was already rejected upstream.

## Decisions

### D1 — Mechanism A (per-session token over the bridge), not B (static provisioned token)

**Chosen: A.** The bridge mints via `mcp/mint-token` on registration and the
credential is delivered per session.

Rejected: **B — one long-lived token merged into the Pi-global entry's
`headers`.** B is a five-line change and genuinely tempting. It is rejected
because every local pi caller would then authenticate as `{kind:"device"}`, and
device callers are *structurally exempt* from the self-target guard
(`guard.ts` `evaluateSelfTarget`, spec scenario "Sessionless caller is
unaffected"). B therefore does not weaken the guard — it deletes it for the
entire local path, silently, while every existing guard test still passes because
they exercise session callers. A shipped requirement would become theatre without
a single red test. B also puts a credential with no natural lifetime into a file
shared by every session and every cwd.

### D2 — `requestHeadersCommand` reading a process-env credential the extension set at runtime

Given D1 and the absence of a per-session config layer, the credential cannot be
delivered by writing `headers` into a config file: the finest granularity
available is `pi-folder`, and two sessions in the same cwd would then share one
credential — collapsing A back into B for the common worktree case.

**Rejected (first draft of this decision): `requestHeadersCommand` that resolves
the session itself.** Doubt cycle 1 falsified it. The command is not
self-identifying — it gets the inherited env and a stdin envelope, and every
session provisions the same Pi-global command line. For the command to name a
session it would have to *assert* one to the server, which Requirement 1 forbids
("SHALL NOT be derived from anything the MCP client asserts") and which
`tokens.ts:9-11` records as the exact objection that overturned the original
design. "Per-session by construction" was not true as drafted.

**Rejected (second draft): the credential expanded into the command line.**
Doubt cycle 2 was half right. Bare `$PI_DASHBOARD_MCP_TOKEN` is indeed dead — it
ships literally. But its conclusion, that the working form puts the bearer in
spawn argv, holds only for the `command`/`args` slots. Measured (Q1b): argv
delivery is world-readable via `ps -ww -o args=`; `env`-slot delivery is not.
And `args` is not even an option — every interpolation form there resolves to the
empty string (Q1a), so that variant would have shipped a permanently-401ing empty
bearer.

**Chosen:** `requestHeadersCommand` as the transport, with the credential in the
**`env` slot**, and the per-session property carried by the pi process's own
environment:

1. The extension mints over the bridge and receives the plaintext (D5).
2. The extension assigns it to `process.env.PI_DASHBOARD_MCP_TOKEN` **in its own
   running pi process** — a runtime mutation, never a file, never a spawn-time
   injection.
3. Provisioning writes a `requestHeadersCommand` whose `env` map contains
   `{ "PI_DASHBOARD_MCP_TOKEN": "${PI_DASHBOARD_MCP_TOKEN}" }` and whose command
   echoes `{"Authorization": "Bearer " + $PI_DASHBOARD_MCP_TOKEN}` read from its
   own environment — never from its argv.

Every property is now measured rather than asserted:

- **Per-session** because each pi process owns its own `process.env`; two
  sessions in one cwd hold different values behind one identical command line.
- **No plaintext at rest** — the credential lives only in process memory.
- **No argv exposure** (Q1b). The residual same-uid `ps -E` surface is the one
  the pi process already has.
- **Runtime delivery and rotation work**: interpolation runs per HTTP request and
  reads the live parent env, so a value written after the connection is
  established is presented on the next request (Q2) — no config rewrite, nothing
  on disk. This is the property `bearerTokenEnv` lacks: it resolves once at
  connect.
- **No client-asserted identity** — the token *is* the identity, and the server
  minted it against the socket key.

**Known cost, accepted: ≥250 ms per HTTP request** (Q2),
i.e. ≥0.5 s of added latency per tool call, and ≈3 `ps axeww` scans per request
on a busy host. Two things follow. First, the change must measure this on the
real entry rather than inherit the spike's number (Task 1.2). Second, there is a
plausible zero-per-request alternative: because D6 gives us an explicit
`reconnect()` trigger anyway, `bearerTokenEnv`'s connect-time resolution may be
sufficient — its defect (staleness) is exactly what D6 repairs. That was **not**
measured by the spike (it only measured `requestHeadersCommand` picking up the
rotated value across a reconnect, Q3 step 5).

**Planning gate decision: no latency budget, and the transport does not flip.**
`requestHeadersCommand` ships regardless of the probe outcome; the measured
per-request cost is recorded as a regression baseline only (test-plan P1). The
`bearerTokenEnv` probe (Task 1.2) stays, but its result is informational and
lands in § Open Questions — switching transport is a later change, not this one.

### D5 — The mint reply travels on the session-private extension lane, not by a handler return and not over `emitEventToSession`

The first draft assumed `mcp/mint-token` could return the plaintext to its
caller. It cannot: `dispatchPluginPiMessage` discards handler return values, so
`return { token }` in `index.ts:144` is dead code and the delivery path has never
had a wire.

**Rejected (second draft): `ctx.emitEventToSession(sessionId,
"mcp:token-minted", …)`.** `bridge.ts:1312-1318` re-emits any `plugin_emit_event`
onto `pi.events`, which is the shared inter-extension bus. Measured end-to-end
(Q4b): an unrelated extension that merely subscribed received the payload. A
credential must not travel that way.

**Chosen:** a dedicated server→extension message, handled entirely inside the
bridge. This is not a new mechanism — 9 of 21 inbound message types already stay
private, and `credentials_updated` (`bridge.ts:1097`) is a server-pushed,
credential-related control message on exactly this lane (Q4a). Three edits:

| File | Change |
|---|---|
| `packages/shared/src/protocol.ts` | new `…ExtensionMessage` interface + a member in the `ServerToExtensionMessage` union |
| `packages/extension/src/bridge.ts` | `if (msg.type === "…")` handler that performs the D2 env assignment and **never** calls `pi.events.emit` |
| `packages/mcp-server-plugin/src/server/index.ts` | send over the existing extension WS, as `credentials_updated` does |

Attribution is unchanged and still unspoofable — the server chooses the
destination session, so the reply cannot be steered by anything in `msg`. A test
asserts the plaintext never reaches `pi.events`.

The dead `return { token }` is removed as part of this change; leaving it invites
the next reader to make the same wrong assumption.

### D3 — Mint on bridge registration, not lazily on first MCP use

The bridge already registers on connect; minting there means the credential exists
before the first tool call and re-exists after a reconnect, with no cold-start
race. Cost: a token minted for every session whether or not it ever touches MCP.
Acceptable — a token row is ~100 bytes, in memory, and dies with the session.

### D4 — Revocation stays where it is, but mint must replace rather than append

`onSessionEnded` → `revokeSession` already covers the session-end case, and the
in-memory registry covers restart. No new revocation path is introduced; the
change only has to guarantee it never writes a copy that outlives the registry
(satisfied by D2).

One repo-side fix is required: `mintForSession` does `rows.push`
(`tokens.ts:91`), so a re-mint on reconnect leaves the previous token valid until
session end — failing the existing scenario "credential is revoked → presenting
it SHALL be refused", and growing a registry whose `resolve()` linear-scans.
Mint replaces the session's row.

### D6 — Recovery is triggered by the mint, not left to the adapter

The spike removed any hope that a 401 heals itself: measured 0 unattended header
invocations in 8 s under 401 and 0 in 4 s after the server recovered, while
`connection.status` still read `connected` (Q3). Two consequences bind the
design:

- **No health signal may be derived from `connection.status`.** It lies.
- **The re-delivery path owns the trigger.** After the extension writes a fresh
  token into `process.env` (D2 step 2), it explicitly reconnects the
  `pi-dashboard` entry. `reconnect()` was measured to recover and to present the
  rotated credential (Q3 step 5).

The trigger is the mint reply, not a 401 — which also means recovery does not
depend on the session having tried and failed first. Note that `reconnect()`
issued *while* the entry is still 401ing fails with a misleading
"Dynamic Client Registration rejected" after ~3 s (Q3 step 4): reconnect after
the new token is in the env, never before.

### D7 — The throttle key becomes `(ip, credential fingerprint)` with a per-ip ceiling

Requirement "One session's credential failures do not lock out the others" is
not satisfiable against a key of `request.ip` alone (`routes.ts:205`): every
local session is `127.0.0.1`. Keying purely on the presented credential is also
wrong — a brute-forcer rotates it and never trips the counter.

**Chosen:** the pre-auth counter keys on `ip` + a SHA-256 fingerprint of the
presented credential at the existing `MAX_AUTH_FAILURES` = 10 / 60 s bucket, and
a second, coarser per-`ip` ceiling of **100 failures / 60 s** (10× the
per-credential bucket; planning gate decision) stays in place.
One session repeatedly presenting one stale token exhausts only its own bucket;
an attacker rotating credentials creates a new bucket per guess but walks into
the per-ip ceiling. The fingerprint is never logged in plaintext form.

## Risks / Trade-offs

- **≥250 ms per HTTP request, ≥0.5 s per tool call** (Q2) — the largest cost this
  change carries, and it is not avoidable inside `requestHeadersCommand` (~3 ms
  is the spawn; the rest is the adapter's own process-discovery machinery, which
  scales with the host's process count). The header cannot be cached on our side
  — the child is the adapter's. Mitigation is the D2 `bearerTokenEnv` alternative
  (Task 1.3), not a cache.
- **A 401 strands the entry until something calls `reconnect()`** (Q3) —
  addressed by D6, exercised by a restart-while-live test. Residual: a token
  revoked server-side for a reason *other* than restart produces no mint reply,
  so nothing triggers recovery and the entry stays 401 until the session
  restarts. Accepted — it is the pre-change behaviour for that case.
- **The e2e leg "extension writes the token after start" is unmeasured** (spike
  §7 — all three providers on the spike host ran out of credits). Module-level
  rotation was measured and extensions load before the first MCP connect, so the
  residual risk is low, but Task 1.1 measures it on the real entry before the
  rest of the change is built.
- **Non-macOS `ps` semantics were not probed.** Linux `/proc/<pid>/environ` is
  owner-only, matching the measured macOS same-uid result — but that is a
  reading, not a measurement.
- **The env credential is inherited by every subprocess the session spawns.**
  Today a session holds no local `/mcp` credential at all; after this change any
  command the agent runs can read its own fleet-control token out of its
  environment. Accepted as the cost of the only verified per-session mechanism,
  but it is a real new exposure surface and is recorded here rather than being
  discovered later.
- **Token in a process env or command output can leak into a crash dump or a
  transcript** → never log the plaintext; assert this in a test.
- **Re-minting on every reconnect grows the in-memory registry**, whose rows have
  no expiry and whose `resolve()` linear-scans. Mint must replace the session's
  existing row rather than append, or the scan cost grows with reconnect count.
- **A Pi-global entry applies to sessions this dashboard never bridged** (a
  second dashboard instance, a session started while the dashboard is down). They
  hold no token, so they 401 — which is the behaviour that ships today, but it
  means the entry's presence is not evidence the path works.
- **`headers` merge semantics**: the spec promises operator-added `headers`
  survive a refresh. Adding a dashboard-owned auth field means the dashboard now
  owns a field adjacent to one it promised not to touch — the boundary must be
  stated in the spec delta, not left to the writer's behaviour.

## Migration Plan

Additive. An existing `pi-dashboard` entry is refreshed in place by the existing
merge-only writer. Rollback = revert; the entry reverts to `{url,
protocolVersion}` and the local path returns to its current (401) state, which is
what ships today.

## Reconciliation of doubt cycle 2

Every cycle-2 finding is now resolved by measurement or by a decision above.

| Cycle-2 finding | Disposition |
|---|---|
| D2's command line is broken as written, and its working form leaks into argv | **Half confirmed.** Bare `$VAR` is dead (Q1a) — D2 rewritten. The argv conclusion is **false** for the `env` slot (Q1b): measured `ps -ww -o args=` marker=false. `args` is eliminated outright — every form there resolves to `""` (upstream bug). |
| D5's channel is a broadcast | **Confirmed, measured e2e** (Q4b). D5 rewritten onto the session-private lane. |
| Restart recovery has no enforcement | **Confirmed** (Q3: no self-healing in either direction). D6 adds the explicit trigger. |
| Delivery failure has no detector | **Resolved by D5.** On the private lane the sender holds the session id, so a send failure is logged server-side with that id; the command's discarded stderr stops being the only record. |
| `mintForSession` appends, never replaces | **Confirmed** — folded into D4 as a required repo-side fix. |
| Requirement 5 is not satisfiable as written | **Confirmed** — D7 supplies the missing mechanism. |

## Open Questions

- Does `bearerTokenEnv` re-resolve on `reconnect()`? If yes it removes the
  ≥250 ms/request cost entirely. **Informational only** — the planning gate fixed
  the transport as `requestHeadersCommand` for this change, so a positive result
  seeds a follow-up change rather than re-opening D2. Probed in Task 1.2; record
  the answer here.

  **ANSWERED (implementation phase, Task 1.2).** YES — with a boundary. Against
  the shipped adapter 2.31.0 (`server-manager.ts:910` + `utils.ts:200`):
  `resolveBearerToken` reads the env var at CONNECT time, and the resolved
  header is fixed onto the transport ("so every attempted transport receives
  the same headers"). A `reconnect()` (close + connect) therefore re-reads the
  live env and presents the rotated value; a mid-connection rotation is NOT
  picked up until a reconnect. It also requires `auth: "bearer"` on the entry.
  Combined with D6's explicit reconnect trigger this removes the per-request
  header-command cost — recorded as the seed of a FOLLOW-UP change; the
  transport stays `requestHeadersCommand` here.
- Should a dashboard-spawned session prefer a spawn-time env injection (no
  runtime delivery at all) while hand-started sessions take the bridge path?
  Deferrable — a refinement inside D2 that changes no spec.
- **D6 implementation deviation (approved by the human operator of the ship-it
  run).** D6 as planned has the extension "explicitly reconnect the
  `pi-dashboard` entry". Shipped pi-mcp-adapter 2.31.0 exposes NO programmatic
  reconnect for a config-defined entry: the only public `pi.events` request ops
  are runtime-register/runtime-snapshot, pi's ExtensionAPI has no MCP surface,
  there is no config watcher, and transient retry classifies only HTTP 503.
  What the shipped stack does instead: `lazyConnect` runs on the entry's next
  USE, re-connecting a dead/failed entry once its 60 s failure backoff
  (`FAILURE_BACKOFF_MS`) expires, and the per-request header command then reads
  the freshly-assigned env (spike Q2). The mint reply therefore remains the
  sole recovery trigger (env assignment), recovery needs no operator action,
  and `connection.status` is read nowhere (F2/F3/F4 test the module); recovery
  completes on next use instead of immediately. The bridge keeps an injected
  `reconnect` seam so a future adapter reconnect op slots in without touching
  the delivery module (`mcp-token-delivery.ts`).
- **P1 measured baseline (implementation phase).** The delivery leg (one full
  header-command spawn+answer) measured **median 57.8 ms, p95 61.3 ms** over 20
  sequential runs on the implementation host — the spike's ≥250 ms figure
  included the adapter's own process-discovery machinery; our delivery leg is
  the smaller share. The standing qa measurement lives in
  `qa/tests/33-mcp-session-token.sh` (P1 leg) and prints the number on every
  VM run.
