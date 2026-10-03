#!/usr/bin/env node
// reverse-spec-for-rebuild deterministic guards (Node >= 20, no dependencies).
//
//   node guard.mjs check-dest <path> [--protect <dir>]...
//       exit 0 when <path> may receive a promoted rebuild package;
//       exit 1 when its resolved real path lies inside a protected root
//       (default roots: openspec docs packages .pi; --protect replaces them).
//   node guard.mjs check-cap <name>
//       exit 0 when <name> is a single kebab-case path component ([a-z0-9]+(-[a-z0-9]+)*)
//       of at most CAP_MAX chars (keeps `_rsfr-val-<run>-<cap>` under 255), else exit 2 — capability names become file names and validation ids.
//   node guard.mjs check-run <id>
//       exit 0 when <id> is a safe run id ([A-Za-z0-9][A-Za-z0-9-]*), else exit 2.
//   node guard.mjs slug <target>
//       print the scratch slug of <target>: `root` for the repository root, else a
//       kebab-case form of its canonical repo-relative path plus an 8-hex hash of that
//       path (collision-free, never `.`/`..`); exit 2 when <target> is outside the repo.
//   node guard.mjs lock <slug> <run-id> / unlock <slug> <run-id> / break-lock <slug> <owner>
//       one run per target: `.reverse-spec-scratch/<slug>.lock` holds the owning run id.
//       lock: create it exclusively (O_EXCL), or succeed when this run already owns it;
//       exit 1 when any other run holds it. Locks never expire on their own.
//       unlock: remove it only when this run owns it (exit 1 otherwise).
//       break-lock: human-confirmed removal of a leftover lock, only when <owner> owns it.
//   node guard.mjs check-manifest <manifest.json>
//       exit 2 unless `capabilities[].capability` is non-empty, kebab-case and unique.
//   node guard.mjs new-run
//       print a collision-resistant run id: <UTC yyyymmddThhmmssZ>-<8 random hex>.
//   node guard.mjs seed-ids <ids.json> <dir>...
//       raise each BR/QUIRK/GAP high-water mark in <ids.json> to the max of its current
//       value, every <dir>/_ids.json, and every id found in <dir>/*.md (never lowers).
//   node guard.mjs next-id <ids.json> <BR|QUIRK|GAP>
//       allocate the next id above the mark, persist the mark, print e.g. BR-011.
//   node guard.mjs sweep [--run <id>]
//       remove this skill's transient openspec/specs/_rsfr-val-* dirs: with --run, every
//       _rsfr-val-<id>-* dir of that run; without, only abandoned ones — a dir whose
//       `.owner` pid is no longer alive, or (no `.owner`) one untouched for STALE_MS —
//       so a concurrent run's live validation dirs survive.
//   node guard.mjs lint-spec <file>
//       structural check of an OpenSpec full-form spec; exit 1 with
//       "<file>:<line>: <reason>" per violation on stdout.
//
// Bad input (missing/empty argument, unknown subcommand) -> exit 2 + usage on stderr.
// Paths are resolved against the current directory; the repository root is
// `git rev-parse --show-toplevel`, falling back to the current directory.

import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";

const DEFAULT_PROTECTED = ["openspec", "docs", "packages", ".pi"];
const VAL_PREFIX = "_rsfr-val-";
const STALE_MS = 10 * 60 * 1000;

