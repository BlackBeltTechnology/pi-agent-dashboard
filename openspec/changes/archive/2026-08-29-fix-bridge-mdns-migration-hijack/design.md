## Context

The bridge (`packages/extension/src/connection.ts`, `bridge.ts`) targets a
dashboard endpoint discovered via mDNS (`@blackbelt-technology/pi-dashboard-shared/mdns-discovery.js`)
with a config-probe fallback. `ConnectionManager` owns a single `url` and a
backoff reconnect loop; `handleDisconnect()` reschedules against whatever `url`
currently holds.

Observed failure: a session registers on `ws://localhost:9999`, then the bridge's
`url` becomes `ws://home-imac-54922.local:9594` and the reconnect loop runs
against that address forever. `disconnect()` is never called and `initBridge`
runs once, so this is a **re-target of a live connection**, not a teardown.

The adopted endpoint belonged to a stale dashboard from a git worktree, bound to
`127.0.0.1` but advertising a `*.local` hostname — unreachable by construction.
The existing `mdns-discovery` spec requires a `GET /api/health` check only on the
config-probe fallback, so nothing validated the mDNS candidate. Its "Localhost
preference" requirement was also bypassed, because it is written as a *selection*
rule and this was a *migration*.

Constraints:
- The bridge must keep working when a server legitimately moves (restart on a new
  port, machine changes network). A blanket "never migrate" rule is not
  acceptable.
- pi's stdout/stderr is discarded unless `keeperLog.capturePiOutput=true`, so
  extension-side `console.error` is not a usable diagnostic channel by default.
- Discovery lives in a shared package used by both server and extension.

## Goals / Non-Goals

**Goals:**
- An established, registered bridge is never lost to an unreachable candidate.
- A migration that fails returns the bridge to the endpoint that worked.
- A stale loopback-bound instance cannot advertise an endpoint others will adopt.
- Re-targeting is visible without enabling pi output capture.

**Non-Goals:**
- Reaping stale dashboard processes (operational).
- Explaining why the server's own repo as cwd is exempt (open question in the
  proposal).
- Changing the heartbeat grace period that leaves bridgeless sessions `active`.
- Any client or wire-protocol change.

## Decisions

**D1 — Validate the candidate before dropping the incumbent, not after.**
The health probe already exists for the fallback path; reuse it as an admission
gate on the mDNS path. Alternative considered: adopt first, fall back on failure.
Rejected as the primary mechanism because the failure window is exactly the
outage being fixed — the bridge is off the working server while probing a dead
one. Fallback is retained as D2, for endpoints that die *after* admission.

**D2 — Bounded migration attempts with return-to-last-good.**
`ConnectionManager` remembers the last endpoint on which a `session_register`
succeeded. After N failed opens against a newly adopted endpoint, it re-targets
that remembered endpoint. Alternative: unbounded backoff (current behaviour) —
rejected, it is the mechanism that makes the outage permanent. N and the backoff
ceiling should be small enough that a mistaken migration self-heals in seconds.

**D3 — Localhost preference becomes an invariant on the connection, not a
selection-time sort.** Expressing it as "a remote candidate never displaces an
established localhost connection" makes it enforceable at the point of migration.
Alternative: keep it selection-only and rely solely on the health check —
rejected because a *reachable* remote server would still be able to steal a
session from the local one.

**D4 — Fix the advertisement as well as the consumer.** A loopback-bound server
publishing a LAN hostname is wrong independently of who consumes it. Fixing only
the bridge would leave the same poison for any other client (and older bridges).
Alternative: consumer-only fix — rejected as treating the symptom.

**D5 — Report migration to the server, not to stderr.** The diagnostic must
survive the default `capturePiOutput=false`. Reuse the existing extension→server
event channel rather than adding a log sink.

## Risks / Trade-offs

- **Guarding migration could strand a bridge when the old server is genuinely
  gone.** → The incumbent is only retained while it is *established*; once it
  drops, normal discovery applies unchanged. The guard governs displacement of a
  live connection, not recovery from a dead one.
- **A health probe on every candidate adds latency and traffic to discovery.** →
  Probe only when a migration is actually proposed for an established
  connection, not on every browse event.
- **`*.local` classification is not purely lexical** — a `.local` name can
  resolve to a loopback address. → Classify lexically, never by resolving
  DNS (the hostname is a hint, not the truth): a loopback-bound server never
  advertises (D4), and the admission gate re-checks the candidate's actual
  reachability before any adoption.
