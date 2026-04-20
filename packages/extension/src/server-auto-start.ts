/**
 * Auto-start logic for the dashboard server.
 * Uses mDNS discovery first, falls back to health check, then auto-starts.
 */
import os from "node:os";
import path from "node:path";

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
  launchServer: (config: any) => Promise<{ success: boolean; message: string }>;
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
}

export interface AutoStartResult {
  /** The server to connect to (if found or launched) */
  server?: { host: string; port: number; piPort: number };
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
  // 1. Try mDNS discovery (2s timeout)
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

  // 3. Auto-start server
  deps.onLaunchStart?.();
  const result = await deps.launchServer(config);
  if (result.success) {
    deps.onLaunchEnd?.(true);
    deps.notify(`🌐 Dashboard started at http://localhost:${config.port}`, "info");

    // Wait for mDNS advertisement from the newly started server (up to 10s)
    try {
      const discovered = await deps.discoverDashboard(10000);
      const local = discovered.find(s => s.isLocal);
      if (local) {
        return { server: { host: local.host, port: local.port, piPort: local.piPort } };
      }
    } catch {
      // mDNS failed — use config defaults
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
  // to know the convention. See change: fix-windows-server-parity.
  deps.onLaunchEnd?.(false);
  const logPath = path.join(os.homedir(), ".pi", "dashboard", "server.log");
  deps.notify(
    `Dashboard server failed to start: ${result.message}\nSee log: ${logPath}`,
    "warning",
  );
  return {};
}
