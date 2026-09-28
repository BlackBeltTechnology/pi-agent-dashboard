/**
 * Single predicate, no drift (test-plan #E16) — static scan over
 * `packages/server/src`. Every peer-IP trust decision must go through
 * `isTrustedSource`; the raw matcher `isBypassedHost(` may be CALLED only in
 * its home module and in `cors-origin.ts` (which matches the Origin host, not
 * a socket peer). Comment lines are stripped before scanning.
 *
 * See change: fix-trusted-network-tunnel-bypass (D1).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverSrc = path.resolve(__dirname, "..");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

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

const ALLOWED = new Set([path.join("auth", "localhost-guard.ts"), path.join("auth", "cors-origin.ts")]);

describe("E16 single peer-IP trust predicate", () => {
  it("calls isBypassedHost( only in localhost-guard.ts and cors-origin.ts", () => {
    const offenders: string[] = [];
    for (const file of walk(serverSrc)) {
      const rel = path.relative(serverSrc, file);
      if (rel.split(path.sep).includes("__tests__") || /\.test\.tsx?$/.test(rel)) continue;
      if (ALLOWED.has(rel)) continue;
      if (stripComments(fs.readFileSync(file, "utf-8")).includes("isBypassedHost(")) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});