const USAGE = `usage:
  node guard.mjs check-dest <path> [--protect <dir>]...
  node guard.mjs check-cap <name>
  node guard.mjs check-run <id>
  node guard.mjs slug <target>
  node guard.mjs lock <slug> <run-id>
  node guard.mjs unlock <slug> <run-id>
  node guard.mjs break-lock <slug> <owner-run-id>
  node guard.mjs check-manifest <manifest.json>
  node guard.mjs new-run
  node guard.mjs seed-ids <ids.json> <dir>...
  node guard.mjs next-id <ids.json> <BR|QUIRK|GAP>
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

const MAX_LINKS = 40;

/**
 * Where `p` lands when the kernel walks it, component by component: `..` applies to the
 * directory reached so far (after following any symlink), symlinks are followed even
 * when dangling, and components that do not exist yet are appended as real dirs would be.
 */
function realPathOf(p, base = process.cwd(), depth = 0) {
  if (depth > MAX_LINKS) {
    process.stderr.write(`check-dest: too many symlinks resolving ${p}\n`);
    process.exit(2);
  }
  let current = isAbsolute(p) ? parse(p).root : realpathSync(base);
  for (const part of p.split(/[\\/]+/)) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      current = dirname(current);
      continue;
    }
    const next = join(current, part);
    let st;
    try {
      st = lstatSync(next);
    } catch {
      current = next; // does not exist (yet)
      continue;
    }
    current = st.isSymbolicLink() ? realPathOf(readlinkSync(next), current, depth + 1) : next;
  }
  return current;
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
    // same kernel-order resolution as the destination, relative to the repo root
    const candidates = [resolve(root, dir), realPathOf(dir, root)];
    if (candidates.some((c) => inside(real, c))) {
      process.stderr.write(`refused: ${dest} resolves to ${real}, inside protected root ${dir}/\n`);
      process.exit(1);
    }
  }
  process.stdout.write(`ok: ${real}\n`);
}

function newRun(args) {
  if (args.length) usage(`new-run: unexpected argument ${args[0]}`);
  const ts = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  process.stdout.write(`${ts}-${randomBytes(4).toString("hex")}\n`);
}

const SLUG_READABLE_MAX = 60;
const CAP_MAX = 60;
const CAP_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RUN_RE = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

function checkName(args, re, what) {
  const [value, extra] = args;
  if (value === undefined || extra !== undefined) usage(`check-${what}: needs exactly one ${what} name`);
  if (!re.test(value) || (what === "cap" && value.length > CAP_MAX)) {
    process.stderr.write(`invalid ${what === "cap" ? "capability" : "run"} name: ${JSON.stringify(value)}\n`);
    process.exit(2);
  }
}

function slug(args) {
  const [target, extra] = args;
  if (!target || extra !== undefined) usage("slug: needs exactly one target path");
  const root = repoRoot();
  const real = realPathOf(target);
  if (!inside(real, root)) {
    process.stderr.write(`slug: ${target} resolves to ${real}, outside the repository ${root}\n`);
    process.exit(2);
  }
  const rel = relative(root, real).split(sep).join("/");
  if (rel === "") {
    process.stdout.write("root\n");
    return;
  }
  // bounded so the slug stays a valid path component for any depth; the hash keeps it unique
  const readable =
    rel
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, SLUG_READABLE_MAX)
      .replace(/^-+|-+$/g, "") || "t";
  const hash = createHash("sha256").update(rel).digest("hex").slice(0, 8);
  process.stdout.write(`${readable}-${hash}\n`);
}

function lockArgs(args, cmd) {
  const [slugArg, run, extra] = args;
  if (!slugArg || !run || extra !== undefined) usage(`${cmd}: needs <slug> <run-id>`);
  if (!CAP_RE.test(slugArg) || !RUN_RE.test(run)) usage(`${cmd}: unsafe slug or run id`);
  return { file: join(repoRoot(), ".reverse-spec-scratch", `${slugArg}.lock`), run };
}

function lock(args) {
  const { file, run } = lockArgs(args, "lock");
  mkdirSync(dirname(file), { recursive: true });
  try {
    writeFileSync(file, `${run}\n`, { flag: "wx" });
    return;
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
  }
  const owner = readFileSync(file, "utf8").trim();
  if (owner === run) return;
  const slugArg = args[0];
  process.stderr.write(
    `locked: target is held by run ${owner} (${file}). If that run is no longer active, ` +
      `ask the user, then: node guard.mjs break-lock ${slugArg} ${owner}\n`,
  );
  process.exit(1);
}

function breakLock(args) {
  const { file, run: owner } = lockArgs(args, "break-lock");
  if (!existsSync(file)) return;
  const current = readFileSync(file, "utf8").trim();
  if (current !== owner) {
    process.stderr.write(`not breaking: lock is held by run ${current}, not ${owner}\n`);
    process.exit(1);
  }
  rmSync(file, { force: true });
  process.stdout.write(`broke lock of run ${owner}\n`);
}

function unlock(args) {
  const { file, run } = lockArgs(args, "unlock");
  if (!existsSync(file)) return;
  const owner = readFileSync(file, "utf8").trim();
  if (owner !== run) {
    process.stderr.write(`not unlocking: owned by run ${owner}\n`);
    process.exit(1);
  }
  rmSync(file, { force: true });
}

function checkManifest(args) {
  const [file, extra] = args;
  if (!file || extra !== undefined) usage("check-manifest: needs exactly one manifest file");
  let caps;
  try {
    caps = JSON.parse(readFileSync(file, "utf8")).capabilities.map((c) => c.capability);
  } catch {
    process.stderr.write(`check-manifest: cannot read capabilities[].capability from ${file}\n`);
    process.exit(2);
  }
  const problems = [];
  if (caps.length === 0) problems.push("no capabilities");
  const seen = new Set();
  for (const cap of caps) {
    if (typeof cap !== "string" || !CAP_RE.test(cap) || cap.length > CAP_MAX) {
      problems.push(`invalid capability name ${JSON.stringify(cap)} (kebab-case, at most ${CAP_MAX} chars)`);
    }
    else if (seen.has(cap)) problems.push(`duplicate capability name ${cap}`);
    seen.add(cap);
  }
  if (problems.length) {
    process.stderr.write(`${problems.join("\n")}\n`);
    process.exit(2);
  }
}

const ID_KINDS = ["BR", "QUIRK", "GAP"];

/** High-water marks from an ids file; missing file = all zero; corrupt file = exit 2. */
function readMarks(file) {
  const marks = { BR: 0, QUIRK: 0, GAP: 0 };
  if (!existsSync(file)) return marks;
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    process.stderr.write(`ids: cannot parse ${file}\n`);
    process.exit(2);
  }
  for (const k of ID_KINDS) {
    const v = raw?.[k] ?? 0;
    if (!Number.isInteger(v) || v < 0) {
      process.stderr.write(`ids: bad ${k} mark in ${file}\n`);
      process.exit(2);
    }
    marks[k] = v;
  }
  return marks;
}

function writeMarks(file, marks) {
  writeFileSync(file, `${JSON.stringify(marks)}\n`);
}

/** Raise `marks` to `<dir>/_ids.json` and to every id mentioned in `<dir>/*.md`. */
function raiseMarks(marks, dir) {
  const own = readMarks(join(dir, "_ids.json"));
  for (const k of ID_KINDS) marks[k] = Math.max(marks[k], own[k]);
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".md"))) {
    for (const m of readFileSync(join(dir, name), "utf8").matchAll(/\b(BR|QUIRK|GAP)-(\d{3,})\b/g)) {
      marks[m[1]] = Math.max(marks[m[1]], Number(m[2]));
    }
  }
}

