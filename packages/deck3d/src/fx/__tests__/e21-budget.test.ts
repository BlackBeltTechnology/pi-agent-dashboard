/**
 * E21 (test-plan) — effects: Composition budget (BVA).
 *
 * `quality:low` has budget 6. A slide's effective effect list is its
 * deck-level effects plus its slide-level effects (spec deck3d-effects:
 * "slide 4 renders only `starfield` plus deck-level effects"), and the summed
 * `cost` is compared against the tier budget: 5 and 6 pass, 9 warns with
 * `warn budget slide <id> 9 > 6`. `render` still succeeds and writes the html,
 * and `check` reports the overage as a `warn budget` row.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { chromiumAvailable } from "../../__tests__/helpers/chromium.js";
import { makeLocalDeck, runCli as runDeckCli } from "../../__tests__/helpers/local-fx.js";
import type { EffectRef } from "../../ir/types.js";
import { deriveDeckIR } from "../../parse/derive.js";
import { parseMarkdown } from "../../parse/markdown.js";
import { composeEffects, QUALITY_BUDGET } from "../compose.js";

const hasChromium = await chromiumAvailable();
const BIN = new URL("../../../bin/deck3d", import.meta.url).pathname;

function runCli(args: string[], cwd: string) {
  return spawnSync(BIN, args, { cwd, encoding: "utf8" });
}

/** A real slide id ("arch") so the warning text matches a parsed deck. */
async function oneSlideId(): Promise<string> {
  const { ir } = await deriveDeckIR(parseMarkdown("# Arch\n\n- one\n"));
  return ir.slides[0].id;
}

/** Deck-level effects, cost 2 (`bloom`). */
const DECK_EFFECTS: EffectRef[] = [{ id: "bloom" }];

// Slide-level lists whose costs are 3, 4 and 7 (deck `bloom` 2 → sums 5, 6, 9).
const SLIDE_COST_3: EffectRef[] = [{ id: "aurora" }];
const SLIDE_COST_4: EffectRef[] = [{ id: "bloom" }, { id: "glass" }];
const SLIDE_COST_7: EffectRef[] = [{ id: "aurora" }, { id: "bloom" }, { id: "glass" }];

interface Report {
  viewports: Array<{ viewport: string; findings: Array<{ severity: string; rule: string; slide: string; detail: string }> }>;
}

/** Parse a one-slide deck, then render it with the given effect wiring. */
function renderWith(dir: string, slideEffects: EffectRef[]) {
  const ir = JSON.parse(readFileSync(join(dir, "arch.json"), "utf8"));
  ir.defaults.quality = "low";
  ir.overrides.deck = { quality: "low" };
  ir.overrides.effects = DECK_EFFECTS;
  ir.overrides.slides = { arch: { effects: slideEffects } };
  writeFileSync(join(dir, "arch.json"), `${JSON.stringify(ir, null, 2)}\n`);
  return runCli(["render", "arch.json", "-o", "arch.html"], dir);
}

describe("E21 composition budget (deck + slide costs)", () => {
  it("uses the quality-tier budgets low 6 / medium 12 / high 20", () => {
    expect(QUALITY_BUDGET).toEqual({ low: 6, medium: 12, high: 20 });
  });

  it("sums deck-level and slide-level cost, warning strictly above the budget", async () => {
    const slideId = await oneSlideId();
    expect(slideId).toBe("arch");
    const budgetWarnings = (warnings: string[]) => warnings.filter((w) => w.startsWith("warn budget"));

    // deck(2) + slide(3) = 5 → under budget.
    const under = composeEffects([...DECK_EFFECTS, ...SLIDE_COST_3], "dark", "low", slideId);
    expect(budgetWarnings(under.warnings)).toEqual([]);

    // deck(2) + slide(4) = 6 → exactly at budget (threshold is strict `>`).
    const at = composeEffects([...DECK_EFFECTS, ...SLIDE_COST_4], "dark", "low", slideId);
    expect(budgetWarnings(at.warnings)).toEqual([]);

    // deck(2) + slide(7) = 9 → over budget, names the sum and the tier budget.
    const over = composeEffects([...DECK_EFFECTS, ...SLIDE_COST_7], "dark", "low", slideId);
    expect(over.warnings).toContain(`warn budget slide ${slideId} 9 > 6`);
    expect(over.active.map((e) => e.id)).toEqual(["bloom", "aurora", "bloom", "glass"]);
  });

  it("render prints the budget warning only when over, exits 0 and still writes the html", () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-fx-e21-"));
    writeFileSync(join(dir, "arch.md"), "# Arch\n\n- one\n");
    const parse = runCli(["parse", "arch.md", "-o", "arch.json"], dir);
    expect(parse.status, parse.stderr).toBe(0);

    const under = renderWith(dir, SLIDE_COST_3); // 2 + 3 = 5
    expect(under.status, under.stderr).toBe(0);
    expect(under.stderr).not.toContain("warn budget");

    const at = renderWith(dir, SLIDE_COST_4); // 2 + 4 = 6
    expect(at.status, at.stderr).toBe(0);
    expect(at.stderr).not.toContain("warn budget");

    const over = renderWith(dir, SLIDE_COST_7); // 2 + 7 = 9
    expect(over.status, over.stderr).toBe(0);
    expect(over.stderr).toContain("warn budget slide arch 9 > 6");
    expect(existsSync(join(dir, "arch.html"))).toBe(true);
  }, 120_000);
});

