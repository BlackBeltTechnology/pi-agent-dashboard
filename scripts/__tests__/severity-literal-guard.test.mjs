/**
 * Static guard — a raw red Tailwind literal may not re-enter a governed
 * tool-result error surface.
 *
 * Resolution of design Q1 (change: repair-tool-error-surfaces): the guard lives
 * here, as a vitest test, NOT as a fifth rule in scripts/check-conventions.mjs.
 * That file caps itself at four rules ("growth pressure here is a signal to
 * write a different script"), and it runs only in ship-it step 4.4 — whereas
 * `npm test` runs in CI (ci.yml), publish.yml and `npm run quality:changed`.
 * Same shape and home as scripts/__tests__/repo-hygiene.test.mjs.
 *
 * SCOPE: the governed file allowlist only. A repo-wide ban would fire on ~40
 * legitimate literals (destructive buttons, preview panes, connectivity
 * panels) and would be switched off within a week. A single literal inside a
 * governed file may be exempted with a `severity-exempt: <reason>` marker on
 * its own or the preceding line — see the stop button in ToolCallStep.tsx.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** The tool-result error surfaces enrolled by repair-tool-error-surfaces. */
const GOVERNED = [
  "packages/client/src/components/tool-renderers/CtxToolRenderer.tsx",
  "packages/client/src/components/tool-renderers/AskUserToolRenderer.tsx",
  "packages/client/src/components/tool-renderers/AgentToolRenderer.tsx",
  "packages/client/src/components/chat/ToolBurstGroup.tsx",
  "packages/client/src/components/chat/BashOutputCard.tsx",
  "packages/client/src/components/chat/ToolCallStep.tsx",
];

const RAW_RED = /\bred-\d{3}\b/;
const EXEMPT = /severity-exempt:/;

/** Violations = raw red literals in `content`, minus exempted lines. */
export function rawRedViolations(file, content) {
  const lines = content.split("\n");
  const out = [];
  lines.forEach((line, i) => {
    if (!RAW_RED.test(line)) return;
    if (EXEMPT.test(line) || EXEMPT.test(lines[i - 1] ?? "")) return;
    out.push({ file, line: i + 1, text: line.trim() });
  });
  return out;
}

describe("governed tool-result error surfaces use severity tokens, not raw red literals", () => {
  it("every governed file still exists (the allowlist has not silently rotted)", () => {
    const missing = GOVERNED.filter((f) => !fs.existsSync(path.join(repoRoot, f)));
    expect(missing, `governed files not found: ${missing.join(", ")}`).toEqual([]);
  });

  it("no governed file carries an unexempted raw red-<NNN> literal", () => {
    const violations = [];
    for (const file of GOVERNED) {
      const abs = path.join(repoRoot, file);
      if (!fs.existsSync(abs)) continue;
      violations.push(...rawRedViolations(file, fs.readFileSync(abs, "utf8")));
    }
    const report = violations.map((v) => `${v.file}:${v.line} — ${v.text}`);
    expect(report, `raw red literals in governed error surfaces:\n${report.join("\n")}`).toEqual([]);
  });

  it("detects a re-introduced literal, and honours the exempt marker", () => {
    const bad = 'const c = "text-red-400 bg-red-950/20";';
    expect(rawRedViolations("f.tsx", bad)).toHaveLength(1);
    expect(rawRedViolations("f.tsx", bad)[0].line).toBe(1);
    expect(rawRedViolations("f.tsx", `${bad} // severity-exempt: destructive button`)).toEqual([]);
    expect(rawRedViolations("f.tsx", `// severity-exempt: reason\n${bad}`)).toEqual([]);
    expect(rawRedViolations("f.tsx", 'const c = "text-[var(--severity-error-fg)]";')).toEqual([]);
  });

  it("does not fire on the legitimate literals outside the governed set", () => {
    // Sampled non-error surfaces named as out-of-scope in the proposal.
    const outside = [
      "packages/client/src/components/composer/Composer.tsx",
      "packages/client/src/components/git/GitPanel.tsx",
    ].filter((f) => fs.existsSync(path.join(repoRoot, f)));
    expect(outside.every((f) => !GOVERNED.includes(f))).toBe(true);
  });
});
