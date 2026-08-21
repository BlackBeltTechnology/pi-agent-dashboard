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

  const existing = readInstanceId(file);
  if (existing) return existing;

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
  return id;
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
