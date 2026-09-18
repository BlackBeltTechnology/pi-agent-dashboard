/**
 * `props generate` — geometry-only GLB via the free Hunyuan3D-2 HF Space
 * (design D7). Python is an *optional* dependency: `parse`/`render`/`build`
 * never touch it. Missing `python3`/`gradio_client` fails with the install hint
 * and writes no cache file.
 *
 * The spawn is injectable so a unit test can simulate a missing client (X8).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PropOverride } from "../ir/types.js";
import { sha256 } from "./fetch.js";
import { propKey } from "./key.js";

export const GENERATE_HINT = "pip install gradio_client";
export const HUNYUAN_SPACE = "tencent/Hunyuan3D-2";
export const HUNYUAN_API = "/shape_generation";

export class GenerateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GenerateError";
  }
}

export interface SpawnResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

/** Injectable spawn signature (defaults to `spawnSync`). */
export type SpawnFn = (command: string, args: string[], options: { encoding: "utf8" }) => SpawnResult;

export const PYTHON_SCRIPT = `import sys
from gradio_client import Client, handle_file
client = Client("${HUNYUAN_SPACE}")
result = client.predict(handle_file(sys.argv[1]), api_name="${HUNYUAN_API}")
first = result[0]
print(first["value"] if isinstance(first, dict) else first)
`;

function lastLine(text: string | undefined): string {
  const lines = (text ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  return lines[lines.length - 1] ?? "";
}

export interface GenerateOptions {
  fromImage: string;
  name: string;
  /** Cache directory — `.deck3d/props/` beside the deck. */
  destDir: string;
  spawn?: SpawnFn;
  python?: string;
}

export interface GenerateResult {
  path: string;
  sha256: string;
  bytes: number;
  /** Ready-to-paste `overrides.props[]` entry. */
  entry: PropOverride;
}

export async function generateProp(opts: GenerateOptions): Promise<GenerateResult> {
  const spawn = opts.spawn ?? (spawnSync as unknown as SpawnFn);
  const python = opts.python ?? "python3";
  const run = spawn(python, ["-c", PYTHON_SCRIPT, opts.fromImage], { encoding: "utf8" });
  if (run.error) {
    throw new GenerateError(`python3 is unavailable (${run.error.message}) — install Python 3 and run \`${GENERATE_HINT}\``);
  }
  const combined = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
  if (run.status !== 0) {
    if (/gradio_client/i.test(combined) || /ModuleNotFoundError|No module named/i.test(combined)) {
      throw new GenerateError(`gradio_client is missing — run \`${GENERATE_HINT}\``);
    }
    throw new GenerateError(`generation failed (exit ${run.status ?? "signal"}): ${lastLine(run.stderr)}`);
  }
  const produced = lastLine(run.stdout);
  if (!produced || !existsSync(produced)) {
    throw new GenerateError("generation produced no GLB (service quota-limited or returned no file)");
  }
  const bytes = new Uint8Array(readFileSync(produced));
  if (bytes.length < 4 || bytes[0] !== 0x67 || bytes[1] !== 0x6c || bytes[2] !== 0x54 || bytes[3] !== 0x46) {
    throw new GenerateError(`${produced} is not a GLB`);
  }
  const key = propKey({ source: "generated", id: opts.name });
  mkdirSync(opts.destDir, { recursive: true });
  const dest = join(opts.destDir, `${key}.glb`);
  writeFileSync(dest, bytes);
  const hash = sha256(bytes);
  return {
    path: dest,
    sha256: hash,
    bytes: bytes.length,
    entry: {
      source: "generated",
      id: opts.name,
      licence: "generated",
      author: "generated",
      sha256: hash,
      slide: "<slide-id>",
      role: "illustration",
      restyle: "palette",
    },
  };
}
