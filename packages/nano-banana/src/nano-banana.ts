/**
 * Programmatic wrapper around the `@the-focus-ai/nano-banana` CLI.
 *
 * Resolves the GEMINI key, invokes the CLI via the repo's safe spawn wrapper
 * (`no-direct-child-process` invariant), and reports a structured result. Also
 * provides bounded-concurrency batch generation reused by the storyboard step
 * of the video-production package.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { buildSafeArgv, execFileAsync } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { type ResolveKeyOptions, resolveGeminiKey } from "./env.js";

/** Underlying CLI package spawned via `npx`. */
export const NANO_BANANA_PKG = "@the-focus-ai/nano-banana";

export interface GenerateImageOptions extends ResolveKeyOptions {
  /** Text prompt (or edit instruction when `file` is set). */
  prompt: string;
  /** Output image path. Parent dirs are created. */
  output?: string;
  /** Input image to edit (image-to-image). */
  file?: string;
  /** Specific Gemini model id. */
  model?: string;
  /** Use the faster gemini-2.0-flash model. */
  flash?: boolean;
  /** Injectable runner for tests. Defaults to the real `npx` spawn. */
  runner?: NanoBananaRunner;
}

export interface GenerateImageResult {
  ok: boolean;
  output?: string;
  /** stderr tail on failure. */
  error?: string;
}

export type NanoBananaRunner = (
  args: string[],
  env: NodeJS.ProcessEnv,
) => Promise<{ code: number; stderr: string }>;

/** Default runner: `npx -y @the-focus-ai/nano-banana <args>` with GEMINI_API_KEY in env. */
export const npxRunner: NanoBananaRunner = async (args, env) => {
  const { argv, spawnOptions } = buildSafeArgv("npx", ["-y", NANO_BANANA_PKG, ...args]);
  try {
    await execFileAsync(argv[0], argv.slice(1), { env, ...spawnOptions });
    return { code: 0, stderr: "" };
  } catch (err) {
    const e = err as { code?: number; stderr?: string | Buffer };
    return {
      code: typeof e.code === "number" ? e.code : 1,
      stderr: (e.stderr ?? "").toString(),
    };
  }
};

/** Build the CLI argument vector for a single generation. */
export function buildArgs(opts: GenerateImageOptions): string[] {
  const args = [opts.prompt];
  if (opts.file) args.push("--file", opts.file);
  if (opts.output) args.push("--output", opts.output);
  if (opts.model) args.push("--model", opts.model);
  if (opts.flash) args.push("--flash");
  return args;
}

/** Generate (or edit) a single image. */
export async function generateImage(opts: GenerateImageOptions): Promise<GenerateImageResult> {
  const { key, source } = resolveGeminiKey(opts);
  if (!key) {
    return {
      ok: false,
      error:
        "No GEMINI_API_KEY. Set it in the environment or a gitignored .env " +
        "in the project or package directory, or pass apiKey/--api-key.",
    };
  }

  if (opts.output) fs.mkdirSync(path.dirname(path.resolve(opts.output)), { recursive: true });

  const env: NodeJS.ProcessEnv = { ...process.env, GEMINI_API_KEY: key };
  const runner = opts.runner ?? npxRunner;
  const { code, stderr } = await runner(buildArgs(opts), env);

  if (code === 0 && (!opts.output || fs.existsSync(opts.output))) {
    return { ok: true, output: opts.output };
  }
  return { ok: false, error: stderr.trim().slice(0, 400) || `exit code ${code} (key via ${source})` };
}

export interface BatchJob {
  name: string;
  prompt: string;
  output: string;
}

export interface BatchResult {
  name: string;
  ok: boolean;
  output?: string;
  error?: string;
  skipped?: boolean;
}

export interface BatchOptions extends Omit<GenerateImageOptions, "prompt" | "output"> {
  jobs: BatchJob[];
  /** Max concurrent generations. Default 3. */
  concurrency?: number;
  /** Skip jobs whose output file already exists (unless `force`). */
  force?: boolean;
  /** Optional per-job progress callback. */
  onResult?: (r: BatchResult) => void;
}

/** Generate many images with bounded concurrency (storyboard-style batch). */
export async function batchGenerate(opts: BatchOptions): Promise<BatchResult[]> {
  const concurrency = Math.max(1, opts.concurrency ?? 3);
  const results: BatchResult[] = [];
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < opts.jobs.length) {
      const job = opts.jobs[cursor++];
      let r: BatchResult;
      if (!opts.force && fs.existsSync(job.output)) {
        r = { name: job.name, ok: true, output: job.output, skipped: true };
      } else {
        const gen = await generateImage({ ...opts, prompt: job.prompt, output: job.output });
        r = { name: job.name, ok: gen.ok, output: gen.output, error: gen.error };
      }
      results.push(r);
      opts.onResult?.(r);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, opts.jobs.length) }, worker));
  return results;
}
