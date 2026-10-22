/**
 * The mutations a server card can ask of the section (remove a route / a whole server, accept a move
 * suggestion, add a discovered route), as one object of async callbacks that resolve to an error text
 * (or `null` / `{ error: null }` on success). Every success re-reads the saved list through `refresh`.
 *
 * Whole-server removal drops each SAVED route of the card (the entry goes with its last route): it
 * works against a dashboard server older than routes and never touches another entry that shares
 * the identity on another instance port. `http` is the server's default scheme, so only an https
 * route names its scheme in a `DELETE`.
 *
 * See change: group-servers-by-identity (D6; tasks 7.1, 7.2).
 */
import type { Route, RouteSource } from "@blackbelt-technology/pi-dashboard-shared/server-routes.js";
import { primaryRoute } from "@blackbelt-technology/pi-dashboard-shared/server-routes.js";
import { acceptKnownServerMove, addKnownServer, removeKnownServer } from "../../lib/api/known-servers-api.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { logRejection } from "../../lib/report-error.js";
import { errorMessage } from "./connectivity-ui.js";
import type { ServerCardActions } from "./ServerCard.js";

/** Always names the scheme: without it the server's pre-routes wildcard also removes the sibling route at the same host:port. */
const dropRoute = (r: Pick<Route, "host" | "port" | "scheme">) => removeKnownServer(r.host, r.port, r.scheme);

export function createServerCardActions(storedSource: ReadonlyMap<string, RouteSource>, refresh: () => Promise<void>): ServerCardActions {
  const removeFailed = (e: unknown) => i18nT("connection.removeFailed", { error: errorMessage(e) }, "Could not remove: {error}");
  return {
    async removeRoute(route) {
      try {
        await dropRoute(route);
        await refresh();
        return null;
      } catch (e) {
        return removeFailed(e);
      }
    },
    async removeServer(entry) {
      try {
        for (const r of entry.routes.filter((x) => storedSource.has(x.key))) await dropRoute(r);
        await refresh();
        return null;
      } catch (e) {
        await refresh().catch(logRejection("createServerCardActions.refresh"));
        return removeFailed(e);
      }
    },
    async acceptMove(entry) {
      const route = primaryRoute(entry.routes);
      if (!route || !(await acceptKnownServerMove(route.host, route.port))) {
        return i18nT("connection.moveRefused", undefined, "Couldn't update this server — an operator credential is needed.");
      }
      await refresh();
      return null;
    },
    async addRoute(route, label, fingerprint) {
      try {
        // The advertised fingerprint is a hint: the server pins it only if its challenge proves it.
        const { updated } = await addKnownServer(route.host, route.port, label || undefined, fingerprint);
        await refresh();
        return { error: null, updated };
      } catch (e) {
        return { error: i18nT("connection.addFailed", { error: errorMessage(e) }, "Could not add: {error}"), updated: false };
      }
    },
  };
}
