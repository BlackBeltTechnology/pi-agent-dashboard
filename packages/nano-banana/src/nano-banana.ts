/**
 * Programmatic wrapper around the `@the-focus-ai/nano-banana` CLI.
 *
 * Resolves the GEMINI key, invokes the CLI via the repo's safe spawn wrapper
 * (`no-direct-child-process` invariant), and reports a structured result. Also
 * provides bounded-concurrency batch generation reused by the storyboard step
 * of the video-production package.
 *
 * `backend: "pi"` (opt-in, see `pi-backend.ts`) generates through pi's model
 * runtime instead. The library never reads an env var to pick the backend.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { buildSafeArgv, execFileAsync } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { type ResolveKeyOptions, resolveGeminiKey } from "./env.js";
import {
  acquirePiRuntime,
  generateWithPi,
  type PiImageUsage,
  type PiOutputFile,
  type PiRuntimeAcquisition,
  type PiSeams,
} from "./pi-backend.js";

/** Image generation backends. `gemini` (default) spawns the CLI; `pi` uses pi's model runtime. */
export type Backend = "gemini" | "pi";
export const isBackend = (value: unknown): value is Backend => value === "gemini" || value === "pi";

/** Underlying CLI package spawned via `npx`. */
export const NANO_BANANA_PKG = "@the-focus-ai/nano-banana";

export interface GenerateImageOptions extends ResolveKeyOptions, PiSeams {
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
  /** Backend. Default `gemini`; `pi` is opt-in. Validated at runtime. */
  backend?: Backend;
  /** pi backend only: per-generation abort timeout in ms. Default 180 000. */
  timeoutMs?: number;
}

export interface GenerateImageResult {
  ok: boolean;
  output?: string;
  /** stderr tail (gemini) or provider/IO error (pi) on failure. */
  error?: string;
  /** Backend that ran. Absent when no backend ran (invalid `backend`). */
  backend?: Backend;
  /** pi backend: every written file. */
  outputs?: PiOutputFile[];
  /** pi backend: `provider/id` of the model used. */
  model?: string;
  /** pi backend: token usage and estimated cost, when reported. */
  usage?: PiImageUsage;
}

const invalidBackend = (value: unknown): GenerateImageResult => ({
  ok: false,
  error: `Invalid backend "${String(value)}": must be "gemini" or "pi".`,
});

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
  const backend = opts.backend ?? "gemini";
  if (!isBackend(backend)) return invalidBackend(backend);
  if (backend === "pi") return generatePi(await acquirePiRuntime(opts), opts);
  return generateGemini(opts);
}

async function generatePi(acq: PiRuntimeAcquisition, opts: GenerateImageOptions): Promise<GenerateImageResult> {
  if (!acq.ok) return { ok: false, backend: "pi", error: acq.error };
  return generateWithPi(acq.runtime, opts);
}

async function generateGemini(opts: GenerateImageOptions): Promise<GenerateImageResult> {
  const { key, source } = resolveGeminiKey(opts);
  if (!key) {
    return {
      ok: false,
      backend: "gemini",
      error:
        "No GEMINI_API_KEY. Set it in the environment or a gitignored .env " +
        "in the project or package directory, or pass apiKey/--api-key. " +
        'Or opt in to the pi backend (backend: "pi"; CLI --backend pi / NANO_BANANA_BACKEND=pi) ' +
        "with an OpenRouter credential in pi.",
    };
  }

  if (opts.output) fs.mkdirSync(path.dirname(path.resolve(opts.output)), { recursive: true });

  const env: NodeJS.ProcessEnv = { ...process.env, GEMINI_API_KEY: key };
  const runner = opts.runner ?? npxRunner;
  const { code, stderr } = await runner(buildArgs(opts), env);

  if (code === 0 && (!opts.output || fs.existsSync(opts.output))) {
    return { ok: true, backend: "gemini", output: opts.output };
  }
  return {
    ok: false,
    backend: "gemini",
    error: stderr.trim().slice(0, 400) || `exit code ${code} (key via ${source})`,
  };
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
  /** Backend that ran; absent on skipped jobs. */
  backend?: Backend;
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
  const backend = opts.backend ?? "gemini";
  if (!isBackend(backend)) {
    return opts.jobs.map((job) => {
      const r: BatchResult = { name: job.name, ...invalidBackend(backend) };
      opts.onResult?.(r);
      return r;
    });
  }
  const concurrency = Math.max(1, opts.concurrency ?? 3);
  const results: BatchResult[] = [];
  let cursor = 0;
  // pi: one guard + runtime per batch, created lazily on the first non-skipped job.
  let piRuntime: Promise<PiRuntimeAcquisition> | undefined;
  const generateJob = async (jobOpts: GenerateImageOptions): Promise<GenerateImageResult> => {
    if (backend === "gemini") return generateGemini(jobOpts);
    piRuntime ??= acquirePiRuntime(opts);
    return generatePi(await piRuntime, jobOpts);
  };

  const worker = async (): Promise<void> => {
    while (cursor < opts.jobs.length) {
      const job = opts.jobs[cursor++];
      let r: BatchResult;
      if (!opts.force && fs.existsSync(job.output)) {
        r = { name: job.name, ok: true, output: job.output, skipped: true };
      } else {
        const gen = await generateJob({ ...opts, prompt: job.prompt, output: job.output });
        r = { name: job.name, ok: gen.ok, output: gen.output, error: gen.error, backend: gen.backend };
      }
      results.push(r);
      opts.onResult?.(r);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, opts.jobs.length) }, worker));
  return results;
}