- **Return-to-last-good could ping-pong** between two endpoints that both fail
  intermittently. → Bound the exchange: after returning to last-good, a further
  migration to the same rejected endpoint must wait out a cooldown.
- **The cwd asymmetry is unexplained**, so a second factor may exist that this
  design does not address. → The fix is behavioural (never adopt an unreachable
  endpoint) and holds regardless of what triggers the migration.
## Migration Plan

No data or schema migration. Ship in `packages/extension` plus the server's mDNS
advertisement. Rollback is reverting the change: behaviour returns to unguarded
migration.

Verification requires a poisoned-discovery environment — a second dashboard bound
to loopback advertising a non-loopback hostname — which is exactly the shape that
occurred naturally here and is reproducible in a test harness.

## Open Questions

- Why is a session whose cwd is the dashboard's own repo immune? Six other cwds
  migrated; that control never did, twice, two hours apart. (Filed as its own
  investigation: `openspec/changes/investigate-bridge-cwd-asymmetric-immunity/`.)
- Should a bridge ever migrate away from a *registered* connection at all, absent
  an explicit user action such as the server switcher? D1–D3 keep the capability
  and constrain it; forbidding it outright is simpler but would break the
  server-moved recovery path.
- ~~What is the right N and cooldown for D2?~~ RESOLVED (task 3.4): **N = 4
  failed opens, cooldown = 60 s**. Basis: the reconnect backoff is
  1s → 2s → 4s → 8s, so the fourth failure lands ~15 s after adoption; a
  deliberate server restart (`POST /api/restart`) answers again within ~5–10 s,
  so 4 attempts ride out a real restart while still returning the bridge to the
  working endpoint within seconds of a mistaken migration. The 60 s cooldown
  outlives the window in which a flapping pair would otherwise swap on every
  discovery tick, while leaving a deliberate re-discovery a minute later
  unaffected. Constants live in `ConnectionManager`
  (`MIGRATION_MAX_FAILED_OPENS`, `MIGRATION_COOLDOWN_MS`), overridable via
  constructor options for tests.

## Resolution Notes (implementation)

- **Classification is lexical.** Loopback = `localhost`/`*.localhost`/`127.x`
  /`::1`; everything else — including every `*.local` mDNS name — is remote.
  DNS resolution inside the gate was rejected: it adds latency and failure
  modes to the migration path, and the ambiguous "`.local` that resolves to
  loopback" shape is removed at the source by D4 (a loopback-bound server no
  longer advertises at all), with the health probe as backstop. Treating a
  loopback-resolving `.local` as remote is the strict side of the rule: it can
  only decline a migration, never adopt a wrong endpoint.
- **Gate order**: cooldown → establishment status → health probe → localhost
  preference. The probe runs before the preference rule so a refusal names the
  candidate's actual failure (D5's "failure reason"), matching the spec's own
  scenario order ("reachable" first, "preferred under the localhost-preference
  rule" second).
- **`updateUrl` is gone.** The ambient mutation is replaced by the explicit,
  gated `retargetTo(url, {trigger, verify?})`; the per-attempt ticket override
  now applies to the dial only, so the base endpoint is never mutated by
  preparation and `lastRegisteredUrl` always names the real endpoint.
- **`session_register` "acknowledged"** means sent on a LIVE socket (the
  server's only register response is a terminal `register_rejected`; silence
  is success). The bridge notes registration at the initial register and in
  `sendStateSync()`; a note taken while the socket is still connecting is
  promoted on open, when the buffered register flushes.
- **Other discovery consumers audited (task 7.2)** — none replaces a working
  connection: the server's mDNS browser feeds only the display-only peer list
  (`servers_updated` broadcast); the config-probe fallback already
  health-checks before returning; the client's network-discovery scan is
  user-initiated display. The bridge's re-target site was the only place a
  discovered endpoint could displace a working one.
  **Follow-up answer (fix-autostart-discovery-precedence, task 8.1):** the
  audit missed `autoStartServer` — both its discovery branches (pre-launch
  and post-launch `spawnAndAttach`) let a discovered candidate displace a
  launch/attach decision. Addressed in that change: the resolved port's
  status is established first (bootstrap-aware), candidates are
  health-verified at their advertised host+port before admission, selection
  is deterministic, and the post-launch branch never adopts an other-port
  candidate.
