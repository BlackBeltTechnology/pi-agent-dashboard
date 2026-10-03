#!/usr/bin/env node
// reverse-spec-for-rebuild deterministic guards (Node >= 20, no dependencies).
//
//   node guard.mjs check-dest <path> [--protect <dir>]...
//       exit 0 when <path> may receive a promoted rebuild package;
//       exit 1 when its resolved real path lies inside a protected root
//       (default roots: openspec docs packages .pi; --protect replaces them).
//   node guard.mjs sweep [--run <id>]
//       remove this skill's transient openspec/specs/_rsfr-val-* dirs: with --run, every
//       _rsfr-val-<id>-* dir of that run; without, only stale ones (untouched for
//       STALE_MS, i.e. left by an interrupted run), so a concurrent run's live ids survive.
//   node guard.mjs lint-spec <file>
//       structural check of an OpenSpec full-form spec; exit 1 with
//       "<file>:<line>: <reason>" per violation on stdout.
//
// Bad input (missing/empty argument, unknown subcommand) -> exit 2 + usage on stderr.
// Paths are resolved against the current directory; the repository root is
// `git rev-parse --show-toplevel`, falling back to the current directory.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const DEFAULT_PROTECTED = ["openspec", "docs", "packages", ".pi"];
const VAL_PREFIX = "_rsfr-val-";
const STALE_MS = 10 * 60 * 1000;

const USAGE = `usage:
  node guard.mjs check-dest <path> [--protect <dir>]...
  node guard.mjs sweep [--run <id>]
  node guard.mjs lint-spec <file>`;

function usage(msg) {
  if (msg) process.stderr.write(`${msg}\n`);
  process.stderr.write(`${USAGE}\n`);
  process.exit(2);
}

function repoRoot() {
  let root = process.cwd();
  try {
    root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // not a git repository: the current directory is the root
  }
  return realpathSync(root);
}

/** Real path of `p`, resolving the nearest existing ancestor (p itself may not exist yet). */
function realPathOf(p) {
  let existing = resolve(p);
  const tail = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) break;
    tail.unshift(existing.slice(parent.length).replace(/^[\\/]+/, ""));
    existing = parent;
  }
  return join(realpathSync(existing), ...tail);
}

function inside(child, parent) {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function parseDestArgs(args) {
  const protect = [];
  let dest;
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== "--protect") {
      if (dest !== undefined) usage(`check-dest: unexpected argument ${args[i]}`);
      dest = args[i];
      continue;
    }
    const dir = args[++i];
    if (!dir) usage("check-dest: --protect needs a directory");
    protect.push(dir.replace(/[\\/]+$/, ""));
  }
  if (!dest) usage("check-dest: missing destination path");
  return { dest, protect: protect.length ? protect : DEFAULT_PROTECTED };
}

function checkDest(args) {
  const { dest, protect } = parseDestArgs(args);
  const root = repoRoot();
  const real = realPathOf(dest);
  for (const dir of protect) {
    const plain = resolve(root, dir);
    const candidates = existsSync(plain) ? [plain, realpathSync(plain)] : [plain];
    if (candidates.some((c) => inside(real, c))) {
      process.stderr.write(`refused: ${dest} resolves to ${real}, inside protected root ${dir}/\n`);
      process.exit(1);
    }
  }
  process.stdout.write(`ok: ${real}\n`);
}

function sweep(args) {
  let run;
  if (args[0] === "--run") {
    run = args[1];
    if (!run || /[\\/]/.test(run)) usage("sweep: --run needs a run id (no path separators)");
    if (args.length > 2) usage(`sweep: unexpected argument ${args[2]}`);
  } else if (args.length) usage(`sweep: unexpected argument ${args[0]}`);
  const specs = join(repoRoot(), "openspec", "specs");
  if (!existsSync(specs) || !statSync(specs).isDirectory()) return;
  const now = Date.now();
  for (const name of readdirSync(specs)) {
    const path = join(specs, name);
    const owned = run
      ? name.startsWith(`${VAL_PREFIX}${run}-`)
      : name.startsWith(VAL_PREFIX) && now - statSync(path).mtimeMs > STALE_MS;
    if (!owned) continue;
    rmSync(path, { recursive: true, force: true });
    process.stdout.write(`swept: openspec/specs/${name}\n`);
  }
}

const MSG = {
  title: "first content line must be a `# <title>` heading",
  table: "markdown table not allowed",
  boldScenario: "bold scenario label; use a `#### Scenario: <name>` heading",
  boldRequirement: "bold requirement label; use a `### Requirement: <name>` heading",
  reqHeading: "requirement heading must be `### Requirement: <name>`",
  reqNumbered: "numbered requirement heading",
  reqOutside: "requirement outside `## Requirements`",
  scenHeading: "scenario heading must be `#### Scenario: <name>`",
  scenOutside: "scenario outside a requirement",
  heading: "unexpected heading; only `### Requirement:` and `#### Scenario:` are allowed below `## Requirements`",
  noWhen: "scenario has no `- **WHEN**` line",
  noThen: "scenario has no `- **THEN**` line",
  noScenario: "requirement has no `#### Scenario:`",
};

