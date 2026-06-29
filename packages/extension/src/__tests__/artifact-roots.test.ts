/**
 * Tests for the bridge's artifact-root allowlist (Fix B containment).
 * See change: inline-agent-screenshot-artifacts.
 */
import { describe, it, expect } from "vitest";
import { resolveArtifactRoots, isUnderArtifactRoot } from "../artifact-roots.js";

/** realpathSync stub: returns mapped value, throws ENOENT for unknown paths. */
function fakeRealpath(map: Record<string, string>) {
  return (p: string): string => {
    if (p in map) return map[p];
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  };
}

describe("resolveArtifactRoots", () => {
  it("includes the default agent-browser tmp dir when it resolves", () => {
    const roots = resolveArtifactRoots({
      homedir: "/home/pi",
      env: {},
      realpathSync: fakeRealpath({ "/home/pi/.agent-browser/tmp": "/home/pi/.agent-browser/tmp" }),
    });
    expect(roots).toEqual(["/home/pi/.agent-browser/tmp"]);
  });

  it("adds AGENT_BROWSER_SCREENSHOT_DIR when set", () => {
    const roots = resolveArtifactRoots({
      homedir: "/home/pi",
      env: { AGENT_BROWSER_SCREENSHOT_DIR: "/shots" },
      realpathSync: fakeRealpath({
        "/home/pi/.agent-browser/tmp": "/home/pi/.agent-browser/tmp",
        "/shots": "/real/shots",
      }),
    });
    expect(roots).toEqual(["/home/pi/.agent-browser/tmp", "/real/shots"]);
  });

  it("drops roots that do not resolve (missing dir)", () => {
    const roots = resolveArtifactRoots({
      homedir: "/home/pi",
      env: {},
      realpathSync: fakeRealpath({}), // nothing resolves
    });
    expect(roots).toEqual([]);
  });
});

describe("isUnderArtifactRoot", () => {
  const roots = ["/home/pi/.agent-browser/tmp"];
  const rp = fakeRealpath({
    "/home/pi/.agent-browser/tmp/shot.png": "/home/pi/.agent-browser/tmp/shot.png",
    "/home/pi/.agent-browser/tmp/sub/a.png": "/home/pi/.agent-browser/tmp/sub/a.png",
    "/etc/passwd.png": "/etc/passwd.png",
    "/home/pi/secret.png": "/home/pi/secret.png",
    // symlink escape: realpath resolves outside the root
    "/home/pi/.agent-browser/tmp/evil.png": "/etc/shadow.png",
  });

  it("accepts a file directly inside a root", () => {
    expect(isUnderArtifactRoot("/home/pi/.agent-browser/tmp/shot.png", roots, rp)).toBe(true);
  });

  it("accepts a nested file", () => {
    expect(isUnderArtifactRoot("/home/pi/.agent-browser/tmp/sub/a.png", roots, rp)).toBe(true);
  });

  it("rejects a path outside every root", () => {
    expect(isUnderArtifactRoot("/etc/passwd.png", roots, rp)).toBe(false);
    expect(isUnderArtifactRoot("/home/pi/secret.png", roots, rp)).toBe(false);
  });

  it("rejects a symlink whose realpath escapes the root", () => {
    expect(isUnderArtifactRoot("/home/pi/.agent-browser/tmp/evil.png", roots, rp)).toBe(false);
  });

  it("rejects a non-existent path (realpath throws)", () => {
    expect(isUnderArtifactRoot("/home/pi/.agent-browser/tmp/missing.png", roots, rp)).toBe(false);
  });

  it("rejects everything when the root list is empty", () => {
    expect(isUnderArtifactRoot("/home/pi/.agent-browser/tmp/shot.png", [], rp)).toBe(false);
  });
});
