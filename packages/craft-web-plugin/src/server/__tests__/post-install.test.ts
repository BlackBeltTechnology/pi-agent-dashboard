/**
 * E13 — post-install: externalised Trunk bootstrap, shim injection, idempotence, `.gz` siblings (no `.br`),
 * `craft-build.json`. See change: edit-office-in-pane-with-craft-web (D2, task 4.1).
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { BUILD_INFO_FILE, createPostInstall, readBuildInfo } from "../post-install.js";
import { cleanupTmp, TRUNK_BOOTSTRAP, tmp, writeShim, writeTrunkBuild } from "./helpers.js";

afterEach(cleanupTmp);

const ctx = (dir: string, shimVersion = 1) => ({ dir, app: "wordcraft" as const, version: "0.8.0", shimVersion });

function setup(o: { br?: boolean } = {}) {
  const dir = writeTrunkBuild(path.join(tmp(), "tree"), o);
  const shim = writeShim(tmp(), 1);
  return { dir, run: createPostInstall(shim) };
}

const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

describe("craft-web post-install (E13)", () => {
  it("leaves no inline script and references the bootstrap and the shim exactly once", async () => {
    const { dir, run } = setup();
    await run(ctx(dir));
    const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
    const files = fs.readdirSync(dir);
    const bootstrap = files.find((f) => /^bootstrap-[0-9a-f]{10}\.js$/.test(f));
    const shim = files.find((f) => /^craft-shim-[0-9a-f]{10}\.js$/.test(f));
    expect(bootstrap && shim).toBeTruthy();
    expect(count(html, `./${bootstrap}`)).toBe(1);
    expect(count(html, `./${shim}`)).toBe(1);
    expect(fs.readFileSync(path.join(dir, bootstrap as string), "utf8")).toBe(TRUNK_BOOTSTRAP);
    // the classic shim runs before the module bootstrap
    expect(html.indexOf(shim as string)).toBeLessThan(html.indexOf(bootstrap as string));
    expect(html).toContain("<!-- craft-shim:1 -->");
    // a `type="module"` bootstrap stays a module
    expect(html).toMatch(new RegExp(`<script type="module" src="./${bootstrap}"`));
  });

  it("is idempotent on a rerun", async () => {
    const { dir, run } = setup();
    await run(ctx(dir));
    const first = fs.readFileSync(path.join(dir, "index.html"), "utf8");
    const names = fs.readdirSync(dir).sort();
    await run(ctx(dir));
    expect(fs.readFileSync(path.join(dir, "index.html"), "utf8")).toBe(first);
    expect(fs.readdirSync(dir).sort()).toEqual(names);
    expect(count(first, "craft-shim:")).toBe(1);
  });

  it("refuses a tree already shimmed with another version", async () => {
    const { dir, run } = setup();
    await run(ctx(dir, 1));
    await expect(run(ctx(dir, 2))).rejects.toThrow(/already carries craft-shim 1/);
  });

  it("fails when the build has no (or an ambiguous) inline Trunk bootstrap", async () => {
    const { dir, run } = setup();
    const idx = path.join(dir, "index.html");
    fs.writeFileSync(idx, "<html><body><script src='x.js'></script></body></html>");
    await expect(run(ctx(dir))).rejects.toThrow(/exactly one inline Trunk bootstrap/);
  });

  it("writes .gz siblings for wasm/js/html/css, never .br, and removes a shipped .br", async () => {
    const { dir, run } = setup({ br: true });
    await run(ctx(dir));
    const all = fs.readdirSync(dir);
    for (const f of ["index.html", "wordcraft-1a2b3c.js", "wordcraft-1a2b3c_bg.wasm"]) expect(all).toContain(`${f}.gz`);
    expect(all.filter((f) => f.endsWith(".br"))).toEqual([]);
    expect(all).not.toContain("icon.png.gz");
    expect(zlib.gunzipSync(fs.readFileSync(path.join(dir, "index.html.gz"))).toString()).toBe(fs.readFileSync(path.join(dir, "index.html"), "utf8"));
  });

  it("writes craft-build.json {app, version, shimVersion, sizeGzip}", async () => {
    const { dir, run } = setup();
    await run(ctx(dir));
    const info = readBuildInfo(dir);
    expect(info).toMatchObject({ app: "wordcraft", version: "0.8.0", shimVersion: 1 });
    const expected = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".gz") || f === "icon.png")
      .reduce((n, f) => n + fs.statSync(path.join(dir, f)).size, 0);
    expect(info?.sizeGzip).toBe(expected);
    expect(fs.existsSync(path.join(dir, BUILD_INFO_FILE))).toBe(true);
  });

  it("readBuildInfo is null for an absent or malformed file", () => {
    const dir = tmp();
    expect(readBuildInfo(dir)).toBeNull();
    fs.writeFileSync(path.join(dir, BUILD_INFO_FILE), "{nope");
    expect(readBuildInfo(dir)).toBeNull();
  });
});
