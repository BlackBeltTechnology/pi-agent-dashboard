/**
 * Auto-start logic for the dashboard server.
 * Uses mDNS discovery first, falls back to health check, then auto-starts.
 */
import { getDashboardServerLogPath } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";
import { SPAWN_READINESS_BUDGET_MS } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import type { DashboardCheckOpts } from "@blackbelt-technology/pi-dashboard-shared/server-identity.js";
import { appendAutoStartLog, shouldRefuseWorktreeAutoStart } from "./autostart-guard.js";
import {
  acquireAutoStartLock,
  autoStartLockPath,
  defaultProbes,
  type LockProbes,
  readLock,
  recordChildPid,
  releaseAutoStartLock,
} from "./autostart-lock.js";
import { resolveServerCliPath } from "./server-launcher.js";

export interface DiscoveredServer {
  host: string;
  port: number;
  piPort: number;
  isLocal: boolean;
  source: "mdns" | "fallback";
}

export interface AutoStartDeps {
  discoverDashboard: (timeout?: number) => Promise<DiscoveredServer[]>;
  /**
   * Widened (fix-autostart-discovery-precedence, task 1.1): accepts a host so
   * a discovered candidate can be probed at its ADVERTISED host + HTTP port
   * (D2), and `DashboardCheckOpts` so the resolved-port gate can pass
   * bootstrap-aware `retries`/`timeoutMs` (D1). The bridge wiring keeps
   * passing the shared `isDashboardRunning`, which already implements both.
   */
  isDashboardRunning: (
    port: number,
    host?: string,
    opts?: DashboardCheckOpts,
  ) => Promise<{ running: boolean; portConflict?: boolean }>;
  launchServer: (config: any) => Promise<{ success: boolean; message: string; childPid?: number; logOwned?: boolean }>;
  notify: (message: string, level: "info" | "warning") => void;
  /**
   * Optional callback fired immediately BEFORE `launchServer(config)` is
   * invoked. Used by TUI-aware callers (bridge extension) to show a
   * "starting dashboard server" spinner. NOT fired during mDNS discovery
   * or health-check phases — only when an actual server process is
   * about to be spawned.
   */
  onLaunchStart?: () => void;
  /**
   * Optional callback fired after `launchServer` resolves (success or
   * failure), AND after the post-launch mDNS re-discovery + recheck.
   * Passes the final success state so the caller can clear spinners.
   */
  onLaunchEnd?: (success: boolean) => void;
  /**
   * Optional callback fired synchronously after `launchServer` reports
   * success and returned a `childPid`. Used by the bridge to register
   * the spawned server's PID into its `selfSpawnedPgids` exclusion set
   * BEFORE the next process-scan tick, so the dashboard's own server
   * never surfaces in the session-card process list.
   * See change: tighten-process-list-ux.
   */
  onServerSpawned?: (childPid: number) => void;
  /**
   * Optional predicate. When it returns true, the auto-start spawn step
   * (step 3 below) is skipped — mDNS discovery + health check still run,
   * so the bridge will pick up the orchestrator-spawned replacement as
   * soon as it advertises. Used by the bridge to honor `server_restarting`
   * bursts. See change: fix-restart-bridge-auto-start-race.
   */
  shouldSuppressAutoStart?: () => boolean;

  // ── Test seams (production omits) ──────────────────────────────────────
  /** Replace `resolveServerCliPath` (the worktree predicate's input). */
  resolveCliPath?: () => string;
  /** Directory holding `autostart-<port>.lock`. Defaults to `~/.pi/dashboard`. */
  lockDir?: string;
  /** Replace the OS liveness / start-time probes used for lock staleness. */
  lockProbes?: LockProbes;
  /** Replace the durable auto-start log sink. */
  log?: (message: string) => void;
  /**
   * Test seam: sleep used BETWEEN bootstrap-aware probe retries (threaded
   * into `DashboardCheckOpts._sleep`). Production omits it (real setTimeout).
   * See change: fix-autostart-discovery-precedence (E12).
   */
  probeSleep?: (ms: number) => Promise<void>;
  /** Spawn readiness budget (lock staleness bound + the loser's wait). */
  readinessBudgetMs?: number;
  /**
   * Poll interval (ms) for the lock loser's bounded wait. Default 250.
   *
   * There is deliberately NO injectable `sleep` seam here: a stubbed
   * immediately-resolving sleep turns the poll into a tight promise loop that
   * starves the macrotask queue, so the holder's own timers never fire, the
   * lock is never released, and the loser spins until the full budget elapses
   * (30s per call — it stalled CI before this was understood). The wait must
   * yield to real timers; shorten it with this interval instead.
   */
  lossPollIntervalMs?: number;
}

