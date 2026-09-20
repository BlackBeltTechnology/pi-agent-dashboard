/**
 * Trust-failure detection (change: add-chat-gateway-team-controls, D5).
 *
 * The rule under test: a trusted-gated verb returning the host's no-op marks
 * the layer unhealthy NAMING the missing trust level, and the state is sticky
 * (the trust level cannot repair itself mid-process).
 */
import { describe, expect, it } from "vitest";
import { createTrustHealth, TRUSTED_PRIORITY_MAX } from "../health.js";

describe("team trust health (D5)", () => {
  it("starts healthy with no reason", () => {
    const h = createTrustHealth();
    expect(h.snapshot()).toEqual({ healthy: true });
  });

  it("marks unhealthy naming the verb and the missing trust level", () => {
    const h = createTrustHealth();
    const reason = h.reportTrustFailure("assignSessionRef");
    expect(h.snapshot().healthy).toBe(false);
    expect(reason).toMatch(/assignSessionRef/);
    expect(reason).toMatch(/trust level/);
    expect(reason).toContain(`<= ${TRUSTED_PRIORITY_MAX}`);
    expect(h.snapshot().reason).toBe(reason);
  });

  it("keeps the FIRST cause and is sticky — a later success must not clear it", () => {
    const h = createTrustHealth();
    const first = h.reportTrustFailure("assignSessionRef");
    const second = h.reportTrustFailure("abortSession");
    // The second report does not rebrand the failure...
    expect(second).toBe(first);
    expect(h.snapshot().reason).toBe(first);
    // ...and there is no API to clear it: only a restart re-derives trust.
    expect(h.snapshot().healthy).toBe(false);
  });
});
