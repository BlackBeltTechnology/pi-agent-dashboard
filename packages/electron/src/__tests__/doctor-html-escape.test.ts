/**
 * Static contract: the Electron doctor page escapes the name and message cells
 * with the three steps of `escapeMdTableCell` (backslash, pipe, line endings).
 * See change: fix-codeql-small-findings (test-plan #E11).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { JSDOM } from "./jsdom-shim.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML = path.resolve(__dirname, "..", "renderer", "doctor.html");

/**
 * @structural-pin doctor.html is a standalone page with no bundling, so it cannot import escapeMdTableCell; source text is the only contract
 */
describe("doctor.html markdown cell escaping", () => {
  const src = readFileSync(HTML, "utf-8");

  it("defines the cell escape as backslash, then pipe, then /\\r\\n?|\\n/g", () => {
    const m = /const cell = \(s\) => (.+);/.exec(src);
    expect(m).not.toBeNull();
    const expr = m![1];
    const bs = expr.indexOf('.replace(/\\\\/g, "\\\\\\\\")');
    const pipe = expr.indexOf('.replace(/\\|/g, "\\\\|")');
    const eol = expr.indexOf('.replace(/\\r\\n?|\\n/g, " ")');
    expect(bs).toBeGreaterThanOrEqual(0);
    expect(pipe).toBeGreaterThan(bs);
    expect(eol).toBeGreaterThan(pipe);
  });

  it("applies it to both the name and message cells; the old message replace is gone", () => {
    expect(src).toContain("${cell(c.name)} | ${cell(c.message)}");
    expect(src).not.toContain("c.message.replace(/\\r?\\n/g");
  });
});

/**
 * BE37: render the real doctor.html through jsdom and feed it a report whose
 * suggestion carries `[x](href)`. Only http(s) hrefs may become anchors.
 * See change: harden-media-and-electron-args (test-plan #BE37).
 */
describe("doctor.html link replacer is scheme-restricted (BE37)", () => {
  const html = readFileSync(HTML, "utf-8");

  async function render(href: string): Promise<{ anchors: HTMLAnchorElement[]; text: string }> {
    const report = {
      generatedAt: 0,
      summary: { ok: 0, warnings: 1, errors: 0 },
      checks: [{ section: "runtime", name: "n", status: "warning", message: "m", suggestion: `[x](${href})` }],
    };
    const dom = new JSDOM(html, {
      runScripts: "dangerously",
      pretendToBeVisual: true,
      beforeParse(window) {
        (window as unknown as { electron: unknown }).electron = {
          doctor: { run: vi.fn(async () => report), copy: vi.fn(), openLog: vi.fn(), openDoctorLog: vi.fn(), openManagedDir: vi.fn() },
        };
      },
    });
    await new Promise((r) => setTimeout(r, 20));
    const doc = dom.window.document;
    return {
      anchors: [...doc.querySelectorAll<HTMLAnchorElement>(".suggestion a")],
      text: doc.querySelector(".suggestion")?.textContent ?? "",
    };
  }

  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "\tjavascript:alert(1)",
    "\u0001javascript:x",
    "   javascript:x",
    "data:text/html,x",
    "vbscript:x",
    "/local/path",
    "http://",
  ])("href %j renders as plain text with the label visible", async (href) => {
    const { anchors, text } = await render(href);
    expect(anchors).toHaveLength(0);
    expect(text).toContain("x");
  });

  it.each(["https://example.com/a", "http://example.com"])("href %s renders as an anchor", async (href) => {
    const { anchors } = await render(href);
    expect(anchors).toHaveLength(1);
    expect(anchors[0].getAttribute("href")).toBe(href);
    expect(anchors[0].textContent).toBe("x");
  });
});
