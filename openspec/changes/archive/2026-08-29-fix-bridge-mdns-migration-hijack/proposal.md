# fix-bridge-mdns-migration-hijack

## Why

A newly spawned session connects to the real dashboard, registers successfully —
and then **migrates its bridge to a different dashboard discovered over mDNS**.
When that discovered server is unreachable, the bridge reconnect-loops against it
forever and never returns to the server that was working. The session keeps
`status=active` under the heartbeat grace period, so the dashboard renders a
normal card, while every prompt fails `502 no bridge connection for session`.

Nothing reports it. The spawn API returns success, the card looks healthy, and
`server.log` shows only an unexplained `connection closed`.

On the instance where this was found, **every** session spawned outside the
dashboard's own repo was dead on arrival for ~23 hours.

### Root cause, from instrumented pi stderr

Probes in `initBridge` and `ConnectionManager` (`keeperLog.capturePiOutput=true`):

```
[P2] initBridge ENTER prevGen=0 hasPrevPi=false samePi=false prevConns=0 hasCleanup=false
[P2] createConnection  url=ws://localhost:9999                 ← correct server; registers OK
[P2] handleDisconnect  url=ws://home-imac-54922.local:9594     ← URL CHANGED
[P2] scheduleReconnect url=ws://home-imac-54922.local:9594
[P2] createConnection  url=ws://home-imac-54922.local:9594
[P2] handleDisconnect  … backoff 1000 → 2000 → 4000 → …        ← forever
```

`ConnectionManager.disconnect()` is **never** called, and `initBridge` runs
exactly **once**. This is not a teardown and not a re-init — the bridge
*re-targets* a live, registered connection at a server it discovered, and the
old endpoint is never reconsidered.

### The endpoint it migrates to cannot work

```
port 9594 + 8478        → pid 78840, a stale dashboard from a git worktree (uptime 1d)
listens on              → 127.0.0.1 ONLY
advertises via mDNS as  → home-imac-54922.local:9594
GET http://home-imac-54922.local:8478/api/health → 000 (unreachable)
```

A loopback-bound server advertising itself under a LAN hostname is
**structurally unreachable** by anyone who believes the advertisement, including
processes on the same machine. Nothing verifies the candidate before adopting
it: the existing `mdns-discovery` spec requires a `GET /api/health` check only on
the *config-probe fallback* path, not on the mDNS path.

The existing **"Localhost preference"** requirement is also not honoured here —
a `*.local` hostname is not localhost, yet it displaced an established
`ws://localhost:9999` connection.

### Reproduced

Seven spawns against the live server, varying only cwd. Every arm registers;
only one keeps its bridge.

| cwd | `.pi/` | `openspec/` | result |
|---|---|---|---|
| `/private/tmp/wedge-repro` (git, no HEAD) | – | – | ❌ 502 |
| `/private/tmp/wedge2` (git + commit) | – | – | ❌ 502 |
| `/private/tmp/w-a` | – | – | ❌ 502 |
| `/private/tmp/w-b` | – | **yes** | ❌ 502 |
| `~/Project/zz-spawn-test-c` (bare git) | – | – | ❌ 502 |
| `~/Project/pi-chainlint` (real project) | yes | yes | ❌ 502 |
| **`~/Project/pi-agent-dashboard`** | yes | yes | ✅ works (twice, 2 h apart) |

### Hypotheses the evidence kills

| Hypothesis | Killed by |
|---|---|
| Invalid git repo (`fatal: ambiguous argument 'HEAD'`) | Valid-repo arm fails identically |
| `openspec-watcher` ENOENT | Arm with `openspec/changes` present fails identically |
| `/private/tmp` is special | Bare `~/Project` arm fails identically |
| A "configured workspace" allowlist | No such config exists |
| Project lacks pi configuration | Fully configured project fails |
| Server degraded over time | Control re-run 2 h later still works |
| pi crashed | pi alive, `stat=S`, ~200 MB RSS |
| Server ping-reaper closed it | That path logs `connection dead (ping timeout, N misses)`; absent |
| Extension never started | `[dashboard] sendFlowsList … sessionId=<id>` present |
| Bridge re-init teardown (`bridge.ts:182`) | `initBridge` ran once; `disconnect()` never called |

## What Changes

- **An established, registered connection SHALL NOT be abandoned for an
  unverified discovery result.** Migration away from a working bridge SHALL
  require the candidate to pass a health check first.
- **Migration SHALL be reversible.** If the new endpoint fails to establish
  within a bounded number of attempts, the bridge SHALL fall back to the last
  endpoint on which it was successfully registered, rather than backing off
  against the new one indefinitely.
- **Localhost preference SHALL apply to migration, not only to initial
  selection.** A non-localhost candidate SHALL NOT displace an established
  localhost connection.
- **A server SHALL NOT advertise an address it does not serve.** A dashboard
  bound only to loopback SHALL advertise a loopback-resolvable address or not
  advertise at all, so a stale instance cannot publish an unreachable endpoint.
- **Migration SHALL be observable.** Re-targeting the bridge SHALL be logged
  with both endpoints and the reason, on a channel that survives
  `capturePiOutput=false`.
- **NOT in scope, and why:**
  - *Killing/reaping stale dashboard instances.* An operational concern; this
    change makes a bridge resilient to one existing, which is the durable fix.
  - *Why the server's own repo is exempt.* Real and unexplained — see Open
    Question. Fixing the migration removes the symptom regardless.
  - *The heartbeat grace period keeping dead sessions `active`.* Tracked with
    the liveness reconcile work in `fix-spawn-correlation-ttl-coupling`.
  - *Duplicate bridge registration for one session id.* Different failure
    (delivery to the wrong live socket) — `fix-duplicate-bridge-registration`.

## Open Question

Why does a session whose cwd is the dashboard server's own repository keep its
`localhost:9999` connection, when six other cwds do not? The control was run
twice, two hours apart, and never migrated. No mechanism for a cwd-dependent
discovery decision has been identified. This is not required to fix the defect,
but it is unexplained and may indicate a second factor.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mdns-discovery` — migration away from an established connection becomes
  guarded, reversible, and subject to localhost preference; advertisement must
  match what the server actually serves.

## Impact

- **Users:** sessions spawned while any stale/unreachable dashboard is
  advertising stop being born dead. Removes a failure whose only symptom is a
  card that accepts typing and never answers.
- **Risk:** the guard must not block *legitimate* migration (a real server
  restarting on a new port, a laptop moving between networks). A health check
  plus fallback-on-failure preserves those paths; a naive "never migrate" rule
  would break them.
- **Blast radius:** `packages/extension` (connection targeting) and the server's
  mDNS advertisement. No client or protocol change.

## Discipline Skills

- `systematic-debugging` — the fix follows an instrumented root cause; the
  remaining cwd asymmetry needs the same treatment.
- `observability-instrumentation` — a silent bridge re-target is the reason this
  cost hours; logging it is part of the deliverable.
- `doubt-driven-review` — the guard sits on the path that legitimately recovers
  a moved server; getting it wrong strands bridges instead of hijacking them.
