import { describe, expect, it } from "vitest";
import { sourceChannel } from "../source-channel.js";

/** Remote requester keys by allocation (change: add-access-grant-dialog, D9 resolved). */
describe("sourceChannel keys a remote requester by its allocation", () => {
  it("IPv4 keys on the /24", () => {
    expect(sourceChannel("203.0.113.9")).toBe("source:203.0.113.0/24");
    expect(sourceChannel("203.0.113.200")).toBe(sourceChannel("203.0.113.9"));
    expect(sourceChannel("203.0.114.9")).not.toBe(sourceChannel("203.0.113.9"));
  });

  it("IPv4-mapped IPv6 is the IPv4 source", () => {
    expect(sourceChannel("::ffff:203.0.113.9")).toBe("source:203.0.113.0/24");
  });

  it("IPv6 keys on the /64, whatever the spelling", () => {
    const a = sourceChannel("2001:db8:1:2::1");
    expect(a).toBe("source:2001:db8:1:2::/64");
    expect(sourceChannel("2001:0db8:0001:0002:ffff:eeee:dddd:cccc")).toBe(a);
    expect(sourceChannel("2001:db8:1:3::1")).not.toBe(a);
    expect(sourceChannel("fe80::1%en0")).toBe("source:fe80:0:0:0::/64");
    expect(sourceChannel("::1")).toBe("source:0:0:0:0::/64");
  });

  it("anything else keys as given, never as a shared bucket by accident", () => {
    expect(sourceChannel(undefined)).toBe("source:unknown");
    expect(sourceChannel("not-an-ip")).toBe("source:not-an-ip");
  });
});
