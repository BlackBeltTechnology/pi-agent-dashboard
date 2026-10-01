/**
 * `GET /api/identity/me` payload (D24, task 18.28): who am I + what the host
 * policy lets me do, so a UI can hide what it would deny. The server still
 * enforces every road; `can` is advisory.
 */
import type { Principal } from "@blackbelt-technology/pi-dashboard-shared/identity.js";
import { describe, expect, it, vi } from "vitest";
import { CORE_ME_ACTIONS, identityMe } from "../identity-me.js";
import { LOCAL_OPERATOR } from "../session-access.js";

const anna: Principal = { iss: "https://kc/realms/app", sub: "anna", email: "anna@x" };
const noPolicy = { hasPolicy: () => false, authorize: vi.fn() };

describe("identityMe", () => {
  it("lists every core family action, never the domain-event road", () => {
    expect(CORE_ME_ACTIONS).toContain("config.write");
    expect(CORE_ME_ACTIONS).toContain("terminal.create");
    expect(CORE_ME_ACTIONS).not.toContain("domain.event");
  });

  it("inert ⇒ enforced:false, everything allowed, policy not consulted", async () => {
    const me = await identityMe({ enforced: false, principal: null, policy: noPolicy });
    expect(me.enforced).toBe(false);
    expect(me.principal).toBeNull();
    expect(Object.values(me.can).every(Boolean)).toBe(true);
    expect(noPolicy.authorize).not.toHaveBeenCalled();
  });

  it("enforced, no policy ⇒ principal echoed (iss/sub/email only), everything allowed", async () => {
    const me = await identityMe({ enforced: true, principal: { ...anna, extra: "x" } as Principal, policy: noPolicy });
    expect(me.principal).toEqual({ iss: anna.iss, sub: anna.sub, email: "anna@x" });
    expect(me.can["system.write"]).toBe(true);
  });

  it("enforced + policy ⇒ each action asked once, with the family resource kind", async () => {
    const authorize = vi.fn(async ({ action }: { action: string }) => action.endsWith(".read"));
    const me = await identityMe({ enforced: true, principal: anna, policy: { hasPolicy: () => true, authorize } });
    expect(me.can["config.read"]).toBe(true);
    expect(me.can["config.write"]).toBe(false);
    expect(authorize).toHaveBeenCalledTimes(CORE_ME_ACTIONS.length);
    expect(authorize).toHaveBeenCalledWith({ principal: anna, action: "terminal.create", resource: { kind: "terminal" } });
  });

  it("enforced + policy + no principal ⇒ nothing allowed", async () => {
    const authorize = vi.fn();
    const me = await identityMe({ enforced: true, principal: null, policy: { hasPolicy: () => true, authorize } });
    expect(Object.values(me.can).some(Boolean)).toBe(false);
    expect(authorize).not.toHaveBeenCalled();
  });

  it("local operator ⇒ flagged and allowed everything (break-glass)", async () => {
    const authorize = vi.fn();
    const me = await identityMe({ enforced: true, principal: LOCAL_OPERATOR, policy: { hasPolicy: () => true, authorize } });
    expect(me.localOperator).toBe(true);
    expect(Object.values(me.can).every(Boolean)).toBe(true);
    expect(authorize).not.toHaveBeenCalled();
  });
});
