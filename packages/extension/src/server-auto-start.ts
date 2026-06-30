/**
 * Auto-start logic for the dashboard server.
 * Uses mDNS discovery first, falls back to health check, then auto-starts.
 */
import { getDashboardServerLogPath } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";

export interface DiscoveredServer {
  host: string;
  port: number;
  piPort: number;
  isLocal: boolean;
  source: "mdns" | "fallback";
}

export interface AutoStartDeps {
  discoverDashboard: (timeout?: number) => Promise<DiscoveredServer[]>;
  isDashboardRunning: (port: number) => Promise<{ running: boolean; portConflict?: boolean }>;
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
 * Discover or auto-start the dashboard server.
 * Discovery chain: mDNS browse → health check fallback → auto-start.
 * Returns the server to connect to.
 */
export async function autoStartServer(
  config: { piPort: number; port: number; autoStart: boolean },
  deps: AutoStartDeps,
): Promise<AutoStartResult> {
  const noMdns = mdnsDisabled();

  // 1. Try mDNS discovery (2s timeout) — skipped when mDNS is disabled.
  if (!noMdns) {
    try {
      const servers = await deps.discoverDashboard(2000);
      const local = servers.find(s => s.isLocal);
      if (local) {
        return { server: { host: local.host, port: local.port, piPort: local.piPort } };
      }
      // Remote servers exist but no local — fall through to health check
    } catch {
      // mDNS failed — fall through to health check
    }
  }

  // 2. Fallback: health check on configured port
  const status = await deps.isDashboardRunning(config.port);
  if (status.running) {
    return { server: { host: "localhost", port: config.port, piPort: config.piPort } };
  }

  if (!config.autoStart) return {};

  if (status.portConflict) {
    deps.notify(`Port ${config.port} is occupied by another service`, "warning");
    return {};
  }

  // Suppress the spawn step while a deliberate restart/shutdown is in
  // flight. Discovery + health check above already ran, so if the
  // orchestrator has finished bringing up the replacement we already
  // returned. See change: fix-restart-bridge-auto-start-race.
  if (deps.shouldSuppressAutoStart?.()) {
    return {};
  }

  // 3. Auto-start server
  deps.onLaunchStart?.();
  const result = await deps.launchServer(config);
  if (result.success) {
    if (typeof result.childPid === "number" && result.childPid > 0) {
      deps.onServerSpawned?.(result.childPid);
    }
    deps.onLaunchEnd?.(true);
    deps.notify(`🌐 Dashboard started at http://localhost:${config.port}`, "info");

    // Wait for mDNS advertisement from the newly started server (up to 10s).
    // Skipped when mDNS is disabled — bind directly to the configured ports.
    if (!noMdns) {
      try {
        const discovered = await deps.discoverDashboard(10000);
        const local = discovered.find(s => s.isLocal);
        if (local) {
          return { server: { host: local.host, port: local.port, piPort: local.piPort } };
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
