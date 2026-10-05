import type { Principal } from "@blackbelt-technology/pi-dashboard-shared/identity.js";
import { describe, expect, it, vi } from "vitest";
import { authorizeRoadUpgrade } from "../upgrade-gate.js";
import { LOCAL_OPERATOR } from "../session-access.js";

const anna: Principal = { iss: "https://idp", sub: "anna" };
const policy = (decide: () => unknown, has = true) => ({ hasPolicy: () => has, authorize: vi.fn(async () => decide() as boolean) });
const base = { enforced: true, action: "terminal.read", resource: { kind: "terminal", id: "t1" } };

describe("authorizeRoadUpgrade (review B2)", () => {
  it("asks the policy with the road's action + resource and follows the answer", async () => {
    const p = policy(() => true);
    expect(await authorizeRoadUpgrade({ ...base, policy: p, principal: anna })).toBe(true);
    expect(p.authorize).toHaveBeenCalledWith({ principal: anna, action: "terminal.read", resource: { kind: "terminal", id: "t1" } });
    expect(await authorizeRoadUpgrade({ ...base, policy: policy(() => false), principal: anna })).toBe(false);
  });

  it("no policy or inert plane ⇒ proceed without asking (unchanged)", async () => {
    const none = policy(() => false, false);
    expect(await authorizeRoadUpgrade({ ...base, policy: none, principal: anna })).toBe(true);
    const inert = policy(() => false);
    expect(await authorizeRoadUpgrade({ ...base, enforced: false, policy: inert, principal: null })).toBe(true);
    expect(none.authorize).not.toHaveBeenCalled();
    expect(inert.authorize).not.toHaveBeenCalled();
  });

  it("principal-less ⇒ deny without consulting the policy; operator ⇒ allow without consulting it", async () => {
    const p = policy(() => false);
    expect(await authorizeRoadUpgrade({ ...base, policy: p, principal: null })).toBe(false);
    expect(await authorizeRoadUpgrade({ ...base, policy: p, principal: LOCAL_OPERATOR })).toBe(true);
    expect(p.authorize).not.toHaveBeenCalled();
  });

  it("a throwing or non-boolean policy denies (fail-closed)", async () => {
    const boom = { hasPolicy: () => true, authorize: vi.fn(async () => { throw new Error("x"); }) };
    expect(await authorizeRoadUpgrade({ ...base, policy: boom, principal: anna })).toBe(false);
    expect(await authorizeRoadUpgrade({ ...base, policy: policy(() => "yes"), principal: anna })).toBe(false);
  });
});
