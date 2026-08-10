#!/usr/bin/env node
/**
 * Repo convention checks — the deterministic half of ship-it's pre-ship gate
 * (D6, D7, D11). Four rules, no dependencies, no framework.
 *
 * Each rule is exported as a pure fn over (path, content) so it can be unit
 * tested without git state; the CLI at the bottom is thin glue.
 *
 * SCOPE: every rule is a regression guard over the files a change TOUCHES, not
 * a tree-absolute audit. 214 tracked .md files carry an ASCII diagram — mostly
 * archived OpenSpec history that must not be rewritten — so a tree-absolute
 * diagram rule could never land green, the same trap that ruled out wiring raw
 * `kb dox lint`. Rules 2 and 3 stay tree-absolute because their present count is
 * zero, so they cost no backfill.
 *
 * Four rules is the ceiling. Growth pressure here is a signal to write a
 * different script, not to add a plugin system.
 *
 *   node scripts/check-conventions.mjs [--base <ref>]
 *
 * Without --base the Discipline-Skills rule reports without gating, because
 * "touched" is undefined with no diff base. The mode is selected by the flag,
 * never inferred.
 *
 * See change: wire-local-review-gate.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Box-drawing chars used to draw diagrams. */
const BOX_DRAWING = /[┌┐└┘├┤┬┴┼─│╔╗╚╝║═╠╣╦╩╬]/;
/**
 * A directory-tree ROW. Trees legitimately use box-drawing characters and are
 * NOT diagrams — README.md and docs/electron-session.md both contain one. A
 * naive any-box-drawing rule flags 7 files; this exclusion brings it to the 4
 * real diagrams.
 */
const TREE_ROW = /(├──|└──|^\s*│\s*(└|├|$))/;

/**
 * Rule 1 — diagrams must be Mermaid, not ASCII box-drawing.
 * Only fenced blocks count; a stray glyph in prose is not a diagram.
 */
export function mermaidViolations(file, content) {
  const out = [];
  const lines = content.split("\n");
  let fenced = false;
  let lang = "";
  lines.forEach((line, i) => {
    const fence = line.match(/^\s*```(\w*)/);
    if (fence) {
      if (fenced) {
        fenced = false;
        lang = "";
      } else {
        fenced = true;
        lang = fence[1];
      }
      return;
    }
    if (!fenced || lang === "mermaid") return;
    if (!BOX_DRAWING.test(line)) return;
    if (TREE_ROW.test(line)) return;
    out.push({
      file,
      line: i + 1,
      message: `ASCII box-drawing diagram — use a \`\`\`mermaid block instead`,
    });
  });
  // One violation per file is enough to act on; report the first.
  return out.slice(0, 1);
}

/**
 * Rule 1 applied to a touched set. A pure rename is not authorship, so
 * relocating a legacy doc does not drag its diagram into the gate.
 */
export function mermaidViolationsIn(touched) {
  const out = [];
  for (const entry of touched) {
    if (!entry.path.endsWith(".md")) continue;
    if (entry.status === "R") continue;
    out.push(...mermaidViolations(entry.path, entry.content));
  }
  return out;
}

/**
 * A driver counts only in COMMAND position — actually invoked, optionally via a
 * runner prefix. The word inside a comment (`# ... a Playwright test ...`) or an
 * echoed string (`info "playwright exit=$rc"`) is prose about the run, not a
 * browser being driven from bash.
 */
const DRIVER_INVOCATION = new RegExp(
  String.raw`(?:^|[|;&(]|&&|\|\||\$\(|\x60)\s*` +
    String.raw`(?:(?:npx|pnpm|yarn|sudo|exec|dlx)\s+)*` +
    String.raw`(agent-browser|playwright|puppeteer|chromedriver|selenium)\b[^\n]*`,
  "gm",
);

/**
 * Invoking the Playwright RUNNER is delegation, not authorship: the browser
 * scenarios stay in tests/e2e/*.spec.ts and the script merely wraps the run to
 * observe something a spec cannot (e.g. the container cgroup, readable only via
 * `docker exec` from the host).
 */
const PLAYWRIGHT_RUNNER = /^playwright\s+(?:test|install|show-report)\b/;

/** Strip full-line shell comments before looking for an invocation. */
function stripComments(content) {
  return content
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");
}

/** True when the script actually invokes a browser driver (not merely names one). */
function drivesBrowser(content) {
  for (const m of stripComments(content).matchAll(DRIVER_INVOCATION)) {
    // Re-anchor on the driver token so the runner check sees `playwright test`.
    const invocation = m[0].slice(m[0].indexOf(m[1]));
    if (m[1] === "playwright" && PLAYWRIGHT_RUNNER.test(invocation)) continue;
    return true;
  }
  return false;
}

/**
 * Rule 2 — browser scenarios belong in tests/e2e Playwright specs, not qa/*.sh.
 * Pure regression guard: there are 0 violations today. The three suspected
 * files assert WebSocket and API behaviour, and their per-OS VM home is exactly
 * what a migration to Playwright would destroy.
 */
export function shellBrowserViolations(file, content) {
  if (!/^qa\/tests\/.*\.sh$/.test(file)) return [];
  if (!drivesBrowser(content)) return [];
  return [
    {
      file,
      message:
        "shell test drives rendered browser UI — author it as a Playwright spec in tests/e2e/ instead",
    },
  ];
}

/**
 * Rule 3 — the root AGENTS.md carries no per-file index.
 * A per-file index is a TABLE whose rows map a filename to a purpose. A prose
 * section that merely names Key Files and points elsewhere is compliant.
 */
