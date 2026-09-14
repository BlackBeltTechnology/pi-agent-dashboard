# Findings — MCP credential delivery

Every verdict below cites a probe and its observed output. Nothing here is a
reading of `pi-mcp-adapter` source presented as a conclusion; where only a source
reading was possible, it is marked as such and listed in §6.

**Harness.** Scratch HTTP sink on `127.0.0.1:8791` logging every request header
(`/tmp/mcp-spike/sink.mjs`), a scratch pi agent dir via `PI_CODING_AGENT_DIR=/tmp/mcp-spike/agentdir`
(symlinks for `auth.json`/`providers.json`/`models*.json`/`npm`/`git`; its own
`settings.json` + `mcp.json`), and a scratch project `/tmp/mcp-spike-proj`.
Probe token strings only (`SPIKETOK-*`, `SECRETVALUE-A1B2C3`); no `mcp_`
credential was ever minted or written. `~/.pi/agent/mcp.json` sha1
`04d212e387fc6227b45b36565e67b5968f93e919` before and after — unchanged.

Module-level probes import the **shipped** `request-headers-command.ts` and
`server-manager.ts` from `~/.pi/agent/npm/node_modules/pi-mcp-adapter/`; nothing
is re-implemented.

---

## Q1 — interpolation and argv exposure

### Q1a Which forms expand, in which slot — **MEASURED**

Probe: `/tmp/mcp-spike/q1-forms.ts` — one `createRequestHeadersCommandFetch`
call per (slot × form), helper echoes back what it actually received.

```
slot | form       | verdict  | observed
-----+------------+----------+---------
args | ${VAR}     | literal  | received=""          <- expanded to EMPTY
args | $env:VAR   | literal  | received=""          <- expanded to EMPTY
args | {env:VAR}  | literal  | received=""          <- expanded to EMPTY
args | $VAR       | literal  | received="$PROBE_SECRET"
env  | ${VAR}     | EXPANDED | received="SECRETVALUE-A1B2C3"
env  | $env:VAR   | EXPANDED | received="SECRETVALUE-A1B2C3"
env  | {env:VAR}  | EXPANDED | received="SECRETVALUE-A1B2C3"
env  | $VAR       | literal  | received="$PROBE_SECRET"
cmd  | ${VAR}     | EXPANDED | command path interpolated, child ran
```

Two distinct facts:

1. **Bare `$VAR` never expands, in any slot.** It ships literally (no shell in
   `spawn`). Confirms doubt-cycle-2 finding F1.
2. **`args` interpolation is broken — every recognised form resolves to the
   empty string.** `resolvedCommand` does
   `(config.args ?? []).map(interpolateEnvVars)`; `Array.map` passes
   `(value, index, array)`, so the overload
   `interpolateEnvVars(value, environment)` receives the **array index** as the
   environment. `environment[name]` is then `undefined` for every name → `""`.
   This is an upstream `pi-mcp-adapter` bug, not a design constraint. It was
   invisible to both prior doubt cycles.

`command` and `env` slots interpolate correctly (they call
`interpolateEnvVars(value)` with one argument).

### Q1b Argv exposure — **MEASURED**

Probe: `/tmp/mcp-spike/q1-psscope2.ts` — samples the live child pid while it
runs, `ps` in three modes.

```
[env-slot delivery]  pid=42469
    ps -ww -o args=      (argv only) : marker=false
    ps -E -ww -o args=   (argv+env)  : marker=true
    ps axeww (the adapter's own scan): marker=true

[args-slot delivery]  pid=43187
    ps -ww -o args=      (argv only) : marker=true
    ps -E -ww -o args=   (argv+env)  : marker=true
    ps axeww (the adapter's own scan): marker=true
```

Cross-uid probe, same script: `ps -E` against a **root-owned** pid returned no
`KEY=VALUE` pairs; against our own pid it did. Environment dumps are
**same-uid-only**; argv is world-readable.

