/**
 * Server-side home of the bind-vs-trust reachability fact.
 *
 * The predicate itself lives in `shared/bind-reachability.ts` — this module only
 * supplies the server's INPUTS to it (the boot-frozen bind host, the `--host`
 * flag, `PI_DASHBOARD_HOST`, the live config) and owns the two server surfaces:
 * the `[bind-reachability]` startup warning and the `reachability` object on the
 * guarded `GET /api/config`.
 *
 * `resolvedBindHost` is frozen at boot — it is what THIS process actually bound.
 * `pendingBindHost` is re-resolved on every read against the current config, so
 * an operator who edits `bindHost` sees the advisory converge before the restart
 * that would apply it.
 *
 * Deliberately NOT on `/api/health`: that route carries no `preHandler`, and the
 * resolved bind host plus the unreachable entries describe the operator's
 * private network topology, not the server's own health. Publishing them
 * unguarded would hand any peer that can reach the port a map of the internal
 * subnets — including, in the flagship configuration, the very host the guard
 * just denied. See change: warn-unreachable-trusted-networks.
 */
import {
  type BindReachability,
  collectTrustedEntries,
  resolveBindHost,
  unreachableTrustedEntries,
} from "@blackbelt-technology/pi-dashboard-shared/bind-reachability.js";

/** Boot-frozen inputs. Set once by the server at startup. */
let bootInputs: { resolvedBindHost: string; hostFlag: string | null } | null = null;

/** Last computed value, so a change in `pendingBindHost` is detectable. */
let last: BindReachability | null = null;

export function initBindReachability(inputs: { resolvedBindHost: string; hostFlag?: string | null }): void {
  bootInputs = { resolvedBindHost: inputs.resolvedBindHost, hostFlag: inputs.hostFlag ?? null };
  last = null;
}

/** Test seam — drop the frozen boot inputs. */
export function resetBindReachability(): void {
  bootInputs = null;
  last = null;
}

/**
 * Recompute against the CURRENT config. Throws only if `loadConfig()` does; every
 * caller on a serving path wraps this in failure isolation.
 */
export function computeBindReachability(
  loadConfig: () => { bindHost?: string } & Parameters<typeof collectTrustedEntries>[0],
): BindReachability {
  const resolvedBindHost = bootInputs?.resolvedBindHost ?? "127.0.0.1";
  const cfg = loadConfig();
  const pendingBindHost = resolveBindHost({
    hostFlag: bootInputs?.hostFlag ?? null,
    envHost: process.env.PI_DASHBOARD_HOST ?? null,
    configBindHost: cfg?.bindHost ?? null,
  });
  const value: BindReachability = {
    resolvedBindHost,
    pendingBindHost,
    unreachable: unreachableTrustedEntries(pendingBindHost, collectTrustedEntries(cfg)),
  };
  last = value;
  return value;
}

/** The last computed value, or `null` when nothing has been computed yet. */
export function getLastBindReachability(): BindReachability | null {
  return last;
}

/**
 * The startup warning line, or `null` when every trusted entry is reachable.
 * Prefixed `[bind-reachability]`, matching the `[openspec-poll]` / `[hydration]`
 * convention, so an operator who never opens Settings still sees the condition.
 */
export function formatBindReachabilityWarning(r: BindReachability): string | null {
  if (r.unreachable.length === 0) return null;
  return (
    `[bind-reachability] listening on ${r.resolvedBindHost} — ` +
    `trusted ${r.unreachable.length === 1 ? "entry" : "entries"} ${r.unreachable.join(", ")} ` +
    `cannot reach this dashboard. Set bindHost to 0.0.0.0 (Settings → Server) to serve them.`
  );
}
