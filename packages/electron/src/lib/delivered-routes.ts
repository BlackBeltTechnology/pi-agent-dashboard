/**
 * Record routes delivered with a pairing result (a knock approval's `routes`, or the
 * `urls` a pasted pairing payload names) into the keyring — only after each one is
 * validated AND the challenge at it proves the pinned fingerprint.
 *
 *   validate (https, DNS name, origin only, ≤ 8)  →  prove at the origin (concurrent, bounded)
 *   →  keep the first {@link MAX_DELIVERED_STORED} that prove the pin  →  keyring
 *
 * A hostile route (IP literal, userinfo, path, …) is never contacted; one that proves another
 * identity is dropped and logged. Log lines carry the short fingerprint and `host:port` only —
 * never the raw input (it may carry userinfo), a token, a code or a payload.
 *
 * Electron-free (ports injected) — unit-tested in `__tests__/pairing-client.test.ts`.
 *
 * See change: group-servers-by-identity (D7, D10).
 */
import type { ProveFn } from "@blackbelt-technology/pi-dashboard-shared/pairing-knock-client.js";
import { originToRoute, validateDeliveredOrigin, validateDeliveredRoutes } from "@blackbelt-technology/pi-dashboard-shared/server-routes.js";
import { shortFingerprint } from "./server-discovery.js";
import { MAX_DELIVERED_STORED, type ServerKeyring } from "./server-keyring.js";

/** Inputs inspected per call (a payload or approval is small; this bounds a hostile one). */
const MAX_INPUTS = 16;

export interface DeliveredRoutesDeps {
  prove: ProveFn;
  keyring: ServerKeyring;
  log: (line: string) => void;
}

/**
 * Validate, prove and store `candidates` for `fingerprint`; returns how many were stored.
 * `limit` bounds the stored count (default {@link MAX_DELIVERED_STORED}); `skip` origins
 * (already stored by the caller) are not re-proven.
 */
export async function recordDeliveredRoutes(
  fingerprint: string,
  candidates: readonly unknown[],
  deps: DeliveredRoutesDeps,
  opts: { limit?: number; skip?: readonly string[] } = {},
): Promise<number> {
  const short = shortFingerprint(fingerprint);
  const limit = Math.min(opts.limit ?? MAX_DELIVERED_STORED, MAX_DELIVERED_STORED);
  if (limit <= 0 || !deps.keyring.has(fingerprint)) return 0;

  for (const c of candidates.slice(0, MAX_INPUTS)) {
    if (validateDeliveredOrigin(c) === null) deps.log(`[server-windows] delivered route dropped fp=${short} reason=invalid`);
  }
  const skip = new Set(opts.skip ?? []);
  const origins = validateDeliveredRoutes(candidates.slice(0, MAX_INPUTS)).filter((o) => !skip.has(o));

  const verdicts = await Promise.all(
    origins.map(async (origin): Promise<"proven" | "mismatch" | "unproven"> => {
      const where = (() => {
        const r = originToRoute(origin);
        return `${r.host}:${r.port}`;
      })();
      try {
        const r = await deps.prove(origin);
        if ("proven" in r && r.proven === fingerprint) return "proven";
        if ("proven" in r) {
          deps.log(`[server-windows] delivered route dropped fp=${short} reason=identity-mismatch proven=${shortFingerprint(r.proven)} host=${where}`);
          return "mismatch";
        }
      } catch {
        /* unreachable — falls through */
      }
      deps.log(`[server-windows] delivered route dropped fp=${short} reason=unproven host=${where}`);
      return "unproven";
    }),
  );

  const proven = origins.filter((_, i) => verdicts[i] === "proven").slice(0, limit);
  const stored = deps.keyring.addDeliveredHosts(
    fingerprint,
    proven.map((o) => {
      const r = originToRoute(o);
      return { scheme: "https" as const, host: r.host, port: r.port };
    }),
  );
  for (const o of proven.slice(0, stored)) {
    const r = originToRoute(o);
    deps.log(`[server-windows] delivered route proven fp=${short} host=${r.host}:${r.port}`);
  }
  return stored;
}
