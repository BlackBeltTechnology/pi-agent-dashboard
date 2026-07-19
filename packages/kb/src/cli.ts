#!/usr/bin/env node
// kb CLI (Phase 1): index | search | neighbors | backlinks | get | config
// Run (dev): NODE_OPTIONS=--experimental-sqlite tsx src/cli.ts <cmd> ...
// Shipped bin builds to dist/cli.js (build step deferred).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig, type ResolvedConfig, type ResolvedSource } from "./config.js";
import { agentsChain, doxInit, doxLint } from "./dox.js";
import { evaluate, type GoldenItem } from "./eval.js";
import { runIndexAtomic } from "./index-run.js";
import { indexSource } from "./indexer.js";
import { kbInit } from "./init.js";
import { renderHits } from "./render.js";
import { classifyRef, type ResolvedSource as RResolvedSource, resolveAll } from "./sources.js";
import { SqliteFtsStore } from "./sqlite-store.js";
import { defaultPromptTrust } from "./trust.js";
import type { DocType, SearchOpts } from "./types.js";

interface Flags {
  _: string[];
  [k: string]: string | boolean | string[];
}
function parse(argv: string[]): Flags {
  const f: Flags = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) f[key] = true;
      else {
        // collect repeatable --source
        if (key === "source") (f.source = ([] as string[]).concat((f.source as string[]) ?? [], next));
        else f[key] = next;
        i++;
      }
    } else f._.push(a);
  }
  return f;
}

/** Validate a positive-integer flag; exit 2 with a clear message on garbage. */
function posInt(v: unknown, name: string): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) { console.error(`${name} must be a positive integer (got ${String(v)})`); process.exit(2); }
  return n;
}
/** Validate an enum flag against an allowlist; exit 2 on unknown value. */
function enumFlag(v: unknown, allowed: string[], name: string): string | undefined {
  if (v === undefined || v === true) return undefined;
  if (!allowed.includes(v as string)) { console.error(`${name} must be one of ${allowed.join("|")} (got ${String(v)})`); process.exit(2); }
  return v as string;
}

function cfgFrom(flags: Flags): ResolvedConfig {
  const cwd = (flags.cwd as string) ?? process.cwd();
  const cfg = loadConfig(cwd, { configPath: flags.config as string | undefined });
  // --source <dir> (repeatable) overrides sources for ad-hoc use
  const srcs = flags.source as string[] | undefined;
  if (srcs?.length) {
    cfg.resolvedSources = srcs.map((s, i): ResolvedSource => ({ id: s, dir: resolve(cwd, s), priority: srcs.length - i }));
  }
  if (flags.db) cfg.dbAbsPath = resolve(cwd, flags.db as string);
  return cfg;
}

function openStore(cfg: ResolvedConfig): SqliteFtsStore {
  const store = new SqliteFtsStore(cfg.dbAbsPath);
  store.init();
  return store;
}
async function runIndex(cfg: ResolvedConfig, store: SqliteFtsStore, sources: RResolvedSource[], force = false) {
  let scanned = 0, changed = 0, deleted = 0, chunks = 0;
  for (const s of sources) {
    const st = await indexSource(store, { root: s.id, dir: s.dir }, { force, indexAgentsFiles: cfg.indexAgentsFiles, includeSourceMarkdown: cfg.includeSourceMarkdown, include: cfg.include, exclude: cfg.exclude, extensions: cfg.extensions });
    scanned += st.scanned; changed += st.changed; deleted += st.deleted; chunks += st.chunks;
  }
  return { scanned, changed, deleted, chunks };
}

/** Resolve sources for a run. --source overrides (filesystem, sync); otherwise
 *  resolve all configured specs (filesystem sync + remote async + TOFU trust). */
async function sourcesForRun(cfg: ResolvedConfig, flags: Flags): Promise<RResolvedSource[]> {
  const srcs = flags.source as string[] | undefined;
  if (srcs?.length) return srcs.map((s, i) => ({ id: s, dir: resolve(cfg.cwd, s), priority: srcs.length - i, identity: s }));
  const interactive = process.stdin.isTTY ?? false;
  return resolveAll(cfg.allSourceSpecs, {
    cwd: cfg.cwd,
    cacheDir: cfg.cacheDirAbs,
    refresh: !!flags.refresh,
    promptTrust: interactive ? defaultPromptTrust : undefined,
  });
}

