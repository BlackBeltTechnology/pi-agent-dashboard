// Deterministic multi-thousand-file corpus for the reindex measurement + time-budget
// tests (change: throttle-kb-reindex, task 1.1). Extends the synthetic-tree helpers:
// same tmp-dir discipline (caller owns the root), but every file carries several
// heading sections so a few thousand files yield tens of thousands of chunks.
// Pure function of `{files, sectionsPerFile, seed}` — no clock, no randomness source
// other than a seeded PRNG — so two builds are byte-identical.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface CorpusOptions {
  /** Number of source files. Default 3000. */
  files?: number;
  /** `##` sections per file; each section ≥ MIN_CHUNK_CHARS so it stays its own chunk. Default 16. */
  sectionsPerFile?: number;
  /** PRNG seed. Default 1. */
  seed?: number;
  /** Every n-th file gets YAML frontmatter / AsciiDoc form / is gitignored. 0 disables. */
  frontmatterEvery?: number;
  adocEvery?: number;
  ignoredEvery?: number;
}

export interface CorpusInfo {
  /** Files the walk will select (gitignored files excluded). */
  files: number;
  /** Expected chunk count lower bound (one per section + one per file title). */
  approxChunks: number;
}

const WORDS = "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu index chunk heading graph reindex batch commit yield event loop worker queue stream buffer socket server client session".split(" ");

/** mulberry32 — tiny deterministic PRNG. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sentence(rnd: () => number, words: number): string {
  const out: string[] = [];
  for (let i = 0; i < words; i++) out.push(WORDS[Math.floor(rnd() * WORDS.length)]);
  return `${out.join(" ")}.`;
}

const section = (rnd: () => number, heading: string): string => `${heading}\n\n${sentence(rnd, 30)} ${sentence(rnd, 25)} ${sentence(rnd, 20)}\n`;

/** One file's text: AsciiDoc (`= ` / `== `) or Markdown (optional frontmatter, `# ` / `## `). */
function docText(rnd: () => number, i: number, sections: number, o: { adoc: boolean; frontmatter: boolean }): string {
  const [h1, h2] = o.adoc ? ["=", "=="] : ["#", "##"];
  const parts: string[] = [];
  if (o.frontmatter) parts.push(`---\ntitle: Document ${i}\nstatus: ${i % 2 ? "draft" : "final"}\n---\n`);
  parts.push(o.adoc ? `${h1} Document ${i}\n` : section(rnd, `${h1} Document ${i}`));
  for (let s = 0; s < sections; s++) parts.push(section(rnd, `${h2} Section ${i}.${s}`));
  return parts.join("\n");
}

const every = (n: number, i: number): boolean => n > 0 && i % n === 0;

/** Writes the corpus under `root` (spread over 50 dirs). Returns the selected-file / chunk estimate. */
export function buildReindexCorpus(root: string, opts: CorpusOptions = {}): CorpusInfo {
  const files = opts.files ?? 3000;
  const sections = opts.sectionsPerFile ?? 16;
  const rnd = prng(opts.seed ?? 1);
  mkdirSync(root, { recursive: true });
  const ignoredEvery = opts.ignoredEvery ?? 13;
  if (ignoredEvery > 0) writeFileSync(join(root, ".gitignore"), "ignored/\n");
  let selected = 0;
  for (let i = 0; i < files; i++) {
    const ignored = every(ignoredEvery, i);
    const dir = join(root, ignored ? "ignored" : `d${i % 50}`);
    mkdirSync(dir, { recursive: true });
    const adoc = every(opts.adocEvery ?? 11, i);
    const frontmatter = !adoc && every(opts.frontmatterEvery ?? 7, i);
    writeFileSync(join(dir, `f${i}.${adoc ? "adoc" : "md"}`), docText(rnd, i, sections, { adoc, frontmatter }));
    if (!ignored) selected++;
  }
  return { files: selected, approxChunks: selected * (sections + 1) };
}