function seedIds(args) {
  const [file, ...dirs] = args;
  if (!file || dirs.length === 0) usage("seed-ids: needs <ids.json> and at least one <dir>");
  const marks = readMarks(file);
  for (const dir of dirs) {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) usage(`seed-ids: not a directory: ${dir}`);
    raiseMarks(marks, dir);
  }
  writeMarks(file, marks);
  process.stdout.write(`${JSON.stringify(marks)}\n`);
}

function nextId(args) {
  const [file, kind, extra] = args;
  if (!file || !ID_KINDS.includes(kind) || extra !== undefined) usage("next-id: needs <ids.json> <BR|QUIRK|GAP>");
  const marks = readMarks(file);
  marks[kind] += 1;
  writeMarks(file, marks);
  process.stdout.write(`${kind}-${String(marks[kind]).padStart(3, "0")}\n`);
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM"; // exists, owned by another user
  }
}

/** A validation dir no live run owns: its `.owner` pid is gone, or (no owner) it is stale. */
function abandoned(path, now) {
  const owner = join(path, ".owner");
  if (existsSync(owner)) {
    const pid = Number.parseInt(readFileSync(owner, "utf8"), 10);
    if (pid > 0) return !alive(pid);
  }
  return now - statSync(path).mtimeMs > STALE_MS;
}

function sweep(args) {
  let run;
  if (args[0] === "--run") {
    run = args[1];
    if (!run || !RUN_RE.test(run)) usage("sweep: --run needs a run id ([A-Za-z0-9-], no path separators)");
    if (args.length > 2) usage(`sweep: unexpected argument ${args[2]}`);
  } else if (args.length) usage(`sweep: unexpected argument ${args[0]}`);
  const specs = join(repoRoot(), "openspec", "specs");
  if (!existsSync(specs) || !statSync(specs).isDirectory()) return;
  const now = Date.now();
  for (const name of readdirSync(specs)) {
    const path = join(specs, name);
    const owned = run ? name.startsWith(`${VAL_PREFIX}${run}-`) : name.startsWith(VAL_PREFIX) && abandoned(path, now);
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
  case "check-cap":
    checkName(rest, CAP_RE, "cap");
    break;
  case "check-run":
    checkName(rest, RUN_RE, "run");
    break;
  case "slug":
    slug(rest);
    break;
  case "lock":
    lock(rest);
    break;
  case "unlock":
    unlock(rest);
    break;
  case "break-lock":
    breakLock(rest);
    break;
  case "check-manifest":
    checkManifest(rest);
    break;
  case "seed-ids":
    seedIds(rest);
    break;
  case "next-id":
    nextId(rest);
    break;
  case "new-run":
    newRun(rest);
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
