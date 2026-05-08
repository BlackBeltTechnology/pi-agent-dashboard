/**
 * Regression test: verify no jj references remain in source after removal.
 * Runs the same grep gates documented in design.md migration plan.
 */
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..", "..", "..", "..");

function grep(pattern: string, paths: string[], include: string[]): string {
  try {
    const includeArgs = include.map((i) => `--include='${i}'`).join(" ");
    const pathArgs = paths.join(" ");
    return execSync(
      `grep -rn '${pattern}' ${pathArgs} ${includeArgs} | grep -v node_modules | grep -v '.jj/' | grep -v 'jj-plugin/' | grep -v '.test.ts' | grep -v '__tests__' | grep -v 'specs/'`,
      { encoding: "utf-8", cwd: PROJECT_ROOT },
    ).trim();
  } catch {
    return "";
  }
}

describe("remove-jj regression gates", () => {
  it("source grep: zero jj references in packages/*.ts/*.tsx", () => {
    const result = grep(
      "\\bjj\\b",
      ["packages/"],
      ["*.ts", "*.tsx"],
    );
    expect(result, `jj references found:\n${result}`).toBe("");
  });

  it("full-tree grep: zero jj references in docs/seed/config", () => {
    const result = grep(
      "\\bjj\\b",
      ["docs/", "seed/", ".github/", "vitest.config.ts", "README.md"],
      ["*.md", "*.json", "*.yml", "*.ts"],
    );
    expect(result, `jj references found:\n${result}`).toBe("");
  });
});
