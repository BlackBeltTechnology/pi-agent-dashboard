/**
 * Path-safe subpath derivation (design D5) — test-plan #E9.
 *
 * The regression this pins: `resolution.path` is native-separator, so the
 * `/\/dist\/index\.js$/` regex the registry used silently no-ops on Windows.
 * A no-op is worse than an error, because it produces a wrong path that then
 * fails somewhere unrelated.
 *
 * See change: adopt-piai-factory-api-registry.
 */
import { sep } from "node:path";
import { describe, expect, it } from "vitest";
import { derivePiAiSubpath, piAiDistDir } from "../subpath.js";

describe("piAiDistDir", () => {
  it("derives the dist dir from a POSIX resolved path", () => {
    expect(piAiDistDir("/a/b/node_modules/@earendil-works/pi-ai/dist/index.js")).toBe(
      ["", "a", "b", "node_modules", "@earendil-works", "pi-ai", "dist"].join(sep),
    );
  });

  // test-plan #E9 — the Windows half. A native-separator path must derive,
  // not silently no-op.
  it("derives the dist dir from a Windows-style resolved path", () => {
    const out = piAiDistDir("C:\\src\\node_modules\\@earendil-works\\pi-ai\\dist\\index.js");
    expect(out.endsWith(`pi-ai${sep}dist`)).toBe(true);
  });

  // test-plan #E9 — the error half. MUST throw, never return something unusable.
  it("throws with the resolved path when the entry basename does not match", () => {
    const bad = "/a/b/pi-ai/dist/entry.js";
    expect(() => piAiDistDir(bad)).toThrowError(new RegExp(bad.replace(/\//g, "\\/")));
  });

  it("throws when the entry is not inside a dist directory", () => {
    expect(() => piAiDistDir("/a/b/pi-ai/lib/index.js")).toThrow(/lib\/index\.js/);
  });

  it("throws on an empty path rather than deriving from cwd", () => {
    expect(() => piAiDistDir("")).toThrow(/no resolved module path/);
  });
});

describe("derivePiAiSubpath", () => {
  it("joins a slash-separated relative path under dist", () => {
    const out = derivePiAiSubpath("/a/pi-ai/dist/index.js", "api/anthropic-messages.lazy.js");
    expect(out).toBe(["", "a", "pi-ai", "dist", "api", "anthropic-messages.lazy.js"].join(sep));
  });

  it("joins a nested relative path", () => {
    const out = derivePiAiSubpath("/a/pi-ai/dist/index.js", "auth/oauth/load.js");
    expect(out.endsWith(["dist", "auth", "oauth", "load.js"].join(sep))).toBe(true);
  });

  it("propagates the derivation error for a non-matching path", () => {
    expect(() => derivePiAiSubpath("/a/pi-ai/build/main.js", "providers/all.js")).toThrow(
      /build\/main\.js/,
    );
  });
});
