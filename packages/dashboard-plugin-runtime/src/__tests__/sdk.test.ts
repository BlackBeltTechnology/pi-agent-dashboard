/**
 * `./sdk` pure helpers (test-plan #E25; change: decouple-plugins-from-core).
 *
 * @structural-pin the sdk is bundled into plugins, so "no react import" is a property of the source import specifiers that only the text can show
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as sdk from "../sdk.js";

describe("./sdk folder codec", () => {
  it("round-trips non-ASCII and spaces", () => {
    const cwd = "/Users/a b/ü";
    expect(sdk.decodeFolderPath(sdk.encodeFolderPath(cwd))).toBe(cwd);
  });

  it("encodes URL-safe base64 without padding", () => {
    const enc = sdk.encodeFolderPath("/a/b?>~");
    expect(enc).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("decodeFolderPath returns null for malformed input", () => {
    expect(sdk.decodeFolderPath("%%%")).toBeNull();
  });

  it("folderRouteHref normalises the suffix", () => {
    const enc = sdk.encodeFolderPath("/x");
    expect(sdk.folderRouteHref("/x")).toBe(`/folder/${enc}`);
    expect(sdk.folderRouteHref("/x", "/goals")).toBe(`/folder/${enc}/goals`);
    expect(sdk.folderRouteHref("/x", "goals")).toBe(`/folder/${enc}/goals`);
    expect(sdk.folderRouteHref("/x", "/view?path=a")).toBe(`/folder/${enc}/view?path=a`);
    expect(sdk.folderRouteHref("/x", "?path=a")).toBe(`/folder/${enc}?path=a`);
  });
});

describe("./sdk surface", () => {
  it("exports the pure helpers and constants", () => {
    expect(sdk.satisfiesHostApiRange("1.2.0", "^1.0.0")).toBe(true);
    expect(sdk.HOST_FX_CLASSES.stripes).toBe("card-stripes-fx");
    expect(sdk.UI_PRIMITIVE_KEYS.confirmDialog).toBe("ui:confirm-dialog");
  });

  it("never exports the host's version or the bound check", () => {
    expect("PLUGIN_HOST_API_VERSION" in sdk).toBe(false);
    expect("satisfiesHostApi" in sdk).toBe(false);
  });

  it("is side-effect-free: the source imports neither react nor local modules", () => {
    const src = fs.readFileSync(path.resolve(import.meta.dirname, "../sdk.ts"), "utf8");
    const specs = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    expect(specs.length).toBeGreaterThan(0);
    for (const s of specs) {
      expect(s.startsWith("@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/"), s).toBe(true);
    }
    expect(src).not.toMatch(/\breact\b/);
  });
});