export function rootIndexViolations(content) {
  const lines = content.split("\n");
  let fileRows = 0;
  for (const line of lines) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    // cells[0] is the empty string before the leading pipe
    const first = cells[1] ?? "";
    if (/^`[^`]+\.(ts|tsx|js|jsx|mjs|mts|json|md|sh|css|yml|yaml)`$/.test(first)) fileRows++;
  }
  return fileRows >= 2
    ? [
        {
          file: "AGENTS.md",
          message: `root AGENTS.md contains a per-file index (${fileRows} file rows) — per-file records belong in the directory AGENTS.md tree`,
        },
      ]
    : [];
}

/**
 * Rule 4 — a touched proposal.md carries `## Discipline Skills` (D7).
 * `touched` = added or content-modified. A pure rename (status R) is NOT
 * authorship, so relocating a legacy proposal does not drag it into the gate.
 */
export function disciplineSkillsViolations(touched) {
  const out = [];
  for (const entry of touched) {
    if (!/(^|\/)proposal\.md$/.test(entry.path)) continue;
    if (entry.status === "R") continue;
    if (/^##\s+Discipline Skills\s*$/m.test(entry.content)) continue;
    out.push({
      file: entry.path,
      message:
        "touched proposal.md is missing a `## Discipline Skills` section — " +
        "name the eng-disciplines skills its tasks trigger, or say none apply",
    });
  }
  return out;
}

// --- CLI -------------------------------------------------------------------

function listMarkdown() {
  const out = execFileSync("git", ["ls-files", "*.md"], { cwd: ROOT, encoding: "utf8" });
  return out.split("\n").filter(Boolean);
}

function listShellTests() {
  const out = execFileSync("git", ["ls-files", "qa/tests/*.sh"], { cwd: ROOT, encoding: "utf8" });
  return out.split("\n").filter(Boolean);
}

/**
 * Union a committed touched set with the working-tree one. The worktree wins on
 * content (it is what a fix just wrote), and a worktree edit promotes a
 * committed pure rename to a content modification.
 */
export function unionTouched(committed, worktree) {
  const byPath = new Map();
  for (const e of committed) byPath.set(e.path, { ...e });
  for (const e of worktree) {
    const prev = byPath.get(e.path);
    byPath.set(e.path, prev ? { ...prev, status: e.status, content: e.content } : { ...e });
  }
  return [...byPath.values()];
}

/** Uncommitted adds/modifications (index + working tree). */
function worktreeTouched() {
  const raw = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" });
  const entries = [];
  for (const line of raw.split("\n").filter(Boolean)) {
    const code = line.slice(0, 2);
    const file = line.slice(3).replace(/^.* -> /, "");
    if (code.includes("D")) continue;
    const abs = path.join(ROOT, file);
    if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) continue;
    entries.push({ status: "M", path: file, content: fs.readFileSync(abs, "utf8") });
  }
  return entries;
}

/** Added/content-modified/renamed files relative to `base`. */
function committedTouched(base) {
  const raw = execFileSync(
    "git",
    ["diff", "--name-status", "--diff-filter=AMR", `${base}...HEAD`],
    { cwd: ROOT, encoding: "utf8" },
  );
  const entries = [];
  for (const line of raw.split("\n").filter(Boolean)) {
    const parts = line.split("\t");
    const status = parts[0][0];
    const file = status === "R" ? parts[2] : parts[1];
    // A rename WITH content change is reported by git as R<score>; treat a
    // similarity below 100 as a content edit.
    const score = status === "R" ? Number.parseInt(parts[0].slice(1), 10) : 0;
    const effective = status === "R" && score === 100 ? "R" : status === "R" ? "M" : status;
    const abs = path.join(ROOT, file);
    entries.push({
      status: effective,
      path: file,
      content: fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : "",
    });
  }
  return entries;
}

function main() {
  const argv = process.argv.slice(2);
  const baseIdx = argv.indexOf("--base");
  const base = baseIdx >= 0 ? argv[baseIdx + 1] : null;

  const violations = [];
  // ship-it runs this inside its fix loop, where fixes are still uncommitted, so
  // the committed diff alone would inspect a stale tree.
  const touched = base ? unionTouched(committedTouched(base), worktreeTouched()) : [];

  if (base) {
    violations.push(...mermaidViolationsIn(touched));
  }
  for (const file of listShellTests()) {
    violations.push(...shellBrowserViolations(file, fs.readFileSync(path.join(ROOT, file), "utf8")));
  }
  violations.push(...rootIndexViolations(fs.readFileSync(path.join(ROOT, "AGENTS.md"), "utf8")));

  let advisory = [];
  if (base) {
    violations.push(...disciplineSkillsViolations(touched));
  } else {
    // No base ⇒ no touched set ⇒ the touched-scoped rules report without
    // gating. Archived changes are excluded: they are immutable history.
    const active = listMarkdown()
      .filter((f) => !f.startsWith("openspec/changes/archive/"))
      .map((f) => ({
        status: "M",
        path: f,
        content: fs.readFileSync(path.join(ROOT, f), "utf8"),
      }));
    advisory = [
      ...disciplineSkillsViolations(active.filter((e) => /(^|\/)proposal\.md$/.test(e.path))),
      ...mermaidViolationsIn(active),
    ];
  }

  for (const v of violations) {
    console.error(`✗ ${v.file}${v.line ? `:${v.line}` : ""} — ${v.message}`);
  }
  if (advisory.length) {
    console.log(
      `\nℹ ${advisory.length} advisory finding(s) in untouched files — reporting only ` +
        "(no --base, so the touched set is undefined). Archived changes excluded.",
    );
  }
  if (violations.length === 0) console.log("✓ check-conventions: no violations");
  process.exit(violations.length === 0 ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
