#!/usr/bin/env node
/**
 * Subagent contract boundary gate (tree-wide). Core packages SHALL NOT name a
 * subagent contract identifier: the subagents plugin owns every `subagent_*`
 * event/message type, `subagents:*` channel and subagent state shape.
 *
 *   node scripts/check-subagent-boundary.mjs [--root <dir>] [--allowlist <file>]
 *
 * Scans `packages/{extension,server,shared,client,dashboard-plugin-runtime}/src`
 * (every line, comments included) against a case-insensitive denylist
 * (design D9). Exempt: tests (`__tests__`, `test-support`, `*.test.*`, `*.spec.*`), `generated/`,
 * i18n catalogs. Prose that merely says "subagents" (no colon, no state access)
 * passes.
 *
 * Allowlist `scripts/subagent-boundary-allowlist.json`: `[{ file, pattern, reason }]`
 * (or `{ "entries": [...] }`). `file` = repo-relative path; `pattern` = regex
 * (case-insensitive) a hit LINE must match to be forgiven. Limited to cross-plugin
 * registries (route-tier table, shipped `custom-event-groups.ts`). A row that
 * forgives nothing is reported as STALE on stderr (warning, exit unaffected).
 *
 * Exit: 0 ok, 1 violations (prints `file:line: match`), 2 script error.
 *
 * See change: move-subagents-to-plugin (D9).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ALLOWLIST_REL = "scripts/subagent-boundary-allowlist.json";
const SCAN_PACKAGES = ["extension", "server", "shared", "client", "dashboard-plugin-runtime"];
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", ".git", ".worktrees"]);
const SOURCE_FILE = /\.[cm]?[jt]sx?$/;

/** D9 denylist families, case-insensitive. */
export const DENYLIST = [
  /subagent_[a-z_]+/i,
  /subagents:/i,
  /subagent(?:state|statesnapshot|timelineentry|details|tickthrottle|heap)\w*/i,
  /subagent_event_map/i,
  /empty_subagents/i,
  /usesessionsubagents/i,
  /issubagentcarrier/i,
  /\.subagents\b/i,
];

const EXEMPT_PATH = /(^|\/)(__tests__|__mocks__|test-support|generated|i18n)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)i18n[\w.-]*\.[cm]?[jt]s$/;
export const isExempt = (rel) => EXEMPT_PATH.test(rel);

function* walk(dir, base) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(path.join(dir, entry.name), base);
    } else if (entry.isFile()) {
      yield path.relative(base, path.join(dir, entry.name)).split(path.sep).join("/");
    }
  }
}

/** First denylist match in `line`, or null. */
export function firstMatch(line) {
  for (const re of DENYLIST) {
    const m = re.exec(line);
    if (m) return m[0];
  }
  return null;
}

export function loadAllowlist(file) {
  if (!fs.existsSync(file)) return [];
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  const rows = Array.isArray(json) ? json : json.entries;
  if (!Array.isArray(rows)) throw new Error(`${file}: expected an array of { file, pattern, reason }`);
  return rows.map((r, i) => {
    if (!r || typeof r.file !== "string" || typeof r.pattern !== "string" || typeof r.reason !== "string") {
      throw new Error(`${file}: entry ${i} needs string file, pattern, reason`);
    }
    return { file: r.file, re: new RegExp(r.pattern, "i"), pattern: r.pattern };
  });
}

/** Scan the tree; returns `{ hits: [{file,line,match}], stale: [row] }`. */
export function scan(root, allowlist) {
  const used = new Set();
  const hits = [];
  for (const pkg of SCAN_PACKAGES) {
    const src = path.join(root, "packages", pkg, "src");
    if (!fs.existsSync(src)) continue;
    for (const inner of walk(src, src)) {
      const rel = `packages/${pkg}/src/${inner}`;
      if (!SOURCE_FILE.test(rel) || isExempt(rel)) continue;
      const lines = fs.readFileSync(path.join(root, rel), "utf8").split(/\r?\n/);
      lines.forEach((text, i) => {
        const match = firstMatch(text);
        if (!match) return;
        const row = allowlist.find((r) => r.file === rel && r.re.test(text));
        if (row) {
          used.add(row);
          return;
        }
        hits.push({ file: rel, line: i + 1, match });
      });
    }
  }
  return { hits, stale: allowlist.filter((r) => !used.has(r)) };
}

function main(argv) {
  let root = DEFAULT_ROOT;
  let allowlistPath;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") root = path.resolve(argv[++i]);
    else if (argv[i] === "--allowlist") allowlistPath = path.resolve(argv[++i]);
  }
  const { hits, stale } = scan(root, loadAllowlist(allowlistPath ?? path.join(root, ALLOWLIST_REL)));
  for (const h of hits) console.error(`${h.file}:${h.line}: subagent contract identifier "${h.match}" in core`);
  for (const r of stale) console.warn(`${ALLOWLIST_REL}: STALE row (${r.file} /${r.pattern}/ matches nothing)`);
  if (hits.length) {
    console.error(
      `\ncheck-subagent-boundary: ${hits.length} violation(s). ` +
        "Move the identifier into packages/subagents-plugin (see openspec change move-subagents-to-plugin, D9).",
    );
    return 1;
  }
  console.log("check-subagent-boundary: ok");
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (err) {
    console.error(`check-subagent-boundary: ${err instanceof Error ? err.message : err}`);
    process.exit(2);
  }
}
