#!/usr/bin/env node
// Mine `kb eval` golden sets from IMPLICIT RELEVANCE FEEDBACK in pi session
// transcripts: the file the agent opened shortly after a `kb_search`.
// See change: fix-kb-search-retrieval-quality (design D8).
//
//   node packages/kb/eval/mine-golden-sets.mjs [--sessions <dir>] [--out <dir>] [--window N]
//
// Emits two fixtures next to this script:
//   golden.markdown-intent.json  — targets are markdown documents
//   golden.source-intent.json    — targets are source files, reachable only via
//                                  their AGENTS.md record (the `agents` lane)
// plus golden.provenance.json carrying the mining parameters and the corpus
// counts, so a re-run is auditable against the numbers a proposal quoted.
//
// BIAS, stated up front and repeated in the fixture headers: a pair only exists
// when the search succeeded well enough that the agent opened SOMETHING. Queries
// the agent abandoned, or answered by falling through to `rg`, are absent by
// construction — this set cannot measure the fall-through population.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const SESSIONS = resolve(flag("sessions", join(homedir(), ".pi", "agent", "sessions")));
const OUT = resolve(flag("out", HERE));
// Repo the mined paths are resolved against, to map a source file to the
// AGENTS.md record that documents it.
const REPO = resolve(flag("repo", join(HERE, "..", "..", "..")));
// How many tool calls after a kb_search still count as "the agent acted on it".
const WINDOW = Number(flag("window", 8));
const MIN_QUERY_TERMS = 2;

/** Every *.jsonl under the sessions root. */
function transcripts(dir) {
  const out = [];
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".jsonl")) out.push(p);
    }
  };
  walk(dir);
  return out;
}

/** The AGENTS.md record that documents a source file: its `<file>.AGENTS.md`
 *  sidecar if one exists, else the nearest ancestor directory `AGENTS.md`.
 *  Returns null when the file is not covered by the tree at all — an
 *  undocumented file is a `dox lint` finding (design D9), not an eval target. */
function documentingRecord(rel) {
  const sidecar = `${rel}.AGENTS.md`;
  if (existsSync(join(REPO, sidecar))) return sidecar;
  let dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
  for (;;) {
    const cand = dir ? `${dir}/AGENTS.md` : "AGENTS.md";
    if (existsSync(join(REPO, cand))) {
      // Only counts when the record actually names the file.
      try {
        if (readFileSync(join(REPO, cand), "utf8").includes(rel.split("/").pop())) return cand;
      } catch { /* unreadable → keep walking up */ }
    }
    if (!dir) return null;
    dir = dir.includes("/") ? dir.slice(0, dir.lastIndexOf("/")) : "";
  }
}

const OPEN_TOOLS = new Set(["read", "Read", "kb_get"]);
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const MD_EXT = /\.mdx?$/i;
// Never a retrieval target: generated, vendored, or scratch.
const IGNORE = /(^|\/)(node_modules|dist|build|out|coverage|\.git)\//;

/** Repo-relative-ish path: drop everything up to and including a worktree or
 *  home prefix so a pair mined in one checkout matches another. */
function normalizePath(p) {
  if (typeof p !== "string" || !p) return null;
  let s = p.replace(/\\/g, "/").replace(/^\.\//, "");
  const wt = s.indexOf("/.worktrees/");
  if (wt >= 0) s = s.slice(s.indexOf("/", wt + 12) + 1);
  const home = homedir().replace(/\\/g, "/");
  if (s.startsWith(home)) s = s.slice(home.length + 1);
  const proj = s.match(/(?:^|\/)((?:packages|docs|openspec|scripts|qa|tests|\.pi)\/.*)$/);
  if (proj) s = proj[1];
  return s.startsWith("/") ? null : s;
}

/** Ordered tool calls + their results for one transcript. */
function toolStream(file) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  if (!text.includes("kb_search")) return [];
  const results = new Map();
  const calls = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const msg = o.message;
    if (!msg) continue;
    if (msg.role === "toolResult") {
      const c = msg.content;
      const t = typeof c === "string" ? c : Array.isArray(c) ? c.map((p) => p.text ?? "").join("\n") : "";
      results.set(msg.toolCallId, t);
      continue;
    }
    if (!Array.isArray(msg.content)) continue;
    for (const part of msg.content) {
      if (part.type === "toolCall") calls.push({ id: part.id, name: part.name, args: part.arguments ?? {} });
    }
  }
  return calls.map((c) => ({ ...c, result: results.get(c.id) ?? "" }));
}

const pairs = new Map(); // `${q}\u0000${path}` → {q, expect}
const stats = { transcripts: 0, withKbSearch: 0, kbSearchCalls: 0, clicks: 0, refines: 0, abandoned: 0 };

