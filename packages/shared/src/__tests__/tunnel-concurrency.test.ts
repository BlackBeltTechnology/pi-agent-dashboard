/**
 * Concurrent tunnels with an explicit primary — folded from test-plan.md
 * (add-zrok-custom-reserved-name): E13–E17, X13, X14.
 *
 * The design's load-bearing claim is that `tunnel.provider` can be REDEFINED as
 * "the primary" without touching any auth requirement, because `getTunnelUrl()`
 * keeps returning the primary's URL. These tests pin the two places that claim
 * is easy to break: mode resolution (a single shared `mode` cannot express
 * zrok+zerotier) and primary fallback (never silently promote a live tunnel).
 */
import { describe, expect, it } from "vitest";
import { primaryOf, resolveTunnelPlan, soleMode } from "../tunnel-concurrency.js";
import { PROVIDER_KIND, usesChildLifecycle } from "../tunnel-provider.js";

describe("single-provider configs are unchanged (the migration-free property)", () => {
  it("resolves to exactly the primary when nothing else opts in", () => {
    const plan = resolveTunnelPlan({ provider: "zrok", mode: "public" });
    expect(plan.providers).toEqual([{ provider: "zrok", mode: "public", primary: true }]);
    expect(plan.refuseConnect).toBe(false);
  });

  it("absent `enabled` means false — it is never inferred from presence of the block", () => {
    const plan = resolveTunnelPlan({ provider: "zrok", mode: "public", tailscale: { mode: "private" } });
    expect(plan.providers.map((p) => p.provider)).toEqual(["zrok"]);
  });

  it("E17: a legacy config normalized to zrok/public still resolves to one provider", () => {
    const plan = resolveTunnelPlan({ provider: "zrok", mode: "public" });
    expect(plan.providers).toHaveLength(1);
    expect(primaryOf(plan)?.provider).toBe("zrok");
  });
});

describe("per-provider mode (E13/E14)", () => {
  it("E13: zerotier defaults to its SOLE mode; the top-level mode is not applied to it", () => {
    // This is the case a single shared `mode` cannot express: zrok is
    // public-only and zerotier private-only.
    const plan = resolveTunnelPlan({ provider: "zrok", mode: "public", zerotier: { enabled: true } });
    expect(plan.providers).toEqual([
      { provider: "zrok", mode: "public", primary: true },
      { provider: "zerotier", mode: "private", primary: false },
    ]);
    expect(plan.errors).toEqual([]);
  });

  it("E14: tailscale supports BOTH modes, so an unset mode is a per-provider config error", () => {
    const plan = resolveTunnelPlan({ provider: "zrok", mode: "public", tailscale: { enabled: true } });
    // Inferring one would be a coin flip dressed as a default.
    expect(plan.errors).toEqual([
      expect.objectContaining({ provider: "tailscale", kind: "no-mode" }),
    ]);
    // …and the primary still connects.
    expect(plan.providers).toEqual([{ provider: "zrok", mode: "public", primary: true }]);
    expect(plan.refuseConnect).toBe(false);
  });

  it("E14b: tailscale WITH an explicit mode resolves normally", () => {
    const plan = resolveTunnelPlan({
      provider: "zrok",
      mode: "public",
      tailscale: { enabled: true, mode: "private" },
    });
    expect(plan.providers).toContainEqual({ provider: "tailscale", mode: "private", primary: false });
    expect(plan.errors).toEqual([]);
  });

  it("soleMode is defined only for single-mode providers", () => {
    expect(soleMode("zrok")).toBe("public");
    expect(soleMode("ngrok")).toBe("public");
    expect(soleMode("zerotier")).toBe("private");
    expect(soleMode("tailscale")).toBeUndefined();
  });
});

describe("unsupported modes are scoped by primacy (E15/E16)", () => {
  it("E15: an unsupported mode on a NON-primary disables that provider alone", () => {
    const plan = resolveTunnelPlan({
      provider: "zrok",
      mode: "public",
      zerotier: { enabled: true, mode: "public" }, // zerotier is private-only
      ngrok: { enabled: true },
    });
    expect(plan.providers.map((p) => p.provider)).toEqual(["zrok", "ngrok"]);
    expect(plan.errors).toEqual([
      expect.objectContaining({ provider: "zerotier", kind: "unsupported-mode" }),
    ]);
    expect(plan.refuseConnect).toBe(false);
  });

  it("E16: an unsupported mode on the PRIMARY refuses the whole connect, exactly as before", () => {
    const plan = resolveTunnelPlan({ provider: "zrok", mode: "private" }); // zrok is public-only
    expect(plan.refuseConnect).toBe(true);
    expect(plan.providers).toEqual([]);
    expect(plan.errors[0]).toMatchObject({ provider: "zrok", kind: "unsupported-mode" });
  });

  it("a primary with two modes and none configured also refuses, rather than guessing", () => {
    const plan = resolveTunnelPlan({ provider: "tailscale" });
    expect(plan.refuseConnect).toBe(true);
    expect(plan.errors[0]).toMatchObject({ provider: "tailscale", kind: "no-mode" });
  });

  it("an error message names the modes the provider actually supports", () => {
    const plan = resolveTunnelPlan({ provider: "zrok", mode: "private" });
    expect(plan.errors[0].message).toContain("public");
  });
});

describe("the primary is explicit and never auto-promoted (X13)", () => {
  it("exactly one resolved provider is the primary", () => {
    const plan = resolveTunnelPlan({
      provider: "zrok",
      mode: "public",
      tailscale: { enabled: true, mode: "private" },
      zerotier: { enabled: true },
    });
    expect(plan.providers.filter((p) => p.primary)).toHaveLength(1);
    expect(primaryOf(plan)?.provider).toBe("zrok");
  });

  it("X13: a live non-primary is NOT promoted when the primary is unresolvable", () => {
    // zrok primary is misconfigured; tailscale is enabled and fine. The plan
    // must NOT hand tailscale the primary flag — promoting it would move the
    // OAuth sign-in origin without the operator asking, bypassing the
    // confirmation a deliberate primary switch carries.
    const plan = resolveTunnelPlan({
      provider: "zrok",
      mode: "private",
      tailscale: { enabled: true, mode: "private" },
    });
    expect(primaryOf(plan)).toBeUndefined();
    expect(plan.providers.some((p) => p.primary)).toBe(false);
  });

  it("no provider configured at all yields an empty plan, not an implicit default", () => {
    const plan = resolveTunnelPlan(undefined);
    expect(plan.providers).toEqual([]);
    expect(plan.refuseConnect).toBe(false);
  });
});

describe("X14: daemon providers carry no child lifecycle", () => {
  it("the shipped child-vs-daemon rule still classifies all four providers", () => {
    expect(PROVIDER_KIND).toEqual({
      zrok: "child",
      ngrok: "child",
      tailscale: "daemon",
      zerotier: "daemon",
    });
  });

  it("only child providers take the PID-file + watchdog path", () => {
    const plan = resolveTunnelPlan({
      provider: "zrok",
      mode: "public",
      tailscale: { enabled: true, mode: "private" },
    });
    const needingPid = plan.providers.filter((p) => usesChildLifecycle(PROVIDER_KIND[p.provider]));
    expect(needingPid.map((p) => p.provider)).toEqual(["zrok"]);
  });
});
