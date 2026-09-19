/**
 * X11 (task 10.74) — ir: Bad edit fails before render.
 *
 * `deck.json` with a trailing comma is invalid JSON. Both `validate` and
 * `render` must exit non-zero naming the JSON position, and `render` must not
 * write an `.html` file.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const BIN = new URL("../../../bin/deck3d", import.meta.url).pathname;

function runCli(args: string[], cwd: string) {
  return spawnSync(BIN, args, { cwd, encoding: "utf8" });
}

const BAD = '{ "meta": { "engine": "0.1.0" }, }';

describe("X11 invalid JSON fails before render", () => {
  it("validate names the JSON position and exits non-zero", () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-x11-"));
    writeFileSync(join(dir, "bad.json"), BAD);
    const r = runCli(["validate", "bad.json"], dir);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("invalid JSON");
    expect(r.stderr).toMatch(/position/);
  });

  it("render names the JSON position, exits non-zero and writes no html", () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-x11-"));
    writeFileSync(join(dir, "bad.json"), BAD);
    const r = runCli(["render", "bad.json", "-o", "bad.html"], dir);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("invalid JSON");
    expect(r.stderr).toMatch(/position/);
    expect(existsSync(join(dir, "bad.html"))).toBe(false);
  });
});
