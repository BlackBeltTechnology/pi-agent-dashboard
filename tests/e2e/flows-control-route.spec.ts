/**
 * REST cutover on the real server: the removed core route is a JSON 404; the
 * flows plugin route is registered and refuses an unknown action with 400.
 * See change: update-flows-plugin (D2; test-plan X5; exemplar api-not-found.spec.ts).
 */
import { expect, test } from "./fixtures.js";
import { OperatorSession } from "./helpers/operator-session.js";

const op = new OperatorSession();

test.describe("flow control REST cutover", () => {
  test.beforeEach(async ({ request, context }) => {
    await op.arm(request, context);
  });

  test("X5 — /api/session/:id/flow-control is gone; /api/plugins/flows/control answers", async ({ request }) => {
    const sid = "x5-missing-session";
    const old = await request.post(`/api/session/${sid}/flow-control`, { headers: op.headers(), data: { action: "abort" } });
    expect(old.status()).toBe(404);
    expect(old.headers()["content-type"]).toContain("application/json");
    expect(await old.json()).toMatchObject({ success: false, error: "not_found" });

    const unknown = await request.post("/api/plugins/flows/control", {
      headers: op.headers(),
      data: { sessionId: sid, action: "flow.rename" },
    });
    expect(unknown.status()).toBe(400);
    expect(await unknown.json()).toMatchObject({ success: false, code: "unknown_action" });
  });
});
