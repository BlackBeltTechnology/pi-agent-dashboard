/**
 * X11 (task 10.74) — ir: Bad edit fails before render.
 *
 * `deck.json` with a trailing comma is invalid JSON. Both `validate` and
 * `render` must exit non-zero naming the JSON position, and `render` must not
 * write an `.html` file.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

/**
 * test-plan #X15 — `overrides apply` is a write path: an unparseable or
 * schema-invalid patch must abort before touching `deck.json`.
 */
describe("X15 overrides apply rejects bad input without writing", () => {
  function deckFixture(): { dir: string; before: string } {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-x15-"));
    writeFileSync(join(dir, "talk.md"), "# Geo\n\n- a\n");
    const parsed = runCli(["parse", "talk.md", "-o", "deck.json"], dir);
    expect(parsed.status, parsed.stderr).toBe(0);
    return { dir, before: readFileSync(join(dir, "deck.json"), "utf8") };
  }

  it("rejects a non-JSON patch file and leaves deck.json byte-unchanged", () => {
    const { dir, before } = deckFixture();
    writeFileSync(join(dir, "patch.json"), "not json at all");
    const r = runCli(["overrides", "apply", "deck.json", "patch.json"], dir);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("invalid JSON");
    expect(readFileSync(join(dir, "deck.json"), "utf8")).toBe(before);
  });

  it("rejects an unknown key naming slide and key, leaving deck.json byte-unchanged", () => {
    const { dir, before } = deckFixture();
    writeFileSync(join(dir, "patch.json"), JSON.stringify({ slides: { geo: { foo: 1 } } }));
    const r = runCli(["overrides", "apply", "deck.json", "patch.json"], dir);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("geo");
    expect(r.stderr).toContain("foo");
    expect(readFileSync(join(dir, "deck.json"), "utf8")).toBe(before);
  });
});
