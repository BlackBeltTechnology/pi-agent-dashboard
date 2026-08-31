# Design — fix-autostart-discovery-precedence

## Context

Two guards already exist and work. `resolveEndpoint` (change
`add-pi-gateway-transport-identity`, #534) makes mDNS a `suggestion` that is
never selected. `decideRetarget` (same change) refuses a re-target unless
unpinned AND failed AND identityVerified. `shouldAdvertise`
(`fix-bridge-mdns-migration-hijack`, #569) stops a loopback-bound server
publishing an address it does not serve.

`autoStartServer` predates all three and answers a different question — *do I
launch a server, and if not, which one do I point at?* — with the pre-#569
trust model, in **two** discovery branches (pre-launch and the post-launch
`spawnAndAttach`). It is not a hijack of an established bridge (that path is
closed); it is a hijack of the **launch decision**.

`isDashboardRunning` (`packages/shared/src/server-identity.ts`) is **three-state**,
not two: `{running:true}`, `{running:false}` (nothing answers), and
`{running:false, portConflict:true}` (HTTP answered but it is not a dashboard —
a foreign service on the port). Its default probe is 2 s timeout / 0 retries and
is *documented* to false-negative while a previous instance is mid-jiti-bootstrap
(event loop blocked 5–15 s). Both facts constrain the design below.

## Goals / Non-Goals

**Goals**
- The resolved port's liveness is known before any discovered candidate can win,
  in **both** discovery branches.
- A candidate is never adopted unverified.
- A foreign service on the resolved port does not strand a session that could
  have discovered a relocated dashboard.
- The warning's stated precondition is one the code has actually checked, and
  the healthy case emits no toast.
- An ephemeral server reclaims its ports/memory instead of leaking them.

**Non-Goals**
- Re-litigating the connect/migrate path. #569 closed it; measured 38/38.
- Removing mDNS. Discovery is legitimately how a session finds a dashboard on a
  non-default port.
- A general orphan reaper for arbitrary processes. Scope is servers that opt in
  as ephemeral.
- Verifying the gateway `piPort` end-to-end (see D2 trade-off).

## Decisions

**D1 — Probe the resolved port first; when it serves, return it and skip
discovery entirely.**
Swap the pre-launch steps so the resolved-port health check runs before the
discovery branch. When the resolved port serves, auto-start returns it and does
NOT consult discovery at all — there is no divergence to record because the
correct answer is already known, and no banner because nothing is wrong. This is
what removes the noise banner at its root (a serving resolved port never emits a
mismatch record). Discovery runs ONLY when the resolved port is silent or
foreign. Because the default probe is documented to false-negative during
bootstrap, the resolved-port gate MUST use bootstrap-aware opts (`retries` /
`timeoutMs`, e.g. the ~8 s the same file recommends) that retry on a timeout
(`AbortError`) — but NOT on `ECONNREFUSED`, which is a definitive "nothing is
listening" and must fall through to launch without paying retry delays (F7).

**Consequence for D4:** because a serving resolved port short-circuits before
discovery, there is no "resolved port serves AND discovery found another" state
to log. The only mismatch record that can exist is on the silent/foreign path,
where discovery actually ran.

**D2 — A discovered candidate is admitted only after `GET /api/health`; only
the HTTP port is verified.**
Mirrors #569's D1 on the connect path. The candidate probe hits the candidate's
advertised host + HTTP port, which requires **widening the `isDashboardRunning`
seam** in `AutoStartDeps` to accept a host (today typed `(port: number)`) — an
explicit, tasked change, not a silent one. Trade-off made explicit: the gateway
`piPort` is adopted from the mDNS TXT record (with a `9999` fallback in
`serviceToServer`) and is **not** independently probed — verifying a raw gateway
socket is out of scope, and a candidate that answers `/api/health` but has a
wrong TXT `piPort` is a pre-existing risk this change neither fixes nor worsens.
Where the advertised host is an mDNS hostname that resolves slowly, the probe
timeout bounds the cost.

**D2b — `portConflict` on the resolved port falls through to discovery.**
The three-state probe means "resolved port answers but is foreign" is distinct
from "resolved port is silent". A `portConflict` MUST NOT short-circuit before
discovery: a real dashboard may have relocated precisely because a foreign
service took the default port. Only after discovery yields no verified candidate
does the existing `portConflict` → "no launch" refusal (server-auto-start.ts:183)
apply. This preserves today's behaviour (discovery-first already found the
relocated dashboard) that a naive reorder would regress.

**D3 — Deterministic selection among multiple locals, with a total order.**
Prefer the candidate whose port equals the resolved port; otherwise lowest port;
**ties on port broken by host string** so the order is total and cannot fall
back to array/arrival order. Alternative: keep `find(isLocal)`. Rejected — a
race in a launch decision is unreproducible by definition, and that
unreproducibility is what made the original incident hard to attribute.

**Scope of the guarantee (F6):** determinism is over the candidate *set*
`discoverDashboard` returns, not over the multicast collection window. mDNS
discovery resolves shortly after the first advertisement, so *which* servers are
in the set can still vary with timing — widening that window would add latency to
every start and is out of scope. The spec's "SHALL NOT depend on arrival order"
is therefore scoped to selection over a fixed returned set; the collection
window is a pre-existing property of `mdns-discovery.ts`, unchanged here.

**D4 — A serving resolved port emits no mismatch record at all; the warning
survives only on the silent path.**
Per D1, a serving resolved port short-circuits before discovery, so no mismatch
is observed and nothing is recorded or shown — this is the fix for the original
noise banner (which fired precisely because discovery ran while `:8000` served).
The `warning` (toast) naming both ports survives ONLY on the path where the
resolved port was probed, found silent, and discovery then yielded a verified
candidate — exactly what `bridge-auto-start-lifecycle` already specifies. The
post-launch branch (D-post) never raises this warning: a transient health miss
just after our own successful launch is not a hijack and must not surface a
"resolved port silent" toast. The greppability contract for the silent-path
record is unchanged; the healthy-path record is deleted, not relocated.

**D5 — Ephemeral is opt-in (flag only), consumes the existing signal, and exits
through the existing graceful-stop path.**
`bootParentAlive` is already computed, already in `/api/health`, already
cross-platform. The change is a consumer, not a mechanism. NOTE the existing
idle timer (`createIdleTimer`, `server.ts:1183`) CANNOT host this check: its
`start()` early-returns when `config.autoShutdown` is false (the default, and the
exact isolated-verification config ephemeral targets), and it terminates via raw
`process.exit(0)` — the leak path this design forbids. So a small INDEPENDENT,
unconditional interval (e.g. 5 s) is introduced, active only in ephemeral mode,
that evaluates boot-parent liveness and, on a proven-dead parent, calls
`server.stop` (NOT `process.exit`) so the full drain runs
(`shutdownHeadlessProcesses` reaps spawned pi, `recordExitIntent`, flush, tunnel
teardown). Its interval is the stated exit-latency bound. `ExitIntent`
(`shared/src/boot-state.ts`) has no ephemeral value; add one, and place it in the
recovery-suppressing set (like `shutdown`) so an ephemeral exit is not treated as
a crash to recover from. This bounds exit latency by the idle timer's cadence.
Opt-in via an explicit **flag only** — NOT an env var (F8): an inherited
`PI_DASHBOARD_EPHEMERAL=1` in a shell would make a user's real standalone
dashboard exit when that shell dies, the exact failure inference was rejected to
avoid. Never inferred from a temp `HOME`, bind address, or port. Standalone and
Electron-hosted servers are excluded by construction.

**D-post — The post-launch branch prefers the just-launched resolved port.**
After a successful `launchServer`, `spawnAndAttach` probes the resolved port with
the same bootstrap-aware opts; when it answers, it is returned and discovery is
used only to resolve a non-localhost host, never to let a discovered stray
displace the server we just started. The post-launch branch shares the D3
selection helper for any candidate it does consider, and — per D4 — raises no
"resolved port silent" warning on a transient post-launch miss.

**D6 — Liveness for the kill decision distinguishes ESRCH from EPERM, and
trusts the reuse-immune tier where it exists.**
`isProcessAlive` (`platform/process.ts`) catches *any* throw → `false`. For a
diagnostic that is fine; for a **kill decision** it is not: `process.kill(pid,0)`
throws `EPERM` when the parent is alive but owned by another user / hardened —
treating that as "dead" would exit an ephemeral server while its parent lives.
The ephemeral consumer MUST treat EPERM (and any non-ESRCH errno) as *alive*,
and only ESRCH (or the Windows Tier-2 signalled-exit) as *dead*.

The reuse-safety rule is tier-specific, not "any tier reports alive" (which would
be self-contradictory on Windows PID reuse, where reuse-immune Tier-2 correctly
says dead while Tier-1 signal-0 on the recycled PID says alive). The precedence:
where the reuse-immune Tier-2 handle exists (Windows), it is authoritative. On
POSIX, where only Tier-1 is available, PID reuse is tolerated in the safe
direction (reads alive → occasionally fails to exit, never a false exit).

## Risks / Trade-offs

- **Reordering changes timing.** The resolved-port probe now runs on every start
  with bootstrap-aware retries — slower worst case than the 2 s multicast wait
  it displaces, but only when the port is genuinely slow to answer.
- **`piPort` stays unverified (D2).** Accepted; pre-existing, unchanged.
- **A legitimately-relocated dashboard is adopted one probe later.** Bounded by
  the health-probe timeout, only on the silent/`portConflict` path.
- **D3 changes which server is chosen** when several advertise and none matches
  the resolved port. Previously arbitrary, so no caller can have depended on it.
- **D5 can terminate a server.** Mitigated by flag-only opt-in, by D6's
  alive-biased liveness, by exiting through `server.stop` (no leaked sessions),
  and by never applying to standalone or Electron.
- **Bootstrap-aware retry is timeout-only (F7).** The resolved-port gate retries
  on `AbortError` (a server may be mid-jiti-bootstrap) but NOT on
  `ECONNREFUSED` (nothing listening → launch now), so a cold start with no
  server does not pay retry delays. A non-200 answer is `portConflict` and
  routes to D2b, not to the retry loop — pre-existing `isDashboardRunning`
  behaviour, unchanged.
- **Pin-vs-portConflict order.** When the resolved port is foreign AND the
  session is pinned AND discovery yields no candidate, the pin refusal is
  evaluated before the port-conflict refusal (unchanged ordering); only the
  discovery fall-through (D2b) is newly inserted ahead of the port-conflict
  refusal.
- **Lock-loser / post-failure probes stay on the default 2 s/0-retry probe.**
  Same false-negative class D1 fixes on the primary gate; pre-existing and out
  of scope here (noted for a follow-up).

## Migration Plan

No data or schema migration. Ships in `packages/extension` (both discovery
branches), a seam widening in `packages/shared/src/server-identity.ts`, and one
wiring point + timer in `packages/server`. Rollback is a revert; behaviour
returns to discovery-first.

Verification needs a poisoned-discovery environment — a second dashboard
advertising while the resolved port is silent, while it serves, and while a
foreign service holds it — all constructible in the existing auto-start test
harness via the `discoverDashboard` / `isDashboardRunning` seams in
`AutoStartDeps`.

## Open Questions

- Should `PI_DASHBOARD_NO_MDNS=1` become the default for the isolated
  verification recipe once ephemeral self-exit lands? Leaning no — ephemeral
  lifecycle plus #569's advertisement guard should suffice, and an extra flag
  has historically cost more in forgotten-flag incidents than it saved.