### Q1c A delivery with no argv exposure — **MEASURED, EXISTS**

`env`-slot delivery (`env: { X: "${VAR}" }`) puts the secret in the child
environment and **not** in argv (`ps -ww -o args=` marker=false, above), while
the value still reaches the sink as a header — confirmed end-to-end in §5.

The stdin envelope carries only `{version, method, url, bodyBase64}` (observed:
103 bytes, keys `version,method,url,bodyBase64`) — no credential channel.

**Verdict.** Doubt-cycle-2 finding F1 is **half right**: bare `$VAR` is indeed
dead, but the conclusion drawn from it — "the working form puts the bearer in
spawn argv" — is **false**. It is only true if the secret is placed in `command`
or `args`. The `env` slot expands correctly and keeps the secret out of argv.
Residual exposure is same-uid `ps -E` / `ps axeww`, which is identical to the
exposure the pi process's own environment already has.

---

## Q2 — invocation model, env freshness, overhead

Probe: `/tmp/mcp-spike/q2-invocation.ts` — one fetch wrapper (one "connection"),
five requests, credential rotated in `process.env` between #3 and #4.

```
requests issued            : 5
child invocations observed : 5 (distinct pids: 5)
header values per request  : ["TOKEN-V1","TOKEN-V1","TOKEN-V1","TOKEN-V2-ROTATED","TOKEN-V2-ROTATED"]
runtime env mutation seen  : true
```

- **Per HTTP request, not per connection** — **MEASURED**. 5 requests → 5
  distinct child pids.
- **The child observes a runtime mutation of the parent's `process.env`** —
  **MEASURED**. Interpolation happens inside the per-request fetch, so a value
  written to `process.env` after the connection is established is picked up by
  the very next request. **This is the single most important finding for
  `wire-mcp-session-token`.**
- Real-session corroboration (§5): 4 invocations during one `connect()`
  (`POST`, `POST`, `GET`, `POST`).

### Overhead — **MEASURED, and it is severe**

Probe: `/tmp/mcp-spike/q2-overhead.ts`, host at 858 processes.

```
header cmd = /bin/sh one-liner            : 250.0 ms/call
header cmd = node script                  : 383.2 ms/call
bare `ps axeww` scan                      :  79.0 ms/call
bare spawn of the same sh script          :   3.3 ms/call
```

The cheapest possible header command costs **250 ms per HTTP request**, of which
only ~3 ms is the spawn. The remainder is the adapter's own process-tree
machinery (`assertPosixProcessDiscoveryAvailable` + a 50 ms descendant-tracking
interval + a kill-path loop requiring two stable passes) — ≈3 full `ps axeww`
scans of the machine per request. A single tool call is ≥2 requests.

---

## Q3 — 401 behaviour and restart recovery

Probe: `/tmp/mcp-spike/q3-401b.ts` — real `McpServerManager` against the sink,
sink flipped 200 → 401 → 200 with the credential rotated across the flip.

```
[1] sink 200 — initial connect
  connect(): OK 1598ms -> connected (+4 cmd invocations)

[2] sink flipped to 401 (credential revoked mid-session)
  refreshTools(conn)      : THREW 457ms -> SdkHttpError: ...{"error":"unauthorized"} (+1)
  connection.status now   = connected            <- stays "connected" while broken
  client.listTools()      : THREW 388ms -> SdkHttpError: ...{"error":"unauthorized"} (+1)

[3] unattended 8s under 401
  header-cmd invocations while idle: 0           <- no retry loop, no self-healing

[4] reconnect() while still 401
  THREW 3084ms -> Error: Dynamic Client Registration rejected (HTTP 401) (+7)

[5] sink back to 200, credential rotated to V2
  unattended invocations in 4s: 0                <- never recovers on its own
  reconnect(stale): OK 1755ms -> connected (+4)
  token presented on that attempt: SPIKETOK-V2   <- fresh credential picked up
  final connection.status = connected
```

