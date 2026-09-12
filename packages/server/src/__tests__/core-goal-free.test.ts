/**
 * Core is goal-free (test-plan #E27) — static scan over `packages/server/src`.
 *
 * After the relocation, core contains NO goal-product identifiers: no
 * `goal/` directory, no goal routes file, no goalStore/supervisor/primer/
 * GOAL_REF_OWNER wiring. The shared-typed `goalId` FIELD on DashboardSession
 * remains (explicit non-goal: it is populated via the generic ref merge and
 * read by the client), so object-key usages of the shared field are allowed;
 * every other `goal` identifier is not.
 *
 * Comment lines are stripped before scanning (change-name references like
 * `detach-automation-goal-from-core` are prose, not identifiers).
 *
 * See change: relocate-goal-product-to-plugin (D1 goals).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverSrc = path.resolve(__dirname, "..");

/** Recursively collect every .ts/.tsx file under a directory. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** Strip // line comments and /* … *​/ block comments (string-blind but sufficient). */
function stripComments(src: string): string {
  return src
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return "";
      const idx = line.indexOf("//");
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join("\n");
}

describe("core is goal-free (relocate-goal-product-to-plugin)", () => {
  it("E27: the goal/ directory and goal-routes file are gone from core", () => {
    expect(fs.existsSync(path.join(serverSrc, "goal"))).toBe(false);
    expect(fs.existsSync(path.join(serverSrc, "routes", "goal-routes.ts"))).toBe(false);
  });

  it("E27: zero goal identifiers in core code outside the shared goalId field", () => {
    const offenders: string[] = [];
    for (const file of walk(serverSrc)) {
      const rel = path.relative(serverSrc, file);
      // Production code only — test files may name the plugin id or the change.
      if (rel.split(path.sep).includes("__tests__")) continue;
      const code = stripComments(fs.readFileSync(file, "utf-8"));
      const lines = code.split("\n");
      lines.forEach((line, i) => {
        if (!/goal/i.test(line)) return;
        // Allowed: the shared-typed session field (object key + property reads).
        if (/^\s*goalId\s*[?:]?\s*:/.test(line)) return;
        if (/\bgoalId\b/.test(line) && !/\bgoal(?!Id)/i.test(line.replace(/\bgoalId\b/g, ""))) return;
        offenders.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
      });
    }
    expect(offenders, `goal identifiers leaked into core:\n${offenders.join("\n")}`).toEqual([]);
  });
});
