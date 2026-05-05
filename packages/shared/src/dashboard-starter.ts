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
