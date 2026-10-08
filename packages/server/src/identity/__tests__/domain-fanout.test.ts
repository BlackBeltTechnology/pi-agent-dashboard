import type { Principal } from "@blackbelt-technology/pi-dashboard-shared/identity.js";
import { describe, expect, it, vi } from "vitest";
import { deliverDomainEvent, type FanoutTarget } from "../domain-fanout.js";
import { HostActions, hostResource } from "../host-resources.js";

const anna: Principal = { iss: "https://kc/realms/app", sub: "anna" };
const bela: Principal = { iss: "https://kc/realms/app", sub: "bela" };
const resource = hostResource.domain("goal-plugin", "goal_status");

function targets(): FanoutTarget<string>[] {
  return [
    { socket: "anna-sock", principal: anna },
    { socket: "bela-sock", principal: bela },
    { socket: "anon-sock", principal: null },
  ];
}

describe("deliverDomainEvent (§10)", () => {
  it("no policy ⇒ delivers to every socket (unchanged broadcast)", async () => {
    const send = vi.fn();
    const policy = { hasPolicy: () => false, authorize: vi.fn() };
    const out = await deliverDomainEvent(targets(), HostActions.domainEvent, resource, policy, send);
    expect(out).toEqual(["anna-sock", "bela-sock", "anon-sock"]);
    expect(send).toHaveBeenCalledTimes(3);
    expect(policy.authorize).not.toHaveBeenCalled();
  });

  it("policy ⇒ delivers only to authorized sockets, per candidate", async () => {
    const send = vi.fn();
    const policy = {
      hasPolicy: () => true,
      authorize: vi.fn(async ({ principal }) => principal.sub === "anna"),
    };
    const out = await deliverDomainEvent(targets(), HostActions.domainEvent, resource, policy, send);
    expect(out).toEqual(["anna-sock"]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("anna-sock");
    // Called once per principal-bearing socket (anna, bela) — never for anon.
    expect(policy.authorize).toHaveBeenCalledTimes(2);
  });

  it("principal-less socket receives nothing under a policy", async () => {
    const send = vi.fn();
    const policy = { hasPolicy: () => true, authorize: vi.fn(async () => true) };
    const out = await deliverDomainEvent(
      [{ socket: "anon", principal: null }],
      HostActions.domainEvent,
      resource,
      policy,
      send,
    );
    expect(out).toEqual([]);
    expect(send).not.toHaveBeenCalled();
    expect(policy.authorize).not.toHaveBeenCalled();
  });

  it("a policy denial (authorize false) drops that socket", async () => {
    const send = vi.fn();
    const policy = { hasPolicy: () => true, authorize: vi.fn(async () => false) };
    const out = await deliverDomainEvent(targets(), HostActions.domainEvent, resource, policy, send);
    expect(out).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("deliverDomainEvent — break-glass operator (D23)", () => {
  it("the local operator receives every domain event under a policy, without consulting it", async () => {
    const { LOCAL_OPERATOR } = await import("../session-access.js");
    const send = vi.fn();
    const policy = { hasPolicy: () => true, authorize: vi.fn(async () => false) };
    const out = await deliverDomainEvent(
      [{ socket: "op", principal: LOCAL_OPERATOR }, { socket: "anna", principal: anna }],
      HostActions.domainEvent,
      resource,
      policy,
      send,
    );
    expect(out).toEqual(["op"]);
    expect(policy.authorize).toHaveBeenCalledTimes(1); // anna only
  });
});

describe("deliverDomainEvent — decisions run concurrently, delivery stays ordered (CodeRabbit r1)", () => {
  it("N slow policy calls cost ~one timeout, not N× (no head-of-line stall), and sockets are served in target order", async () => {
    const targets = Array.from({ length: 6 }, (_, i) => ({ socket: `s${i}`, principal: { iss: "https://idp", sub: `u${i}` } as Principal }));
    const policy = { hasPolicy: () => true, authorize: vi.fn(async () => { await new Promise((r) => setTimeout(r, 80)); return true; }) };
    const sent: string[] = [];
    const t0 = Date.now();
    const out = await deliverDomainEvent(targets, HostActions.domainEvent, resource, policy, (s) => sent.push(s));
    expect(Date.now() - t0).toBeLessThan(80 * 3); // sequential would be ≥ 480 ms
    expect(out).toEqual(["s0", "s1", "s2", "s3", "s4", "s5"]);
    expect(sent).toEqual(out);
  });

  it("a denied/throwing socket in the middle neither blocks nor reorders the others", async () => {
    const targets = ["a", "b", "c", "d"].map((s) => ({ socket: s, principal: { iss: "https://idp", sub: s } as Principal }));
    const policy = {
      hasPolicy: () => true,
      authorize: vi.fn(async ({ principal }: { principal: Principal }) => {
        if (principal.sub === "b") return false;
        if (principal.sub === "c") throw new Error("boom");
        return true;
      }),
    };
    const out = await deliverDomainEvent(targets, HostActions.domainEvent, resource, policy as never, () => {});
    expect(out).toEqual(["a", "d"]);
  });
});
