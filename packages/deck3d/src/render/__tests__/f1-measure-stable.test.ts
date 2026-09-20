/**
 * F1 (task 10.51) — render: measurement is stable.
 *
 * With a fixed viewport and a frozen deterministic clock, two `measure()` calls
 * at the same slide/time must be deep-equal (convergence), and every projected
 * rect must be finite (no NaN from an empty/degenerate object).
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromiumAvailable } from "../../__tests__/helpers/chromium.js";
import { makeLocalDeck, runCli as runDeckCli } from "../../__tests__/helpers/local-fx.js";

const BIN = new URL("../../../bin/deck3d", import.meta.url).pathname;
const hasChromium = await chromiumAvailable();

const MD = `# Arch

\`\`\`mermaid
flowchart LR
  A[Alpha] --> B([Beta])
  B --> C{Megfigyelés}
  C -.-> A
\`\`\`
`;

function runCli(args: string[], cwd: string) {
  return spawnSync(BIN, args, { cwd, encoding: "utf8" });
}

describe.skipIf(!hasChromium)("F1 measurement is stable (chromium)", () => {
  it("two measure() calls at slide arch / t=1.7 are deep-equal with finite rects", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-render-f1-"));
    writeFileSync(join(dir, "arch.md"), MD);
    expect(runCli(["parse", "arch.md", "-o", "arch.json"], dir).status).toBe(0);
    expect(runCli(["render", "arch.json", "-o", "arch.html"], dir).status).toBe(0);

    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
      await page.goto(pathToFileURL(join(dir, "arch.html")).href);
      await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
      await page.evaluate(() => {
        window.__deck3d?.gotoSlide(1);
        window.__deck3d?.setTime(1.7);
      });
      await page.evaluate(() => window.__deck3d?.ready());
      const a = await page.evaluate(() => window.__deck3d?.measure() ?? []);
      const b = await page.evaluate(() => window.__deck3d?.measure() ?? []);
      expect(a.length).toBeGreaterThan(0);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      for (const row of a) {
        expect(Number.isFinite(row.rect.x), `${row.id} x`).toBe(true);
        expect(Number.isFinite(row.rect.y), `${row.id} y`).toBe(true);
        expect(Number.isFinite(row.rect.w), `${row.id} w`).toBe(true);
        expect(Number.isFinite(row.rect.h), `${row.id} h`).toBe(true);
      }
    } finally {
      await browser.close();
    }
  }, 120_000);
});

/**
 * test-plan #E24 — `bars` is the topology whose geometry encodes a number, so
 * the projected column heights are the contract: proportional to `values`,
 * equal without them, and never zero-height (a zero bar must keep its label).
 */
describe.skipIf(!hasChromium)("E24 bars geometry from data (chromium)", () => {
  let browser: Awaited<ReturnType<typeof chromium.launch>>;

  beforeAll(async () => {
    browser = await chromium.launch({ channel: "chromium" });
  }, 180_000);
  afterAll(async () => {
    await browser?.close();
  });

  /** Render a one-slide `bars` deck and return its `measure()` rows at t=0. */
  async function barRows(data: { labels: string[]; values?: number[] }) {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-e24-"));
    writeFileSync(join(dir, "bars.md"), "# Market\n\n- a\n- b\n");
    expect(runCli(["parse", "bars.md", "-o", "bars.json"], dir).status).toBe(0);
    const deck = JSON.parse(readFileSync(join(dir, "bars.json"), "utf8"));
    deck.overrides.slides = { market: { diagram: { kind: "bars", data } } };
    writeFileSync(join(dir, "bars.json"), JSON.stringify(deck, null, 2));
    expect(runCli(["render", "bars.json", "-o", "bars.html"], dir).status).toBe(0);

    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(join(dir, "bars.html")).href);
    await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
    await page.evaluate(() => {
      window.__deck3d?.gotoSlide(1);
      window.__deck3d?.setTime(0);
    });
    await page.evaluate(() => window.__deck3d?.ready());
    const rows = await page.evaluate(() => window.__deck3d?.measure() ?? []);
    await page.close();
    return rows;
  }

  it("renders column heights in the ratio of the values", async () => {
    const rows = await barRows({ labels: ["A", "B", "C"], values: [1, 2, 4] });
    const nodes = rows.filter((r) => r.kind === "node");
    expect(nodes).toHaveLength(3);
    const h = nodes.map((n) => n.rect.h);
    expect(h[1] / h[0]).toBeCloseTo(2, 1);
    expect(h[2] / h[0]).toBeCloseTo(4, 1);
    for (const [i, expected] of [2, 4].entries()) {
      expect(Math.abs(h[i + 1] / h[0] - expected) / expected).toBeLessThanOrEqual(0.05);
    }
  }, 120_000);

  it("gives a zero value a visible stub that still carries its label", async () => {
    const rows = await barRows({ labels: ["Zero", "Five"], values: [0, 5] });
    const nodes = rows.filter((r) => r.kind === "node");
    expect(nodes).toHaveLength(2);
    expect(nodes[0].rect.h).toBeGreaterThan(0);
    expect(nodes[0].rect.h).toBeLessThan(nodes[1].rect.h);
    expect(rows.some((r) => r.text === "Zero")).toBe(true);
  }, 120_000);

  it("renders equal heights when no values are supplied", async () => {
    const rows = await barRows({ labels: ["A", "B", "C"] });
    const h = rows.filter((r) => r.kind === "node").map((n) => n.rect.h);
    expect(h).toHaveLength(3);
    const max = Math.max(...h);
    const min = Math.min(...h);
    expect((max - min) / max).toBeLessThanOrEqual(0.02);
  }, 120_000);
});