describe.skipIf(!hasChromium)("E21 over-budget effects surface in `check`", () => {
  it("reports a `warn budget` row for the over-budget slide", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-fx-e21-check-"));
    writeFileSync(join(dir, "arch.md"), "# Arch\n\n- one\n");
    const parse = runCli(["parse", "arch.md", "-o", "arch.json"], dir);
    expect(parse.status, parse.stderr).toBe(0);
    const over = renderWith(dir, SLIDE_COST_7);
    expect(over.status, over.stderr).toBe(0);

    const check = runCli(["check", "arch.html", "-o", "report.json"], dir);
    const report = JSON.parse(readFileSync(join(dir, "report.json"), "utf8")) as Report;
    const perViewport = report.viewports.map((v) => v.findings.filter((f) => f.rule === "budget"));
    // One `warn budget` row per viewport.
    expect(perViewport.map((rows) => rows.length)).toEqual([1, 1]);
    for (const f of perViewport.flat()) {
      expect(f.severity).toBe("warn");
      expect(f.slide).toBe("arch");
      expect(f.detail).toBe("9 > 6");
    }
    expect(check.stderr).toContain("warn budget slide 1 9 > 6");

    // The runtime exposes the same warning text as the render CLI.
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
      await page.goto(pathToFileURL(join(dir, "arch.html")).href);
      await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
      const budget = await page.evaluate(() => window.__deck3d?.effects().budget);
      expect(budget).toMatchObject({ sum: 9, limit: 6, warning: "warn budget slide arch 9 > 6" });
    } finally {
      await browser.close();
    }
  }, 180_000);
});

/**
 * test-plan #E11 — a local card's `cost` is real: it counts toward the same
 * quality budget as corpus effects, so a per-deck effect cannot smuggle in
 * unbounded work.
 */
describe("E11 local effect cost counts toward the budget", () => {
  /** `aurora` (3) + `glass` (2) = 5 corpus cost, plus one local card. */
  const build = (cost: number) =>
    makeLocalDeck(
      { effects: [{ name: "x", card: { cost } }], corpus: ["aurora", "glass"], deck: { quality: "low" } },
      "deck3d-e11-",
    );

  it("stays silent at exactly the budget", () => {
    const { dir } = build(1);
    const r = runDeckCli(["render", "deck.json", "-o", "deck.html"], dir);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).not.toContain("warn budget");
  });

  it("warns once over the budget, naming the sum and the limit", () => {
    const { dir } = build(2);
    const r = runDeckCli(["render", "deck.json", "-o", "deck.html"], dir);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toContain("warn budget slide geo 7 > 6");
  });
});

/**
 * test-plan #P3 — the realistic deck must fit its own budget. Six local
 * effects plus corpus effects across ten slides, and not one slide over the
 * quality-tier cost cap.
 */
describe.skipIf(!hasChromium)("P3 business fixture stays inside the cost budget", () => {
  it("reports zero budget findings across every slide", () => {
    const src = new URL("../../../fixtures/business-2031/", import.meta.url).pathname;
    const dir = mkdtempSync(join(tmpdir(), "deck3d-p3-"));
    cpSync(src, dir, { recursive: true });

    expect(runDeckCli(["build", "deck.md", "-o", "deck.html"], dir).status).toBe(0);
    const r = runDeckCli(["check", "deck.html", "-o", "report.json"], dir);
    expect(r.status, r.stderr).toBe(0);

    const report = JSON.parse(readFileSync(join(dir, "report.json"), "utf8")) as {
      viewports: Array<{ findings: Array<{ rule: string }> }>;
    };
    const budget = report.viewports.flatMap((v) => v.findings).filter((f) => f.rule === "budget");
    expect(budget).toEqual([]);
  }, 240_000);
});
