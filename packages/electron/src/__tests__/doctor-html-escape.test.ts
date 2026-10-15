/**
 * Static contract: the Electron doctor page escapes the name and message cells
 * with the three steps of `escapeMdTableCell` (backslash, pipe, line endings).
 * See change: fix-codeql-small-findings (test-plan #E11).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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
