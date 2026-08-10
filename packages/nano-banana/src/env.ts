/**
 * GEMINI API-key resolution.
 *
 * Port of the `.env` precedence chain from the original nano-banana skill.
 * Resolution order (first non-empty wins):
 *   1. explicit key argument (CLI --api-key)
 *   2. process env (GEMINI_API_KEY, GOOGLE_API_KEY)
 *   3. project-local `.env` (cwd and up to two parents) — per-project key
 *   4. package-global `.env` (next to this package)
 *
 * No secret is ever committed; `.env` files are gitignored.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/** Key names accepted inside any `.env`, in priority order. */
export const KEY_NAMES = ["GEMINI_API_KEY", "GOOGLE_API_KEY"] as const;

export interface ResolvedKey {
  key: string | undefined;
  /** Human-readable source, e.g. "env:GEMINI_API_KEY" or "/path/.env (GOOGLE_API_KEY)". */
  source: string;
}

/** Parse a minimal `KEY=VALUE` `.env` body. Ignores blanks/comments, strips quotes and `export`. */
export function parseEnvFile(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of body.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    if (line.toLowerCase().startsWith("export ")) line = line.slice("export ".length);
    const eq = line.indexOf("=");
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

function readEnvFile(dir: string): Record<string, string> {
  try {
    return parseEnvFile(fs.readFileSync(path.join(dir, ".env"), "utf8"));
  } catch {
    return {};
  }
}

/** Directories to search for a project-local `.env`, nearest first. */
export function envSearchDirs(baseDir: string): string[] {
  const base = path.resolve(baseDir);
  const dirs = [base];
  for (const parent of [path.dirname(base), path.dirname(path.dirname(base))]) {
    if (!dirs.includes(parent)) dirs.push(parent);
  }
  return dirs;
}

export interface ResolveKeyOptions {
  /** Explicit key (CLI flag) — highest precedence. */
  cliKey?: string;
  /** Base directory to search for a project-local `.env`. Defaults to cwd. */
  baseDir?: string;
  env?: NodeJS.ProcessEnv;
  /** Package dir searched last for a global fallback `.env`. */
  packageDir?: string;
}

export function resolveGeminiKey(opts: ResolveKeyOptions = {}): ResolvedKey {
  const env = opts.env ?? process.env;
  const baseDir = opts.baseDir ?? process.cwd();
  const packageDir = opts.packageDir ?? path.dirname(path.dirname(fileURLToPath(import.meta.url)));

  if (opts.cliKey) return { key: opts.cliKey, source: "--api-key flag" };

  for (const name of KEY_NAMES) {
    if (env[name]) return { key: env[name], source: `env:${name}` };
  }

  for (const dir of envSearchDirs(baseDir)) {
    const data = readEnvFile(dir);
    for (const name of KEY_NAMES) {
      if (data[name]) return { key: data[name], source: `${path.join(dir, ".env")} (${name})` };
    }
  }

  if (path.resolve(packageDir) !== path.resolve(baseDir)) {
    const data = readEnvFile(packageDir);
    for (const name of KEY_NAMES) {
      if (data[name]) return { key: data[name], source: `${path.join(packageDir, ".env")} (${name})` };
    }
  }

  return { key: undefined, source: "not found" };
}
