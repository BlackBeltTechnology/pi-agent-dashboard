# fix-autostart-discovery-precedence

## Why

`fix-bridge-mdns-migration-hijack` (#569) hardened the **connect** path: mDNS
became a `suggestion` in `resolveEndpoint`, `decideRetarget` gained a
conjunctive guard, and a loopback-bound server stopped advertising. Measured on
a live instance immediately after it shipped: **38 `retarget_refused`, 0
accepted, 520/520 endpoints resolved from `PI_DASHBOARD_SOCKET`.** The guard
holds.

Its own follow-up task 7.2 asked whether the same guard is needed anywhere else
a discovered endpoint replaces a working one. **It is** — `autoStartServer` was
never touched by #569 and still treats mDNS as authoritative in **two** places:

1. **Pre-launch** (`server-auto-start.ts:119-142`) returns the first discovered
   local dashboard before the health check on the resolved port ever runs:

   ```ts
   const servers = await deps.discoverDashboard(2000);
   const local = servers.find(s => s.isLocal);   // arbitrary first local
   if (local) { ...notify("warning")...; return { server: local } }   // ← returns
   }
   const status = await deps.isDashboardRunning(config.port);   // ← unreachable
   ```

2. **Post-launch** (`spawnAndAttach`, `server-auto-start.ts:~350`) does the
   same after a successful spawn — `discoverDashboard(10000)` →
   `find(s => s.isLocal)` → returns it — with no health gate and in
   multicast-arrival order. After launch the resolved port *does* answer, so a
   stray advertiser winning that race returns a foreign dashboard even though
   the just-launched one is serving.

Neither branch health-probes the candidate, prefers the resolved port, or
chooses deterministically among N advertising locals.

### This already contradicts the spec

`bridge-auto-start-lifecycle` → "Discovery elsewhere while the resolved port is
silent warns both ports" is explicitly conditioned on:

> - **AND** the resolved port 8000 answers nothing

The code emits the warning whenever the ports merely *differ*. Observed on a
live instance while `:8000` was serving normally:

```
[auto-start] discovered dashboard elsewhere: attaching to port 8588 (gateway 9636);
             resolved port 8000 silent — no launch
```

`:8000` was not silent. The log line asserts a precondition nothing checked,
because step 1 returns before step 2 runs. The user-facing banner fires at
discovery time, before `decideRetarget` runs — so in the now-guarded normal case
the retarget is refused, nothing breaks, and the operator is handed a red
warning for a non-event.

### The damaging case

When the resolved port is genuinely **down** and any stray instance advertises,
auto-start returns "found one, not launching" and the user's dashboard never
starts.

### A separate leak: ephemeral servers that outlive their agent

The two advertisers in the trace above were isolated-verification servers
(`HOME=$(mktemp -d)`, loopback-bound) that had orphaned to `PPID 1`, outlived
their git worktrees, and kept holding ports and ~200 MB each until killed by
hand.

**Correction to the naive framing:** because they were loopback-bound, #569's
`shouldAdvertise` already stops them advertising — post-#569 they can no longer
poison discovery. Ephemeral self-exit does **not** fix an mDNS hijack; it
reclaims **leaked ports and memory**. `bootParentAlive` is already computed and
exposed in `/api/health`, and Electron zombie detection already consumes it —
but no *server-side* consumer acts on it to self-terminate. That is the gap.

## What Changes

- **Both** auto-start discovery branches (pre-launch and post-launch) establish
  the resolved port's status before a discovered candidate can win, adopt a
  candidate only after a `GET /api/health` probe, and choose deterministically
  among multiple locals.
- When the resolved port serves, it is returned and discovery is not consulted
  at all — so a serving resolved port emits no mismatch record and no banner.
  This deletes the noise banner at its source (it fired precisely because
  discovery ran while `:8000` served).
- A `portConflict` on the resolved port (a foreign service, not a dashboard)
  does not suppress discovery — a real dashboard relocated elsewhere is still
  adopted rather than leaving the session with nothing.
- The `warning` banner survives ONLY on the silent path (resolved port probed,
  found silent, verified candidate discovered) — as the spec already requires.
  The post-launch branch never raises it on a transient miss after our own
  launch.
- An **ephemeral** server (explicit opt-in) exits when its boot parent dies, so
  isolated-verification instances reclaim their ports and memory instead of
  leaking them. Never applies to a standalone or Electron-hosted dashboard.

## Capabilities

### New Capabilities

- none

### Modified Capabilities

- `bridge-auto-start-lifecycle` — discovery (both branches) no longer outranks
  the resolved port; candidates are health-gated; the warning's stated
  precondition becomes one the code has verified.
- `boot-parent-liveness` — the already-computed `bootParentAlive` gains an
  opt-in server-side consumer.

## Impact

- `packages/extension/src/server-auto-start.ts` — ordering + candidate
  admission + deterministic selection in **both** discovery branches +
  notification level.
- `packages/shared/src/server-identity.ts` — the `AutoStartDeps.isDashboardRunning`
  seam may widen to carry a host and bootstrap-aware retry opts for candidate
  probing.
- `packages/server/src/server.ts` — ephemeral self-exit wiring (a new bounded
  timer; there is no existing periodic tick to reuse).
- Isolated-verification recipes gain a lifecycle guarantee instead of relying on
  every author remembering to tear down.
- No schema or data migration. Rollback is a revert.

## Discipline Skills

- `systematic-debugging` — the ordering defect was found by reading a live
  instance's logs, not the source; any regression must be re-derived the same
  way (`retarget_refused` / `endpoint_resolved` counts), because every outbound
  signal looks healthy while this fails.
- `observability-instrumentation` — task 4 changes what is logged and at which
  level; the greppability contract in `bridge-auto-start-lifecycle` must survive
  while the healthy-case toast is removed.
- `review-code` — before commit, per the project checkpoint table.
- `doubt-driven-review` — the ephemeral self-exit can terminate a running
  server; it is irreversible from the server's own perspective and must be
  stress-tested against the standalone/Electron cases AND the EPERM liveness
  direction before it stands.

`security-hardening` and `performance-optimization` do not apply: no untrusted
input, no auth surface, no latency budget.
