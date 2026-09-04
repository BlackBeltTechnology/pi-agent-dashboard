/**
 * Configuration + secret resolution.
 *
 * The API key comes from the environment first, falling back to an optional
 * gitignored `.env` (cwd, then the skill dir). Both backends use the SAME
 * resolver, only the variable name differs (`SONIOX_API_KEY` /
 * `ASSEMBLY_AI_KEY`). No secret is committed. Numeric overrides
 * (MAX_CHUNK_HOURS, MAX_AUDIO_MB, TRANSCRIBE_CONCURRENCY) parse from env with
 * safe defaults.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_MAX_AUDIO_MB = 200;
const DEFAULT_CONCURRENCY = 8;
/** Soniox async API caps pending transcriptions at 100; never exceed it. */
const MAX_CONCURRENCY = 100;

export type Backend = "soniox" | "assemblyai";
export const DEFAULT_BACKEND: Backend = "soniox";
/** Selector value that runs every backend against each file. */
export const ALL_BACKENDS: Backend[] = ["soniox", "assemblyai"];

/**
 * Per-backend defaults. Chunk hours sit safely under each provider's hard
 * per-request duration cap (Soniox 5 h; AssemblyAI 10 h). The AssemblyAI SRT
 * lands on a distinct suffix so it can sit beside the Soniox one for A/B.
 */
export const BACKENDS: Record<
  Backend,
  { keyVar: string; chunkHours: number; srtSuffix: string }
> = {
  soniox: { keyVar: "SONIOX_API_KEY", chunkHours: 4.5, srtSuffix: ".srt" },
  assemblyai: { keyVar: "ASSEMBLY_AI_KEY", chunkHours: 9, srtSuffix: ".diarize.srt" },
};

/**
 * One resolved backend to run: its credential, chunk size and output suffix.
 * A file is transcribed once per target, so `both` writes two sibling SRTs.
 */
export interface BackendTarget {
  backend: Backend;
  apiKey: string;
  maxChunkHours: number;
  maxChunkSeconds: number;
  /** Sibling output extension, e.g. `.srt` or `.diarize.srt`. */
  srtSuffix: string;
}

export interface Config {
  /** One entry per selected backend, in run order. Never empty. */
  targets: BackendTarget[];
  maxAudioMb: number;
  concurrency: number;
  /** Pin a language (AssemblyAI only); omit for automatic detection. */
  languageCode?: string;
  /** Hard cap on speaker labels (AssemblyAI only). */
  maxSpeakers?: number;
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

/**
 * Parse a file-level concurrency setting: a positive integer, else `fallback`,
 * clamped to `[1, MAX_CONCURRENCY]`. Truncates fractional input (e.g. `"3.9"`
 * -> 3) and rejects zero/negative/non-numeric values back to the fallback.
 */
function parseConcurrency(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, MAX_CONCURRENCY);
}

/** Resolve a backend selector, falling back to `soniox` on an unknown value. */
export function parseBackend(raw: string | undefined): Backend {
  const value = raw?.trim().toLowerCase();
  return value && value in BACKENDS ? (value as Backend) : DEFAULT_BACKEND;
}

/**
 * Resolve a backend selector into the list of backends to run. Accepts a single
 * name, the keyword `both`/`all`, or a comma-separated list. Unknown names are
 * dropped; an empty result falls back to `[DEFAULT_BACKEND]`. Duplicates are
 * collapsed so `soniox,soniox` never transcribes twice.
 */
export function parseBackends(raw: string | undefined): Backend[] {
  const value = raw?.trim().toLowerCase();
  if (!value) return [DEFAULT_BACKEND];
  if (value === "both" || value === "all") return [...ALL_BACKENDS];
  const names = value.split(",").map((s) => s.trim());
  const picked = ALL_BACKENDS.filter((b) => names.includes(b));
  return picked.length > 0 ? picked : [DEFAULT_BACKEND];
}

export function loadConfig(opts: LoadConfigOptions = {}): Config {
  const env = opts.env ?? process.env;
  const cwd = opts.cwd ?? process.cwd();
  const skillDir = opts.skillDir ?? path.dirname(fileURLToPath(import.meta.url));

  const backends = parseBackends(env.TRANSCRIBE_BACKEND);

  // Resolve every selected backend's key up front so a missing credential fails
  // before any audio is uploaded, not halfway through a `both` run.
  const targets: BackendTarget[] = backends.map((backend) => {
    const { keyVar, chunkHours, srtSuffix } = BACKENDS[backend];

    let apiKey = env[keyVar];
    if (!apiKey) apiKey = readEnvFile(cwd)[keyVar];
    if (!apiKey && path.resolve(skillDir) !== path.resolve(cwd)) {
      apiKey = readEnvFile(skillDir)[keyVar];
    }

    if (!apiKey) {
      throw new Error(
        `${keyVar} is not set. Provide it via the environment ` +
          `(export ${keyVar}=...) or a gitignored .env file in the current ` +
          "directory. No transcription can run without it.",
      );
    }

    const maxChunkHours = parsePositiveFloat(env.MAX_CHUNK_HOURS, chunkHours);
    // A suffix override is only unambiguous with a single backend selected;
    // with several it would collapse their outputs onto one path.
    const suffixOverride = backends.length === 1 ? env.TRANSCRIBE_SRT_SUFFIX?.trim() : undefined;

    return {
      backend,
      apiKey,
      maxChunkHours,
      maxChunkSeconds: Math.trunc(maxChunkHours * 3600),
      srtSuffix: suffixOverride || srtSuffix,
    };
  });

  const maxAudioMb = parseNonNegativeFloat(env.MAX_AUDIO_MB, DEFAULT_MAX_AUDIO_MB);
  const concurrency = parseConcurrency(env.TRANSCRIBE_CONCURRENCY, DEFAULT_CONCURRENCY);
  const maxSpeakers = Number.parseInt(env.TRANSCRIBE_MAX_SPEAKERS ?? "", 10);

  return {
    targets,
    maxAudioMb,
    concurrency,
    languageCode: env.TRANSCRIBE_LANGUAGE?.trim() || undefined,
    maxSpeakers: Number.isFinite(maxSpeakers) && maxSpeakers > 0 ? maxSpeakers : undefined,
  };
}
