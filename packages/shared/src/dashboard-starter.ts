/**
 * DashboardStarter — identifies who launched the dashboard server process.
 *
 * "Bridge"     — spawned by the pi bridge extension (server-launcher.ts).
 * "Standalone" — invoked directly via CLI (`pi-dashboard` or `pi-dashboard start`).
 * "Electron"   — spawned by the Electron main process.
 *
 * The value is injected via the DASHBOARD_STARTER env var at spawn time.
 * When unset or empty the default is "Standalone" (direct CLI invocation).
 */

export type DashboardStarter = "Bridge" | "Standalone" | "Electron";

const VALID: ReadonlySet<string> = new Set<DashboardStarter>(["Bridge", "Standalone", "Electron"]);

/**
 * Parse `env.DASHBOARD_STARTER` into a `DashboardStarter`.
 *
 * - Unset or empty → `"Standalone"` (direct CLI invocation default).
 * - Valid value    → that value.
 * - Invalid value  → logs `console.warn`, returns `"Standalone"`.
 */
export function parseDashboardStarter(
  env: Record<string, string | undefined>,
): DashboardStarter {
  const raw = env["DASHBOARD_STARTER"];
  if (!raw) return "Standalone";
  if (VALID.has(raw)) return raw as DashboardStarter;
  console.warn(
    `[dashboard-starter] Unknown DASHBOARD_STARTER value "${raw}"; defaulting to "Standalone".`,
  );
  return "Standalone";
}

/**
 * `LaunchSource` — lowercase alias of `DashboardStarter` exposed on
 * `/api/health` as a stable client contract for arm-aware gating
 * (notably hiding pi-core update UI when running under Electron, since
 * the bundled `node_modules/` is read-only under the .app).
 *
 * Detection follows `parseDashboardStarter` then lowercases:
 *   DASHBOARD_STARTER=Electron   → "electron"
 *   DASHBOARD_STARTER=Bridge     → "bridge"
 *   else                          → "standalone"
 *
 * See change: eliminate-electron-runtime-install (task 3.2).
 */
export type LaunchSource = "electron" | "standalone" | "bridge";

export function parseLaunchSource(
  env: Record<string, string | undefined>,
): LaunchSource {
  const s = parseDashboardStarter(env);
  return s === "Electron" ? "electron" : s === "Bridge" ? "bridge" : "standalone";
}

const FROM_LAUNCH_SOURCE: Readonly<Record<string, DashboardStarter>> = {
  electron: "Electron",
  bridge: "Bridge",
  standalone: "Standalone",
};

/**
 * Map a `/api/health` body to the starter that launched that server.
 *
 * `/api/health` publishes `launchSource` (static, lowercase) and no longer
 * publishes `starter`. Reads only the STATIC `launchSource`, never
 * `launchSourceEffective` (an orphaned bridge server reports
 * `launchSource:"bridge"` + `launchSourceEffective:"bridge-orphaned"`).
 * Falls back to a legacy `starter` string for servers that predate the
 * removal; anything else → `undefined`.
 *
 * See change: fix-cli-control-electron-server (design D6).
 */
export function starterFromHealth(body: unknown): DashboardStarter | undefined {
  if (!body || typeof body !== "object") return undefined;
  const { launchSource, starter } = body as { launchSource?: unknown; starter?: unknown };
  if (typeof launchSource === "string" && Object.hasOwn(FROM_LAUNCH_SOURCE, launchSource)) {
    return FROM_LAUNCH_SOURCE[launchSource];
  }
  if (launchSource === undefined && typeof starter === "string" && VALID.has(starter)) {
    return starter as DashboardStarter;
  }
  return undefined;
}