const HELP = `kb — markdown knowledge base
Usage:
  kb init    [--global] [--source <ref>]... [--dry-run] [--force] [--cwd <dir>]
  kb index   [--source <dir>...] [--db <path>] [--force] [--refresh]
  kb search  "<query>" [--limit N] [--root id] [--doc-type doc|agents|source-md]
             [--expand-parent|--no-expand-parent] [--expand-graph] [--rerank]
             [--expand-query] [--json] [--no-reindex] [--source <dir>...] [--db <path>]
  kb neighbors "<node>" [--depth N] [--rel child_of|links_to|references|has_tag]
  kb backlinks "<node>"
  kb get <path> [--section "<heading_path>"]
  kb agents <path>                  nearest AGENTS.md chain (root→nearest); --fallback-manifest
  kb dox init [--dry-run]           scaffold a DOX AGENTS.md tree (path rows only)
  kb dox lint [--json] [--fix]      audit DOX tree drift
  kb eval    --golden <file.json> [--limit N] [--doc-type ...] [--no-reindex]
  kb config   show resolved config
Global: --cwd <dir>  --config <file>`;

function main() {
  const flags = parse(process.argv.slice(2));
  const cmd = flags._[0];
  if (!cmd || cmd === "help" || flags.help) {
    console.log(HELP);
    return;
  }
  if (cmd === "config") {
    const cfg = cfgFrom(flags);
    console.log(JSON.stringify({ origin: cfg.origin, dbAbsPath: cfg.dbAbsPath, cacheDirAbs: cfg.cacheDirAbs, sources: cfg.resolvedSources, allSourceSpecs: cfg.allSourceSpecs, maxFileCount: cfg.maxFileCount, indexAgentsFiles: cfg.indexAgentsFiles }, null, 2));
    return;
  }
  if (cmd === "init") {
    const r = kbInit({
      global: !!flags.global,
      force: !!flags.force,
      dryRun: !!flags["dry-run"],
      sources: flags.source as string[] | undefined,
      cwd: (flags.cwd as string) ?? process.cwd(),
    });
    if (!flags["dry-run"] && r.wrote) {
      console.log(`wrote ${r.configPath}`);
      if (r.gitignoreAdded) console.log(`gitignored ${r.gitignoreAdded} in ${r.gitignorePath}`);
    }
    return;
  }

  if (cmd === "agents") {
    const cwd = (flags.cwd as string) ?? process.cwd();
    const { chain, manifest } = agentsChain(cwd, flags._[1] ?? cwd, { claudeMd: true, fallbackManifest: flags["no-fallback-manifest"] ? false : true });
    if (flags.json) console.log(JSON.stringify({ chain: chain.map((c) => c.rel), manifest }, null, 2));
    else if (chain.length) for (const c of chain) console.log(c.rel);
    else if (manifest) console.log(manifest);
    else console.log("(no AGENTS.md on path and no manifest)");
    return;
  }
  if (cmd === "dox") {
    const sub = flags._[1];
    const cwd = (flags.cwd as string) ?? process.cwd();
    if (sub === "init") {
      const plan = doxInit({ cwd, dryRun: !!flags["dry-run"] });
      if (flags["dry-run"]) console.log(`# dry-run dox init\ncreate: ${plan.created.join(", ") || "(none)"}\nappend: ${plan.appended.map((a) => a.file + " +" + a.rows.length).join(", ") || "(none)"}`);
      else console.log(`created ${plan.created.length} AGENTS.md, appended rows to ${plan.appended.length} files`);
      return;
    }
    if (sub === "lint") {
      const r = doxLint({ cwd, json: !!flags.json, fix: !!flags.fix });
      if (flags.json) console.log(JSON.stringify(r, null, 2));
      else for (const i of r.issues) console.log(`${i.kind}\t${i.agentsFile}${i.path ? "\t" + i.path : ""}\t${i.detail}`);
      if (r.issues.length) process.exit(1);
      return;
    }
    console.error(`unknown dox subcommand: ${sub}`); process.exit(2);
  }

  // index/search/neighbors/backlinks/get/eval need sources + store
  void runCmd(cmd, flags).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
}

