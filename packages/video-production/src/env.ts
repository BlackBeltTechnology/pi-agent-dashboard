/**
 * Veo/Gemini API-key resolution.
 *
 * Port of the `.env` precedence chain from the original veo-generator skill.
 * Reuses the `.env` parsing/search primitives from the nano-banana package so
 * both packages share one implementation.
 *
 * Resolution order (first non-empty wins):
 *   1. explicit key argument (CLI --api-key)
 *   2. process env (VEO_API_KEY, GEMINI_API_KEY, GOOGLE_API_KEY)
 *   3. project-local `.env` (baseDir and up to two parents) — per-project key
 *   4. package-global `.env` (next to this package)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  envSearchDirs,
  parseEnvFile,
} from "@blackbelt-technology/pi-dashboard-nano-banana/env.js";

/** Key names accepted inside any `.env`, in priority order. */
export const KEY_NAMES = ["VEO_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"] as const;

export interface ResolvedKey {
  key: string | undefined;
  source: string;
}

function readEnvFile(dir: string): Record<string, string> {
  try {
    return parseEnvFile(fs.readFileSync(path.join(dir, ".env"), "utf8"));
  } catch {
    return {};
  }
}

export interface ResolveKeyOptions {
  cliKey?: string;
  baseDir?: string;
  env?: NodeJS.ProcessEnv;
  packageDir?: string;
}

export function resolveVeoKey(opts: ResolveKeyOptions = {}): ResolvedKey {
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

export { envSearchDirs, parseEnvFile };
