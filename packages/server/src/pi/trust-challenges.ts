/**
 * Outstanding project-trust challenges, shared by every route that can answer a
 * project-scope write with `403 trustRequired` (the Resources toggle and the
 * Add-ons folder toggle).
 *
 * `POST /api/resources/trust` only acts on a folder in this set, so a caller can
 * neither choose the trust-store updates nor plant a durable trust record for a
 * path of its choosing: a real toggle must have raised the challenge first.
 * Process-lifetime and in-memory — a restart simply makes the user re-toggle.
 *
 * Extracted from `routes/resource-activation-routes.ts` (behaviour preserving).
 * See change: project-scope-disable-global-resources, addons-hub-folder-view (D4).
 */
import * as path from "node:path";

const outstandingTrustChallenges = new Set<string>();

function key(cwd: string): string {
  return path.resolve(cwd);
}

/** Record that a toggle asked for a trust decision on `cwd`. */
export function registerTrustChallenge(cwd: string): void {
  outstandingTrustChallenges.add(key(cwd));
}

export function hasTrustChallenge(cwd: string): boolean {
  return outstandingTrustChallenges.has(key(cwd));
}

export function clearTrustChallenge(cwd: string): void {
  outstandingTrustChallenges.delete(key(cwd));
}

/** Test seam: clear the outstanding challenges (simulates a fresh process). */
export function __resetTrustChallenges(): void {
  outstandingTrustChallenges.clear();
}