async function runCmd(cmd: string, flags: Flags): Promise<void> {
  const cfg = cfgFrom(flags);
  const isIndex = cmd === "index";
  if (!cfg.allSourceSpecs.length && isIndex && !(flags.source as string[] | undefined)?.length) {
    console.error("no sources configured. add sources[] to .pi/dashboard/knowledge_base.json or pass --source <dir>");
    process.exit(2);
  }
  const sources = await sourcesForRun(cfg, flags);
  if (!sources.length && isIndex) { console.error("no sources resolved"); process.exit(2); }

  if (cmd === "index") {
    // Atomic path: do NOT openStore(cfg) here — opening pre-creates the DB file
    // at dbPath (the husk). runIndexAtomic owns store lifecycle (temp+rename on
    // first index; in-place incremental). See change: harden-kb-index-failure-atomicity.
    const explicit = !!(flags.source as string[] | undefined)?.length;
    const t = performance.now();
    const s = await runIndexAtomic({
      dbPath: cfg.dbAbsPath,
      sources: sources.map((x) => ({ id: x.id, dir: x.dir })),
      indexOpts: { force: !!flags.force, indexAgentsFiles: cfg.indexAgentsFiles, includeSourceMarkdown: cfg.includeSourceMarkdown, include: cfg.include, exclude: cfg.exclude, extensions: cfg.extensions },
      explicit,
    });
    console.log(`indexed ${s.scanned} files (${s.changed} changed, ${s.deleted} deleted, ${s.chunks} chunks) in ${(performance.now() - t).toFixed(0)}ms`);
    console.log(JSON.stringify(s.counts));
    return;
  }

  const store = openStore(cfg);
  try {
    if (cmd === "search") {
      const q = flags._[1];
      if (!q) { console.error("search needs a query"); process.exit(2); }
      const limit = posInt(flags.limit, "--limit");
      const docType = enumFlag(flags["doc-type"], ["doc", "agents", "source-md"], "--doc-type");
      if (!flags["no-reindex"]) await runIndex(cfg, store, sources); // auto incremental freshness
      const so: SearchOpts = {
        limit: limit ?? 10,
        root: flags.root as string | undefined,
        docType: docType as DocType | undefined,
        fieldWeights: cfg.ranking.fieldWeights,
        proximityBoost: cfg.ranking.proximityBoost,
        diversity: cfg.ranking.diversity,
        expandParent: flags["no-expand-parent"] ? false : (cfg.expand.parent || !!flags["expand-parent"]),
        expandGraph: cfg.expand.graph || !!flags["expand-graph"],
        rerank: cfg.rerank.enabled || !!flags.rerank,
        queryExpansion: flags["expand-query"] ? (cfg.queryExpansion.mode === "off" ? "synonym" : cfg.queryExpansion.mode) : cfg.queryExpansion.mode,
        rootPriority: Object.fromEntries(sources.map((s) => [s.id, s.priority])),
      };
      const hits = store.search(q, so);
      if (flags.json) console.log(JSON.stringify(hits, null, 2));
      else if (hits.length) console.log(renderHits(hits, { leading: "score", parentGlyph: "[parent: ", multiline: false }));
    } else if (cmd === "neighbors") {
      const depth = posInt(flags.depth, "--depth") ?? 2;
      const rel = enumFlag(flags.rel, ["child_of", "links_to", "references", "has_tag"], "--rel");
      const n = store.neighbors(flags._[1], depth, rel as any);
      console.log(flags.json ? JSON.stringify(n, null, 2) : n.map((x) => `${x.type}\t${x.name}`).join("\n"));
    } else if (cmd === "backlinks") {
      const n = store.backlinks(flags._[1]);
      console.log(flags.json ? JSON.stringify(n, null, 2) : n.map((x) => `${x.type}\t${x.name}`).join("\n"));
    } else if (cmd === "get") {
      // search every resolved root (not just the first) for the path
      let c = null;
      for (const s of sources) {
        c = store.getChunk(s.id, flags._[1], flags.section as string | undefined);
        if (c) break;
      }
      console.log(c ? c.body : `(not found: ${flags._[1]})`);
    } else if (cmd === "eval") {
      const gf = flags.golden as string | undefined;
      if (!gf) { console.error("eval needs --golden <file.json>"); process.exit(2); }
      if (!flags["no-reindex"]) await runIndex(cfg, store, sources);
      const golden = JSON.parse(readFileSync(resolve(cfg.cwd, gf), "utf8")) as GoldenItem[];
      const m = evaluate(store, golden, { k: flags.limit ? Number(flags.limit) : 10, docType: flags["doc-type"] as DocType | undefined });
      console.log(JSON.stringify(m, null, flags.json ? 2 : 0));
    } else {
      console.error(`unknown command: ${cmd}\n\n${HELP}`);
      process.exit(2);
    }
  } finally {
    store.close();
  }
}

main();
