/**
 * Source-shape contract: the i18n scripts list files with `execFileSync` and an
 * argv array, never a shell string (`execSync`). User-controlled values never
 * reach a shell, and CodeQL's `js/shell-command-constructed-from-input` has no
 * string to flag.
 *
 * See change: triage-codeql-alert-debt (design D3 #28/#29).
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..", "..");

describe.each(["scripts/i18n-parity.mjs", "scripts/i18n-migrate-auto-keys.mjs"])("%s", (rel) => {
  const src = fs.readFileSync(path.join(repoRoot, rel), "utf8");

  it("does not call execSync", () => {
    expect(src).not.toMatch(/\bexecSync\b/);
  });

  it("lists files with execFileSync and an argv array", () => {
    const calls = [...src.matchAll(/\bexecFileSync\(\s*("[^"]+"|'[^']+')\s*,\s*\[/g)];
    expect(calls.length).toBeGreaterThan(0);
    expect(src.match(/\bexecFileSync\(/g)?.length).toBe(calls.length);
  });
});
