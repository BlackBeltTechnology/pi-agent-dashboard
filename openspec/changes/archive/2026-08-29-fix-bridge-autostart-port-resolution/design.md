# Design — fix-bridge-autostart-port-resolution

Status: planning-pass output. The proposal commit deliberately deferred
design to this pass (doubt-review + scenario-design). All line numbers
verified against this worktree at planning time.

## Doubt-review cycle record

Cycle 1 (fresh-context reviewer, Explore subagent; findings reconciled
against source by the orchestrator):

- **Confirmed blocking — false contract rationale.** The delta claimed the
  server "exports these variables into every session it spawns".
  False: `packages/server/src/spawn-process/process-manager.ts:252` injects
  only `PI_DASHBOARD_URL` / `PI_DASHBOARD_SOCKET` /
  `PI_DASHBOARD_SPAWN_TOKEN`. `DASHBOARD_PORT` / `PI_GATEWAY_PORT` reach
  sessions via container env (docker harness) only. Contract rewritten
  (named signals, corrected env names) + proposal corrected.
- **Confirmed blocking — incoherent "second dashboard on a different port"
  scenario.** Auto-start only probes/launches the RESOLVED port
  (`server-auto-start.ts` steps 2-3), so the original GIVEN/WHEN could never
  co-occur. Rewritten as the loud-and-greppable requirement anchored on
  `appendAutoStartLog` and the discovery-elsewhere warning.
- **Confirmed should-fix — crash recovery.** Absolute never-launch for
  pinned sessions means a dead parent is not replaced. Accepted as a
  documented trade-off (D4), made explicit in the spec.
- **Confirmed should-fix — gateway env naming.** Server convention is
  `PI_DASHBOARD_PI_PORT` (`packages/server/src/cli.ts:158`);
  `PI_GATEWAY_PORT` is docker-compose-only. Resolver reads both, order
  pinned.
