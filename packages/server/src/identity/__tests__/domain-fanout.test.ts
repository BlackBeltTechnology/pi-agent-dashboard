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
