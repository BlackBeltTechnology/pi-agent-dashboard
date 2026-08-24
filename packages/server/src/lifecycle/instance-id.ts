/**
 * Persisted per-instance rendezvous id.
 *
 * Two different things in this repo are called "identity". They are not
 * interchangeable, and conflating them is a documented review trap:
 *
 * | concept                    | source                          | scope     |
 * |----------------------------|---------------------------------|-----------|
 * | Ed25519 server fingerprint | `auth/identity.ts` → identity.key | per HOME  |
 * | rendezvous instance id     | this file                       | per instance |
 *
 * The Ed25519 fingerprint is shared by every same-HOME dashboard, so it cannot
 * answer *"is this the instance the rendezvous record named"* — which is the
 * whole job here (D14). Equally, `home-lock`'s `randomUUID()` default is minted
 * per *acquisition*, so it dies on every restart, making a benign restart
 * indistinguishable from an endpoint capture (defect B1).
 *
 * So the id is a small key file, keyed by `piPort` because that is what
 * distinguishes instances under one HOME (D2): generated once, reused across
 * restarts, distinct per instance.
 *
 * The id is an IDENTIFIER, not a capability. It is published unauthenticated
 * on `/api/health`, so knowledge of it SHALL never grant entitlement —
 * entitlement comes from socket ownership (POSIX) or the local token (Windows).
 *
 * See change: add-pi-gateway-transport-identity (D14, B1).
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  type DashboardPathsEnv,
  getDashboardConfigDir,
} from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";

/** Memoised id per resolved path. Cleared only by process exit. */
const idCache = new Map<string, string>();

/** Test seam: drop the memo so a fresh HOME is re-read from disk. */
export function __resetInstanceIdCache(): void {
  idCache.clear();
}

/** `~/.pi/dashboard/instances/<piPort>.id` */
export function getInstanceIdPath(env: DashboardPathsEnv | undefined, piPort: number): string {
  return path.join(getDashboardConfigDir(env), "instances", `${piPort}.id`);
}

/**
 * Read the instance id for `piPort`, generating and persisting one on first
 * use. Mode `0600` in a `0700` dir, matching the convention already used for
 * `identity.key` and `paired-devices.json`.
 */
export function ensureInstanceId(env: DashboardPathsEnv | undefined, piPort: number): string {
  const file = getInstanceIdPath(env, piPort);
  const dir = path.dirname(file);

  // `/api/health` is polled by the UI, the bridge and doctor, and the id is
  // immutable for the life of the file — so the read is memoised per path
  // rather than paid per request.
  const cached = idCache.get(file);
  if (cached) return cached;

  const existing = readInstanceId(file);
  if (existing) {
    idCache.set(file, existing);
    return existing;
  }

  fs.mkdirSync(dir, { recursive: true });
  // chmod separately: mkdir's mode is masked by the process umask, so the
  // 0700 guarantee cannot be expressed by `{ mode }` alone.
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    /* best-effort (e.g. Windows, where chmod is a documented no-op) */
  }
  const id = randomUUID();
  fs.writeFileSync(file, `${id}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* best-effort */
  }
  idCache.set(file, id);
  return id;
}

/**
 * The `/api/health` fields carrying the rendezvous instance id.
 *
 * SINGLE PUBLISH SITE, deliberately. `home-lock`'s liveness probe compares the
 * record's `identity` against a health field; publishing under a name the probe
 * does not read makes the comparison fall through to the PID branch and the
 * verification silently never runs (task 2.0e-i). Both sides go through this
 * helper so the names cannot drift apart.
 *
 * NOT `identity`: `server.ts` already binds that name to the Ed25519 object,
 * and reusing it would make every second instance throw
 * `InstanceLockMismatchError` instead of attaching (task 2.0e).
 */
export const INSTANCE_ID_HEALTH_FIELD = "instanceId" as const;

/** The health-payload fragment that publishes the instance id. */
export function instanceIdHealthFields(instanceId: string): { instanceId: string } {
  return { [INSTANCE_ID_HEALTH_FIELD]: instanceId };
}

/** Read a persisted id, or `null` when absent, empty, or unreadable. */
function readInstanceId(file: string): string | null {
  try {
    const raw = fs.readFileSync(file, "utf-8").trim();
    return raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}
