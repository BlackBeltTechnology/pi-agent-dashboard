/**
 * Static contract: updateSplashStatus embeds the status text as a JSON string
 * literal, with no template-literal splicing/escaping of the value.
 * See change: fix-codeql-small-findings (test-plan #E16).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
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

  it("builds el.textContent from JSON.stringify(text)", () => {
    expect(start).toBeGreaterThan(-1);
    expect(body).toContain("el.textContent = ${JSON.stringify(text)};");
  });

  it("does not hand-escape the text or wrap it in template-literal delimiters", () => {
    expect(body).not.toMatch(/\.replace\(\/`\/g/);
    expect(body).not.toMatch(/\.replace\(\/\\\$\/g/);
    expect(body).not.toContain("el.textContent = \\`");
  });
});
