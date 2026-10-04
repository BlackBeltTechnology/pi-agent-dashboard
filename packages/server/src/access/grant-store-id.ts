/**
 * `~/.pi/dashboard/grant-store-id` — a random token that NAMES the grant store a
 * dashboard writes. A bridge compares the token announced by its connected
 * server (`dashboard_identity`) with its own local copy and offers "Always
 * allow" only on equality, i.e. only when the server writes the very store the
 * bridge's path gate reads. Exclusive-create (`O_EXCL`, 0600) so concurrent
 * local instances converge on whichever file won; an existing file is never
 * overwritten. Re-read on every announce (never a cached value).
 * See change: ask-agent-file-access-in-chat (D3).
 */

import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import path from "node:path";
import { getDashboardConfigDir } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";

function grantStoreIdPath(dir: string = getDashboardConfigDir()): string {
  return path.join(dir, "grant-store-id");
}

/** Content of the token file, or `null` when missing/unreadable/empty. */
export function readGrantStoreId(dir?: string): string | null {
  try {
    const v = fs.readFileSync(grantStoreIdPath(dir), "utf8").trim();
    return v || null;
  } catch {
    return null;
  }
}

/** Create the token file if absent (exclusive), then return its content. */
export function ensureGrantStoreId(dir?: string): string | null {
  const file = grantStoreIdPath(dir);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
    try {
      fs.writeSync(fd, randomBytes(16).toString("hex"));
    } finally {
      fs.closeSync(fd);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== "EEXIST") {
      console.warn(`[grant-store-id] cannot create token: ${(err as Error)?.message}`);
    }
  }
  return readGrantStoreId(dir);
}

/**
 * The token to announce to a bridge, or `null` when it must not be: with
 * `PI_ACCESS_GRANTS_STORE` set the server writes a store the bridge's gate does not
 * read by default, so matching tokens would offer an "Always allow" that cannot take
 * effect. See change: ask-agent-file-access-in-chat.
 */
export function announceableGrantStoreId(
  env: Record<string, string | undefined> = process.env,
  dir?: string,
): string | null {
  if (env.PI_ACCESS_GRANTS_STORE?.trim()) return null;
  return readGrantStoreId(dir);
}
