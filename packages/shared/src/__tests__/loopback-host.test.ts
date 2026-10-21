import { describe, expect, it } from "vitest";
import { isLoopbackEndpoint, isLoopbackHost } from "../loopback-host.js";

/** Shared loopback predicate (test-plan #E25). See change: mirror-dashboard-trust-live-remote. */
describe("loopback host predicate (#E25)", () => {
  it.each([
    ["127.0.0.1", true],
    ["127.0.0.2", true],
    ["::1", true],
    ["[::1]", true],
    ["localhost", true],
    ["LOCALHOST", true],
    ["[::ffff:127.0.0.1]", true],
    ["::ffff:127.0.0.1", true],
    ["10.0.0.5", false],
    ["192.168.1.2", false],
    ["example.com", false],
    ["", false],
    ["126.0.0.1", false],
  ])("%s → %s", (host, expected) => {
    expect(isLoopbackHost(host)).toBe(expected);
  });

  it("classifies endpoints the same way the host predicate does", () => {
    expect(isLoopbackEndpoint("ws://127.0.0.1:8001")).toBe(true);
    expect(isLoopbackEndpoint("ws://[::1]:8001")).toBe(true);
    expect(isLoopbackEndpoint("ws://localhost:8001")).toBe(true);
    expect(isLoopbackEndpoint("ws+unix:/tmp/x.sock")).toBe(true);
    expect(isLoopbackEndpoint("wss://dash.example.com")).toBe(false);
    expect(isLoopbackEndpoint("ws://10.0.0.5:8001")).toBe(false);
    expect(isLoopbackEndpoint("not a url")).toBe(false);
  });
});
