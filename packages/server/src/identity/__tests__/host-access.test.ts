import type { Principal } from "@blackbelt-technology/pi-dashboard-shared/identity.js";
import { describe, expect, it, vi } from "vitest";
import { gateHttpNonSession, type HostPolicy } from "../host-access.js";
import { HostActions, hostResource } from "../host-resources.js";

const anna: Principal = { iss: "https://kc/realms/app", sub: "anna" };
const action = HostActions.openspecRead;
const resource = hostResource.openspec("/w");

function reply() {
  const codes: number[] = [];
  return { code: (s: number) => (codes.push(s), undefined), codes };
}

describe("gateHttpNonSession (§7.3/§8.4)", () => {
  it("inert (no policy) ⇒ proceeds, sets no status — today's behavior", async () => {
    const policy: HostPolicy = { hasPolicy: () => false, authorize: vi.fn() };
    const r = reply();
    expect(await gateHttpNonSession(r, policy, null, action, resource)).toBe(true);
    expect(r.codes).toEqual([]);
    expect(policy.authorize).not.toHaveBeenCalled(); // never consulted when ungated
  });

  it("policy registered + principal allowed ⇒ proceeds", async () => {
    const policy: HostPolicy = { hasPolicy: () => true, authorize: vi.fn().mockResolvedValue(true) };
    const r = reply();
    expect(await gateHttpNonSession(r, policy, anna, action, resource)).toBe(true);
    expect(policy.authorize).toHaveBeenCalledWith({ principal: anna, action, resource });
    expect(r.codes).toEqual([]);
  });

  it("policy registered + principal denied ⇒ 403, does not proceed", async () => {
    const policy: HostPolicy = { hasPolicy: () => true, authorize: vi.fn().mockResolvedValue(false) };
    const r = reply();
    expect(await gateHttpNonSession(r, policy, anna, action, resource)).toBe(false);
    expect(r.codes).toEqual([403]);
  });

  it("policy registered + no principal ⇒ 403 without consulting the policy", async () => {
    const policy: HostPolicy = { hasPolicy: () => true, authorize: vi.fn() };
    const r = reply();
    expect(await gateHttpNonSession(r, policy, undefined, action, resource)).toBe(false);
    expect(r.codes).toEqual([403]);
    expect(policy.authorize).not.toHaveBeenCalled();
  });
});
