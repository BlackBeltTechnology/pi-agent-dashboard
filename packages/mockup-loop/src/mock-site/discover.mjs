// @ts-check
// Mock discovery + adoption helpers. One mock = `<root>/<id>/mock.tsx` (+ optional
// `decision.json`), roots = `mockups/` and `openspec/changes/*/mockups/`
// (archive excluded). See change: add-live-component-mock-site (design D3, D12).
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { MOCK_ID_RE } from "./refs.mjs";
import { readDecisionFile } from "./decisions.mjs";

/** @typedef {{ id: string, dir: string, file: string, root: string }} MockEntry */

/** Mock roots of a project (existing dirs only). @param {string} projectRoot */
export function mockRoots(projectRoot) {
  const roots = [path.join(projectRoot, "mockups")];
  const changes = path.join(projectRoot, "openspec", "changes");
  if (fs.existsSync(changes)) {
    for (const d of fs.readdirSync(changes, { withFileTypes: true })) {
      if (!d.isDirectory() || d.name === "archive") continue;
      roots.push(path.join(changes, d.name, "mockups"));
    }
  }
  return roots.filter((r) => fs.existsSync(r));
}

/**
 * @param {string} projectRoot
 * @returns {{ mocks: MockEntry[], errors: string[] }}
 */
export function discoverMocks(projectRoot) {
  /** @type {Map<string, MockEntry[]>} */
  const byId = new Map();
  /** @type {string[]} */
  const errors = [];
  for (const root of mockRoots(projectRoot)) {
    for (const d of fs.readdirSync(root, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const dir = path.join(root, d.name);
      const file = path.join(dir, "mock.tsx");
      if (!fs.existsSync(file)) continue;
      if (!MOCK_ID_RE.test(d.name)) {
        errors.push(`invalid mock id (want yyyy-mm-dd-slug): ${path.relative(projectRoot, dir)}`);
        continue;
      }
      const list = byId.get(d.name) ?? [];
      list.push({ id: d.name, dir, file, root });
      byId.set(d.name, list);
    }
  }
  /** @type {MockEntry[]} */
  const mocks = [];
  for (const [id, list] of byId) {
    if (list.length > 1) errors.push(`duplicate mock id ${id}: ${list.map((m) => path.relative(projectRoot, m.dir)).join(" and ")}`);
    else mocks.push(list[0]);
  }
  mocks.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  return { mocks, errors };
}

const MARKER_RE = /Pending change: [^|]+\|\s*$/;

/**
 * Adoption offer for `rules.proposal` / plan-proposal Step 1b: marked rows of
 * `mockups/AGENTS.md`, live mocks filtered + labelled by their decision.
 * Accepted first `(accepted)`, open / malformed `(open)`, rejected skipped.
 * @param {string} projectRoot
 */
export function listAdoptable(projectRoot) {
  const agents = path.join(projectRoot, "mockups", "AGENTS.md");
  /** @type {{ entry: string, label: string, status?: string }[]} */
  const accepted = [], rest = [];
  /** @type {{ entry: string, reason: string }[]} */
  const skipped = [];
  /** @type {string[]} */
  const warnings = [];
  const text = fs.existsSync(agents) ? fs.readFileSync(agents, "utf8") : "";
  for (const line of text.split("\n")) {
    if (!line.startsWith("|") || !MARKER_RE.test(line) || line.includes("See change:")) continue;
    const m = /^\|\s*`([^`]+)`/.exec(line);
    if (!m) continue;
    const entry = m[1];
    const abs = path.join(projectRoot, "mockups", entry.replace(/\/$/, ""));
    if (!fs.existsSync(abs) || path.dirname(abs) !== path.join(projectRoot, "mockups")) {
      skipped.push({ entry, reason: "missing or not directly under mockups/" });
      continue;
    }
    if (!fs.existsSync(path.join(abs, "mock.tsx"))) { rest.push({ entry, label: entry }); continue; }
    const d = readDecisionFile(path.join(abs, "decision.json"));
    if (d.warning) warnings.push(d.warning);
    const status = d.decision?.status ?? "open";
    if (status === "rejected") skipped.push({ entry, reason: "rejected" });
    else (status === "accepted" ? accepted : rest).push({ entry, label: `${entry} (${status})`, status });
  }
  return { options: [...accepted, ...rest], skipped, warnings };
}

/** @param {string} cwd @param {string[]} args */
function git(cwd, args) {
  try { execFileSync("git", args, { cwd, stdio: "pipe" }); return true; } catch { return false; }
}

/**
 * Move one live mock dir into `<changeDir>/mockups/` as a unit: `git mv`, then
 * `mv` + `git add -A` for anything left (untracked files). Ignores `.*.tmp-*`.
 * Verdict: ok only when the source dir no longer exists.
 * @param {string} src @param {string} changeDir
 * @returns {{ ok: boolean, dest: string, error?: string }}
 */
export function moveMockDir(src, changeDir) {
  const dest = path.join(changeDir, "mockups", path.basename(src));
  if (fs.existsSync(dest)) return { ok: false, dest, error: `destination exists: ${dest}` };
  if (!fs.existsSync(src)) return { ok: false, dest, error: `source missing: ${src}` };
  for (const f of fs.readdirSync(src)) if (/^\..*\.tmp-/.test(f)) fs.rmSync(path.join(src, f), { force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const repo = git(src, ["rev-parse", "--show-toplevel"]);
  // git mv renames the whole dir (untracked files too) but stages only tracked ones.
  if (repo && git(src, ["mv", src, dest]) && !fs.existsSync(src)) {
    git(changeDir, ["add", "-A", "--", dest]);
    return { ok: true, dest };
  }
  try {
    if (fs.existsSync(dest)) {
      for (const f of fs.readdirSync(src)) fs.renameSync(path.join(src, f), path.join(dest, f));
      fs.rmdirSync(src);
    } else fs.renameSync(src, dest);
  } catch (e) {
    return { ok: false, dest, error: String(e) };
  }
  if (repo) git(changeDir, ["add", "-A", "--", src, dest]);
  return fs.existsSync(src) ? { ok: false, dest, error: `source still exists: ${src}` } : { ok: true, dest };
}
