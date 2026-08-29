# fix-bridge-autostart-port-resolution

## Why

The bridge's auto-start path resolves the dashboard port from `config.json`
alone. When the dashboard runs on a NON-default port and mDNS discovery does
not answer, the bridge probes the wrong port, concludes no dashboard is
running, and launches a **second** one on the defaults. Both stay alive; a
session whose bridge did not pin its endpoint can then attach to the wrong
server's gateway while the browser talks to the real one.

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

Measured facts: two dashboards answered `/api/health` simultaneously; the
port-8000 process owned `server.pid`; prompts went unanswered. The exact
per-session attach chain behind the silent prompts was **not** traced.
What follows is the verifiable source mechanism this change fixes — not a
claim about which harness session attached where.

The chain, verified in source (line numbers current at planning time):

- `packages/shared/src/config.ts:641-648` — `DEFAULT_DASHBOARD_PORT = 8000`,
  `DEFAULT_GATEWAY_PORT = 9999`, applied by `DEFAULTS` when `config.json`
  carries neither key (the harness's does not).
- `packages/extension/src/bridge.ts:834` — `loadConfig()` feeds the bridge
  config. `bridge.ts:840-877` — the CONNECTION endpoint already has its own
  precedence ladder (`resolveEndpoint`: `PI_DASHBOARD_SOCKET` →
  `PI_DASHBOARD_URL` → rendezvous record → `ws://localhost:${config.piPort}`
  as last resort), so an endpoint-PINNED session never touches
  `config.piPort`.
- `packages/extension/src/bridge.ts:3177` — `autoStartServer(config, …)` runs
  UNCONDITIONALLY, even for a pinned session. Inside
  `server-auto-start.ts`: step 1 mDNS discovery, step 2 health-check on
  `config.port`, step 3 `launchServer(config)` when nothing answers.
- `packages/extension/src/command-handler.ts:1132-1155` —
  `resolveDashboardPort()` (at `:1141`) already resolves
  `PI_DASHBOARD_PORT` → `DASHBOARD_PORT` → `config.json` `port` → `8000`, and
  its doc calls the env *"the only reliable source when the server runs on a
  non-default port"* — but only the slash-command path calls it.
  `server-auto-start.ts` never reads the env.

Where the env actually comes from (this also corrects the in-code comment):
the dashboard server injects ONLY `PI_DASHBOARD_URL` / `PI_DASHBOARD_SOCKET`
into sessions it spawns
(`packages/server/src/spawn-process/process-manager.ts:252`).
`DASHBOARD_PORT` / `PI_GATEWAY_PORT` reach a session via CONTAINER env in the
docker harness (`docker/compose.test.yml`), not via the server. The server's
own gateway env convention is `PI_DASHBOARD_PI_PORT`
(`packages/server/src/cli.ts:158`).

Blast radius is narrower than "every non-default install": with mDNS healthy,
step 1 of `autoStartServer` discovers a non-default dashboard and the bug
does not fire. It fires where mDNS is disabled or fails — the harness sets
`PI_DASHBOARD_NO_MDNS` — and for sessions spawned OUTSIDE the server (no
pinned endpoint) on such hosts.

`docker/test-entrypoint.sh:627-630` documents the hazard for the ONE session
it launches itself:

> *"Point the bridge at the RUNNING gateway. `config.json` carries no `piPort`,
> so the bridge would default to 9999, find nothing, and try to AUTOSTART a
> second dashboard — which fails with 'readiness timeout' and leaves the
> session connected to nothing."*

But pinning `PI_DASHBOARD_URL` only pins the CONNECTION endpoint;
`autoStartServer` still runs (`bridge.ts:3177`) and still probes/launches on
the `config.json` port. The workaround defends the session's ATTACH — not the
host against a second dashboard.

**Consequence — every local browser-E2E result is untrustworthy.** Each spec
that drives a prompt fails with *"No response from session — the prompt may
not have been received."* This reproduces with a change's source entirely
absent, and it hits the unrelated `tests/e2e/faux-text.spec.ts` canary, so it
presents as broad regression while being one misresolved port. It is distinct
from the memory-exhaustion failure of `fix-e2e-harness-memory-exhaustion`
(#433): memory sits at 18 % of the cap with zero cgroup events and a single
session.

## What Changes

- **The auto-start path resolves ports exactly like slash commands do.** One
  shared resolver in `packages/shared/src/config.ts` — env first
  (`PI_DASHBOARD_PORT` then `DASHBOARD_PORT`; gateway:
  `PI_DASHBOARD_PI_PORT` then `PI_GATEWAY_PORT`), then `config.json`, then
  the defaults — consumed by BOTH the auto-start path and the slash-command
  path. It is a separate export; `loadConfig()` is NOT touched, so the
  server's own bind resolution (`buildConfig` in `cli.ts`, already
  env-aware) keeps its exact current behaviour. Parsing stays exactly as
  today's resolver: `Number(v)` finite and > 0, first variable of a role wins.
- **A session with a pinned endpoint never runs the launch step.** Presence
  of `PI_DASHBOARD_URL` or `PI_DASHBOARD_SOCKET` — the signals the server
  actually injects into its spawned sessions — skips step 3 of auto-start
  only; discovery and the health check still run, so the session attaches to
  its pinned parent. Accepted trade-off: if the parent later dies, the
  session retries the pinned endpoint and does NOT relaunch a replacement;
  recovery is restarting the dashboard (or the session), never a competitor
  server.
- **Every skip/refusal is loud and greppable.** The durable auto-start log
  (`appendAutoStartLog`, `autostart-guard.ts`) gains a line — naming the
  ports involved — whenever a launch is skipped (already serving on the
  resolved port, endpoint pinned, worktree refusal, port conflict), and the
  bridge warns naming both ports when discovery finds a dashboard somewhere
  other than the resolved port. The split brain names itself instead of
  presenting as anonymous session silence.
- **NOT in scope, and why:**
  - *Changing the defaults (`8000`/`9999`).* Correct for a normal install;
    the bug is precedence, not the values.
  - *The connection endpoint ladder* (`resolveEndpoint`, rendezvous records,
    `bridge.ts:840-877`). Already shipped with its own precedence; this
    change only stops auto-start from competing with what it resolves.
  - *The server's bind resolution* (`buildConfig`, `cli.ts:146-158`).
    Already env-aware (`PI_DASHBOARD_PORT` / `PI_DASHBOARD_PI_PORT`);
    untouched.
  - *The `docker/test-entrypoint.sh` `PI_DASHBOARD_URL` workaround.* Stays as
    belt-and-braces for the independent session's ATTACH; this change removes
    the need for it to be the only defence.
  - *Relaunch-on-dead-parent liveness logic.* Rejected — see the documented
    trade-off above; the restart orchestrator already covers planned
    restarts (`shouldSuppressAutoStart`).
  - *Temp-HOME installs* where `guardTempHomePort` (`cli.ts:130`) forces an
    ephemeral port: the env cannot express "ephemeral"; existing guards and
    docs cover it. Residual, accepted.
  - *Triaging the remaining red E2E specs (#433 part 1).* Blocked on this: a
    harness that answers on two ports cannot produce a trustworthy verdict.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bridge-auto-start-lifecycle`: three new requirements — (1) the auto-start
  path SHALL resolve the dashboard HTTP and gateway ports through one shared
  resolver with env precedence over `config.json`; (2) a session with a
  pinned endpoint (`PI_DASHBOARD_URL` / `PI_DASHBOARD_SOCKET`) SHALL NOT run
  the auto-start launch step; (3) auto-start skips and refusals SHALL be
  loud and greppable, naming the ports involved.

## Impact

- `packages/shared/src/config.ts` — new exported resolver beside
  `DEFAULT_DASHBOARD_PORT` / `DEFAULT_GATEWAY_PORT`; `loadConfig()` untouched.
- `packages/extension/src/server-auto-start.ts` — consumes the resolved ports
  the bridge passes; gains the pinned-endpoint gate beside the existing
  `shouldRefuseWorktreeAutoStart` and `shouldSuppressAutoStart` gates; the
  single-flight lock (`autostart-lock.ts`) is untouched.
- `packages/extension/src/bridge.ts` — passes resolved ports to
  `autoStartServer`; the `loadConfig()` call site is unchanged.
- `packages/extension/src/command-handler.ts` — `resolveDashboardPort()`
  delegates to the shared resolver; its stale doc comment ("set by the
  dashboard server and inherited by spawned sessions") is corrected — the
  server injects only the URL/socket pins.
- `packages/extension/src/autostart-guard.ts` — log-line reuse; refusal
  semantics unchanged (it keys on the RESOLVED ports, so post-fix a harness
  worktree session resolves the non-default harness port and stays permitted
  per E16 — while its health check now finds the real server, so no launch
  is attempted anyway).
- `tests/e2e/` — unblocks the suite; `faux-text.spec.ts` is the canary that
  must pass before any other E2E verdict is believed.
- No user-visible product behaviour changes on a default-port install with no
  port env: the resolver returns config/defaults exactly as today.

## Discipline Skills

- `systematic-debugging` — the root cause above was reached evidence-first
  (two-port health probes, pidfile, cgroup counters, source chain); the fix
  is judged against reproducing that evidence, not against "the suite looks
  green".
- `observability-instrumentation` — the third requirement exists so a
  duplicate dashboard can never again present as anonymous session silence.
- `doubt-driven-review` — the precedence change touches every install's
  startup path; it got an adversarial pass at planning (see `design.md`,
  cycle record) and gates implementation review.

## Design

See [design.md](design.md) — decisions D1-D7, including the doubt-review
cycle record that produced the corrections folded into this proposal.
