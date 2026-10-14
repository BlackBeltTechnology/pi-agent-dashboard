/**
 * Static contract + behaviour: updateSplashStatus embeds the status text as an
 * escaped JSON string literal (no template-literal splicing/escaping of the
 * value). See change: fix-codeql-small-findings (test-plan #E16).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAIN_TS = path.resolve(__dirname, "..", "main.ts");

/**
 * @structural-pin main.ts imports electron and cannot be loaded; the script text built in updateSplashStatus is the contract
 */
describe("updateSplashStatus script", () => {
  const src = readFileSync(MAIN_TS, "utf-8");
  const start = src.indexOf("function updateSplashStatus(");
  const body = src.slice(start, src.indexOf("\n}\n", start));

  it("builds el.textContent from a JSON-literal local", () => {
    expect(start).toBeGreaterThan(-1);
    expect(body).toContain("JSON.stringify(text)");
    expect(body).toContain("el.textContent = ${literal};");
  });

  it("does not hand-escape the text for a template literal or wrap it in template-literal delimiters", () => {
    expect(body).not.toMatch(/\.replace\(\/`\/g/);
    expect(body).not.toMatch(/\.replace\(\/\\\$\/g/);
    expect(body).not.toContain("el.textContent = \\`");
  });

  it("the literal expression round-trips hostile text, incl. backtick, ${}, </script>, U+2028/2029", () => {
    const m = /const literal = (.+);\n/.exec(body);
    expect(m).not.toBeNull();
    // Evaluate the exact expression from main.ts with a fixed `text`.
    const evalLiteral = (text: string) => vm.runInNewContext(`(${m![1]})`, { text, JSON });
    for (const text of ["plain", "a`b${c}d", "</script><b>", "x\u2028y\u2029z", 'q"\\', "back\\`tick"]) {
      const lit = evalLiteral(text) as string;
      expect(lit).not.toMatch(/[<>/\u2028\u2029]/);
      expect(vm.runInNewContext(lit)).toBe(text);
    }
  });
});
