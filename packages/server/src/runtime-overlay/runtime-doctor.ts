/**
 * Doctor row "Dashboard runtime" (task 9.2): active runtime origin / version /
 * source / pi version, last failure, persisting `extension_mismatch`
 * sessions (D8), and whether the bundled fallback is intact (Electron).
 * Pure; wired in server.ts via `registerDoctorRoutes({extraChecks})`.
 *
 * See change: electron-runtime-overlay-updates.
 */
import fs from "node:fs";
import path from "node:path";
import type { DoctorCheck } from "@blackbelt-technology/pi-dashboard-shared/doctor-core.js";
import type { RuntimeHealth } from "./runtime-health.js";

interface MismatchLike {
  sessionId: string;
  runtimeId: string;
  expected: string;
  reported: string | null;
}

export function buildRuntimeDoctorCheck(input: {
  health: RuntimeHealth;
  piVersion?: string;
  mismatches: MismatchLike[];
  /** null = not applicable (no Electron bundle). */
  bundledIntact: boolean | null;
}): DoctorCheck {
  const { health, piVersion, mismatches, bundledIntact } = input;
  const parts = [`${health.origin} ${health.version}`];
  if (health.source) parts.push(`source ${health.source}`);
  if (piVersion) parts.push(`pi ${piVersion}`);
  const details: string[] = [];
  if (health.lastFailure) details.push(`last failure ${health.lastFailure.id}: ${health.lastFailure.reason}`);
  for (const m of mismatches) {
    details.push(`extension_mismatch ${m.sessionId} runtime=${m.runtimeId} expected=${m.expected} reported=${m.reported ?? "(none)"}`);
  }
  if (bundledIntact === false) details.push("bundled fallback missing (resources/server/node_modules/@blackbelt-technology/pi-dashboard-server/src/cli.ts)");
  const status: DoctorCheck["status"] =
    bundledIntact === false ? "error" : health.lastFailure || mismatches.length ? "warning" : "ok";
  return {
    name: "Dashboard runtime",
    section: "runtime",
    status,
    message: parts.join(" · "),
    ...(details.length ? { detail: details.join("\n") } : {}),
  };
}

/**
 * Bundled server entry present under the Electron resources dir; null outside
 * Electron or for a devMonorepo run (a dev checkout has no bundle).
 */
export function bundledFallbackIntact(env: NodeJS.ProcessEnv = process.env): boolean | null {
  const res = env.PI_DASHBOARD_RESOURCES_PATH;
  if (!env.PI_DASHBOARD_ELECTRON_INSTANCE || !res || env.PI_DASHBOARD_RUNTIME_ORIGIN === "devMonorepo") return null;
  // Same path as Electron `getBundledCliPath` (fixed by bundle-server.mjs).
  return fs.existsSync(path.join(res, "server", "node_modules", "@blackbelt-technology", "pi-dashboard-server", "src", "cli.ts"));
}
