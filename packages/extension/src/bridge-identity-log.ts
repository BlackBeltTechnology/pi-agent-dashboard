/**
 * Owner-only, off-channel record of a server identity failure.
 *
 * A MARKED bridge that reaches a peer which cannot prove it holds this HOME's
 * credential aborts before registering. The bridge's stdout is discarded under
 * the default `capturePiOutput:false`, and the suspect socket must never carry
 * the report, so the failure is also appended here: one JSON line per failure in
 * `~/.pi/dashboard/local/bridge-identity.log` (`0600`, next to the token, rotated
 * to `.1` past 256 KiB), visible even if the genuine dashboard never returns.
 *
 * Best-effort by contract: an unwritable directory must never stop the
 * quarantine that follows.
 *
 * See change: loopback-credential-proof (D8).
 */
import fs from "node:fs";
import path from "node:path";
import { getDashboardConfigDir } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";
import type { IdentityFailureReport } from "./connection.js";

export const IDENTITY_LOG_NAME = "bridge-identity.log";
export const IDENTITY_LOG_MAX_BYTES = 256 * 1024;

/** Append `report` as one JSON line; never throws. */
export function appendIdentityLog(report: IdentityFailureReport, env?: { homedir?: string }): void {
  try {
    const dir = path.join(getDashboardConfigDir(env), "local");
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, IDENTITY_LOG_NAME);
    try {
      if (fs.statSync(file).size >= IDENTITY_LOG_MAX_BYTES) fs.renameSync(file, `${file}.1`);
    } catch {
      /* no file yet */
    }
    fs.appendFileSync(file, `${JSON.stringify(report)}\n`, { mode: 0o600 });
    // `mode` only applies on creation; tighten a pre-existing file too (best-effort).
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      /* best-effort (e.g. Windows) */
    }
  } catch {
    /* best-effort */
  }
}
