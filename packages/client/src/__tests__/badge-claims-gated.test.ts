/**
 * Contract: every first-party registry claim on `session-card-badge` declares a
 * `predicate` or `shouldRender`. An un-gated badge claim always counts toward the
 * STATUS-subcard gate, so any plugin whose component can render `null` would
 * draw an empty STATUS panel (the fix-empty-status-subcard bug). The allow-list
 * is intentionally empty — add a claim there only with a justification.
 *
 * Scope: first-party registry claims only; intent-store contributions and
 * third-party runtime claims are not covered (design D4).
 */
import { describe, expect, it } from "vitest";
import { PLUGIN_REGISTRY } from "../generated/plugin-registry.js";

/** `pluginId` → justification. Empty by design. */
const UNGATED_ALLOW_LIST: Record<string, string> = {};

describe("session-card-badge claims are gated (#E5)", () => {
  const badgeClaims = PLUGIN_REGISTRY.flatMap((e) => e.claims).filter((c) => c.slot === "session-card-badge");

  it("finds the registry's badge claims (guards against a vacuous pass)", () => {
    expect(badgeClaims.length).toBeGreaterThan(0);
    expect(badgeClaims.some((c) => c.pluginId === "browser")).toBe(true);
  });

  it("every badge claim has a predicate or shouldRender", () => {
    const ungated = badgeClaims.filter((c) => !c.predicate && !c.shouldRender && !(c.pluginId in UNGATED_ALLOW_LIST));
    expect(ungated.map((c) => c.pluginId)).toEqual([]);
  });
});