for (const file of transcripts(SESSIONS)) {
  stats.transcripts++;
  const stream = toolStream(file);
  if (!stream.length) continue;
  stats.withKbSearch++;
  for (let i = 0; i < stream.length; i++) {
    const call = stream[i];
    if (call.name !== "kb_search") continue;
    stats.kbSearchCalls++;
    const q = String(call.args.query ?? "").trim();
    if (q.split(/\s+/).filter(Boolean).length < MIN_QUERY_TERMS) continue;
    const shown = call.result;
    let clicked = false;
    let refined = false;
    for (let j = i + 1; j < Math.min(i + 1 + WINDOW, stream.length); j++) {
      const nxt = stream[j];
      if (nxt.name === "kb_search") {
        refined = true;
        break;
      }
      if (!OPEN_TOOLS.has(nxt.name)) continue;
      const raw = nxt.args.path ?? nxt.args.file_path ?? nxt.args.filePath;
      const p = normalizePath(raw);
      if (!p || IGNORE.test(p)) continue;
      if (MD_EXT.test(p)) {
        // MARKDOWN INTENT. Implicit relevance: only count the open as feedback
        // on THIS search when the search actually surfaced that file, else the
        // agent navigated from prior knowledge and the pair is unearned.
        const base = p.split("/").pop();
        if (!shown.includes(p) && !(base && shown.includes(base))) continue;
        pairs.set(`${q}\u0000${p}`, { q, expect: p, kind: "markdown" });
        clicked = true;
        break;
      }
      if (!SOURCE_EXT.test(p)) continue;
      // SOURCE INTENT. A source file can NEVER appear in kb results (the KB
      // indexes markdown), so "was it shown" is the wrong filter here. The
      // reachable target is the AGENTS.md record that documents the file — that
      // is what kb_search should have surfaced, via the `agents` doc-type lane.
      const record = documentingRecord(p);
      if (!record) continue;
      pairs.set(`${q}\u0000${record}`, { q, expect: record, kind: "source", openedFile: p });
      clicked = true;
      break;
    }
    if (clicked) stats.clicks++;
    else if (refined) stats.refines++;
    else stats.abandoned++;
  }
}

const all = [...pairs.values()];
const byTarget = (a, b) => a.expect.localeCompare(b.expect) || a.q.localeCompare(b.q);
const markdown = all.filter((p) => p.kind === "markdown").map(({ q, expect }) => ({ q, expect })).sort(byTarget);
const source = all.filter((p) => p.kind === "source").map(({ q, expect, openedFile }) => ({ q, expect, openedFile })).sort(byTarget);

const PROVENANCE = [
  "Derived from IMPLICIT relevance feedback in pi session transcripts: the file",
  `the agent opened within ${WINDOW} tool calls of a kb_search.`,
  "",
  "MARKDOWN INTENT: counted only when the opened file actually appeared in that",
  "search's own result text, so the open is feedback on the search and not on",
  "prior knowledge.",
  "",
  "SOURCE INTENT: a source file can never appear in kb results (the KB indexes",
  "markdown), so the target is the AGENTS.md record that documents it \u2014 the",
  "sidecar if present, else the nearest ancestor AGENTS.md that names the file.",
  "`openedFile` records which source file the agent actually opened.",
  "",
  "KNOWN BIAS: a pair exists only when the search succeeded well enough for the",
  "agent to open something. Queries the agent abandoned, refined away, or",
  "answered by falling through to rg/grep are absent BY CONSTRUCTION, so this",
  "set systematically under-samples the failure population it is meant to fix.",
  "An opened file is also not proof of relevance — it is the cheapest available",
  "proxy for it.",
  "",
  "Regenerate: node packages/kb/eval/mine-golden-sets.mjs",
];

function writeFixture(name, items, intent) {
  const body = {
    $provenance: PROVENANCE,
    intent,
    minedAt: new Date().toISOString().slice(0, 10),
    n: items.length,
    items,
  };
  writeFileSync(join(OUT, name), `${JSON.stringify(body, null, 2)}\n`, "utf8");
  return items.length;
}

const nMd = writeFixture("golden.markdown-intent.json", markdown, "markdown documents");
const nSrc = writeFixture("golden.source-intent.json", source, "source files, reachable via their AGENTS.md record");
writeFileSync(
  join(OUT, "golden.provenance.json"),
  `${JSON.stringify({ $provenance: PROVENANCE, sessionsRoot: SESSIONS.replace(homedir(), "~"), window: WINDOW, minQueryTerms: MIN_QUERY_TERMS, stats, fixtures: { markdownIntent: nMd, sourceIntent: nSrc } }, null, 2)}\n`,
  "utf8",
);

console.log(JSON.stringify({ ...stats, markdownIntent: nMd, sourceIntent: nSrc }, null, 2));
if (statSync(join(OUT, "golden.markdown-intent.json")).size < 100) process.exitCode = 1;