/**
 * test-plan #E10 — `Math.random` inside a local module is the deck's seeded
 * stream, so a module that scatters points lands them identically on every
 * load. Without this the deck would not be reproducible for `check`.
 */
describe.skipIf(!hasChromium)("E10 local effect randomness is seeded (chromium)", () => {
  it("places the same points across two loads", async () => {
    const src = [
      "export default function (ctx, params) {",
      "  const { THREE } = ctx;",
      "  const group = new THREE.Group();",
      "  const geo = new THREE.BufferGeometry();",
      "  const pts = new Float32Array(200 * 3);",
      "  for (let i = 0; i < pts.length; i++) pts[i] = (Math.random() - 0.5) * 8;",
      "  geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));",
      "  const cloud = new THREE.Points(geo, new THREE.PointsMaterial({ color: ctx.palette.accent, size: 0.2 }));",
      "  group.add(cloud);",
      "  group.userData.sample = [pts[0], pts[1], pts[299], pts[599]];",
      "  return { object: group, dispose: function () { geo.dispose(); } };",
      "}",
      "",
    ].join("\n");

    const { dir } = makeLocalDeck({ effects: [{ name: "scatter", src }] }, "deck3d-e10-");
    expect(runDeckCli(["render", "deck.json", "-o", "deck.html"], dir).status).toBe(0);

    const browser = await chromium.launch({ channel: "chromium" });
    const read = async () => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      await page.goto(pathToFileURL(join(dir, "deck.html")).href);
      await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
      await page.evaluate(() => {
        window.__deck3d?.gotoSlide(1);
        window.__deck3d?.setTime(0);
      });
      const rows = await page.evaluate(() => window.__deck3d?.measure() ?? []);
      await page.close();
      return JSON.stringify(rows);
    };
    try {
      expect(await read()).toBe(await read());
    } finally {
      await browser.close();
    }
  }, 180_000);
});

/**
 * test-plan #F2 — the configurator must be invisible until asked for. The
 * baseline was recorded from the pre-HUD runtime and committed, so any drift
 * introduced by the panel shows up here rather than in a screenshot review.
 */
describe.skipIf(!hasChromium)("F2 hidden HUD does not disturb the scene (chromium)", () => {
  it("keeps the panel display:none and measure() equal to the committed baseline", async () => {
    const baseline = JSON.parse(
      readFileSync(new URL("./fixtures/strategy-lab-slide1.measure.json", import.meta.url), "utf8"),
    );
    const dir = mkdtempSync(join(tmpdir(), "deck3d-f2-"));
    writeFileSync(join(dir, "deck.md"), readFileSync(new URL("../../../fixtures/strategy-lab.md", import.meta.url), "utf8"));
    expect(runCli(["build", "deck.md", "-o", "deck.html"], dir).status).toBe(0);

    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
      await page.goto(pathToFileURL(join(dir, "deck.html")).href);
      await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
      await page.evaluate(() => {
        window.__deck3d?.gotoSlide(1);
        window.__deck3d?.setTime(0);
      });
      await page.evaluate(() => window.__deck3d?.ready());

      const display = await page.evaluate(() => {
        const el = document.getElementById("deck3d-hud");
        return el ? getComputedStyle(el).display : "absent";
      });
      expect(display).toBe("none");
      expect(await page.evaluate(() => window.__deck3d?.measure() ?? [])).toEqual(baseline);
    } finally {
      await browser.close();
    }
  }, 240_000);
});
