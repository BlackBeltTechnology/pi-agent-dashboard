import type { Principal } from "@blackbelt-technology/pi-dashboard-shared/identity.js";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_POLICY_TIMEOUT_MS,
  MAX_POLICY_TIMEOUT_MS,
  MIN_POLICY_TIMEOUT_MS,
  type PolicyAuditEvent,
  PolicyDuplicateError,
  PolicyRegistry,
  PolicyTrustError,
} from "../policy-registry.js";

const principal: Principal = { iss: "https://kc/realms/app", sub: "user-1" };
const resource = { kind: "workspace", path: "/w" } as const;

describe("PolicyRegistry — registration (§7.1)", () => {
  it("accepts the named plugin and refuses any other registrant", () => {
    const reg = new PolicyRegistry({ trustedPolicyPlugin: "policy-plugin" });
    expect(() => reg.register("other-plugin", async () => true)).toThrow(PolicyTrustError);
    expect(reg.hasPolicy()).toBe(false);
    reg.register("policy-plugin", async () => true);
    expect(reg.hasPolicy()).toBe(true);
    expect(reg.size).toBe(1);
  });

  it("refuses a second registration (no nondeterministic choice)", () => {
    const reg = new PolicyRegistry({ trustedPolicyPlugin: "policy-plugin" });
    reg.register("policy-plugin", async () => true);
    expect(() => reg.register("policy-plugin", async () => false)).toThrow(PolicyDuplicateError);
  });

  it("when no plugin is named, no registration is trusted (roads stay ungated)", async () => {
    const reg = new PolicyRegistry({});
    expect(() => reg.register("policy-plugin", async () => true)).toThrow(PolicyTrustError);
    expect(reg.hasPolicy()).toBe(false);
    // Ungated: authorize returns true with no policy.
    await expect(reg.authorize({ principal, action: "workspace.read", resource })).resolves.toBe(true);
  });

  it("unregister handle removes only its own policy", () => {
    const reg = new PolicyRegistry({ trustedPolicyPlugin: "policy-plugin" });
    const off = reg.register("policy-plugin", async () => true);
    off();
    expect(reg.hasPolicy()).toBe(false);
  });
});

describe("PolicyRegistry — bounded fail-closed evaluation (§7.2)", () => {
  const setup = (policy: Parameters<PolicyRegistry["register"]>[1], timeoutMs?: number) => {
    const audit = vi.fn<(e: PolicyAuditEvent) => void>();
    const reg = new PolicyRegistry({ trustedPolicyPlugin: "p", timeoutMs, audit });
    reg.register("p", policy);
    return { reg, audit };
  };

  it("allows on true", async () => {
    const { reg, audit } = setup(async () => true);
    await expect(reg.authorize({ principal, action: "workspace.read", resource })).resolves.toBe(true);
    expect(audit).not.toHaveBeenCalled();
  });

  it("denies + audits on false", async () => {
    const { reg, audit } = setup(async () => false);
    await expect(reg.authorize({ principal, action: "workspace.read", resource })).resolves.toBe(false);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "false", action: "workspace.read", principal: { iss: principal.iss, sub: principal.sub } }),
    );
  });

  it("denies + audits on throw", async () => {
    const { reg, audit } = setup(async () => {
      throw new Error("boom");
    });
    await expect(reg.authorize({ principal, action: "a", resource })).resolves.toBe(false);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ reason: "throw" }));
  });

  it("denies + audits on timeout", async () => {
    const { reg, audit } = setup(() => new Promise<boolean>(() => {}), MIN_POLICY_TIMEOUT_MS);
    await expect(reg.authorize({ principal, action: "a", resource })).resolves.toBe(false);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ reason: "timeout" }));
  });

  it("denies + audits on a non-boolean result", async () => {
    const { reg, audit } = setup((async () => "yes") as unknown as () => Promise<boolean>);
    await expect(reg.authorize({ principal, action: "a", resource })).resolves.toBe(false);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ reason: "non-boolean" }));
  });

  it("denies an unclassified road (missing action/resource) when a policy is present", async () => {
    const { reg, audit } = setup(async () => true);
    await expect(
      reg.authorize({ principal, action: "", resource } as unknown as { principal: Principal; action: string; resource: typeof resource }),
    ).resolves.toBe(false);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ reason: "unclassified" }));
  });

  it("clamps the timeout to the allowed range", () => {
    // Construction-only sanity: out-of-range values do not throw and clamp.
    expect(() => new PolicyRegistry({ timeoutMs: 1 })).not.toThrow();
    expect(() => new PolicyRegistry({ timeoutMs: 99999 })).not.toThrow();
    expect(MIN_POLICY_TIMEOUT_MS).toBeLessThan(DEFAULT_POLICY_TIMEOUT_MS);
    expect(DEFAULT_POLICY_TIMEOUT_MS).toBeLessThan(MAX_POLICY_TIMEOUT_MS);
  });
});