- **A non-OAuth 401 throws** (`SdkHttpError`), it is not retried and not backed
  off — **MEASURED**. Confirms doubt-cycle-1 finding D.
- **`connection.status` still reads `connected` after the 401** — **MEASURED**.
  Any health signal derived from that field will lie.
- **No unattended recovery, in either direction** — **MEASURED**. 0 invocations
  in 8 s under 401 and 0 in 4 s after the sink was healthy again.
- **An explicit `reconnect()` does recover, and presents the rotated
  credential** — **MEASURED** (`SPIKETOK-V2`). Recovery is possible; it just has
  to be *triggered*.
- **`reconnect()` under a live 401 fails with a misleading OAuth error**
  ("Dynamic Client Registration rejected") for an entry with no OAuth config —
  **MEASURED**. Costs 3 s and 7 header-command invocations.

---

## Q4 — a non-broadcast server→session channel

### Q4a Classification of every server→extension message — **MEASURED** (static scan)

Scan of `packages/extension/src/bridge.ts`, classifying each inbound
`msg.type` handler by whether it forwards onto the shared `pi.events` bus:

```
SHARED BUS (pi.events.emit)          extension-private
-----------------------------        -----------------
auto_name_state_restore              credentials_updated
stop_after_turn                      preferences_update
flow_management                      prompt_response
role_set / role_preset_load          subagent_resync_request
role_preset_save / _delete           edit_followup_entry
role_remove / request_roles          remove_followup_entry
plugin_emit_event                    promote_followup_entry
prompt_resync_request                clear_followup_entries
flow_control                         set_thinking_level
```

**A session-private server→extension channel already exists** — 9 of 21 message
types are handled entirely inside the bridge extension and never touch
`pi.events`. `credentials_updated` (`bridge.ts:1097`) is the closest precedent:
a server-pushed, credential-related control message handled in-bridge.

### Q4b The broadcast exposure is real — **MEASURED, end-to-end**

Two throwaway extensions in a real pi session (scratch agent dir). `ext-emit`
performs exactly what `bridge.ts:1316` does for a relayed `plugin_emit_event`;
`ext-eaves` is an unrelated third party that merely subscribes.

```
eavesdropper: loaded, subscribing to mcp:token-minted
emitter: set process.env.PI_SPIKE_TOKEN at extension load
eavesdropper: RECEIVED {"token":"SPIKE-BROADCAST-TOKEN-XYZ","intendedFor":"pi-mcp-adapter"}
```

An extension that was never the intended recipient received the payload.
Doubt-cycle-2 finding F2 is **confirmed**: `plugin_emit_event` is a broadcast
and must not carry a credential.

### Q4c Minimal addition, if a dedicated channel is wanted — **NOT NEEDED**

No new mechanism is required: the private lane already exists. A new credential
message would follow `credentials_updated` exactly —

| File | Change |
|---|---|
| `packages/shared/src/protocol.ts` | new `…ExtensionMessage` interface + a member in the `ServerToExtensionMessage` union (`:1301`) |
| `packages/extension/src/bridge.ts` | `if (msg.type === "…")` handler that does **not** call `pi.events.emit` |
| `packages/server/src/…` (sender) | send over the existing extension WS, as `credentials_updated` does |

---

## 5. End-to-end confirmation in a real pi session

Real `pi` process, scratch agent dir, project-level MCP entry pointing at the
sink, credential supplied via the `env` slot as `${PI_SPIKE_TOKEN}`:

