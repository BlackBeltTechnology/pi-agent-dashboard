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
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** The tool-result error surfaces enrolled by repair-tool-error-surfaces. */
const GOVERNED = [
  "packages/client/src/components/tool-renderers/CtxToolRenderer.tsx",
  "packages/client/src/components/tool-renderers/AskUserToolRenderer.tsx",
  "packages/subagents-plugin/src/client/AgentToolRenderer.tsx",
  "packages/client/src/components/chat/ToolBurstGroup.tsx",
  "packages/client/src/components/chat/BashOutputCard.tsx",
  "packages/client/src/components/chat/ToolCallStep.tsx",
];

const RAW_RED = /\bred-\d{2,3}\b/;
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

/** Violations across the GOVERNED set only; `read(file)` returns a file's content or undefined. */
export function governedViolations(read) {
  const out = [];
  for (const file of GOVERNED) {
    const content = read(file);
    if (content !== undefined) out.push(...rawRedViolations(file, content));
  }
  return out;
}

/** Every tracked client source file, for the anti-vacuity sample below. */
function walkClientSources() {
  const out = execFileSync("git", ["ls-files", "packages/client/src/**/*.tsx"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return out.split("\n").filter(Boolean);
}

describe("governed tool-result error surfaces use severity tokens, not raw red literals", () => {
  it("every governed file still exists (the allowlist has not silently rotted)", () => {
    const missing = GOVERNED.filter((f) => !fs.existsSync(path.join(repoRoot, f)));
    expect(missing, `governed files not found: ${missing.join(", ")}`).toEqual([]);
  });

  it("no governed file carries an unexempted raw red-<NNN> literal", () => {
    const violations = governedViolations((file) => {
      const abs = path.join(repoRoot, file);
      return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : undefined;
    });
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
    // Anti-vacuity: sample real out-of-scope files that DO carry red literals,
    // prove the guard would report them if enrolled, then prove they are not
    // enrolled. Asserting only "not in GOVERNED" would pass without ever
    // exercising rawRedViolations.
    const outside = walkClientSources()
      .filter((f) => !GOVERNED.includes(f))
      .map((f) => ({ file: f, hits: rawRedViolations(f, fs.readFileSync(path.join(repoRoot, f), "utf8")) }))
      .filter((r) => r.hits.length > 0);

    expect(outside.length, "no out-of-scope red literals found — the sample is vacuous").toBeGreaterThan(0);
    for (const { file } of outside) expect(GOVERNED).not.toContain(file);
  });
});

// #E50 (decouple-plugins-from-core, task 4.4): moving the Agent renderer into the
// plugin must not drop it from the governed set, and must not widen the guard.
describe("the moved Agent renderer stays governed; non-error surfaces are unaffected (E50)", () => {
  const MOVED = "packages/subagents-plugin/src/client/AgentToolRenderer.tsx";
  const UNGOVERNED = "packages/client/src/components/some/DeleteButton.tsx";

  it("a raw red literal injected into the moved renderer fails with file:line", () => {
    const real = fs.readFileSync(path.join(repoRoot, MOVED), "utf8");
    const injected = `${real}\nconst leaked = "text-red-400";\n`;
    const injectedLine = injected.split("\n").indexOf('const leaked = "text-red-400";') + 1;
    const hits = governedViolations((file) => (file === MOVED ? injected : undefined));
    expect(hits.map((h) => `${h.file}:${h.line}`)).toEqual([`${MOVED}:${injectedLine}`]);
  });

  it("an ungoverned destructive button keeps its bg-red-500 without tripping the guard", () => {
    const button = '<button className="bg-red-500 text-white">Delete</button>';
    expect(GOVERNED).not.toContain(UNGOVERNED);
    // The literal IS a raw red (the sample is not vacuous) ...
    expect(rawRedViolations(UNGOVERNED, button)).toHaveLength(1);
    // ... but only enrolled files are scanned, so the guard passes.
    expect(governedViolations((file) => (file === UNGOVERNED ? button : undefined))).toEqual([]);
  });
});
