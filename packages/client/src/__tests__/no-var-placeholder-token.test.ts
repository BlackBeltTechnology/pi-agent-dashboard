/**
 * Repository lint: ban the literal three-dot `bg-`/`text-` var() placeholder
 * tokens (the arbitrary-value form with a three-dot argument) from ALL client
 * source (`.ts`/`.tsx`/`.md`).
 *
 * The bug — captured in change `fix-vite-build-warnings` — was: prose in
 * `session-status-visuals.ts` (and its `.AGENTS.md` sidecar) used the literal
 * three-dot placeholder tokens to *describe* the colour helpers. Tailwind v4's
 * content scanner reads comments + markdown (and scans `packages/client/src/**`,
 * including this `__tests__` dir), extracted those
 * three-dot tokens as real arbitrary-value utilities, and Lightning CSS then
 * failed to parse the placeholder `var(...)` → `Unexpected token Delim('.')`.
 *
 * Fix: reword the prose so the three-dot placeholder never appears. This lint
 * guards against any future comment / sidecar re-introducing it (repo-wide,
 * not just the two seed files).
 *
 * The needle is built at runtime from parts so THIS file never contains the
 * literal three-dot token and cannot self-trip.
 *
 * See change: fix-vite-build-warnings (test-plan #S1).
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const CLIENT_SRC = path.resolve(__dirname, "..");

// Build the `bg-`/`text-` var() placeholder regex without writing the literal
// three-dot token in this source (so the scan below never matches itself).
const DOTS = ".".repeat(3);
const PLACEHOLDER = new RegExp(`(?:bg|text)-\\[var\\(${DOTS.replace(/\./g, "\\.")}\\)\\]`);

const SCAN_EXTS = new Set([".ts", ".tsx", ".md"]);

/** Recursively collect scannable source files under `dir`. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      out.push(...walk(abs));
    } else if (SCAN_EXTS.has(path.extname(entry.name)) || entry.name.endsWith(".AGENTS.md")) {
      out.push(abs);
    }
  }
  return out;
}

describe("Lint: no literal bg-/text- var() three-dot placeholder tokens", () => {
  it("no client source re-introduces the placeholder token", () => {
    const offenders: string[] = [];
    for (const abs of walk(CLIENT_SRC)) {
      const text = fs.readFileSync(abs, "utf8");
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (PLACEHOLDER.test(lines[i])) {
          offenders.push(`${path.relative(CLIENT_SRC, abs)}:${i + 1}  ${lines[i].trim().slice(0, 120)}`);
        }
      }
    }
    if (offenders.length > 0) {
      throw new Error(
        `Found literal bg-/text- var() three-dot placeholder tokens (see change fix-vite-build-warnings):\n` +
          offenders.map((o) => `  - ${o}`).join("\n") +
          `\n\nFix: reword the prose — Tailwind extracts the token as a real utility that Lightning CSS cannot parse.`,
      );
    }
    expect(offenders).toEqual([]);
  });

  it("matcher sanity: catches both prefixes and ignores real tokens", () => {
    expect(PLACEHOLDER.test(`bg-[var(${DOTS})]`)).toBe(true);
    expect(PLACEHOLDER.test(`text-[var(${DOTS})]`)).toBe(true);
    // A real, valid var() token must NOT trip the lint.
    expect(PLACEHOLDER.test("bg-[var(--status-error)]")).toBe(false);
    expect(PLACEHOLDER.test("text-[var(--text-muted)]")).toBe(false);
  });
});
