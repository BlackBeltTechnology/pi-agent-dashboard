import { describe, expect, it } from "vitest";
import {
  createPendingPrincipalOwnerRegistry,
  PENDING_PRINCIPAL_OWNER_TTL_MS,
} from "../pending-principal-owner-registry.js";

const owner = { iss: "https://kc/realms/app", sub: "user-1" };

describe("pending-principal-owner-registry (§6.2 / D11)", () => {
  it("files before the spawn await and resolves on register (correlation)", () => {
    const reg = createPendingPrincipalOwnerRegistry();
    expect(reg.file("tok-1", owner)).toBe(true);
    // An event/register arriving during the await resolves the pre-filed owner.
    expect(reg.resolve("tok-1")).toEqual(owner);
  });

  it("resolve consumes the entry (single-use)", () => {
    const reg = createPendingPrincipalOwnerRegistry();
    reg.file("tok", owner);
    expect(reg.resolve("tok")).toEqual(owner);
    expect(reg.resolve("tok")).toBeNull();
    expect(reg.size()).toBe(0);
  });

  it("stores nothing for a malformed owner or empty token (ownerless)", () => {
    const reg = createPendingPrincipalOwnerRegistry();
    expect(reg.file("tok", { iss: "", sub: "s" })).toBe(false);
    expect(reg.file("tok", { iss: "i" })).toBe(false);
    expect(reg.file("tok", null)).toBe(false);
    expect(reg.file("", owner)).toBe(false);
    expect(reg.size()).toBe(0);
  });

  it("copies + freezes the owner so a later caller mutation cannot change it", () => {
    const reg = createPendingPrincipalOwnerRegistry();
    const mutable = { iss: "i", sub: "s" };
    reg.file("tok", mutable);
    mutable.sub = "attacker";
    expect(reg.resolve("tok")).toEqual({ iss: "i", sub: "s" });
  });

  it("drops entries past the TTL (register too late ⇒ ownerless)", () => {
    let t = 1000;
    const reg = createPendingPrincipalOwnerRegistry({ now: () => t });
    reg.file("tok", owner);
    t += PENDING_PRINCIPAL_OWNER_TTL_MS + 1;
    expect(reg.resolve("tok")).toBeNull();
  });

  it("remove is idempotent and token-scoped", () => {
    const reg = createPendingPrincipalOwnerRegistry();
    reg.file("a", owner);
    reg.file("b", owner);
    reg.remove("a");
    reg.remove("a");
    expect(reg.resolve("a")).toBeNull();
    expect(reg.resolve("b")).toEqual(owner);
  });
});
