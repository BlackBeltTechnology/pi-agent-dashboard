/**
 * E2E: an unmatched `/api` path is a JSON 404 on the real server, while a
 * registered plugin route is unaffected (change: retro-ux-credential-vault,
 * test-plan X11, url-routing "SPA fallback on server").
 *
 * Runs against the docker harness (production build), where the SPA fallback
 * used to answer any unknown path with `index.html` and HTTP 200.
 */

import { expect, test } from "./fixtures.js";
import { OperatorSession } from "./helpers/operator-session.js";

const op = new OperatorSession();

test.describe("unknown /api paths", () => {
  test.beforeEach(async ({ request, context }) => {
    await op.arm(request, context);
  });
  test.afterEach(async ({ request }) => {
    await op.restore(request);
  });

  test("X11 — an unknown /api path is a JSON 404; a registered plugin route still answers", async ({ request }) => {
    const miss = await request.get("/api/does-not-exist", { headers: op.headers() });
    expect(miss.status()).toBe(404);
    expect(miss.headers()["content-type"]).toContain("application/json");
    const body = (await miss.json()) as { success: boolean; error: string; message: string };
    expect(body).toMatchObject({ success: false, error: "not_found" });
    expect(body.message).toContain("/api/does-not-exist");

    // Registered before `listen`, so the not-found handler never sees it.
    const plugin = await request.get("/api/plugins/demo/vault-read", { headers: op.headers() });
    expect(plugin.status()).toBe(200);
    expect(plugin.headers()["content-type"]).toContain("application/json");
    expect(await plugin.json()).toHaveProperty("present");
  });
});
