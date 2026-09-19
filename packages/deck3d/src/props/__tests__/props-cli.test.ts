import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const BIN = new URL("../../../bin/deck3d", import.meta.url).pathname;

function props(args: string[], cwd = process.cwd()) {
  return spawnSync(BIN, ["props", ...args], { cwd, encoding: "utf8", env: { ...process.env, POLY_PIZZA_KEY: "" } });
}

describe("deck3d props CLI (7b.2/7b.4)", () => {
  it("searches the vendored manifest and notices the offline source", () => {
    const r = props(["search", "robot"]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("vendored\trobot");
    expect(r.stderr).toContain("no POLY_PIZZA_KEY");
  });

  it("fetches a vendored prop into the cache and prints the override fields", () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-props-cli-"));
    const r = props(["fetch", "vendored", "robot"], dir);
    expect(r.status, r.stderr).toBe(0);
    const entry = JSON.parse(r.stdout);
    expect(entry).toMatchObject({ source: "vendored", id: "robot", licence: "CC0-1.0" });
    expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(existsSync(join(dir, ".deck3d", "props", "vendored-robot.glb"))).toBe(true);
  });

  it("fails on an unknown prop", () => {
    const r = props(["fetch", "vendored", "does-not-exist"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("unknown vendored prop");
  });
});
