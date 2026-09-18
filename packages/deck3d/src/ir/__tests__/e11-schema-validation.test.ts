/**
 * E11 (task 10.11) — ir: IR is schema-validated.
 *
 * `render` runs the schema first. A wrong-typed override leaf reports the JSON
 * path plus `expected number`; an unknown leaf key is named as unknown. Neither
 * case writes an `.html` file.
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

function clone(deck: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(deck)) as Record<string, unknown>;
}

describe("E11 IR schema validation before render", () => {
  it("rejects a wrong-typed camera distance with its JSON path, no html", () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-e11-"));
    writeFileSync(join(dir, "talk.md"), "# Intro\n\n- a\n");
    const parsed = runCli(["parse", "talk.md", "-o", "deck.json"], dir);
    expect(parsed.status, parsed.stderr).toBe(0);
    const deck = JSON.parse(readFileSync(join(dir, "deck.json"), "utf8")) as Record<string, unknown>;

    const bad = clone(deck);
    (bad.overrides as Record<string, unknown>).slides = { intro: { camera: { distance: "far" } } };
    writeFileSync(join(dir, "bad.json"), JSON.stringify(bad, null, 2));

    const r = runCli(["render", "bad.json", "-o", "bad.html"], dir);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('overrides.slides["intro"].camera.distance');
    expect(r.stderr).toContain("expected number");
    expect(existsSync(join(dir, "bad.html"))).toBe(false);
  });

  it("rejects an unknown node override key naming it as unknown, no html", () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-e11-"));
    writeFileSync(join(dir, "talk.md"), "# Intro\n\n- a\n");
    const parsed = runCli(["parse", "talk.md", "-o", "deck.json"], dir);
    expect(parsed.status, parsed.stderr).toBe(0);
    const deck = JSON.parse(readFileSync(join(dir, "deck.json"), "utf8")) as Record<string, unknown>;

    const bad = clone(deck);
    (bad.overrides as Record<string, unknown>).nodes = { "intro/A": { colour: "#fff" } };
    writeFileSync(join(dir, "bad.json"), JSON.stringify(bad, null, 2));

    const r = runCli(["render", "bad.json", "-o", "bad.html"], dir);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('overrides.nodes["intro/A"]');
    expect(r.stderr).toContain("unknown key");
    expect(r.stderr).toContain("colour");
    expect(existsSync(join(dir, "bad.html"))).toBe(false);
  });
});
