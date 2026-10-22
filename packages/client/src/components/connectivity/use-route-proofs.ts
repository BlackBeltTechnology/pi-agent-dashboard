/**
 * Proves every route of the listed entries once (the identity challenge via `createRouteChecker`,
 * bounded to 6 at once) and, for a STORED route this browser could not reach, asks the dashboard
 * server for its own explanation (operator-only probe). Results are kept per route key; a request
 * is never repeated for the same route + expected fingerprint while the section is mounted.
 *
 * See change: group-servers-by-identity (D2, D11).
 */
import type { RouteSource } from "@blackbelt-technology/pi-dashboard-shared/server-routes.js";
import { type MutableRefObject, useEffect, useRef, useState } from "react";
import { probeKnownServer } from "../../lib/api/known-servers-api.js";
import { logRejection } from "../../lib/report-error.js";
import type { ListEntry } from "../../lib/server-list-model.js";
import { createRouteChecker, type RouteCheck } from "../../lib/server-route-check.js";
import type { RouteExplain } from "./server-route-chips.js";

export function useRouteProofs(
  entries: readonly ListEntry[],
  opts: { canManage: boolean; storedSource: ReadonlyMap<string, RouteSource>; alive: MutableRefObject<boolean> },
): { checks: ReadonlyMap<string, RouteCheck>; explain: ReadonlyMap<string, RouteExplain> } {
  const { canManage, storedSource, alive } = opts;
  const [checks, setChecks] = useState<ReadonlyMap<string, RouteCheck>>(new Map());
  const [explain, setExplain] = useState<ReadonlyMap<string, RouteExplain>>(new Map());
  const checker = useRef<ReturnType<typeof createRouteChecker> | null>(null);
  const requested = useRef(new Set<string>());
  const explained = useRef(new Set<string>());

  // Prove every route once (the list may grow with a scan or an add).
  useEffect(() => {
    checker.current ??= createRouteChecker();
    const c = checker.current;
    for (const e of entries) {
      for (const r of e.routes) {
        const sig = `${r.key}|${e.fingerprint ?? ""}`;
        if (requested.current.has(sig)) continue;
        requested.current.add(sig);
        void c
          .check(r, e.fingerprint)
          .then((check) => {
            if (alive.current) setChecks((prev) => new Map(prev).set(r.key, check));
          })
          .catch(logRejection("useRouteProofs.check"));
      }
    }
  }, [entries, alive]);

  // The dashboard server's own explanation of a stored route this browser could not reach.
  useEffect(() => {
    if (!canManage) return;
    for (const e of entries) {
      for (const r of e.routes) {
        if (checks.get(r.key)?.kind !== "unreachable" || !storedSource.has(r.key) || explained.current.has(r.key)) continue;
        explained.current.add(r.key);
        void probeKnownServer(r.host, r.port, r.scheme)
          .then((status) => {
            if (alive.current && status) setExplain((prev) => new Map(prev).set(r.key, status));
          })
          .catch(logRejection("useRouteProofs.probe"));
      }
    }
  }, [entries, checks, canManage, storedSource, alive]);

  return { checks, explain };
}
