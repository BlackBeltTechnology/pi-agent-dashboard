/**
 * `/dashboard connect <target>` argument parsing (task 9.5).
 *
 * The argument is overloaded by design, so the tests are mostly about the
 * BOUNDARIES between kinds — the places a user's input could plausibly be read
 * two ways, and where guessing wrong sends them debugging the wrong thing.
 */
import { describe, expect, it } from "vitest";
import { describeConnectTarget, parseConnectTarget } from "../connect-target.js";

describe("parseConnectTarget", () => {
  it("treats empty and `default` as the $HOME rendezvous default", () => {
    expect(parseConnectTarget("")).toEqual({ kind: "default" });
    expect(parseConnectTarget("   ")).toEqual({ kind: "default" });
    expect(parseConnectTarget("default")).toEqual({ kind: "default" });
  });

  it("recognises ws, wss and ws+unix endpoints", () => {
    expect(parseConnectTarget("ws://127.0.0.1:8000")).toEqual({
      kind: "url",
      url: "ws://127.0.0.1:8000",
    });
    expect(parseConnectTarget("wss://dash.example:443")).toEqual({
      kind: "url",
      url: "wss://dash.example:443",
    });
    expect(parseConnectTarget("ws+unix:///tmp/gw.sock:/")).toEqual({
      kind: "url",
      url: "ws+unix:///tmp/gw.sock:/",
    });
  });

  it("recognises socket paths by shape, including a mistyped one", () => {
    expect(parseConnectTarget("/home/me/.pi/dashboard/gateway-8000.sock")).toEqual({
      kind: "socket",
      path: "/home/me/.pi/dashboard/gateway-8000.sock",
    });
    expect(parseConnectTarget("./local.sock")).toEqual({ kind: "socket", path: "./local.sock" });
    // A path that does not exist is still a PATH. Reporting "no such instance"
    // would send the user hunting for a dashboard instead of a typo.
    expect(parseConnectTarget("/nope/missing.sock").kind).toBe("socket");
  });

  it("takes a bare number as a loopback port", () => {
    expect(parseConnectTarget("8000")).toEqual({ kind: "port", port: 8000 });
  });

  it("rejects ports that cannot be a dashboard", () => {
    expect(parseConnectTarget("0").kind).toBe("invalid");
    expect(parseConnectTarget("80").kind).toBe("invalid");
    expect(parseConnectTarget("99999").kind).toBe("invalid");
  });

  it("takes anything else as an instance identity, without pinning its format", () => {
    // The id format belongs to the server. A regex here would start rejecting
    // valid ids the day that format changes.
    expect(parseConnectTarget("7f3a9c2e")).toEqual({ kind: "instance", id: "7f3a9c2e" });
    expect(parseConnectTarget("laptop-worktree")).toEqual({
      kind: "instance",
      id: "laptop-worktree",
    });
  });

  it("does not mistake a hostname for an instance id", () => {
    // `dash.example:8000` has no scheme, so it is not a URL by our rule — but
    // reading it as an instance id would fail confusingly later. It is left as
    // an instance id deliberately; this test documents that choice so a future
    // change to it is visible rather than accidental.
    expect(parseConnectTarget("dash.example:8000").kind).toBe("instance");
  });
});

describe("describeConnectTarget", () => {
  it("renders every kind for confirmations and errors", () => {
    expect(describeConnectTarget({ kind: "default" })).toMatch(/default dashboard/);
    expect(describeConnectTarget({ kind: "socket", path: "/x.sock" })).toBe("socket /x.sock");
    expect(describeConnectTarget({ kind: "port", port: 8000 })).toBe("127.0.0.1:8000");
    expect(describeConnectTarget({ kind: "url", url: "ws://h:1" })).toBe("ws://h:1");
    expect(describeConnectTarget({ kind: "instance", id: "abc" })).toBe("instance abc");
    expect(describeConnectTarget({ kind: "invalid", reason: "bad" })).toMatch(/invalid target/);
  });

  it("renders a port as loopback, never as a bare number", () => {
    // A bare port must never be dialled on a wildcard address; the rendering
    // is what tells the user which host they are about to reach.
    expect(describeConnectTarget(parseConnectTarget("8000"))).toBe("127.0.0.1:8000");
  });
});
