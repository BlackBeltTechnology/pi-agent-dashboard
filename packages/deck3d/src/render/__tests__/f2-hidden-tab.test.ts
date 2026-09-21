/**
 * F2 (task 10.52) — render: render loop tolerates hidden tabs.
 *
 * Headless pages report `document.hidden === false`, so the test installs an
 * init script that overrides it to `true` (the runtime's frame loop reads it
 * every iteration to choose `setTimeout` over `requestAnimationFrame`). With the
 * page hidden, advancing the deterministic clock (`setTime`) must still change
 * animated message geometry: at least one message rect differs between `t=0` and
 * `t=2.2`.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
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

/** Force `document.hidden`/`visibilityState` in the page (raw string: no TS transform). */
const HIDE_SCRIPT =
  'Object.defineProperty(Document.prototype,"hidden",{configurable:true,get:function(){return true}});' +
  'Object.defineProperty(Document.prototype,"visibilityState",{configurable:true,get:function(){return "hidden"}});';

function runCli(args: string[], cwd: string) {
  return spawnSync(BIN, args, { cwd, encoding: "utf8" });
}

describe.skipIf(!hasChromium)("F2 hidden tab advances animation (chromium)", () => {
  it("a message rect changes between t=0 and t=2.2 while the page is hidden", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-render-f2-"));
    writeFileSync(join(dir, "ciklus.md"), MD);
    expect(runCli(["parse", "ciklus.md", "-o", "ciklus.json"], dir).status).toBe(0);
    expect(runCli(["render", "ciklus.json", "-o", "ciklus.html"], dir).status).toBe(0);

    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
      await page.addInitScript({ content: HIDE_SCRIPT });
      await page.goto(pathToFileURL(join(dir, "ciklus.html")).href);
      await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
      expect(await page.evaluate(() => document.hidden)).toBe(true);

      await page.evaluate(() => {
        window.__deck3d?.gotoSlide(1);
        window.__deck3d?.setTime(0);
      });
      const atZero = await page.evaluate(() => window.__deck3d?.measure() ?? []);
      await page.evaluate(() => window.__deck3d?.setTime(2.2));
      const atPeak = await page.evaluate(() => window.__deck3d?.measure() ?? []);

      const messages = (rows: typeof atZero) => rows.filter((r) => /^m\d$/.test(r.id));
      expect(messages(atZero).map((r) => r.id)).toEqual(["m0", "m1", "m2", "m3", "m4"]);
      const changed = messages(atZero).filter(
        (a) => JSON.stringify(a.rect) !== JSON.stringify(messages(atPeak).find((b) => b.id === a.id)?.rect),
      );
      expect(changed.length, "no animated message rect changed while hidden").toBeGreaterThan(0);
    } finally {
      await browser.close();
    }
  }, 120_000);
});
