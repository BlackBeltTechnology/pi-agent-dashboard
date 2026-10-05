/**
 * Repo-level invariant: no source hardcodes the default NSIS install
 * directory (`Programs\PI Dashboard`). The launch source resolves from
 * `process.resourcesPath`, so the installer location can be anything.
 *
 * Covers test-plan #E12. See change: cleanup-stale-fork-specs.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const SCAN_ROOTS = ["packages/electron/src", "packages/server/src", "packages/shared/src"];
const NEEDLE = /Programs[\\/]+PI Dashboard/;

function walk(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === "dist" || e.name === "__tests__") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(full);
  }
}

describe("no hardcoded NSIS install path", () => {
  it("no non-comment line in electron/server/shared src names `Programs\\PI Dashboard`", () => {
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(here, "..", "..", "..", "..");
    const files: string[] = [];
    for (const root of SCAN_ROOTS) walk(path.resolve(repoRoot, root), files);

    const violations: string[] = [];
    for (const file of files) {
      fs.readFileSync(file, "utf-8")
        .split(/\r?\n/)
        .forEach((line, idx) => {
          const t = line.trim();
          if (t.startsWith("*") || t.startsWith("//") || t.startsWith("/*")) return;
          const code = line.includes("//") ? line.slice(0, line.indexOf("//")) : line;
          if (NEEDLE.test(code)) violations.push(`  ${path.relative(repoRoot, file)}:${idx + 1}  ${t}`);
        });
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });
});
