/**
 * Read the per-HOME dashboard lock metadata sidecar.
 *
 * The path is rooted on the shared `getDashboardConfigDir()` — the same
 * `$HOME`-honouring root the server writes the sidecar under
 * (`packages/server/src/lifecycle/home-lock.ts::getLockPath`). Reader and
 * writer MUST agree, or the Electron dialog misses (or invents) dashboards.
 *
 * See change: single-dashboard-per-home; harden-dashboard-start-detection (D6).
 */
import fs from "node:fs";
import path from "node:path";
import { getDashboardConfigDir } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";

export interface DashboardLockMetadata {
  pid: number;
  httpPort: number;
  piPort: number;
  startedAt: number;
  identity: string;
  version: string;
  url: string;
  hostname: string;
}

export function getLockMetaPath(): string {
  return path.join(getDashboardConfigDir(), "server.lock.meta.json");
}

/**
 * Read the lock metadata sidecar. Returns null on missing / corrupt / perm.
 */
export function readDashboardLockMetadata(metaPath: string = getLockMetaPath()): DashboardLockMetadata | null {
  try {
    const raw = fs.readFileSync(metaPath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const m = parsed as Record<string, unknown>;
    if (
      typeof m.pid === "number" &&
      typeof m.httpPort === "number" &&
      typeof m.identity === "string" &&
      typeof m.url === "string"
    ) {
      return m as unknown as DashboardLockMetadata;
    }
    return null;
  } catch {
    return null;
  }
}
