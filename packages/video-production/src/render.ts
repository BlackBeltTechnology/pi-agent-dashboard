/**
 * Render a shot package into mp4 clips with the Google Veo 3.1 API.
 *
 * Port of `veo_render.py`. For each shot, sends the Full Veo prompt + negative
 * prompt + seed + aspect/resolution + first-frame sketch (and optionally the
 * world-anchor reference) to Veo, polls the long-running operation, and
 * downloads the result to `<package>/renders/<shot>.mp4`.
 *
 * Idempotent: shots whose mp4 already exists are skipped unless `force`.
 * The Veo client is injectable so the planning/config logic is testable
 * without the SDK or network.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileAsync } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { resolveVeoKey } from "./env.js";
import { loadShots } from "./package.js";
import { MODEL_ALIASES, type Shot } from "./shots.js";

// ── Injectable Veo client ────────────────────────────────────────────────────

export interface VeoImage {
  imageBytes: string;
  mimeType: string;
}

export interface VeoReferenceImage {
  image: VeoImage;
  referenceType: string;
}

export interface VeoGenerateParams {
  model: string;
  prompt: string;
  image?: VeoImage;
  config: Record<string, unknown>;
}

export interface VeoOperation {
  done?: boolean;
  error?: unknown;
  response?: { generatedVideos?: Array<{ video?: unknown }> };
}

export interface VeoClient {
  generate(params: VeoGenerateParams): Promise<VeoOperation>;
  poll(op: VeoOperation): Promise<VeoOperation>;
  download(video: unknown, dest: string): Promise<void>;
}

/** Wrap `@google/genai` into a `VeoClient`. */
export async function createGenAIClient(apiKey: string): Promise<VeoClient> {
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey });
  return {
    generate: (params) => ai.models.generateVideos(params as never),
    poll: (op) => ai.operations.getVideosOperation({ operation: op as never }),
    download: async (video, dest) => {
      await ai.files.download({ file: video as never, downloadPath: dest });
    },
  };
}

// ── Image helpers ────────────────────────────────────────────────────────────

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

/** Read an image file into a base64 `VeoImage`. */
export function loadImage(file: string): VeoImage {
  const mimeType = MIME_BY_EXT[path.extname(file).toLowerCase()] ?? "image/png";
  return { imageBytes: fs.readFileSync(file).toString("base64"), mimeType };
}

// ── Config building ──────────────────────────────────────────────────────────

export interface RenderFlags {
  resolution?: string;
  withReference?: boolean;
  noFirstFrame?: boolean;
  noSeed?: boolean;
  enhancePrompt?: boolean;
}

export interface BuiltRequest {
  image?: VeoImage;
  config: Record<string, unknown>;
}

/** Build the generateVideos config + first-frame image for one shot. */
export function buildRequest(shot: Shot, flags: RenderFlags, firstFrameOverride?: string): BuiltRequest {
  const config: Record<string, unknown> = {
    numberOfVideos: 1,
    aspectRatio: shot.aspectRatio,
    resolution: flags.resolution ?? shot.resolution,
  };
  if (flags.enhancePrompt) config.enhancePrompt = shot.enhancePrompt;
  if (shot.negative) config.negativePrompt = shot.negative;
  if (shot.seed !== null && !flags.noSeed) config.seed = shot.seed;

  let image: VeoImage | undefined;
  const ff = firstFrameOverride ?? (flags.noFirstFrame ? null : shot.firstFrame);
  if (ff && fs.existsSync(ff)) image = loadImage(ff);

  if (flags.withReference && shot.referenceImages.length > 0) {
    const refs: VeoReferenceImage[] = [];
    for (const rp of shot.referenceImages.slice(0, 3)) {
      if (fs.existsSync(rp)) refs.push({ image: loadImage(rp), referenceType: "asset" });
    }
    if (refs.length > 0) config.referenceImages = refs;
  }

  return { image, config };
}

// ── ffmpeg last-frame extraction (for --chain) ───────────────────────────────

/** Extract the final frame of a clip with ffmpeg. Returns true on success. */
export async function extractLastFrame(videoPath: string, outPng: string): Promise<boolean> {
  fs.mkdirSync(path.dirname(outPng), { recursive: true });
  try {
    await execFileAsync("ffmpeg", [
      "-y", "-sseof", "-0.5", "-i", videoPath,
      "-update", "1", "-q:v", "2", outPng,
    ]);
    return fs.existsSync(outPng);
  } catch {
    return false;
  }
}

