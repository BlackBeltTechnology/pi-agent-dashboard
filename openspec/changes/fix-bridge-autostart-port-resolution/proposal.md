# fix-bridge-autostart-port-resolution

## Why

The bridge's auto-start path resolves the dashboard port from `config.json`
alone. When the dashboard runs on a NON-default port, the bridge probes the
wrong port, concludes no dashboard is running, and launches a **second** one on
the defaults. Both stay alive, and the browser and the pi session end up talking
to different servers.

Measured on the e2e harness while shipping `gate-notify-rows-by-level`
(container `pi-dash-test-3022010697`):

| Probe | Value |
|---|---|
| boot | `pi-dashboard start --port 18697 --pi-port 19697` → `running at http://0.0.0.0:18697`, `gateway 19697` |
| +40 s | `[test-entrypoint] daemon restarted: pid 269 -> 494` (supervisor merely NOTICES a new pidfile) |
| after | `Dashboard server running at http://0.0.0.0:8000`, `Pi gateway listening on port 9999` |
| `curl :18697/api/health` (in container) | HTTP 200 |
| `curl :8000/api/health` (in container) | HTTP 200 |
| `server.pid` | `494` — the port-8000 process |
| `memory.current` / `memory.max` | 794 MB / 4 GiB, `memory.events` all zero |

The chain, all verified in source:

- `packages/extension/src/bridge.ts:719` — `const config = loadConfig()`.
- `packages/shared/src/config.ts:572-573` — `DEFAULT_CONFIG` supplies
  `port: 8000`, `piPort: 9999`. The harness's `config.json` carries neither key,
  so both defaults apply.
- `packages/extension/src/server-auto-start.ts:101` — health-checks
  `config.port`; on no answer, `launchServer(config)` starts a second dashboard.
- `packages/extension/src/command-handler.ts:915-936` — `resolveDashboardPort()`
  already documents `PI_DASHBOARD_PORT` / `DASHBOARD_PORT` as *"the only
  reliable source when the server runs on a non-default port, e.g. the Docker
  test harness, whose `config.json` carries no `port` field"* — but **only the
  slash-command path calls it**. `server-auto-start.ts`, `server-launcher.ts`
  and `config.ts` never read the env.

The spawned session's env is already correct (`DASHBOARD_PORT=18697`,
`PI_GATEWAY_PORT=19697`, `PI_DASHBOARD_URL=ws://localhost:19697` observed on the
live process). The env is present; the auto-start path simply does not read it.

**Consequence — every local browser-E2E result is untrustworthy.** Each spec that
drives a prompt fails with *"No response from session — the prompt may not have
been received."* This reproduces with a change's source entirely absent, and it
hits the unrelated `tests/e2e/faux-text.spec.ts` canary, so it presents as broad
regression while being one misresolved port. It is distinct from the
memory-exhaustion failure of `fix-e2e-harness-memory-exhaustion` (#433): memory
sits at 18 % of the cap with zero cgroup events and a single session.

`docker/test-entrypoint.sh:577` already documents the hazard and works around it
for the ONE session it launches itself (`PI_DASHBOARD_URL=…`), but not for the
sessions specs spawn:

> *"Point the bridge at the RUNNING gateway. `config.json` carries no `piPort`,
> so the bridge would default to 9999, find nothing, and try to AUTOSTART a
> second dashboard."*

## What Changes

- **Auto-start resolves the port the same way slash commands already do.** The
  env (`PI_DASHBOARD_PORT` / `DASHBOARD_PORT`, and the gateway equivalent) takes
  precedence over `config.json`, which takes precedence over the defaults. One
  shared resolver, used by both paths, so they cannot drift again.
- **A spawned session never auto-starts a competing dashboard.** A session the
  dashboard itself spawned already knows its parent; it SHALL join that server
  rather than probe-and-launch.
- **The split brain becomes observable instead of silent.** Starting a second
  dashboard while another is already serving on a different port SHALL be
  logged loudly (and refused where the parent is known), so the failure names
  itself instead of surfacing as "no response from session".
- **NOT in scope, and why:**
  - *Changing `DEFAULT_CONFIG`'s `8000`/`9999`.* They are correct defaults for a
    normal install; the bug is precedence, not the values.
  - *The `docker/test-entrypoint.sh` `PI_DASHBOARD_URL` workaround.* It stays as
    a belt-and-braces measure for the independent session; this change removes
    the need for it to be the only defence.
  - *Triaging the remaining red E2E specs (#433 part 1).* Blocked on this: a
    harness that answers on two ports cannot produce a trustworthy verdict.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bridge-auto-start-lifecycle`: new requirements — the auto-start path SHALL
  resolve the dashboard HTTP and gateway ports with env precedence over
  `config.json`, and SHALL NOT launch a second dashboard when the session was
  spawned by a known parent server.

## Impact

- `packages/extension/src/server-auto-start.ts` — port resolution + the
  already-served guard.
- `packages/extension/src/command-handler.ts` — `resolveDashboardPort()` becomes
  (or delegates to) the shared resolver rather than a private copy.
- `packages/extension/src/server-launcher.ts` — launches on the resolved port.
- `packages/shared/src/config.ts` — home for the shared resolver; defaults
  unchanged.
- `tests/e2e/` — unblocks the suite; `faux-text.spec.ts` is the canary that must
  pass before any other E2E verdict is believed.
- No user-visible product behaviour changes on a default-port install, where the
  env is absent and `config.json` already carries the port.

## Discipline Skills

- `systematic-debugging` — the root cause above was reached evidence-first
  (two-port health probes, pidfile, cgroup counters, source chain); the fix is
  judged against reproducing that evidence, not against "the suite looks green".
- `observability-instrumentation` — the third bullet exists so a duplicate
  dashboard can never again present as anonymous session silence.
- `doubt-driven-review` — the precedence change touches every install's startup
  path; it gets an adversarial pass before it stands.
