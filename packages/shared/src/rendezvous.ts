/**
 * The HOME-derived rendezvous: how a bridge learns where its dashboard is
 * WITHOUT asking the network.
 *
 * This is the primitive, not the socket. The endpoint-ambiguity class
 * (`fix-bridge-mdns-migration-hijack`, `fix-bridge-autostart-port-resolution`)
 * exists because the answer to "where is my dashboard" came from an
 * unauthenticated name→endpoint indirection that could be wrong. A record
 * under the caller's own HOME cannot be, because nothing on the network can
 * write it (D0).
 *
 * Absence means "no local dashboard", NOT "go ask the network". A partially
 * written record is treated as absent — never partially trusted (D15).
 *
 * See change: add-pi-gateway-transport-identity (D0, D2).
 */

import fs from "node:fs";
import path from "node:path";
import {
  type DashboardPathsEnv,
  getDashboardConfigDir,
  resolveLocalGatewayEndpoint,
} from "./dashboard-paths.js";

/** The subset of the lock record a bridge needs. */
export interface RendezvousRecord {
  piPort: number;
  httpPort: number;
  /** The per-instance rendezvous id, verified against `/api/health`. */
  instanceId: string;
  pid: number;
}

/** `~/.pi/dashboard/server.lock.meta.json` — written by the lock holder only. */
export function getRendezvousRecordPath(env?: DashboardPathsEnv): string {
  return path.join(getDashboardConfigDir(env), "server.lock.meta.json");
}

/**
 * Read the record for this HOME, or `null` when there is no usable one.
 *
 * `null` covers absent, truncated, and malformed alike: all three mean the
 * bridge has no local default, and every one of them must resolve to a visible
 * "no local dashboard available" rather than a discovered substitute.
 */
export function readRendezvousRecord(env?: DashboardPathsEnv): RendezvousRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(getRendezvousRecordPath(env), "utf-8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const m = parsed as Record<string, unknown>;
  // `identity` is the record's field name; it carries the per-instance
  // rendezvous id (see server/lifecycle/instance-id.ts).
  if (
    typeof m.piPort !== "number" ||
    typeof m.httpPort !== "number" ||
    typeof m.pid !== "number" ||
    typeof m.identity !== "string"
  ) {
    return null;
  }
  return {
    piPort: m.piPort,
    httpPort: m.httpPort,
    pid: m.pid,
    instanceId: m.identity,
  };
}

/**
 * Resolve the record into a dialable endpoint plus the identity expected to
 * answer at it. The transport choice is the platform's, not the record's:
 * POSIX prefers the per-instance socket, Windows and the `sun_path` fallback
 * use loopback (D6, D15).
 */
export function rendezvousEndpoint(
  env?: DashboardPathsEnv,
): { endpoint: string; instanceId: string } | null {
  const record = readRendezvousRecord(env);
  if (!record) return null;
  const local = resolveLocalGatewayEndpoint(env, record.piPort);
  const endpoint =
    local.transport === "unix"
      ? `ws+unix://${local.path}:/`
      : `ws://127.0.0.1:${local.port}`;
  return { endpoint, instanceId: record.instanceId };
}