export interface AutoStartResult {
  /** The server to connect to (if found or launched) */
  server?: { host: string; port: number; piPort: number };
}

/**
 * Opt-out gate for isolated / CI runs. When `PI_DASHBOARD_NO_MDNS` is truthy
 * the bridge skips mDNS discovery entirely and binds to the explicit /
 * configured URL via the health-check path. Mirrors the server's identical
 * gate in `server.ts` (PI_DASHBOARD_NO_MDNS). Without this, a co-located real
 * dashboard advertising on mDNS would be discovered here and override the
 * bridge's explicit `PI_DASHBOARD_URL`, hijacking the connection off the
 * isolated gateway. See change: resolve-global-prompt-templates-from-dashboard.
 */
function mdnsDisabled(): boolean {
  const raw = (process.env.PI_DASHBOARD_NO_MDNS ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

/**
 * Bootstrap-aware probe settings for the resolved-port gate (D1) and the
 * post-launch attach probe (D-post). A previous instance mid-jiti-bootstrap
 * can block its event loop 5–15 s and false-negative the default 2 s/0-retry
 * probe, so: non-default timeout, ≥1 retry, retrying ONLY on timeout
 * (AbortError) — ECONNREFUSED is a definitive "nothing listens" and falls
 * through to launch without paying retry delays (F7). Implemented by the
 * shared `isDashboardRunning` retry loop; threaded here so both discovery
 * branches probe identically.
 * See change: fix-autostart-discovery-precedence (D1, F7).
 */
const RESOLVED_PORT_PROBE_OPTS = { timeoutMs: 8000, retries: 2, retryDelayMs: 500 } as const;

/** Sort key order for candidate selection (D3). Internal to the module. */
function compareCandidates<T extends { host: string; port: number }>(
  a: T,
  b: T,
  resolvedPort: number,
): number {
  const aMatch = a.port === resolvedPort;
  const bMatch = b.port === resolvedPort;
  if (aMatch !== bMatch) return aMatch ? -1 : 1;
  if (a.port !== b.port) return a.port - b.port;
  // Plain codepoint compare — deterministic across locales/runtimes.
  return a.host < b.host ? -1 : a.host > b.host ? 1 : 0;
}

/**
 * Deterministic selection among discovered LOCAL candidates (D3, task 1.2):
 * prefer the candidate whose port equals `resolvedPort`, otherwise the lowest
 * port, ties on port broken by host string — a TOTAL order, so selection never
 * depends on advertisement arrival order. Non-locals are ignored (pre-existing
 * behaviour: only locals are attachable). Shared by BOTH discovery branches.
 */
export function selectLocalCandidate<T extends { host: string; port: number; isLocal: boolean }>(
  candidates: readonly T[],
  resolvedPort: number,
): T | undefined {
  return candidates
    .filter((c) => c.isLocal)
    .sort((a, b) => compareCandidates(a, b, resolvedPort))[0];
}

/**
 * Discover or auto-start the dashboard server.
 * Discovery chain: mDNS browse → health check fallback → auto-start.
 * Returns the server to connect to.
 */
export async function autoStartServer(
  config: { piPort: number; port: number; autoStart: boolean },
  deps: AutoStartDeps,
): Promise<AutoStartResult> {
  const noMdns = mdnsDisabled();
  const log = deps.log ?? appendAutoStartLog;
  const probeOpts = { ...RESOLVED_PORT_PROBE_OPTS, _sleep: deps.probeSleep };

  // 1. Establish the resolved port's status BEFORE discovery can win (D1).
  // Bootstrap-aware (see RESOLVED_PORT_PROBE_OPTS): a mid-bootstrap server is
  // retried, a refused one is not. When it serves, auto-start returns it and
  // does NOT consult discovery at all — there is no divergence to record and
  // no banner, because the correct answer is already known (D4).
  const resolved = await deps.isDashboardRunning(config.port, "localhost", probeOpts);
  if (resolved.running) {
    log(
      `attached: dashboard already serving on port ${config.port} (gateway ${config.piPort}) — no launch`,
    );
    return { server: { host: "localhost", port: config.port, piPort: config.piPort } };
  }

  // 2. Discovery — runs ONLY when the resolved port is silent or foreign.
  // A candidate is admitted only after a health probe at its advertised
  // host+port succeeds (D2), and the winner is chosen by the shared
  // deterministic total order (D3). The mismatch record + warning survive
  // ONLY on this path (resolved probed silent + verified candidate found) —
  // the only path where "silent" has actually been established by a probe.
  // See change: fix-autostart-discovery-precedence (D1, D2, D2b, D3, D4).
  if (!noMdns) {
    try {
      const servers = await deps.discoverDashboard(2000);
      const adopted = await firstVerifiedLocal(servers, config.port, deps, log);
      if (adopted) {
        if (adopted.port !== config.port || adopted.piPort !== config.piPort) {
          deps.notify(
            `Discovered dashboard on port ${adopted.port} (gateway ${adopted.piPort}) ` +
            `while auto-start resolved port ${config.port} (gateway ${config.piPort}) — ` +
            `attaching to the discovered server, not launching`,
            "warning",
          );
          // Review fix #2: name the OBSERVED resolved-port state — "silent"
          // only when the probe found nothing; a foreign service answered,
          // it just isn't a dashboard (D4: never assert silent unprobed).
          const resolvedState = resolved.portConflict
            ? `occupied by a foreign service`
            : `silent`;
          log(
            `discovered dashboard elsewhere: attaching to port ${adopted.port} ` +
            `(gateway ${adopted.piPort}); resolved port ${config.port} ${resolvedState} — no launch`,
          );
        }
        return { server: { host: adopted.host, port: adopted.port, piPort: adopted.piPort } };
      }
      // No verified local — fall through to the launch gates
    } catch {
      // mDNS failed — fall through to the launch gates
    }
  }

  if (!config.autoStart) {
    log(`skipped: auto-start disabled — no launch (port ${config.port} gateway ${config.piPort})`);
    return {};
  }

  // Pinned endpoint (D3/D4): the server pins the sessions it spawns via
  // PI_DASHBOARD_URL / PI_DASHBOARD_SOCKET. The resolved-port gate and
  // discovery above already ran, so an ALIVE parent was attached there;
  // reaching this point means the pinned parent is NOT answering. Deliberate
  // trade-off (D4): never spawn a competitor for a pinned session — no
  // liveness-driven relaunch (planned restarts cover that path); the session
  // keeps retrying its pin.
  // See change: fix-bridge-autostart-port-resolution (D3, D4).
  // `||`, not `??`: an empty-string URL must not mask a valid socket pin.
  const pin = process.env.PI_DASHBOARD_URL || process.env.PI_DASHBOARD_SOCKET;
  if (pin) {
    log(
      `skipped: session has a pinned dashboard endpoint (${pin}) which is not ` +
      `answering — not launching on port ${config.port} (gateway ${config.piPort})`,
    );
    return {};
  }

  // D2b: this refusal applies only AFTER discovery had its chance — a real
  // dashboard may have relocated precisely because a foreign service took
  // the resolved port. Unchanged refusal, relocated behind the fall-through.
  if (resolved.portConflict) {
    deps.notify(`Port ${config.port} is occupied by another service`, "warning");
    log(`skipped: port ${config.port} occupied by another service — no launch`);
    return {};
  }

  // Suppress the spawn step while a deliberate restart/shutdown is in
  // flight. Discovery + health check above already ran, so if the
  // orchestrator has finished bringing up the replacement we already
  // returned. See change: fix-restart-bridge-auto-start-race.
  if (deps.shouldSuppressAutoStart?.()) {
    return {};
  }

  const cliPath = (deps.resolveCliPath ?? resolveServerCliPath)();

  // 3a. Worktree refusal (D3). Evaluated BEFORE lock acquisition (DR-10) and
  // before `onLaunchStart` (D5), so a refusing session neither contends for
  // the lock nor leaks a spinner. Keys on the resolved cliPath — which code
  // would be spawned — never on cwd.
  if (shouldRefuseWorktreeAutoStart({ cliPath, port: config.port, piPort: config.piPort })) {
    log(
      `refused: worktree checkout would take a shared default port ` +
      `(cliPath=${cliPath} port=${config.port} piPort=${config.piPort})`,
    );
    // A toast is a bonus, not the requirement (D4) — and is absent headless.
    try {
      deps.notify(
        `Dashboard auto-start refused: worktree checkout on shared port ${config.port}/${config.piPort}`,
        "warning",
      );
    } catch { /* headless session with no UI (X2) */ }
    return {};
  }

  // 3b. Single-flight lock (D2). Only the winner spawns.
  const budgetMs = deps.readinessBudgetMs ?? SPAWN_READINESS_BUDGET_MS;
  const probes = deps.lockProbes ?? defaultProbes();
  const lock = acquireAutoStartLock(
    { port: config.port, cliPath, dir: deps.lockDir },
    probes,
    budgetMs,
  );
  if (!lock.acquired) {
    log(`lock held by session ${lock.holder?.sessionPid ?? "unknown"} — not spawning`);
    // Wait for the holder, bounded by its readiness budget, then attach (X4)
    // or report unavailable (X5). Never spawn, never throw.
    //
    // POLL, do not sleep the whole budget: the budget is the holder's WORST
    // case, and a holder that finishes in a second must not cost every other
    // session 30 idle seconds. Two exits end the wait early — the dashboard
    // answering, or the holder releasing its lock.
    const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
    const lockPath = autoStartLockPath(config.port, deps.lockDir);
    const pollMs = Math.min(deps.lossPollIntervalMs ?? 250, budgetMs);
    // Wait out the holder's REMAINING budget, not a fresh one: a lock taken
    // 29s ago has one second left to live, and restarting the clock on every
    // loser would let a stuck holder stall an unbounded number of sessions for
    // a full budget each.
    const heldSince = lock.holder?.startedAt ?? probes.now();
    const deadline = Math.min(heldSince, probes.now()) + budgetMs;

    let holderGone = false;
    while (probes.now() < deadline) {
      const probe = await deps.isDashboardRunning(config.port);
      if (probe.running) {
        return { server: { host: "localhost", port: config.port, piPort: config.piPort } };
      }
      if (readLock(lockPath) === null) { holderGone = true; break; }
      await sleep(pollMs);
    }

    // Holder released without a dashboard coming up, or the budget elapsed:
    // one last look, then report unavailable.
    if (holderGone) {
      const afterHolder = await deps.isDashboardRunning(config.port);
      if (afterHolder.running) {
        return { server: { host: "localhost", port: config.port, piPort: config.piPort } };
      }
    }
    return {};
  }
  if (lock.degraded) {
    log("lock directory unwritable — proceeding without single-flight");
  }

  try {
    return await spawnAndAttach(config, deps, noMdns, {
      lockDir: deps.lockDir,
      locked: !lock.degraded,
    }, probeOpts);
  } finally {
    if (!lock.degraded) releaseAutoStartLock(config.port, deps.lockDir);
  }
}

/**
 * Verify discovered candidates in D3 order and return the first one whose
 * `/api/health` answers at its ADVERTISED host + port (D2). A candidate that
 * fails verification never suppresses the launch step; its rejection is
 * durably logged with the endpoint and the reason. Uses the DEFAULT probe
 * (2 s / 0 retries) so an unreachable candidate costs one bounded probe, not
 * the bootstrap-aware retry budget reserved for the resolved-port gate.
 */
async function firstVerifiedLocal(
  servers: DiscoveredServer[],
  resolvedPort: number,
  deps: AutoStartDeps,
  log: (message: string) => void,
): Promise<DiscoveredServer | undefined> {
  const ranked = servers.filter((s) => s.isLocal)
    .sort((a, b) => compareCandidates(a, b, resolvedPort));
  for (const candidate of ranked) {
    const status = await deps.isDashboardRunning(candidate.port, candidate.host);
    if (status.running) return candidate;
    const reason = status.portConflict
      ? "not a dashboard (port conflict)"
      : "health probe did not answer";
    log(`candidate rejected: ${candidate.host}:${candidate.port} — ${reason}`);
  }
  return undefined;
}

/**
 * Step 3 proper: spawn the server and resolve the address to connect to.
 * Extracted so the caller can wrap it in the lock's `finally` (E9 — the lock
 * is released on ready, failed AND timed-out spawns alike).
 */
async function spawnAndAttach(
  config: { piPort: number; port: number; autoStart: boolean },
  deps: AutoStartDeps,
  noMdns: boolean,
  lockCtx: { lockDir?: string; locked: boolean },
  probeOpts: { timeoutMs: number; retries: number; retryDelayMs: number; _sleep?: (ms: number) => Promise<void> },
): Promise<AutoStartResult> {
  deps.onLaunchStart?.();
  let result: Awaited<ReturnType<AutoStartDeps["launchServer"]>>;
  try {
    result = await deps.launchServer(config);
  } catch (err) {
    // Production `launchServer` resolves rather than rejects, but the
    // never-a-start-without-an-end invariant (F1/F2) must hold locally and
    // not depend on the bridge's outer spinner net.
    deps.onLaunchEnd?.(false);
    throw err;
  }
  if (result.success) {
    if (typeof result.childPid === "number" && result.childPid > 0) {
      // Record the detached child so a concurrent session's staleness check
      // sees a live spawn even if this session dies. Accepted gap: the
      // primitive surfaces `childPid` only on readiness success, so the lock
      // is childPid-less for the whole readiness window.
      if (lockCtx.locked) recordChildPid(config.port, result.childPid, lockCtx.lockDir);
      deps.onServerSpawned?.(result.childPid);
    }
    deps.onLaunchEnd?.(true);
    deps.notify(`🌐 Dashboard started at http://localhost:${config.port}`, "info");

    // D-post: the server we just launched owns the attach decision. Probe the
    // resolved port with the SAME bootstrap-aware opts as the pre-launch gate;
    // when it answers, return it — discovery is NOT consulted, so a stray
    // advertiser can never displace the server we just started. The retry
    // absorbs our own server's bootstrap; no "resolved port silent" warning
    // is ever raised on this path (D4).
    const postLaunch = await deps.isDashboardRunning(config.port, "localhost", probeOpts);
    if (postLaunch.running) {
      return { server: { host: "localhost", port: config.port, piPort: config.piPort } };
    }

    // Resolved port still silent after the bootstrap-aware probe: discovery
    // may only resolve OUR server's non-localhost address — candidates on
    // other ports are never considered here, and adoption is health-verified
    // (D2) via the shared deterministic order (D3).
    if (!noMdns) {
      try {
        const discovered = await deps.discoverDashboard(10000);
        const samePort = discovered.filter((s) => s.port === config.port);
        const local = selectLocalCandidate(samePort, config.port);
        if (local) {
          const verified = await deps.isDashboardRunning(local.port, local.host);
          if (verified.running) {
            return { server: { host: local.host, port: local.port, piPort: local.piPort } };
          }
        }
      } catch {
        // mDNS failed — use config defaults
      }
    }

    return { server: { host: "localhost", port: config.port, piPort: config.piPort } };
  }

  // Another agent may have started the server concurrently — recheck before warning
  const recheck = await deps.isDashboardRunning(config.port);
  if (recheck.running) {
    deps.onLaunchEnd?.(true);
    return { server: { host: "localhost", port: config.port, piPort: config.piPort } };
  }

  // Surface the log path so users can inspect the crash output without having
  // to know the convention. The bridge auto-spawn owns this file when the spawn
  // reached the log-owning path (stdio:{logFile}); only failures that abort
  // before the log fd opens (JitiNotFoundError → logOwned:false) skip the
  // suffix, so we never point users at a server.log that was never written.
  // See change: fix-windows-server-parity, fix-bridge-server-start-diagnostics.
  deps.onLaunchEnd?.(false);
  const logSuffix = result.logOwned === false ? "" : `\nSee log: ${getDashboardServerLogPath()}`;
  deps.notify(
    `Dashboard server failed to start: ${result.message}${logSuffix}`,
    "warning",
  );
  return {};
}
