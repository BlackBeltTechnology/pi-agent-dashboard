/**
 * Dashboard port discovery, mirroring the skill's curl layer resolution order:
 *   explicit opt → DASHBOARD_PORT env → ~/.pi/dashboard/config.json → 8000.
 * See OpenSpec change: add-dashboard-bus-client-scripting.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_PORT = 8000;

export function discoverPort(explicit?: number): number {
  if (explicit && Number.isFinite(explicit)) return explicit;

  const env = process.env.DASHBOARD_PORT;
  if (env && /^\d+$/.test(env)) return Number(env);

  const configFile = path.join(os.homedir(), ".pi", "dashboard", "config.json");
  try {
    const raw = fs.readFileSync(configFile, "utf8");
    const parsed = JSON.parse(raw) as { port?: number };
    if (typeof parsed.port === "number" && Number.isFinite(parsed.port)) {
      return parsed.port;
    }
  } catch {
    // Missing/unreadable/malformed config → fall through to default.
  }
  return DEFAULT_PORT;
}

export function discoverHost(explicit?: string): string {
  return explicit ?? process.env.DASHBOARD_HOST ?? "localhost";
}
