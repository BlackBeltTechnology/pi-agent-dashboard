/**
 * Provenance accessor contract (test-plan #E2, #E5): an absent `lifecyclePolicy`
 * is treated as `"durable"` (legacy safety), interactive sessions stay durable,
 * and only an explicit `"ephemeral"` marker flips `isEphemeral`. Every downstream
 * gate (reaper, caps) reads through these accessors, so this is the single point
 * where absent-⇒-durable is guaranteed.
 * See change: add-embed-session-lifecycle.
 */
import { describe, expect, it } from "vitest";
import {
  effectiveLifecyclePolicy,
  isEphemeral,
} from "../session-lifecycle-policy.js";

describe("session lifecycle policy accessor", () => {
  // E2 — absent policy defaults to durable.
  it("treats an absent lifecyclePolicy as durable", () => {
    expect(effectiveLifecyclePolicy({})).toBe("durable");
    expect(isEphemeral({})).toBe(false);
  });

  // E5 — interactive spawns (no marker) stay durable and ungoverned.
  it("classifies an interactive session (no marker) as durable", () => {
    const interactive = { lifecyclePolicy: undefined };
    expect(effectiveLifecyclePolicy(interactive)).toBe("durable");
    expect(isEphemeral(interactive)).toBe(false);
  });

  it("classifies an explicitly durable session as durable", () => {
    expect(effectiveLifecyclePolicy({ lifecyclePolicy: "durable" })).toBe("durable");
    expect(isEphemeral({ lifecyclePolicy: "durable" })).toBe(false);
  });

  it("classifies an ephemeral session as ephemeral", () => {
    expect(effectiveLifecyclePolicy({ lifecyclePolicy: "ephemeral" })).toBe("ephemeral");
    expect(isEphemeral({ lifecyclePolicy: "ephemeral" })).toBe(true);
  });
});
