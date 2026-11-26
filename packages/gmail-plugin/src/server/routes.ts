/**
 * Gmail plugin REST routes (add-google-connect D10). Account, client and setup management moved to
 * Google Connect (`/api/plugins/google/*`): every management route here answers a fixed refusal and
 * stores nothing — `410 { error: "moved" }` while Google Connect is usable, `503
 * { error: "google_connect_unavailable" }` while it is not (Gmail tools keep working from the plugin's own
 * data). `GET /state` stays: it tells the settings section which notice to show. All routes sit behind
 * `networkGuard` in an encapsulated scope with `@fastify/rate-limit` (loopback allow-listed); tiers
 * `operate` (`packages/shared/src/route-tiers.ts`). See change: add-google-connect.
 */
import type { PluginNetworkGuard } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { GoogleLink } from "./google-link.js";

export interface GmailRouteDeps {
  networkGuard: PluginNetworkGuard;
  link: GoogleLink;
}

const PREFIX = "/api/plugins/gmail";

/** Every management route of the pre-Google-Connect plugin, by method (paths are relative to {@link PREFIX}). */
const MOVED_ROUTES: ReadonlyArray<{ method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; url: string }> = [
  { method: "PUT", url: "/client" },
  { method: "PUT", url: "/setup" },
  { method: "GET", url: "/accounts" },
  { method: "POST", url: "/accounts" },
  { method: "PATCH", url: "/accounts/:sub" },
  { method: "DELETE", url: "/accounts/:sub" },
  { method: "POST", url: "/accounts/:sub/level" },
  { method: "POST", url: "/accounts/:sub/reauth" },
  { method: "POST", url: "/accounts/:sub/filters" },
  { method: "POST", url: "/setup/run" },
  { method: "GET", url: "/setup/run/:id" },
  { method: "POST", url: "/setup/run/:id/continue" },
  { method: "POST", url: "/setup/run/:id/takeover" },
  { method: "DELETE", url: "/setup/run/:id" },
];

export async function mountGmailRoutes(fastify: FastifyInstance, deps: GmailRouteDeps): Promise<void> {
  await fastify.register(async (scope) => {
    await scope.register(rateLimit, {
      global: true,
      max: 600,
      timeWindow: "1 minute",
      allowList: ["127.0.0.1", "::1"],
    });
    const guarded = { preHandler: deps.networkGuard };

    scope.get(`${PREFIX}/state`, guarded, async () => {
      const { usable } = await deps.link.ensure();
      return usable ? { moved: true } : { moved: false, googleConnect: "unavailable" };
    });

    const refuse = async (_request: unknown, reply: FastifyReply) => {
      const { usable } = await deps.link.ensure();
      return usable
        ? reply.code(410).send({ error: "moved" })
        : reply.code(503).send({ error: "google_connect_unavailable" });
    };
    for (const { method, url } of MOVED_ROUTES) scope.route({ method, url: `${PREFIX}${url}`, preHandler: deps.networkGuard, handler: refuse });
  });
}
