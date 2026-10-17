/**
 * Read-only view of `~/.pi/dashboard/services.json` (the managed-services
 * definitions file, same OS user). Used offline: `doctor` start-argv preflight,
 * `--service` URL resolution, env-name collision checks and the panel's
 * membership check. Never writes — every write goes through
 * `pi-dashboard service add --file`. See change: add-obs-studio-plugin (D3, D7).
 */
import fs from "node:fs";
import path from "node:path";
import { execSecretEnvName, type ServiceDefinition } from "@blackbelt-technology/pi-dashboard-shared/services/schema.js";

function servicesFile(dashboardDir: string): string {
  return path.join(dashboardDir, "services.json");
}

/** All definitions; a missing or unreadable file reads as none. */
export function readServiceDefinitions(dashboardDir: string): ServiceDefinition[] {
  try {
    const raw = JSON.parse(fs.readFileSync(servicesFile(dashboardDir), "utf8")) as { services?: unknown };
    return Array.isArray(raw.services) ? (raw.services.filter((s) => s && typeof s === "object" && typeof (s as { id?: unknown }).id === "string") as ServiceDefinition[]) : [];
  } catch {
    return [];
  }
}

export function findDefinition(dashboardDir: string, id: string): ServiceDefinition | undefined {
  return readServiceDefinitions(dashboardDir).find((d) => d.id === id);
}

/** The `SVC_<ID>_` prefix `service exec` derives for an id (`-`/`_` fold together). */
export function envPrefix(id: string): string {
  return execSecretEnvName(id, "x").slice(0, -1);
}

/** An existing definition whose exec env prefix equals `id`'s (other than `id` itself). */
export function envNameCollision(defs: readonly ServiceDefinition[], id: string): string | undefined {
  const mine = envPrefix(id);
  return defs.find((d) => d.id !== id && envPrefix(d.id) === mine)?.id;
}
