/**
 * E24 (task 10.24) — effects: Card drives validation (BVA on the param schema).
 *
 * The `starfield` card bounds `density` to `0..1`, so `validate` accepts the
 * bounds themselves and rejects `min−1` / `max+1`, naming the override path
 * `overrides.slides["<id>"].effects[0].params.density`.
 *
 * The bounds are read from the card, not hardcoded, so a card change drives the
 * test (spec: "Card drives validation").
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const BIN = new URL("../../../bin/deck3d", import.meta.url).pathname;
const CARD = JSON.parse(readFileSync(new URL("../starfield.meta.json", import.meta.url), "utf8")) as {
  params: { density: { minimum: number; maximum: number } };
};

function runCli(args: string[], cwd: string) {
  return spawnSync(BIN, args, { cwd, encoding: "utf8" });
}

function deckWithDensity(dir: string, density: number): string {
  writeFileSync(join(dir, "arch.md"), "# Arch\n\n- one\n");
  const parse = runCli(["parse", "arch.md", "-o", "arch.json"], dir);
  expect(parse.status, parse.stderr).toBe(0);

  const ir = JSON.parse(readFileSync(join(dir, "arch.json"), "utf8"));
  expect(ir.slides[0].id).toBe("arch");
  ir.overrides.slides = { arch: { effects: [{ id: "starfield", params: { density } }] } };
  const path = join(dir, `density-${density}.json`);
  writeFileSync(path, `${JSON.stringify(ir, null, 2)}\n`);
  return path;
}

describe("E24 card param bounds drive validate", () => {
  it("accepts the card's min and max (inclusive bounds)", () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-fx-e24-"));
    const { minimum, maximum } = CARD.params.density;
    for (const density of [minimum, maximum]) {
      const r = runCli(["validate", deckWithDensity(dir, density)], dir);
      expect(r.status, `density ${density}: ${r.stderr}`).toBe(0);
    }
  });

  it("rejects min−1 and max+1, naming the exact override path", () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-fx-e24-"));
    const { minimum, maximum } = CARD.params.density;
    const path = 'overrides.slides["arch"].effects[0].params.density';

    for (const density of [minimum - 1, maximum + 1]) {
      const r = runCli(["validate", deckWithDensity(dir, density)], dir);
      expect(r.status, `density ${density} should fail`).not.toBe(0);
      expect(r.stderr).toContain(path);
      expect(r.stderr).toContain(String(density));
    }
  });
});
