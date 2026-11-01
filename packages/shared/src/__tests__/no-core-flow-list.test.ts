/**
 * Core carries no flow list: no `flows_list` / `request_flows_refresh`
 * message, no shared `FlowInfo` type, no `flowsList` session-data key in any
 * core package's source. Only the flows plugin reads or produces the catalog.
 * Tests (`__tests__`) are excluded: they may name the legacy message to prove
 * an old bridge's copy is ignored. Harness: repo-root resolution as in
 * `publish-workflow-contract.test.ts`.
 * See change: flows-dock-chip-and-panel-actions (D8; test-plan E17).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");
const PACKAGES = path.join(REPO_ROOT, "packages");
// Built from parts so this file never matches its own pattern.
const PATTERN = new RegExp(["flows" + "_list", "Flow" + "Info", "request_flows" + "_refresh", "flows" + "List"].join("|"));

function* sourceFiles(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "__tests__" || e.name === "dist") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* sourceFiles(p);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) yield p;
  }
}

describe("E17: core carries no flow list", () => {
  it("no core package source names the legacy flow-list protocol", () => {
    const hits: string[] = [];
    for (const pkg of fs.readdirSync(PACKAGES)) {
      if (pkg === "flows-plugin") continue;
      const src = path.join(PACKAGES, pkg, "src");
      if (!fs.existsSync(src)) continue;
      for (const file of sourceFiles(src)) {
        const lines = fs.readFileSync(file, "utf8").split("\n");
        lines.forEach((line, i) => {
          if (PATTERN.test(line)) hits.push(`${path.relative(REPO_ROOT, file)}:${i + 1}: ${line.trim()}`);
        });
      }
    }
    expect(hits).toEqual([]);
  });
});
