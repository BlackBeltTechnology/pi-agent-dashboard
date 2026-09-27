/**
 * The bridge's own extension package identity (D8): realpath of the nearest
 * package dir above this module + its version. Cached for the process.
 * Sent on every `session_register`; the server compares it with the active
 * runtime's extension and reloads a stale bridge once.
 *
 * See change: electron-runtime-overlay-updates.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BridgeExtensionIdentity } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";

function readVersion(file: string): string | undefined {
  try {
    const v = (JSON.parse(fs.readFileSync(file, "utf8")) as { version?: unknown }).version;
    return typeof v === "string" ? v : undefined;
  } catch {
    return undefined; // unreadable manifest — identity is the dir alone
  }
}

function realpathOr(dir: string): string {
  try {
    return fs.realpathSync(dir);
  } catch {
    return dir;
  }
}

/** Walk up from `startDir` to the first dir with a package.json. */
export function resolveExtensionIdentity(startDir: string): BridgeExtensionIdentity | undefined {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    const file = path.join(dir, "package.json");
    if (fs.existsSync(file)) {
      const version = readVersion(file);
      const real = realpathOr(dir);
      return version ? { dir: real, version } : { dir: real };
    }
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}

let cached: BridgeExtensionIdentity | undefined | null = null;

export function bridgeExtensionIdentity(): BridgeExtensionIdentity | undefined {
  if (cached === null) {
    try {
      cached = resolveExtensionIdentity(path.dirname(fileURLToPath(import.meta.url)));
    } catch {
      cached = undefined;
    }
  }
  return cached;
}
