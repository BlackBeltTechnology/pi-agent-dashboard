#!/usr/bin/env node
/**
 * pi-nano-banana — generate or edit images with Google Gemini image models.
 *
 * A thin TypeScript CLI over the @the-focus-ai/nano-banana CLI that adds
 * GEMINI_API_KEY resolution (env / project .env / package .env) and output-path
 * handling. Runs as TypeScript via pi's jiti loader (no build step).
 *
 * Usage:
 *   pi-nano-banana "<prompt>"                       generate an image
 *   pi-nano-banana "<edit>" --file in.png           edit an existing image
 *   pi-nano-banana "<prompt>" --output logo.png     custom output path
 *   pi-nano-banana "<prompt>" --model <id> --flash  model overrides
 *   pi-nano-banana "<prompt>" --api-key <KEY>       explicit key
 */
import { generateImage } from "../nano-banana.js";

interface Parsed {
  prompt?: string;
  file?: string;
  output?: string;
  model?: string;
  flash: boolean;
  apiKey?: string;
}

function parseArgs(argv: string[]): Parsed {
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
      default:
        if (!a.startsWith("-") && out.prompt === undefined) out.prompt = a;
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.prompt) {
    console.error('usage: pi-nano-banana "<prompt>" [--file in.png] [--output out.png] [--model id] [--flash] [--api-key KEY]');
    process.exit(1);
  }

  const res = await generateImage({
    prompt: args.prompt,
    file: args.file,
    output: args.output,
    model: args.model,
    flash: args.flash,
    cliKey: args.apiKey,
  });

  if (res.ok) {
    console.log(`\u2713 image generated${res.output ? `: ${res.output}` : ""}`);
  } else {
    console.error(`\u2717 generation failed: ${res.error}`);
    process.exit(1);
  }
}

void main();
