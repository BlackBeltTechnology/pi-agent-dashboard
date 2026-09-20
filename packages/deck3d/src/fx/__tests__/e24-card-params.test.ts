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
import { makeLocalDeck, runCli as runDeckCli } from "../../__tests__/helpers/local-fx.js";

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

/**
 * test-plan #E4 — a local card may only declare a kind the `{ object, tick }`
 * handle grammar can actually fulfil. `post`/`material`/`light`/`edge`/
 * `transition` need composer or material hooks a local module cannot provide.
 */
describe("E4 local card kind", () => {
  it.each([
    ["background", true],
    ["motion", true],
    ["post", false],
    ["material", false],
    ["light", false],
    ["edge", false],
    ["transition", false],
  ])("kind %s is allowed=%s", (kind, allowed) => {
    const { dir } = makeLocalDeck({ effects: [{ name: "k", card: { kind } }] }, "deck3d-e4-");
    const r = runDeckCli(["validate", "deck.json"], dir);
    if (allowed) {
      expect(r.status, r.stderr).toBe(0);
    } else {
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain("fx/k.meta.json");
      expect(r.stderr).toContain("background, motion");
    }
  });
});

/**
 * test-plan #E5 — a local card bounds its params exactly like a corpus card,
 * so a bad override is caught before it reaches the browser.
 */
describe("E5 local card param bounds", () => {
  const validateDensity = (density: unknown) => {
    const { dir } = makeLocalDeck({ effects: [{ name: "d" }] }, "deck3d-e5-");
    const path = join(dir, "deck.json");
    const deck = JSON.parse(readFileSync(path, "utf8"));
    deck.overrides.slides.geo.effects[0].params = { density };
    writeFileSync(path, `${JSON.stringify(deck, null, 2)}\n`);
    // Param bounds are checked by `render`, which resolves the local cards.
    return runDeckCli(["render", "deck.json", "-o", "deck.html"], dir);
  };

  it.each([[0], [1]])("accepts density %s", (density) => {
    expect(validateDensity(density).status).toBe(0);
  });

  it.each([[-0.01], [1.01]])("rejects density %s naming the path and the range", (density) => {
    const r = validateDensity(density);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('overrides.slides["geo"].effects[0].params.density');
  });
});
