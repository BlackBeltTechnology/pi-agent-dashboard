/**
 * Totality of the identity road classification over the REAL route set
 * (D10/D24, task 18.28). Boots the real server (core + in-tree plugins), collects
 * every registered `/api/*` route via `onRoute`, and requires each to resolve to
 * exactly one road with the production route-owner attribution — so a new core
 * route or plugin route cannot silently skip the owner gate or the host policy.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type DashboardServer } from "../../server.js";
import { classifyHttpRoad } from "../http-road-classification.js";
import { getRouteOwnerRegistry } from "../route-owner-registry.js";

let server: DashboardServer;
const routes: Array<{ method: string | string[]; url: string }> = [];

beforeAll(async () => {
  server = await createServer({
    port: 0,
    piPort: 0,
    host: "127.0.0.1",
    dev: true,
    autoShutdown: false,
    shutdownIdleSeconds: 999,
    tunnel: false,
    onRoute: (r) => routes.push(r),
  });
  await server.start();
}, 60_000);

afterAll(async () => {
  await server?.stop();
});

const apiRoutes = () =>
  routes
    .filter((r) => r.url.startsWith("/api/"))
    .flatMap((r) => (Array.isArray(r.method) ? r.method : [r.method]).map((m) => ({ method: m, url: r.url })))
    .filter((r) => r.method !== "HEAD" && r.method !== "OPTIONS");

describe("identity road classification — live route set", () => {
  it("collects a realistic route set", () => {
    expect(apiRoutes().length).toBeGreaterThan(150);
  });

  it("every registered /api route is classified", () => {
    const owners = getRouteOwnerRegistry();
    const unclassified = apiRoutes()
      .filter((r) => classifyHttpRoad(r.method, r.url, (u) => owners.ownerOf(u)) === undefined)
      .map((r) => `${r.method} ${r.url}`);
    expect(unclassified).toEqual([]);
  });

  it("in-tree plugin routes outside /api/plugins/ are attributed to their plugin", () => {
    const owners = getRouteOwnerRegistry();
    const kb = apiRoutes().find((r) => r.url.startsWith("/api/kb/"));
    if (kb) expect(owners.ownerOf(kb.url)).toBe("kb");
    const goals = apiRoutes().find((r) => r.url.startsWith("/api/folders/goals"));
    if (goals) expect(owners.ownerOf(goals.url)).toBe("goal");
  });
});
