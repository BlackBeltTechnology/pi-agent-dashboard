// `kb init` — scaffold + validate knowledge_base.json (design §7, §8.1).
// Project file by default; --global writes ~/.pi/dashboard/knowledge_base.json.
// Seeds documented defaults + sources[]; gitignores dbPath; never clobbers
// without --force; --dry-run prints and writes nothing.
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { DEFAULTS, globalConfigPath, projectConfigPath, validateConfig, type KbConfig, type SourceConfig } from "./config.js";

export interface InitOptions {
  global?: boolean;
  force?: boolean;
  dryRun?: boolean;
  sources?: string[]; // raw <ref> strings → filesystem sources
  cwd?: string;
}

export interface InitResult {
  configPath: string;
  dbPath: string;
  gitignorePath: string | null;
  gitignoreAdded: string | null;
  sources: SourceConfig[];
  wrote: boolean;
}

/** Build the config object to be written, with documented defaults. */
export function buildInitConfig(sources: SourceConfig[] = []): KbConfig {
  return { ...DEFAULTS, sources };
}

/** Render a human-readable, commented JSON-ish config. JSON has no comments,
 *  so we emit valid JSON with defaults and return a separate doc string. */
export function renderConfig(c: KbConfig): string {
  return JSON.stringify(c, null, 2);
}

function ensureGitignore(dbPath: string, cwd: string): { path: string; added: string } | null {
  // Resolve dbPath relative to cwd; gitignore the project-local DB dir.
  const abs = isAbsolute(dbPath) ? dbPath : resolve(cwd, dbPath);
  if (!abs.startsWith(cwd)) return null; // DB outside project → no project gitignore entry
  const rel = abs.slice(cwd.length + 1);
  const entry = `/${rel}`;
  const giPath = join(cwd, ".gitignore");
  let existing = "";
  if (existsSync(giPath)) existing = readFileSync(giPath, "utf8");
  if (existing.includes(entry)) return { path: giPath, added: "" };
  appendFileSync(giPath, (existing && !existing.endsWith("\n") ? "\n" : "") + `\n# kb knowledge base index\n${entry}\n`);
  return { path: giPath, added: entry };
}

export function kbInit(opts: InitOptions): InitResult {
  const cwd = opts.cwd ?? process.cwd();
  const configPath = opts.global ? globalConfigPath() : projectConfigPath(cwd);
  const sources: SourceConfig[] = (opts.sources ?? []).map((ref) => ({ kind: "filesystem", ref }));
  const cfg = buildInitConfig(sources);
  validateConfig(cfg, opts.global ? "global" : "project");

  const dbPath = cfg.dbPath;
  const gitignorePath = opts.global ? null : join(cwd, ".gitignore");

  if (existsSync(configPath) && !opts.force) {
    if (opts.dryRun) {
      return { configPath, dbPath, gitignorePath, gitignoreAdded: null, sources, wrote: false };
    }
    throw new Error(`${configPath} already exists — pass --force to overwrite`);
  }

  if (opts.dryRun) {
    // print planned config, write nothing
    console.log(`# dry-run: would write ${configPath}`);
    console.log(renderConfig(cfg));
    return { configPath, dbPath, gitignorePath, gitignoreAdded: null, sources, wrote: false };
  }

  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, renderConfig(cfg) + "\n", "utf8");

  let gitignoreAdded: string | null = null;
  if (!opts.global) {
    const gi = ensureGitignore(dbPath, cwd);
    if (gi) gitignoreAdded = gi.added || null;
  }
  return { configPath, dbPath, gitignorePath, gitignoreAdded, sources, wrote: true };
}
