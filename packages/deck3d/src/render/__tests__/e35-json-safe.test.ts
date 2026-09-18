/**
 * E35 (task 10.35) — render: JSON inlined safely.
 *
 * A node label containing `</script><b>x` (which would break out of the inline
 * `<script>` payload) and a label containing U+2028 (a JS line terminator) must
 * survive `render` → `measure()`: the page logs no console error and the
 * measured label text equals the input. `render` escapes `<`, U+2028 and U+2029
 * as `\uXXXX` before inlining.
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

const INJECTION = "</script><b>x";
const LINE_SEPARATOR = "sor1\u2028sor2";

const MD = `# Arch

\`\`\`mermaid
flowchart LR
  A[Alpha] --> B[Beta]
\`\`\`
`;

function runCli(args: string[], cwd: string) {
  return spawnSync(BIN, args, { cwd, encoding: "utf8" });
}

describe.skipIf(!hasChromium)("E35 JSON inlined safely (chromium)", () => {
  it("escapes script-terminating text and renders both labels intact", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-render-e35-"));
    writeFileSync(join(dir, "arch.md"), MD);
    const parsed = runCli(["parse", "arch.md", "-o", "arch.json"], dir);
    expect(parsed.status, parsed.stderr).toBe(0);

    const ir = JSON.parse(readFileSync(join(dir, "arch.json"), "utf8")) as {
      overrides: { nodes?: Record<string, { label?: string }> };
    };
    ir.overrides.nodes = { "arch/A": { label: INJECTION }, "arch/B": { label: LINE_SEPARATOR } };
    writeFileSync(join(dir, "arch.json"), `${JSON.stringify(ir, null, 2)}\n`);

    const rendered = runCli(["render", "arch.json", "-o", "arch.html"], dir);
    expect(rendered.status, rendered.stderr).toBe(0);

    // The raw payload must not contain the escaping sequences verbatim.
    const html = readFileSync(join(dir, "arch.html"), "utf8");
    expect(html).not.toContain(INJECTION);
    expect(html).not.toContain("\u2028");
    expect(html).toContain("\\u003c/script>");
    expect(html).toContain("\\u2028");

    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
      const errors: string[] = [];
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
      });
      page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
      await page.goto(pathToFileURL(join(dir, "arch.html")).href);
      await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
      await page.evaluate(() => {
        window.__deck3d?.gotoSlide(1);
        window.__deck3d?.setTime(0);
      });

      const rows = await page.evaluate(() => window.__deck3d?.measure() ?? []);
      const labels = rows.filter((r) => r.kind === "label");
      expect(labels.find((r) => r.id === "A")?.text).toBe(INJECTION);
      expect(labels.find((r) => r.id === "B")?.text).toBe(LINE_SEPARATOR);
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 120_000);
});
