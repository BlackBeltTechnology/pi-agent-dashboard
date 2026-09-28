/**
 * `isLoopbackRange` boundary values (test-plan #E4).
 * See change: fix-trusted-network-tunnel-bypass (D1).
 */
import { describe, expect, it } from "vitest";
import { isLoopback, isLoopbackRange } from "../auth/loopback.js";

describe("E4 isLoopbackRange boundaries", () => {
  const cases: Array<[string, boolean]> = [
    ["126.255.255.255", false],
    ["127.0.0.0", true],
    ["127.255.255.255", true],
    ["128.0.0.0", false],
    ["::1", true],
    ["::2", false],
    ["::FFFF:127.0.0.1", true],
    ["::ffff:128.0.0.1", false],
    ["localhost", false],
    ["", false],
  ];
  it.each(cases)("isLoopbackRange(%j) === %s", (ip, expected) => {
    expect(isLoopbackRange(ip)).toBe(expected);
  });

  it("covers every textual form of an IPv4-mapped / IPv6 loopback address", () => {
    for (const ip of ["::ffff:7f00:1", "0:0:0:0:0:ffff:7f00:1", "0:0:0:0:0:0:0:1", "0::1", "::FFFF:7F00:5"]) {
      expect(isLoopbackRange(ip), ip).toBe(true);
    }
    for (const ip of ["::ffff:8000:1", "fe80::1", "::"]) {
      expect(isLoopbackRange(ip), ip).toBe(false);
    }
  });

  it("rejects malformed dotted quads", () => {
    expect(isLoopbackRange("127.0.0.256")).toBe(false);
    expect(isLoopbackRange("127.0.0")).toBe(false);
    expect(isLoopbackRange("127.0.0.1.evil")).toBe(false);
  });

  it("leaves the set-based isLoopback unwidened", () => {
    expect(isLoopback("127.0.0.5")).toBe(false);
    expect(isLoopbackRange("127.0.0.5")).toBe(true);
  });
});