- **Confirmed should-fix — workaround claim false.** `PI_DASHBOARD_URL`
  pins only the connection endpoint; `autoStartServer` runs unconditionally
  (`bridge.ts:3177`). Entry-point quote restored in full (it ends "…fails
  with 'readiness timeout'"), citation fixed (`:627-630`).
- **Partially valid — resolver-in-loadConfig coupling.** `buildConfig`
  already applies env precedence for the server's own bind, so folding the
  resolver into `loadConfig` would double-apply and change server behaviour.
  Constraint adopted: separate export, `loadConfig` untouched (D1).
- **Partially valid — split-brain mechanism.** Server-spawned sessions are
  endpoint-pinned, so "browser and session attach to different servers" is
  unproven FOR THEM; it IS the real mechanism for un-pinned sessions
  (spawned outside the server) on non-default installs. Proposal Why now
  separates measured facts from the source-verified mechanism.
- **Confirmed nit — stale citations.** `bridge.ts:719`→`:834`;
  `DEFAULT_CONFIG`→`DEFAULTS` + `DEFAULT_DASHBOARD_PORT`/`DEFAULT_GATEWAY_PORT`
  (`config.ts:641-648`); `command-handler.ts:915-936`→`:1132-1155` (fn at
  `:1141`); `test-entrypoint.sh:577`→`:627-630`. Fixed in proposal + tasks.
- **Valid nit — parse/precedence pinning.** Spec pins `Number(v)` finite > 0
  and first-var-wins per role (matches today's resolver).
- **Cross-model pass — attempted, failed at spawn level, surfaced.**
  `@propose-review-1` (glm-5.3, different architecture family from the
  author) resolved and probed clean ("OK"), but the real review pass
  returned empty output; a retry on `@propose-review-2` (deepseek-v4-pro)
  and two single-model cycle-2 retries all returned empty (4 consecutive
  spawn-level failures — harness, not verdict; surfaced, not silently
  swallowed). Cycle 2 therefore stands DEGRADED: the doubt record rests on
  cycle 1 (11 findings, every one reconciled against source) plus the
  orchestrator's own verification reads of every cited file. A manual
  external review remains available post-hoc: paste proposal.md + spec.md
  into any model.
- **Degraded self-check (flagged as such).** One consistency pass over the
  corrected artifacts: spec scenarios cover every SHALL (R1: 5 scenarios
  incl. both gateway env names + first-var-wins; R2: 2 scenarios incl. the
  documented dead-parent trade-off; R3: the requirement lists 4 skip
  causes, scenarios exemplify attach/pinned/discovery-elsewhere, and
  port-conflict + worktree-refusal logging are covered by manifest rows +
  the existing 3a behaviour); tasks.md stays vanilla checkbox format; no
  residual `DEFAULT_CONFIG` / stale line-number references remain
  (grep-verified at fold time).

## D1 — Resolver home and shape

`packages/shared/src/config.ts` exports a pure resolver
(`resolveDashboardPorts(env, fileConfig) → { port, piPort }`; final name at
implementation) placed beside `DEFAULT_DASHBOARD_PORT` / `DEFAULT_GATEWAY_PORT`
so the constants it falls back to cannot desync — the same rationale as the
import comment in `autostart-guard.ts`. Inputs are arguments (env object +
parsed config), not `process.env` reads, so it stays unit-testable without
environment mutation. `loadConfig()` is NOT modified: the server's
`buildConfig` (`cli.ts:146-158`) already applies its own chain
(flags > env > file) for its bind and must keep it exactly.

## D2 — Consumption points

- `bridge.ts` — the config object handed to `autoStartServer` at `:3177`
  carries resolved ports (resolved after `loadConfig()`, before the call).
- `command-handler.ts` — `resolveDashboardPort()` body becomes a delegation
  to the shared resolver (HTTP role); its doc comment is corrected (the
  server injects only the URL/socket pins).

## D3 — Pinned-endpoint gate placement

Inside `autoStartServer`, AFTER steps 1-2 (a pinned session still discovers
and health-check-attaches), BEFORE step 3: when `PI_DASHBOARD_URL` or
`PI_DASHBOARD_SOCKET` is set → log the skip via `appendAutoStartLog` and
return whatever discovery/health found. Precedent: the
`shouldSuppressAutoStart` gate (`fix-restart-bridge-auto-start-race`) sits
at the same spot. NOT folded into `shouldRefuseWorktreeAutoStart` —
different predicate, different key (endpoint pin vs cliPath).

## D4 — Trade-off: no relaunch for pinned sessions

Documented, deliberate. Pinned session + dead parent → the session keeps
retrying the pin; it never launches a competitor. The alternative
(liveness-check then relaunch) is rejected: a second liveness semantics
beside the existing lock/health machinery, for a case planned restarts
already cover (`shouldSuppressAutoStart` + the restart orchestrator).

## D5 — Composition with existing guards (semantics unchanged)

- `shouldRefuseWorktreeAutoStart` keys on the RESOLVED ports: post-fix, a
  harness worktree session resolves 18697/19697 (non-default) → permitted
  per E16 — but its health check now FINDS the harness server, so no launch
  is attempted. A local worktree session resolves config/defaults → still
  refused. No guard change needed.
- The single-flight lock (`autostart-lock.ts`) is untouched — it serialises
  exactly the launch step the new gate skips.

## D6 — Loud logging

`appendAutoStartLog` (`autostart-guard.ts:81`) is the sink. New lines: (a)
pinned-skip (D3); (b) attach-without-launch on health-check success (today
step 2 returns silently); (c) port-conflict — today it only `notify`s, add
the durable append. Worktree refusal already logs. Discovery-elsewhere:
`deps.notify` warning naming both ports + durable append (headless
visibility).

## D7 — Harness canary

`tests/e2e/faux-text.spec.ts` is the canary (tasks 4.3/4.4 carry the
blocked-spec history). Any E2E verdict before it passes is not believed.
