/**
 * F6 (task 10.56) — render: light and dark labels.
 *
 * The same slide in `mode:dark` and `mode:light` must expose inverted label
 * fills: dark = palette text (`P.text`, the light foreground) with the dark
 * background as outline; light = the inverse. `measure()` reports the label
 * fill colour, which is the observable part of "unlit labels with a
 * background-colour outline" (the `toneMapped:false` material flag and the
 * outline colour are internal and not exposed by the runtime surface).
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { chromiumAvailable } from "../../__tests__/helpers/chromium.js";
import { PALETTES } from "../../runtime/palette.js";

const BIN = new URL("../../../bin/deck3d", import.meta.url).pathname;
const hasChromium = await chromiumAvailable();

const MD = `# Arch

\`\`\`mermaid
flowchart LR
  A([Felhasználó]) --> B[Beta]
\`\`\`
`;

function runCli(args: string[], cwd: string) {
  return spawnSync(BIN, args, { cwd, encoding: "utf8" });
}

describe.skipIf(!hasChromium)("F6 light and dark labels (chromium)", () => {
  it("inverts the label fill between dark and light mode", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-render-f6-"));
    writeFileSync(join(dir, "arch.md"), MD);
    expect(runCli(["parse", "arch.md", "-o", "arch.json"], dir).status).toBe(0);

    const ir = JSON.parse(readFileSync(join(dir, "arch.json"), "utf8")) as {
      slides: Array<{ id: string }>;
      overrides: { slides?: Record<string, { mode?: string }> };
    };
    const slideId = ir.slides[0].id;

    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const colourFor = async (mode: "dark" | "light"): Promise<string | null | undefined> => {
        ir.overrides.slides = { [slideId]: { mode } };
        writeFileSync(join(dir, "arch.json"), `${JSON.stringify(ir, null, 2)}\n`);
        expect(runCli(["render", "arch.json", "-o", `arch-${mode}.html`], dir).status).toBe(0);
        const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
        try {
          await page.goto(pathToFileURL(join(dir, `arch-${mode}.html`)).href);
          await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
          await page.evaluate(() => {
            window.__deck3d?.gotoSlide(1);
            window.__deck3d?.setTime(0);
          });
          return (await page.evaluate(() => window.__deck3d?.measure() ?? [])).find((r) => r.id === "A" && r.kind === "label")?.color;
        } finally {
          await page.close();
        }
      };

      const dark = await colourFor("dark");
      const light = await colourFor("light");

      expect(dark).toBe(PALETTES.blackbelt.dark.text);
      expect(light).toBe(PALETTES.blackbelt.light.text);
      // Inverted: the dark-mode fill is the light-mode background and vice versa.
      expect(dark).not.toBe(light);
      expect(dark).toBe("#FFFFFF");
      expect(light).toBe("#2b2b2b");
    } finally {
      await browser.close();
    }
  }, 180_000);
});
