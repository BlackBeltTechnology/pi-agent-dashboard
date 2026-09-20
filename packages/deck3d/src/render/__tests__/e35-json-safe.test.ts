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
import { makeLocalDeck, runCli as runDeckCli } from "../../__tests__/helpers/local-fx.js";

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

/**
 * test-plan #E8 — a local module is LLM-written source inlined into the page.
 * A `</script>` sequence inside it must not terminate the script block, or the
 * rest of the module becomes live markup.
 */
describe.skipIf(!hasChromium)("E8 script terminator inside a local module", () => {
  it("keeps the document intact and the effect running", async () => {
    const src = [
      "export default function (ctx, params) {",
      '  const marker = "</script><script>window.pwned=1</script>";',
      "  const group = new ctx.THREE.Group();",
      "  group.name = marker.length > 0 ? 'local-ok' : 'empty';",
      "  return { object: group, dispose: function () {} };",
      "}",
      "",
    ].join("\n");

    const { dir } = makeLocalDeck({ effects: [{ name: "x", src }] }, "deck3d-e8-");
    expect(runDeckCli(["render", "deck.json", "-o", "deck.html"], dir).status).toBe(0);
    // The literal must be escaped in the output, never present verbatim.
    expect(readFileSync(join(dir, "deck.html"), "utf8")).not.toContain("<script>window.pwned=1");

    const browser = await chromium.launch({ channel: "chromium" });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      await page.goto(pathToFileURL(join(dir, "deck.html")).href);
      await page.waitForFunction(() => window.__deck3d !== undefined, undefined, { timeout: 30_000 });
      await page.evaluate(() => window.__deck3d?.gotoSlide(1));
      expect(await page.evaluate(() => (window as unknown as { pwned?: number }).pwned)).toBeUndefined();
      // The effect constructed cleanly: no recorded failure.
      expect(await page.evaluate(() => window.__deck3d?.effects().errors ?? [])).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 180_000);
});
