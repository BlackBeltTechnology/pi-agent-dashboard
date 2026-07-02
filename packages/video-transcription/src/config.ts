/**
 * Configuration + secret resolution.
 *
 * SONIOX_API_KEY comes from the environment first, falling back to an optional
 * gitignored `.env` (cwd, then the skill dir). No secret is committed. Numeric
 * overrides (MAX_CHUNK_HOURS, MAX_AUDIO_MB) parse from env with safe defaults.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_MAX_CHUNK_HOURS = 4.5;
const DEFAULT_MAX_AUDIO_MB = 200;

export interface Config {
  apiKey: string;
  maxChunkHours: number;
  maxChunkSeconds: number;
  maxAudioMb: number;
}

export interface LoadConfigOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  /** Directory to search for a fallback `.env` after cwd. Defaults to the package dir. */
  skillDir?: string;
}

/** Parse a `.env` file body into a flat map. Ignores comments and blank lines. */
export function parseEnvFile(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
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
  const file = path.join(dir, ".env");
  try {
    return parseEnvFile(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function parsePositiveFloat(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseNonNegativeFloat(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function loadConfig(opts: LoadConfigOptions = {}): Config {
  const env = opts.env ?? process.env;
  const cwd = opts.cwd ?? process.cwd();
  const skillDir = opts.skillDir ?? path.dirname(fileURLToPath(import.meta.url));

  let apiKey = env.SONIOX_API_KEY;
  if (!apiKey) apiKey = readEnvFile(cwd).SONIOX_API_KEY;
  if (!apiKey && path.resolve(skillDir) !== path.resolve(cwd)) {
    apiKey = readEnvFile(skillDir).SONIOX_API_KEY;
  }

  if (!apiKey) {
    throw new Error(
      "SONIOX_API_KEY is not set. Provide it via the environment " +
        "(export SONIOX_API_KEY=...) or a gitignored .env file in the current " +
        "directory. No transcription can run without it.",
    );
  }

  const maxChunkHours = parsePositiveFloat(env.MAX_CHUNK_HOURS, DEFAULT_MAX_CHUNK_HOURS);
  const maxAudioMb = parseNonNegativeFloat(env.MAX_AUDIO_MB, DEFAULT_MAX_AUDIO_MB);

  return {
    apiKey,
    maxChunkHours,
    maxChunkSeconds: Math.trunc(maxChunkHours * 3600),
    maxAudioMb,
  };
}
