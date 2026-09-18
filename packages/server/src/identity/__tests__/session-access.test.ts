import { describe, expect, it } from "vitest";
import { createPendingPrincipalOwnerRegistry } from "../../pending/pending-principal-owner-registry.js";
import { canAccessSession, filterSnapshotForPrincipal, gateHttpSession } from "../session-access.js";

const owner = { iss: "https://kc/realms/app", sub: "user-1" };
const other = { iss: "https://kc/realms/app", sub: "user-2" };

describe("canAccessSession (§8 / D11)", () => {
  it("allows everything when the resolver is inert", () => {
    expect(canAccessSession({ active: false, principal: null, owner: undefined })).toBe(true);
    expect(canAccessSession({ active: false, principal: owner, owner })).toBe(true);
    expect(canAccessSession({ active: false, principal: null, owner })).toBe(true);
  });

  it("allows the exact owner when active", () => {
    expect(canAccessSession({ active: true, principal: { ...owner }, owner })).toBe(true);
  });

  it("refuses a non-owner when active", () => {
    expect(canAccessSession({ active: true, principal: other, owner })).toBe(false);
  });

  it("refuses a principal-less requester every owned session when active", () => {
    expect(canAccessSession({ active: true, principal: null, owner })).toBe(false);
  });

  it("refuses an ownerless session to any human principal when active", () => {
    expect(canAccessSession({ active: true, principal: owner, owner: undefined })).toBe(false);
    expect(canAccessSession({ active: true, principal: null, owner: undefined })).toBe(false);
  });

  it("requires BOTH iss and sub to match (no partial, no normalization)", () => {
    expect(canAccessSession({ active: true, principal: { iss: owner.iss, sub: "x" }, owner })).toBe(false);
    expect(canAccessSession({ active: true, principal: { iss: "x", sub: owner.sub }, owner })).toBe(false);
  });
});

// §11.4 — non-human principal policy: an automation / host-internal spawn runs
// in-process, carries no principal, and files no spawn-owner token, so its
// session is ownerless BY CONSTRUCTION and is invisible/immutable to every
// human once the plane is active. This composes the two mechanisms end to end.
describe("scheduler-spawned session is ownerless and hidden from humans (§11.4)", () => {
  it("a spawn that files no owner token resolves ownerless, then is denied to any human", () => {
    const pending = createPendingPrincipalOwnerRegistry();
    // Non-human spawn road never called `file(...)`; register resolves nothing.
    const resolvedOwner = pending.resolve("scheduler-spawn-token");
    expect(resolvedOwner).toBeNull(); // ownerless by construction

    // The resulting ownerless session is hidden from a human principal…
    expect(canAccessSession({ active: true, principal: owner, owner: resolvedOwner })).toBe(false);
    // …and from a principal-less socket, while inert access is unchanged.
    expect(canAccessSession({ active: true, principal: null, owner: resolvedOwner })).toBe(false);
    expect(canAccessSession({ active: false, principal: owner, owner: resolvedOwner })).toBe(true);
  });
});

describe("filterSnapshotForPrincipal (§8.2)", () => {
  const snap = {
    sessions: [
      { id: "a", principalOwner: owner },
      { id: "b", principalOwner: other },
      { id: "c" }, // ownerless
    ],
    orders: { g1: ["a", "b"], g2: ["c"] },
    endedTotals: { g1: 3, g2: 1 },
  };

  it("passes through unchanged when inert", () => {
    expect(filterSnapshotForPrincipal(snap, false, owner)).toBe(snap);
  });

  it("returns only the principal's own sessions when active", () => {
    const out = filterSnapshotForPrincipal(snap, true, owner);
    expect(out.sessions.map((s) => s.id)).toEqual(["a"]);
    expect(out.orders).toEqual({ g1: ["a"] }); // b removed, g2 dropped (empty)
    expect(out.endedTotals).toEqual({ g1: 3 }); // g2 dropped
  });

  it("the other principal sees only its own, never the full registry", () => {
    const out = filterSnapshotForPrincipal(snap, true, other);
    expect(out.sessions.map((s) => s.id)).toEqual(["b"]);
    expect(out.orders).toEqual({ g1: ["b"] });
  });

  it("a principal-less socket sees nothing when active", () => {
    const out = filterSnapshotForPrincipal(snap, true, null);
    expect(out.sessions).toEqual([]);
    expect(out.orders).toEqual({});
    expect(out.endedTotals).toEqual({});
  });
});

describe("gateHttpSession (§8.1)", () => {
  const makeReply = () => {
    const codes: number[] = [];
    return { code: (n: number) => codes.push(n), codes };
  };

  it("proceeds for the exact owner (no reply code)", () => {
    const reply = makeReply();
    expect(gateHttpSession(reply, true, owner, owner)).toBe(true);
    expect(reply.codes).toEqual([]);
  });

  it("replies 404 for a non-owner (no owned-vs-not-found oracle)", () => {
    const reply = makeReply();
    expect(gateHttpSession(reply, true, other, owner)).toBe(false);
    expect(reply.codes).toEqual([404]);
  });

  it("replies 404 for a principal-less request and an ownerless session", () => {
    const r1 = makeReply();
    expect(gateHttpSession(r1, true, null, owner)).toBe(false);
    expect(r1.codes).toEqual([404]);
    const r2 = makeReply();
    expect(gateHttpSession(r2, true, owner, undefined)).toBe(false);
    expect(r2.codes).toEqual([404]);
  });

  it("proceeds unconditionally when inert", () => {
    const reply = makeReply();
    expect(gateHttpSession(reply, false, null, undefined)).toBe(true);
    expect(reply.codes).toEqual([]);
  });
});
