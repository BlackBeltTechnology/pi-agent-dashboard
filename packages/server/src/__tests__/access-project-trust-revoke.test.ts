/**
 * Task 4.5, fresh cycle round 1 (finding B).
 *
 * The spec (`access-settings-tab/spec.md`) mandates that project-trust
 * revocation goes through the `persistTrustDecision` repository wrapper. That
 * wrapper is the single place that knows `decision: null` DELETES the key rather
 * than recording a standing refusal (design D13). The route previously wrote
 * pi's store directly with `new ProjectTrustStore(AGENT_DIR).setMany(...)`, which
 * duplicated that knowledge and diverged from the wrapper — and made the client
 * comments and AGENTS.md rows describing the wrapper factually false.
 *
 * This test pins the indirection: reverting to a direct store write fails here.
 *
 * See change: add-access-grants-and-review.
 */
import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const persistTrustDecision = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock("../pi/resource-toggle-trust.js", () => ({
  persistTrustDecision: (...args: unknown[]) => persistTrustDecision(...args),
  trustOptionsFor: () => [],
}));

import { registerAccessRoutes } from "../routes/access-routes.js";

describe("DELETE /api/access/project-trust uses the mandated wrapper (D13)", () => {
  beforeEach(() => {
    persistTrustDecision.mockClear();
  });

  it("routes the revoke through persistTrustDecision with decision: null", async () => {
    const app = Fastify({ logger: false });
    registerAccessRoutes(app, {
      networkGuard: async () => undefined,
      preferencesStore: {
        getPinnedDirectories: () => [],
        unpinDirectory: () => undefined,
      },
      writeConfigPartial: () => ({ success: true }),
    } as never);
    await app.ready();

    const res = await app.inject({
      method: "DELETE",
      url: "/api/access/project-trust",
      payload: { subject: "/home/dev/project" },
    });
    expect(res.statusCode).toBe(200);

    // Exactly one wrapper call, carrying `decision: null` — the DELETE semantics
    // live in the wrapper, not here. Sending `false` would RECORD a refusal.
    expect(persistTrustDecision).toHaveBeenCalledTimes(1);
    const call = persistTrustDecision.mock.calls[0] as unknown as [string, unknown[]];
    expect(typeof call[0]).toBe("string");
    expect(call[1]).toEqual([{ path: "/home/dev/project", decision: null }]);

    await app.close();
  });
});