// ── Render loop ──────────────────────────────────────────────────────────────

export interface RenderOptions extends RenderFlags {
  target: string;
  shots?: string[];
  out?: string;
  model?: string;
  chain?: boolean;
  parallel?: number;
  force?: boolean;
  /** Poll interval in seconds. Default 12. */
  poll?: number;
  cliKey?: string;
  env?: NodeJS.ProcessEnv;
  packageDir?: string;
  /** Injected client factory (tests). Defaults to the real @google/genai. */
  clientFactory?: (apiKey: string) => Promise<VeoClient>;
  /** Injected sleep (tests). */
  sleep?: (ms: number) => Promise<void>;
  /** Progress logger. Defaults to console.log. */
  log?: (msg: string) => void;
}

export type RenderStatus = "ok" | "skip" | "error";

export interface RenderResult {
  name: string;
  status: RenderStatus;
  dest?: string;
  error?: string;
}

export interface RenderPlan {
  baseDir: string;
  outDir: string;
  model: string;
  keyState: string;
  shots: Shot[];
  missingPrompt: string[];
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Resolve everything needed to render, without calling the API. */
export function planRender(opts: RenderOptions): RenderPlan {
  const { shots, baseDir } = loadShots(opts.target, opts.shots);
  const outDir = opts.out ? path.resolve(opts.out) : path.join(baseDir, "renders");
  const modelKey = (opts.model ?? "standard").toLowerCase();
  const model = MODEL_ALIASES[modelKey] ?? opts.model ?? "veo-3.1-generate-preview";
  const { key, source } = resolveVeoKey({ cliKey: opts.cliKey, baseDir, env: opts.env, packageDir: opts.packageDir });
  return {
    baseDir,
    outDir,
    model,
    keyState: key ? `found via ${source}` : "MISSING",
    shots,
    missingPrompt: shots.filter((s) => !s.prompt).map((s) => s.name),
  };
}

function appendLog(logPath: string, shot: Shot, model: string, flags: RenderFlags, extra: Record<string, unknown>): void {
  const rec = {
    ts: new Date().toISOString(),
    shot: shot.name,
    model,
    seed: shot.seed,
    aspectRatio: shot.aspectRatio,
    resolution: flags.resolution ?? shot.resolution,
    ...extra,
  };
  fs.appendFileSync(logPath, `${JSON.stringify(rec)}\n`);
}

async function generateWithRetry(
  client: VeoClient,
  model: string,
  shot: Shot,
  req: BuiltRequest,
  poll: number,
  sleep: (ms: number) => Promise<void>,
  log: (msg: string) => void,
): Promise<VeoOperation> {
  const submit = (config: Record<string, unknown>): Promise<VeoOperation> =>
    client.generate({ model, prompt: shot.prompt, ...(req.image ? { image: req.image } : {}), config });

  let op: VeoOperation;
  try {
    op = await submit(req.config);
  } catch (err) {
    if (req.config.referenceImages) {
      log(`    ↻ retry without reference images (${(err as Error).name})`);
      const { referenceImages, ...rest } = req.config;
      op = await submit(rest);
    } else {
      throw err;
    }
  }
  while (!op.done) {
    await sleep(poll * 1000);
    op = await client.poll(op);
  }
  return op;
}

async function renderShot(
  client: VeoClient,
  model: string,
  shot: Shot,
  opts: RenderOptions,
  outDir: string,
  logPath: string,
  firstFrameOverride: string | undefined,
  log: (msg: string) => void,
  sleep: (ms: number) => Promise<void>,
): Promise<RenderResult> {
  const dest = path.join(outDir, `${shot.name}.mp4`);
  if (fs.existsSync(dest) && !opts.force) {
    log(`= ${shot.name}: exists, skip (use --force to re-render)`);
    return { name: shot.name, status: "skip", dest };
  }

  const ffUsed = firstFrameOverride ?? (opts.noFirstFrame ? null : shot.firstFrame);
  const mode = ffUsed ? "image-to-video" : "text-to-video";
  log(`▶ ${shot.name}: submitting (${mode}, ${opts.resolution ?? shot.resolution}) …`);
  const t0 = Date.now();
  const req = buildRequest(shot, opts, firstFrameOverride);

  let op: VeoOperation;
  try {
    op = await generateWithRetry(client, model, shot, req, opts.poll ?? 12, sleep, log);
  } catch (err) {
    const msg = `${(err as Error).name}: ${(err as Error).message}`;
    log(`✗ ${shot.name}: FAILED — ${msg}`);
    appendLog(logPath, shot, model, opts, { status: "error", error: msg });
    return { name: shot.name, status: "error", error: msg };
  }

  if (op.error) {
    const msg = JSON.stringify(op.error);
    log(`✗ ${shot.name}: operation error — ${msg}`);
    appendLog(logPath, shot, model, opts, { status: "error", error: msg });
    return { name: shot.name, status: "error", error: msg };
  }

  try {
    const video = op.response?.generatedVideos?.[0]?.video;
    if (!video) throw new Error("no generated video in response");
    await client.download(video, dest);
  } catch (err) {
    const msg = (err as Error).message;
    log(`✗ ${shot.name}: download/save failed — ${msg}`);
    appendLog(logPath, shot, model, opts, { status: "error", error: msg });
    return { name: shot.name, status: "error", error: msg };
  }

  const dt = Math.round((Date.now() - t0) / 1000);
  log(`✓ ${shot.name}: saved ${path.basename(dest)}  (${dt}s)`);
  appendLog(logPath, shot, model, opts, { status: "ok", out: dest, seconds: dt });
  return { name: shot.name, status: "ok", dest };
}

/** Render a shot package. Returns per-shot results. */
export async function renderShots(opts: RenderOptions): Promise<RenderResult[]> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const sleep = opts.sleep ?? defaultSleep;
  const plan = planRender(opts);

