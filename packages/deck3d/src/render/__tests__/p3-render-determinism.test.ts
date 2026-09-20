/**
 * P3 (task 10.50) — render: render is deterministic and fast.
 *
 * The same `deck.json` rendered three times in-process must produce byte-identical
 * HTML, each call under 5 s. `renderDeck` is pure (fixed runtime, sorted IR,
 * clock-frozen font subset) and needs no browser.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DeckIR } from "../../ir/types.js";
import { makeLocalDeck, runCli } from "../../__tests__/helpers/local-fx.js";
import { ensureRuntime, renderDeck } from "../index.js";

const IR = JSON.parse(readFileSync(new URL("../../../fixtures/strategy-lab.json", import.meta.url), "utf8")) as DeckIR;

describe("P3 render is deterministic and fast", () => {
  it("three renders are byte-identical and each under 5 s", async () => {
    const runtime = await ensureRuntime();
    const htmls: string[] = [];
    const durations: number[] = [];
    for (let i = 0; i < 3; i++) {
      const start = performance.now();
      htmls.push(renderDeck(IR, { runtime }));
      durations.push(performance.now() - start);
    }
    expect(htmls[0]).toBe(htmls[1]);
    expect(htmls[1]).toBe(htmls[2]);
    for (const [i, ms] of durations.entries()) expect(ms, `render ${i}`).toBeLessThan(5000);
  }, 60_000);
});

/**
 * test-plan #E36 — a topic background seeds its layout from `ctx.rng`, so two
 * previews of the same effect must be pixel-identical. A stray `Math.random`
 * would show up here and nowhere else.
 */
describe("E36 topic background preview is deterministic", () => {
  it("renders globe-arcs to identical PNG bytes twice", async () => {
    const { chromiumAvailable } = await import("../../__tests__/helpers/chromium.js");
    if (!(await chromiumAvailable())) return;
    const { spawnSync } = await import("node:child_process");
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const BIN = new URL("../../../bin/deck3d", import.meta.url).pathname;
    const dir = mkdtempSync(join(tmpdir(), "deck3d-e36-"));
    for (const out of ["a.png", "b.png"]) {
      const r = spawnSync(BIN, ["fx", "preview", "globe-arcs", "-o", out], { cwd: dir, encoding: "utf8" });
      expect(r.status, r.stderr).toBe(0);
    }
    expect(readFileSync(join(dir, "a.png")).equals(readFileSync(join(dir, "b.png")))).toBe(true);
  }, 180_000);
});

/**
 * test-plan #E7 — local effects must not cost determinism. The module bytes are
 * embedded (never fetched), so the same `deck.json` + same `fx/` bytes has to
 * yield byte-identical HTML with no external script.
 */
describe("E7 render with local effects is deterministic and self-contained", () => {
  it("renders byte-identical HTML twice, embedding both sources inline", () => {
    const { dir } = makeLocalDeck({ effects: [{ name: "alpha" }, { name: "beta" }], corpus: ["starfield"] }, "deck3d-e7-");

    for (const out of ["a.html", "b.html"]) {
      const r = runCli(["render", "deck.json", "-o", out], dir);
      expect(r.status, r.stderr).toBe(0);
    }
    const a = readFileSync(`${dir}/a.html`, "utf8");
    expect(a).toBe(readFileSync(`${dir}/b.html`, "utf8"));

    // Both modules are present as embedded JSON strings, not script URLs.
    expect(a).toContain("__DECK_LOCAL_FX");
    for (const name of ["alpha", "beta"]) expect(a).toContain(`"${name}"`);
    expect(a).not.toMatch(/<script[^>]+src=/i);
  });
});