```
=== header-cmd invocations ===
{"pid":74422,"method":"POST","url":"http://127.0.0.1:8791/mcp","tok":"SPIKETOK-E2E"}
{"pid":74582,"method":"POST",...,"tok":"SPIKETOK-E2E"}
{"pid":74860,"method":"GET", ...,"tok":"SPIKETOK-E2E"}
{"pid":75013,"method":"POST",...,"tok":"SPIKETOK-E2E"}

=== headers received by the sink ===
POST auth= Bearer SPIKETOK-E2E  x-spike= 1  proto= -
POST auth= Bearer SPIKETOK-E2E  x-spike= 1  proto= 2025-06-18
GET  auth= Bearer SPIKETOK-E2E  x-spike= 1  proto= 2025-06-18
POST auth= Bearer SPIKETOK-E2E  x-spike= 1  proto= 2025-06-18
```

The whole path works in a real session: env → `${VAR}` in the `env` slot →
header command → `Authorization: Bearer …` at the server.

---

## 6. What this ELIMINATES and what remains viable

**Eliminated:**

| Mechanism | Killed by |
|---|---|
| Secret in `args` (any interpolation form) | Q1a — every form resolves to `""`; the entry would present an empty bearer and 401 permanently |
| Secret in `command` / `args` as a literal | Q1b — world-readable in `ps -ww -o args=` |
| Bare `$VAR` anywhere | Q1a — ships literally, never expands |
| A credential over `plugin_emit_event` | Q4b — measured receipt by an unintended extension |
| "The command resolves the calling session" (doubt cycle 1) | Q1c — the stdin envelope carries only `{version, method, url, bodyBase64}`; nothing identifies the session |
| Any design relying on `connection.status` to detect a dead credential | Q3 — reads `connected` while every request 401s |
| Any design assuming a 401 self-heals | Q3 — 0 unattended invocations in either direction |

**Viable — and this is the mechanism to write up:**

`requestHeadersCommand` with the credential in the **`env` slot** as
`${PI_DASHBOARD_MCP_TOKEN}`, the value deposited into the pi process's
`process.env` by the bridge extension over a **session-private** server→extension
message (the `credentials_updated` lane, never `plugin_emit_event`).

Measured properties that make it work:

- interpolation is per-invocation, so a token written at runtime is picked up by
  the next request (Q2) — no restart, no config rewrite, nothing on disk;
- rotation is free: overwrite `process.env`, the next request carries the new
  value (Q2, and Q3 step 5 with `SPIKETOK-V2`);
- no argv exposure (Q1b); residual exposure is same-uid `ps -E`, no worse than
  the pi process's own environment;
- per-session by construction: each pi process has its own `process.env`, even
  though `mcp.json` is shared.

Two costs the write-up must carry:

1. **≥250 ms per HTTP request** (Q2) — a real latency budget item, and ≈3
   `ps axeww` scans per request on a busy host.
2. **A 401 strands the entry until something calls `reconnect()`** (Q3). The
   design needs an explicit trigger; it cannot rely on the adapter recovering.

---

## 7. Unanswered / partially answered

- **Runtime-set token, end-to-end in a real session.** Measured at module level
  (Q2: `TOKEN-V1` → `TOKEN-V2-ROTATED` within one live wrapper) and e2e for a
  token present at launch (§5), but **not** e2e for a token written by an
  extension *after* start: the three model providers available on this host ran
  out of credits mid-spike (`anthropic`/`openai`: "no credits remaining";
  `google`: 404), and a `--mode rpc` session with no prompt never connects its
  MCP servers (0 sink requests in 15 s), so no LLM-free trigger was available.
  Low residual risk — the interpolation is per-invocation and extensions load
  before the first connect — but it is not measured.
- **Who triggers `reconnect()` after a 401** is a design question this spike
  deliberately did not answer; it only established that recovery is possible and
  never automatic.
- **Non-macOS `ps` semantics** were not probed. Linux `/proc/<pid>/environ` is
  owner-only, which matches the measured macOS same-uid result, but that is a
  reading, not a measurement on this host.
- Incidental: `pi.events.emit` from a `setTimeout` after a `--print` session
  ends throws a fatal "extension ctx is stale" error. Unrelated to credentials;
  noted because it cost a probe run.