/** Structural checker for one OpenSpec full-form spec; feed lines, then finish(). */
class SpecLinter {
  constructor(file) {
    this.file = file;
    this.errors = [];
    this.inComment = false;
    this.inFence = false;
    this.title = 0;
    this.purpose = 0;
    this.requirements = 0;
    this.section = ""; // text of the current `## ` heading
    this.reqCount = 0;
    this.req = null; // { line, scenarios }
    this.scen = null; // { line, when, then }
  }

  report(line, reason) {
    this.errors.push(`${this.file}:${line}: ${reason}`);
  }

  /** The line with HTML comments (citations, also multi-line) removed; null when nothing is left to check. */
  visible(raw) {
    let line = raw;
    if (this.inComment) {
      const end = line.indexOf("-->");
      if (end < 0) return null;
      line = line.slice(end + 3);
      this.inComment = false;
    }
    line = line.replace(/<!--.*?-->/g, "");
    const open = line.indexOf("<!--");
    if (open >= 0) {
      line = line.slice(0, open);
      this.inComment = true;
    }
    if (/^\s*(```|~~~)/.test(line)) {
      this.inFence = !this.inFence;
      return null;
    }
    return this.inFence || line.trim() === "" ? null : line;
  }

  closeScenario() {
    if (!this.scen) return;
    if (!this.scen.when) this.report(this.scen.line, MSG.noWhen);
    if (!this.scen.then) this.report(this.scen.line, MSG.noThen);
    this.scen = null;
  }

  closeRequirement() {
    this.closeScenario();
    if (this.req && this.req.scenarios === 0) this.report(this.req.line, MSG.noScenario);
    this.req = null;
  }

  line(raw, n) {
    const line = this.visible(raw);
    if (line === null) return;
    if (!this.title) {
      this.title = /^# \S/.test(line) ? n : -1;
      if (this.title === n) return;
      this.report(n, MSG.title);
    }
    if (/^\s*\|.*\|\s*$/.test(line)) this.report(n, MSG.table);
    if (/^\s*(?:[-*]\s+)?\*\*\s*Scenario\b/i.test(line)) this.report(n, MSG.boldScenario);
    if (/^\s*(?:[-*]\s+)?\*\*\s*Requirement\b/i.test(line)) this.report(n, MSG.boldRequirement);
    if (/^#{2,}\s/.test(line)) this.heading(line, n);
    else if (this.scen) {
      if (/^\s*- \*\*WHEN\*\*/.test(line)) this.scen.when = true;
      if (/^\s*- \*\*THEN\*\*/.test(line)) this.scen.then = true;
    }
  }

  heading(line, n) {
    if (/^##\s/.test(line)) {
      this.closeRequirement();
      this.section = line.trim();
    }
    if (/^## Purpose\s*$/.test(line)) this.purpose = n;
    else if (/^## Requirements\s*$/.test(line)) this.requirements = n;
    else if (/^##\s/.test(line)) return;
    else if (/^###\s+Requirement\b/.test(line)) this.requirement(line, n);
    else if (/^####\s+Scenario\b/.test(line)) this.scenario(line, n);
    else {
      this.closeRequirement();
      this.report(n, MSG.heading);
    }
  }

  requirement(line, n) {
    this.closeRequirement();
    this.reqCount++;
    this.req = { line: n, scenarios: 0 };
    if (!/^### Requirement: \S/.test(line)) this.report(n, MSG.reqHeading);
    else if (/^### Requirement: (?:\d+[.:)]|#\d)/.test(line)) this.report(n, MSG.reqNumbered);
    if (this.section !== "## Requirements") this.report(n, MSG.reqOutside);
  }

  scenario(line, n) {
    this.closeScenario();
    this.scen = { line: n, when: false, then: false };
    if (!/^#### Scenario: \S/.test(line)) this.report(n, MSG.scenHeading);
    if (this.req) this.req.scenarios++;
    else this.report(n, MSG.scenOutside);
  }

  finish() {
    this.closeRequirement();
    if (this.title === 0) this.report(1, "missing `# <title>` heading");
    if (!this.purpose) this.report(1, "missing `## Purpose` section");
    if (!this.requirements) this.report(1, "missing `## Requirements` section");
    else if (this.reqCount === 0) this.report(this.requirements, "`## Requirements` has no `### Requirement:`");
    return this.errors;
  }
}

function lintSpec(args) {
  const [file, extra] = args;
  if (!file) usage("lint-spec: missing spec file");
  if (extra !== undefined) usage(`lint-spec: unexpected argument ${extra}`);
  if (!existsSync(file) || !statSync(file).isFile()) {
    process.stderr.write(`lint-spec: not found: ${file}\n`);
    process.exit(2);
  }
  const linter = new SpecLinter(file);
  readFileSync(file, "utf8")
    .split(/\r?\n/)
    .forEach((raw, idx) => linter.line(raw, idx + 1));
  const errors = linter.finish();
  if (errors.length) {
    process.stdout.write(`${errors.join("\n")}\n`);
    process.exit(1);
  }
}

const [cmd, ...rest] = process.argv.slice(2);
switch (cmd) {
  case "check-dest":
    checkDest(rest);
    break;
  case "sweep":
    sweep(rest);
    break;
  case "lint-spec":
    lintSpec(rest);
    break;
  default:
    usage(cmd ? `unknown subcommand: ${cmd}` : "missing subcommand");
}
