/**
 * F7 (task 10.57) — render: message order animation.
 *
 * A sequence with 5 messages advances the highlight on a fixed 1.1 s pulse
 * period. At `setTime(k * 1.1)` the lifted message group must be `m<k>` — one
 * message at a time, in source order. The runtime exposes the currently lifted
 * group via `__deck3d.debug.liftedMessage()` (added for this scenario; the
 * `measure()` rects cannot isolate it because the diagram rotates with time).
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { chromiumAvailable } from "../../__tests__/helpers/chromium.js";

const BIN = new URL("../../../bin/deck3d", import.meta.url).pathname;
const hasChromium = await chromiumAvailable();

const MD = `# Ciklus

\`\`\`mermaid
sequenceDiagram
  participant F as Fejlesztő
  participant A as Ágens
  participant E as Eszközök
  F->>A: egy
  A->>E: kettő
  E-->>A: három
  A->>E: négy
  A-->>F: öt
\`\`\`
`;

function runCli(args: string[], cwd: string) {
  return spawnSync(BIN, args, { cwd, encoding: "utf8" });
}

describe.skipIf(!hasChromium)("F7 message order animation (chromium)", () => {
  it("lifts exactly m<k> at step time k * 1.1", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-render-f7-"));
    writeFileSync(join(dir, "ciklus.md"), MD);
    expect(runCli(["parse", "ciklus.md", "-o", "ciklus.json"], dir).status).toBe(0);
    expect(runCli(["render", "ciklus.json", "-o", "ciklus.html"], dir).status).toBe(0);

    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
      await page.goto(pathToFileURL(join(dir, "ciklus.html")).href);
      await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
      await page.evaluate(() => window.__deck3d?.gotoSlide(1));

      const peaks = await page.evaluate(() => window.__deck3d?.peaks() ?? [0]);
      expect(peaks.map((t) => Number(t.toFixed(1)))).toEqual([0, 1.1, 2.2, 3.3, 4.4]);

      for (let k = 0; k < 5; k++) {
        await page.evaluate((t) => window.__deck3d?.setTime(t), k * 1.1);
        expect(await page.evaluate(() => window.__deck3d?.debug.liftedMessage()), `step ${k}`).toBe(`m${k}`);
      }
    } finally {
      await browser.close();
    }
  }, 120_000);
});

/**
 * test-plan #E25 — every built topology must be reachable AND measurable. A
 * topology that renders but exposes nothing to `measure()` is invisible to
 * `check`, so the fit/legibility gate would silently pass a broken slide.
 */
const BUILT_KINDS = ["brain", "loop", "swarm", "bars", "funnel", "timeline-rail", "globe", "orbit-cluster", "stack"] as const;
const CAPTIONS = ["Alpha", "Beta", "Gamma", "Delta"];

describe.skipIf(!hasChromium)("E25 every built kind is measurable (chromium)", () => {
  it("returns at least four labelled parts for each of the nine topologies", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-e25-"));
    const md = BUILT_KINDS.map((k) => `# ${k}\n\n${CAPTIONS.map((c) => `- ${c}`).join("\n")}\n`).join("\n");
    writeFileSync(join(dir, "kinds.md"), md);
    expect(runCli(["parse", "kinds.md", "-o", "kinds.json"], dir).status).toBe(0);

    const deck = JSON.parse(readFileSync(join(dir, "kinds.json"), "utf8"));
    deck.overrides.slides = Object.fromEntries(
      BUILT_KINDS.map((kind) => [kind, { diagram: { kind, data: { labels: CAPTIONS } } }]),
    );
    writeFileSync(join(dir, "kinds.json"), JSON.stringify(deck, null, 2));
    expect(runCli(["render", "kinds.json", "-o", "kinds.html"], dir).status).toBe(0);

    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
      await page.goto(pathToFileURL(join(dir, "kinds.html")).href);
      await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });

      for (const [i, kind] of BUILT_KINDS.entries()) {
        const rows = await page.evaluate((n) => {
          window.__deck3d?.gotoSlide(n);
          window.__deck3d?.setTime(0);
          return window.__deck3d?.measure() ?? [];
        }, i + 1);
        expect(rows.filter((r) => r.kind === "node"), `${kind} nodes`).toHaveLength(4);
        const captions = rows.filter((r) => CAPTIONS.includes(r.text)).map((r) => r.text);
        expect([...captions].sort(), `${kind} labels`).toEqual([...CAPTIONS].sort());
      }

      // The rail reads left-to-right only if consecutive captions alternate
      // sides; same-side captions would stack and collide.
      const railY = await page.evaluate(
        ({ n, captions }) => {
          window.__deck3d?.gotoSlide(n);
          window.__deck3d?.setTime(0);
          const rows = window.__deck3d?.measure() ?? [];
          return rows.filter((r) => captions.includes(r.text)).map((r) => r.rect.y);
        },
        { n: BUILT_KINDS.indexOf("timeline-rail") + 1, captions: CAPTIONS },
      );
      const centre = railY.reduce((a, b) => a + b, 0) / railY.length;
      for (let k = 0; k + 1 < railY.length; k++) {
        expect(railY[k] < centre, `caption ${k} vs ${k + 1}`).not.toBe(railY[k + 1] < centre);
      }
    } finally {
      await browser.close();
    }
  }, 180_000);
});