  if (plan.shots.length === 0) throw new Error("no matching shots found");
  if (plan.missingPrompt.length > 0) {
    throw new Error(`these shots have no Full Veo prompt block: ${plan.missingPrompt.join(", ")}`);
  }

  const { key } = resolveVeoKey({ cliKey: opts.cliKey, baseDir: plan.baseDir, env: opts.env, packageDir: opts.packageDir });
  if (!key) {
    throw new Error(
      "no API key. Put VEO_API_KEY in a .env next to the project (per-project) " +
        "or in the package folder, or pass --api-key.",
    );
  }

  fs.mkdirSync(plan.outDir, { recursive: true });
  const logPath = path.join(plan.outDir, "render_log.jsonl");
  const factory = opts.clientFactory ?? createGenAIClient;
  const client = await factory(key);

  const parallel = opts.chain ? 1 : Math.max(1, opts.parallel ?? 1);
  if (opts.chain && (opts.parallel ?? 1) > 1) {
    log("note: --chain forces sequential rendering; ignoring --parallel.\n");
  }

  const results: RenderResult[] = [];

  if (parallel === 1) {
    // Sequential — required for --chain (B needs A's rendered last frame).
    let prevVideo: string | null = null;
    for (let i = 0; i < plan.shots.length; i++) {
      const shot = plan.shots[i];
      let ffOverride: string | undefined;
      const prev = plan.shots[i - 1];
      if (opts.chain && i > 0 && prev?.seamlessNext && prevVideo && fs.existsSync(prevVideo)) {
        const lf = path.join(plan.outDir, `_lastframe_${prev.name}.png`);
        if (await extractLastFrame(prevVideo, lf)) {
          ffOverride = lf;
          log(`  ⛓ ${shot.name}: first frame = last frame of ${prev.name}`);
        } else {
          log(`  ⚠ ${shot.name}: ffmpeg last-frame extraction failed, using sketch`);
        }
      }
      const r = await renderShot(client, plan.model, shot, opts, plan.outDir, logPath, ffOverride, log, sleep);
      results.push(r);
      if ((r.status === "ok" || r.status === "skip") && r.dest) prevVideo = r.dest;
    }
  } else {
    // Parallel — independent shots, up to N concurrent Veo operations.
    log(`Rendering up to ${parallel} shots concurrently (bounded by your Veo API quota)…\n`);
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < plan.shots.length) {
        const shot = plan.shots[cursor++];
        results.push(
          await renderShot(client, plan.model, shot, opts, plan.outDir, logPath, undefined, log, sleep),
        );
      }
    };
    await Promise.all(Array.from({ length: Math.min(parallel, plan.shots.length) }, worker));
  }

  const rendered = results.filter((r) => r.status === "ok").length;
  log(`\nDone. Rendered ${rendered}/${plan.shots.length} shot(s) into ${plan.outDir}`);
  return results;
}
