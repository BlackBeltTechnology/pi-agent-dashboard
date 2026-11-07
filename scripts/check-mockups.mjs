#!/usr/bin/env node
/**
 * Mock check (advisory) — every NEW entry under a mock root (`mockups/` or
 * `openspec/changes/<change>/mockups/`, archive excluded) must be a live mock:
 *   - a directory passes with `mock.tsx` under a dated id (yyyy-mm-dd-slug), or a
 *     `STATIC.md` naming the static exception (geometry repro / no buildable
 *     components) — the exemption travels with the dir when it is adopted;
 *   - a loose `.html` file always fails: move it into a dir with STATIC.md.
 * Root support files (AGENTS.md, mock-site.*, tsconfig.json, *.md notes) are not entries.
 *
 * Standalone: check-conventions.mjs is at its five-rule ceiling. Advisory: exits 0
 * and prints findings; `--strict` exits 1 on a finding (for the follow-up gate wiring).
 *
 *   node scripts/check-mockups.mjs --base <rev> [--strict]
 *
 * See change: add-mock-site-exact-env (design D11).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MOCK_ID_RE = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/;
/** `<root>/<entry>[/rest]` for a path under a mock root, else null. */
const ROOT_RE = /^((?:openspec\/changes\/(?!archive\/)[^/]+\/)?mockups)\/([^/]+)(\/.*)?$/;

/**
 * Mock-root entries touched by the given (added) repo-relative paths.
 * @param {string[]} files
 * @returns {{ entry: string, dir: boolean }[]} entry = `<mock root>/<name>`
 */
export function mockEntries(files) {
  /** @type {Map<string, boolean>} */
  const out = new Map();
  for (const f of files) {
    const m = ROOT_RE.exec(f.replace(/\\/g, "/"));
    if (!m) continue;
    const [, root, name, rest] = m;
    const dir = rest !== undefined;
    if (!dir && !name.endsWith(".html")) continue; // root support files and notes
    out.set(`${root}/${name}`, dir || out.get(`${root}/${name}`) === true);
  }
  return [...out].map(([entry, dir]) => ({ entry, dir }));
}

/**
 * Findings for entries, judged on the CURRENT tree under `root`.
 * @param {{ entry: string, dir: boolean }[]} entries @param {string} root
 * @returns {{ entry: string, reason: string }[]}
 */
export function mockFindings(entries, root) {
  /** @type {{ entry: string, reason: string }[]} */
  const out = [];
  for (const { entry, dir } of entries) {
    const abs = path.join(root, entry);
    if (!dir) { out.push({ entry, reason: "loose static file: move it into a dir with STATIC.md naming the exception, or make it a live mock (<yyyy-mm-dd-slug>/mock.tsx)" }); continue; }
    if (!fs.existsSync(abs)) continue; // added then removed / moved away
    if (fs.existsSync(path.join(abs, "STATIC.md"))) continue;
    const live = fs.existsSync(path.join(abs, "mock.tsx"));
    if (live && MOCK_ID_RE.test(path.basename(entry))) continue;
    out.push({ entry, reason: live ? "live mock needs a dated id (yyyy-mm-dd-slug)" : "not a live mock: add <yyyy-mm-dd-slug>/mock.tsx, or a STATIC.md naming the static exception" });
  }
  return out;
}

/** Paths added since `base` (committed, staged, untracked). Renames count as adds. @param {string} base @param {string} cwd */
function addedFiles(base, cwd) {
  const git = (/** @type {string[]} */ a) => execFileSync("git", a, { cwd, encoding: "utf8" }).split("\n").filter(Boolean);
  return [...new Set([
    ...git(["diff", "--name-only", "--no-renames", "--diff-filter=A", `${base}...HEAD`]),
    ...git(["diff", "--name-only", "--no-renames", "--diff-filter=A", "HEAD"]),
    ...git(["ls-files", "--others", "--exclude-standard"]),
  ])];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const i = args.indexOf("--base");
  if (i < 0 || !args[i + 1]) {
    process.stderr.write("usage: check-mockups.mjs --base <rev> [--strict]\n");
    process.exit(2);
  }
  const findings = mockFindings(mockEntries(addedFiles(args[i + 1], ROOT)), ROOT);
  for (const f of findings) process.stdout.write(`check-mockups: ${f.entry}: ${f.reason}\n`);
  process.stdout.write(findings.length ? `check-mockups: ${findings.length} non-live mock entr${findings.length === 1 ? "y" : "ies"} (advisory)\n` : "check-mockups: ok\n");
  process.exit(findings.length && args.includes("--strict") ? 1 : 0);
}
