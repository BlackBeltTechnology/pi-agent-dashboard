#!/usr/bin/env node
/**
 * pi-nano-banana — generate or edit images with Google Gemini image models.
 *
 * A thin TypeScript CLI over the @the-focus-ai/nano-banana CLI that adds
 * GEMINI_API_KEY resolution (env / project .env / package .env) and output-path
 * handling. Runs as TypeScript via pi's jiti loader (no build step).
 *
 * `--backend pi` (or NANO_BANANA_BACKEND=pi) opts in to pi's model runtime
 * (OpenRouter credential in pi, pi >= 1.0.0). Only this CLI reads that variable.
 *
 * Usage:
 *   pi-nano-banana "<prompt>"                       generate an image
 *   pi-nano-banana "<edit>" --file in.png           edit an existing image
 *   pi-nano-banana "<prompt>" --output logo.png     custom output path
 *   pi-nano-banana "<prompt>" --model <id> --flash  model overrides
 *   pi-nano-banana "<prompt>" --api-key <KEY>       explicit key
 *   pi-nano-banana "<prompt>" --backend pi          generate through pi (OpenRouter)
 */
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import { type Backend, type GenerateImageResult, generateImage, isBackend } from "../nano-banana.js";

export const USAGE =
  'usage: pi-nano-banana "<prompt>" [--file in.png] [--output out.png] [--model id] [--flash] [--api-key KEY] [--backend gemini|pi]';
export const ENV_BACKEND_ERROR = "\u2717 NANO_BANANA_BACKEND must be gemini or pi";

export interface Parsed {
  prompt?: string;
  file?: string;
  output?: string;
  model?: string;
  flash: boolean;
  apiKey?: string;
  /** Raw `--backend` value; `""` when the flag had no value. */
  backend?: string;
}

export function parseArgs(argv: string[]): Parsed {
  const out: Parsed = { flash: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--file":
        out.file = argv[++i];
        break;
      case "--output":
      case "-o":
        out.output = argv[++i];
        break;
      case "--model":
        out.model = argv[++i];
        break;
      case "--flash":
        out.flash = true;
        break;
      case "--api-key":
        out.apiKey = argv[++i];
        break;
      case "--backend":
        out.backend = argv[++i] ?? "";
        break;
      default:
        if (!a.startsWith("-") && out.prompt === undefined) out.prompt = a;
    }
  }
  return out;
}

export type BackendResolution = { ok: true; backend: Backend } | { ok: false; source: "flag" | "env" };

/** `--backend` → `NANO_BANANA_BACKEND` (trimmed, lower-cased) → `gemini`. */
export function resolveBackend(flag: string | undefined, env: NodeJS.ProcessEnv): BackendResolution {
  if (flag !== undefined) return isBackend(flag) ? { ok: true, backend: flag } : { ok: false, source: "flag" };
  const raw = env.NANO_BANANA_BACKEND;
  if (raw === undefined || raw.trim() === "") return { ok: true, backend: "gemini" };
  const value = raw.trim().toLowerCase();
  return isBackend(value) ? { ok: true, backend: value } : { ok: false, source: "env" };
}

/** Render the result line and the stream it belongs on. */
export function formatResult(res: GenerateImageResult): { stream: "stdout" | "stderr"; line: string } {
  const pi = res.backend === "pi";
  if (!res.ok) {
    return { stream: "stderr", line: `\u2717 generation failed${pi ? " (pi)" : ""}: ${res.error}` };
  }
  let line = `\u2713 image generated${res.output ? `: ${res.output}` : ""}`;
  if (pi) {
    line += ` (pi \u00b7 ${res.model})`;
    if (res.usage) line += ` \u00b7 ~$${Number(res.usage.cost.total.toPrecision(2))} est.`;
  }
  return { stream: "stdout", line };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.prompt) {
    console.error(USAGE);
    process.exit(1);
  }
  const resolved = resolveBackend(args.backend, process.env);
  if (!resolved.ok) {
    console.error(resolved.source === "flag" ? USAGE : ENV_BACKEND_ERROR);
    process.exit(1);
  }

  const res = await generateImage({
    prompt: args.prompt,
    file: args.file,
    output: args.output,
    model: args.model,
    flash: args.flash,
    cliKey: args.apiKey,
    backend: resolved.backend,
  });
  const { stream, line } = formatResult(res);
  const code = res.ok ? 0 : 1;

  if (resolved.backend === "pi") {
    // The SDK import may retain handles: exit explicitly, but only after the write flushed.
    process[stream].write(`${line}\n`, () => process.exit(code));
    return;
  }
  if (stream === "stdout") console.log(line);
  else console.error(line);
  if (!res.ok) process.exit(1);
}

/** True when this module is the process entry (direct run, bin symlink, or jiti). */
function isEntry(): boolean {
  try {
    const entry = process.argv[1];
    return !!entry && fs.realpathSync(entry) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntry()) void main();
