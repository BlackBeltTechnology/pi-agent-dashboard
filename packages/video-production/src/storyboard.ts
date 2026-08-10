/**
 * (Re)generate storyboard sketches for a shot package.
 *
 * Port of `gen_storyboard.py`. These sketches are the per-shot first-frame
 * images (and the master world anchor) that the renderer feeds to Veo as
 * image-to-video starting frames. Reads
 * `<package>/storyboard/sketch_prompts.json` ({ "shot_01": "<prompt>", … }) and
 * generates one PNG per key via the nano-banana package.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  type BatchResult,
  batchGenerate,
} from "@blackbelt-technology/pi-dashboard-nano-banana/nano-banana.js";
import { resolveVeoKey } from "./env.js";
import { resolvePackage } from "./package.js";

export interface StoryboardOptions {
  target: string;
  /** Subset of sketch keys (e.g. shot_01, 00_world_anchor). */
  only?: string[];
  force?: boolean;
  cliKey?: string;
  env?: NodeJS.ProcessEnv;
  packageDir?: string;
  /** Max concurrent generations. Default 3. */
  workers?: number;
  onResult?: (r: BatchResult) => void;
}

export interface StoryboardRun {
  storyboardDir: string;
  keySource: string;
  results: BatchResult[];
}

/** Generate the storyboard sketches. Throws on missing prompts file or key. */
export async function generateStoryboard(opts: StoryboardOptions): Promise<StoryboardRun> {
  const { baseDir } = resolvePackage(opts.target);
  const sbDir = path.join(baseDir, "storyboard");
  const promptsFile = path.join(sbDir, "sketch_prompts.json");
  if (!fs.existsSync(promptsFile)) {
    throw new Error(`${promptsFile} not found`);
  }

  const { key, source } = resolveVeoKey({ cliKey: opts.cliKey, baseDir, env: opts.env, packageDir: opts.packageDir });
  if (!key) {
    throw new Error("no GEMINI/VEO API key (env, project .env, or package .env)");
  }

  let prompts = JSON.parse(fs.readFileSync(promptsFile, "utf8")) as Record<string, string>;
  if (opts.only && opts.only.length > 0) {
    const wanted = new Set(opts.only);
    prompts = Object.fromEntries(Object.entries(prompts).filter(([k]) => wanted.has(k)));
  }

  fs.mkdirSync(sbDir, { recursive: true });
  const jobs = Object.entries(prompts).map(([name, prompt]) => ({
    name,
    prompt,
    output: path.join(sbDir, `${name}.png`),
  }));

  const results = jobs.length
    ? await batchGenerate({
        jobs,
        cliKey: key,
        force: opts.force,
        concurrency: opts.workers ?? 3,
        onResult: opts.onResult,
      })
    : [];

  return { storyboardDir: sbDir, keySource: source, results };
}
