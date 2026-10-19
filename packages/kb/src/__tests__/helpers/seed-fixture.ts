// Fixtures for the worktree-seed tests (change: add-kb-worktree-seed): a real temp git
// repository indexed as the "main checkout", a real `git worktree add`, and a snapshot
// dump used to prove a seeded first index equals an unseeded one.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach } from "vitest";
import { indexOptionsFromConfig, loadConfig, type ResolvedConfig } from "../../config.js";
import { setRunningEngineForTest } from "../../index-gate.js";
import { type RunIndexAtomicOpts, runIndexAtomic } from "../../index-run.js";
import { type SeedOptions, seedOptionsFromConfig } from "../../seed.js";
import { SqliteFtsStore } from "../../sqlite-store.js";

const ENV = { GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.test", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.test", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
export function sh(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...ENV } });
}

export const KB_CONFIG = { sources: [{ ref: "docs" }, { ref: "packages" }], include: ["**/*.md"] };

export function writeFile(root: string, rel: string, text: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}

/** One markdown file with a front-matter tag, two headings, a markdown link and a wikilink. */
export function doc(i: number, n: number, tag = ""): string {
  return [
    "---",
    `title: Doc ${i}`,
    `tags: [t${i % 5}]`,
    "---",
    `# Doc ${i}`,
    "",
    `Introduction paragraph of document ${i} with the unique token intro${tag}${i} and enough words to be a real chunk for the index.`,
    "",
    "## Section A",
    "",
    `See [next](./d${(i + 1) % n}.md) and [[d${(i + 2) % n}]] for related material; token alpha${tag}${i} appears only here in this body text.`,
    "",
    "## Section B",
    "",
    `Second section of document ${i}, token beta${tag}${i}, with sufficient length to stay above the minimum chunk size threshold.`,
    "",
  ].join("\n");
}

export interface SeedTree {
  tmp: string;
  home: string;
  main: string;
}

/** Register per-test isolation: temp dir (realpath), isolated HOME, pinned engine `E1`. */
export function useSeedTree(): SeedTree {
  const t = {} as SeedTree;
  let prevHome: string | undefined;
  beforeEach(() => {
    t.tmp = realpathSync(mkdtempSync(join(tmpdir(), "kb-seed-")));
    t.home = join(t.tmp, "home");
    t.main = join(t.tmp, "main");
    mkdirSync(t.home, { recursive: true });
    prevHome = process.env.HOME;
    process.env.HOME = t.home;
    setRunningEngineForTest("E1");
  });
  afterEach(() => {
    setRunningEngineForTest(undefined);
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    rmSync(t.tmp, { recursive: true, force: true });
  });
  return t;
}

/** Create + commit the main checkout: `docs/d<i>.md` and `packages/p<i>/README.md`. */
export function mkMain(t: SeedTree, o: { docs?: number; pkgs?: number; config?: Record<string, unknown> } = {}): string {
  const nd = o.docs ?? 30;
  const np = o.pkgs ?? 30;
  mkdirSync(t.main, { recursive: true });
  sh(t.main, "init", "-q", "-b", "main");
  writeFile(t.main, ".pi/dashboard/knowledge_base.json", JSON.stringify(o.config ?? KB_CONFIG));
  writeFile(t.main, ".gitignore", ".pi/dashboard/kb/\n");
  for (let i = 0; i < nd; i++) writeFile(t.main, `docs/d${i}.md`, doc(i, nd));
  for (let i = 0; i < np; i++) writeFile(t.main, `packages/p${i}/README.md`, doc(i, np, "p"));
  sh(t.main, "add", "-A");
  sh(t.main, "commit", "-q", "-m", "init");
  return t.main;
}

export function addWorktree(t: SeedTree, name = "wt"): string {
  const dir = join(t.tmp, name);
  sh(t.main, "worktree", "add", "-q", "-b", `b-${name}`, dir);
  return dir;
}

function cfgAt(cwd: string): ResolvedConfig {
  return loadConfig(cwd);
}

export interface IndexRun {
  stats: Awaited<ReturnType<typeof runIndexAtomic>>;
  lines: string[];
  cfg: ResolvedConfig;
}

