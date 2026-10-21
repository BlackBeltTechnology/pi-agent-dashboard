/**
 * Extracted realpath / allowlist / `.gz` helpers (task 6.8). `app-mount.test.ts` pins the no-behaviour-change
 * side; these pin the helper contracts the `/plugin-assets` route (task 6.10) reuses.
 *
 * See change: decouple-plugins-from-core (design D13).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  acceptsGzip,
  canonicalize,
  isWithin,
  PLUGIN_ASSET_MIME,
  parseSegments,
  pickVariant,
  realFileWithin,
  STATIC_MIME,
} from "../confined-static.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "confined-static-")));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("allowlists", () => {
  it("the plugin-asset list is code, styles, fonts, images: no html / wasm / map / json", () => {
    for (const ext of [".js", ".mjs", ".css", ".woff2", ".png", ".svg"]) expect(PLUGIN_ASSET_MIME[ext]).toBeDefined();
    for (const ext of [".html", ".wasm", ".map", ".json", ".gz"]) expect(PLUGIN_ASSET_MIME[ext]).toBeUndefined();
    expect(STATIC_MIME[".html"]).toBeDefined();
  });
});

describe("parseSegments", () => {
  const prefix = "/plugin-assets/ext/abc";
  it("accepts allowlisted paths and refuses traversal, dotfiles, NUL, backslash, bad escapes, other extensions", () => {
    expect(parseSegments(`${prefix}/dist/a.js`, prefix, PLUGIN_ASSET_MIME)).toEqual(["dist", "a.js"]);
    for (const bad of ["/../x.js", "/.hidden.js", "/a%00.js", "/a%5Cb.js", "/%E0%A4%A.js", "/client.js.map", "/package.json", "/index.html"]) {
      expect(parseSegments(prefix + bad, prefix, PLUGIN_ASSET_MIME)).toBeNull();
    }
    expect(parseSegments("/other/a.js", prefix, PLUGIN_ASSET_MIME)).toBeNull();
  });
});

describe("realpath confinement", () => {
  it("isWithin / canonicalize / realFileWithin refuse symlink escapes and directories", () => {
    const root = path.join(tmp, "root");
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, "a.js"), "1");
    fs.writeFileSync(path.join(tmp, "out.js"), "2");
    fs.symlinkSync(path.join(tmp, "out.js"), path.join(root, "link.js"));
    expect(isWithin(path.join(root, "a.js"), root)).toBe(true);
    expect(isWithin(`${root}-sibling/a.js`, root)).toBe(false);
    expect(realFileWithin(path.join(root, "a.js"), root)?.size).toBe(1);
    expect(realFileWithin(path.join(root, "link.js"), root)).toBeNull();
    expect(realFileWithin(root, root)).toBeNull();
    expect(canonicalize(path.join(root, "missing", "x"))).toBe(path.join(root, "missing", "x"));
  });
});

describe(".gz negotiation", () => {
  it("accepts gzip unless q=0; picks the .gz sibling only for a gzip client", () => {
    expect(acceptsGzip("gzip, br")).toBe(true);
    expect(acceptsGzip("gzip;q=0")).toBe(false);
    expect(acceptsGzip(undefined)).toBe(false);
    fs.writeFileSync(path.join(tmp, "c.js"), "plain");
    fs.writeFileSync(path.join(tmp, "c.js.gz"), "gz");
    const real = path.join(tmp, "c.js");
    expect(pickVariant(real, tmp, "gzip")).toMatchObject({ gzipped: true, hasVariant: true });
    expect(pickVariant(real, tmp, undefined)).toMatchObject({ gzipped: false, hasVariant: true });
  });
});
