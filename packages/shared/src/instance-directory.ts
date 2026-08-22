/**
 * The dashboard instances visible under this HOME — for showing a human their
 * options (`--list`, `where`) and for resolving what they typed (tasks 9.5, 9.6).
 *
 * **The D2 carve-out, stated plainly.** D2 forbids a scan as the *selection*
 * mechanism: an unpinned bridge reads the rendezvous record and dials the one
 * instance it names — no enumeration, no heuristic, one deterministic read.
 * That is what makes endpoint choice predictable, and it is not weakened here.
 *
 * But the record names exactly ONE instance (the lock holder), so a
 * record-only listing cannot answer "which dashboards could I move this
 * session to?" — the second instance is precisely the interesting one, and
 * D11's headline case (worktree ↔ main) is two instances under one HOME.
 *
 * So this module scans, and the scan is **display-only**:
 *
 *   - it never picks an endpoint automatically — it returns a list a human
 *     chooses from, or resolves an identifier the human already typed;
 *   - an ambiguous identifier is REFUSED, never silently resolved;
 *   - nothing on the bridge's automatic connect path imports it. That is the
 *     invariant keeping this from becoming discovery-by-the-back-door.
 *
 * See change: add-pi-gateway-transport-identity (D2, D11b; tasks 9.5, 9.6).
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { type DashboardPathsEnv, getDashboardConfigDir } from "./dashboard-paths.js";
import { readRendezvousRecord } from "./rendezvous.js";

export interface LocalInstance {
  piPort: number;
  /** Absent when the instance predates instance ids, or its id file is unreadable. */
  instanceId?: string;
  /** A dialable `ws+unix:` endpoint for this instance's gateway socket. */
  endpoint: string;
  /** True for the instance the `$HOME` rendezvous record names (ladder rung 4). */
  isDefault: boolean;
}

const SOCKET_RE = /^gateway-(\d+)\.sock$/;

/** Every instance with a gateway socket under this HOME, default first. */
export function listLocalInstances(env?: DashboardPathsEnv): LocalInstance[] {
  const dir = getDashboardConfigDir(env);

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    // No config dir means no instances — not an error worth surfacing.
    return [];
  }

  const record = readRendezvousRecord(env);
  const out: LocalInstance[] = [];

  for (const name of entries) {
    const m = SOCKET_RE.exec(name);
    if (!m) continue;
    const piPort = Number(m[1]);

    let instanceId: string | undefined;
    try {
      const raw = readFileSync(path.join(dir, "instances", `${piPort}.id`), "utf8").trim();
      instanceId = raw === "" ? undefined : raw;
    } catch {
      // A socket with no readable id is still a reachable dashboard. Hiding it
      // would make a connectable instance invisible.
    }

    out.push({
      piPort,
      instanceId,
      endpoint: `ws+unix://${path.join(dir, name)}:/`,
      isDefault: instanceId !== undefined && record?.instanceId === instanceId,
    });
  }

  out.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.piPort - b.piPort);
  return out;
}

export type InstanceRefResolution =
  | { ok: true; instance: LocalInstance }
  | { ok: false; reason: string };

/**
 * Resolve what the user typed — a full id, an id prefix, or a port — against a
 * known list. Ambiguity is an error, never a guess: silently choosing between
 * two dashboards moves the session to the wrong one and still looks like it
 * worked.
 */
export function resolveInstanceRef(
  ref: string,
  instances: LocalInstance[],
): InstanceRefResolution {
  const needle = ref.trim();

  // Exact id first: an instance whose id happens to prefix another's must stay
  // addressable.
  const exact = instances.find((i) => i.instanceId === needle);
  if (exact) return { ok: true, instance: exact };

  if (/^\d+$/.test(needle)) {
    const byPort = instances.find((i) => i.piPort === Number(needle));
    if (byPort) return { ok: true, instance: byPort };
  }

  const prefixed = instances.filter((i) => i.instanceId?.startsWith(needle));
  if (prefixed.length === 1) return { ok: true, instance: prefixed[0] };
  if (prefixed.length > 1) {
    const which = prefixed.map((i) => `${i.instanceId} (port ${i.piPort})`).join(", ");
    return { ok: false, reason: `ambiguous instance "${needle}" — matches ${which}` };
  }

  return { ok: false, reason: `no instance matching "${needle}" under this HOME` };
}

/** One line per instance, for `--list`. */
export function formatInstanceLine(i: LocalInstance): string {
  const id = i.instanceId ?? "(no id)";
  return `${i.isDefault ? "*" : " "} port ${i.piPort}  ${id}  ${i.endpoint}`;
}