/** Run the atomic first/incremental index at `cwd` the way the CLI does, capturing seed log lines. */
export async function indexAt(cwd: string, o: { seed?: Partial<SeedOptions> | false; dbPath?: string; extra?: Partial<RunIndexAtomicOpts>; noSeed?: boolean; explicitSources?: boolean } = {}): Promise<IndexRun> {
  const cfg = cfgAt(cwd);
  if (o.dbPath) cfg.dbAbsPath = o.dbPath;
  const lines: string[] = [];
  const seed = o.seed === false ? undefined : { ...seedOptionsFromConfig(cfg, { noSeed: o.noSeed, explicitSources: o.explicitSources }), ...(o.seed ?? {}) };
  const stats = await runIndexAtomic({
    dbPath: cfg.dbAbsPath,
    sources: cfg.resolvedSources.map((s) => ({ id: s.id, dir: s.dir })),
    indexOpts: indexOptionsFromConfig(cfg),
    gate: cfg,
    seed,
    seedLog: (l) => lines.push(l),
    log: () => {},
    ...(o.extra ?? {}),
  });
  return { stats, lines, cfg };
}

export interface Dump {
  files: string[];
  chunks: string[];
  properties: string[];
  nodes: string[];
  edges: string[];
  meta: Record<string, string>;
}
/** Names-based, id-free dump of a docs database (rows sorted) for set-equality assertions. */
export function dump(dbPath: string): Dump {
  const s = SqliteFtsStore.openExisting(dbPath);
  if (!s) throw new Error(`no database at ${dbPath}`);
  try {
    return s.read((db) => {
      const rows = (sql: string, f: (r: any) => string) => db.prepare(sql).all().map(f).sort();
      return {
        files: rows("SELECT root,path,sha256 FROM files", (r) => `${r.root}|${r.path}|${r.sha256}`),
        chunks: rows("SELECT root,path,heading_path,body FROM chunks", (r) => `${r.root}|${r.path}|${r.heading_path}|${r.body}`),
        properties: rows("SELECT root,path,key,value FROM properties", (r) => `${r.root}|${r.path}|${r.key}|${r.value}`),
        nodes: rows("SELECT type,name,path FROM nodes", (r) => `${r.type}|${r.name}|${r.path}`),
        edges: rows("SELECT a.name AS s, b.name AS d, e.rel AS rel FROM edges e JOIN nodes a ON a.id=e.src JOIN nodes b ON b.id=e.dst", (r) => `${r.s}|${r.d}|${r.rel}`),
        meta: Object.fromEntries((db.prepare("SELECT k,v FROM kb_meta").all() as Array<{ k: string; v: string }>).map((r) => [r.k, r.v])),
      };
    });
  } finally {
    s.close();
  }
}
export const sameRows = (a: Dump, b: Dump): void => {
  for (const k of ["files", "chunks", "properties", "nodes", "edges"] as const) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) {
      const sa = new Set(a[k]);
      const sb = new Set(b[k]);
      throw new Error(`${k} differ: only-left=${JSON.stringify(a[k].filter((x) => !sb.has(x)).slice(0, 3))} only-right=${JSON.stringify(b[k].filter((x) => !sa.has(x)).slice(0, 3))} (${a[k].length} vs ${b[k].length})`);
    }
  }
};

/** Count rows of one source root across files/chunks/properties. */
export function rowsOfRoot(dbPath: string, root: string): number {
  const s = SqliteFtsStore.openExisting(dbPath);
  if (!s) return 0;
  try {
    return s.read((db) => {
      let n = 0;
      for (const t of ["files", "chunks", "properties"]) n += Number((db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE root=?`).get(root) as { n: number }).n);
      return n;
    });
  } finally {
    s.close();
  }
}
export function rowsOfPath(dbPath: string, path: string): number {
  const s = SqliteFtsStore.openExisting(dbPath);
  if (!s) return 0;
  try {
    return s.read((db) => {
      let n = 0;
      for (const t of ["files", "chunks", "properties"]) n += Number((db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE path=?`).get(path) as { n: number }).n);
      n += Number((db.prepare("SELECT COUNT(*) AS n FROM nodes WHERE path=? OR name=? OR name LIKE ?").get(path, path, `${path}#%`) as { n: number }).n);
      return n;
    });
  } finally {
    s.close();
  }
}

export function setMtime(file: string, ms: number): void {
  utimesSync(file, new Date(ms), new Date(ms));
}
