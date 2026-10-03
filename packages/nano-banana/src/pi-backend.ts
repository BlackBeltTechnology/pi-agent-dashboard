/**
 * Opt-in pi-runtime image backend (`backend: "pi"`).
 *
 * Generates images through pi's model runtime (`ModelRuntime.generateImages`,
 * pi >= 1.0.0) using the OpenRouter credential pi already holds (`/login
 * openrouter` or `OPENROUTER_API_KEY`). pi is loaded lazily with a dynamic
 * `import()` only on this path; every failure — import, version guard, runtime
 * creation, provider error, I/O — resolves to an `ok: false` result, never a throw.
 *
 * Types are local structural subsets so the package does not depend on
 * `@earendil-works/pi-ai`; pi's values satisfy them at runtime.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export const PI_PACKAGE = "@earendil-works/pi-coding-agent";
export const PI_MIN_VERSION = "1.0.0";
export const PI_PROVIDER = "openrouter";
export const DEFAULT_PI_MODEL = "google/gemini-2.5-flash-image";
export const FLASH_PI_MODEL = "google/gemini-3.1-flash-lite-image";
export const DEFAULT_TIMEOUT_MS = 180_000;
const ERROR_MAX = 400;

export interface PiTextBlock {
  type: "text";
  text: string;
}
export interface PiImageBlock {
  type: "image";
  data: string;
  mimeType: string;
}
export type PiImageContent = PiTextBlock | PiImageBlock;

export interface PiImageUsage {
  input: number;
  output: number;
  totalTokens?: number;
  cost: { total: number };
}

export interface PiImageModel {
  provider: string;
  id: string;
}

export interface PiImageResponse {
  output: PiImageContent[];
  stopReason: string;
  errorMessage?: string;
  usage?: PiImageUsage;
}

/** The subset of pi's `ModelRuntime` this backend uses. */
export interface PiImageRuntime {
  getModelOfType(type: "image", provider: string, id: string): PiImageModel | undefined;
  getModelsOfType(type: "image", provider?: string): readonly PiImageModel[];
  generateImages(
    model: PiImageModel,
    context: { input: PiImageContent[] },
    options?: { signal?: AbortSignal; maxRetries?: number },
  ): Promise<PiImageResponse>;
}

/** The subset of the pi module this backend reads. */
export interface PiModule {
  VERSION?: unknown;
  ModelRuntime?: { create?: (options: unknown) => Promise<unknown> };
}

export type PiLoader = () => Promise<PiModule>;
export type PiRuntimeFactory = () => Promise<unknown>;

export interface PiSeams {
  /** Module loader (tests). Default: dynamic import of `@earendil-works/pi-coding-agent`. */
  loadPi?: PiLoader;
  /** Runtime factory (tests). Replaces load + version guard + `ModelRuntime.create`. */
  createPiRuntime?: PiRuntimeFactory;
}

export interface PiGenerateOptions {
  prompt: string;
  output?: string;
  file?: string;
  model?: string;
  flash?: boolean;
  /** Per-generation abort timeout. Default 180 000 ms. */
  timeoutMs?: number;
}

export interface PiOutputFile {
  path: string;
  mimeType: string;
}

export interface PiGenerateResult {
  ok: boolean;
  backend: "pi";
  output?: string;
  outputs?: PiOutputFile[];
  model?: string;
  usage?: PiImageUsage;
  error?: string;
}

export type PiRuntimeAcquisition = { ok: true; runtime: PiImageRuntime } | { ok: false; error: string };

export const loadPi: PiLoader = async () => (await import(PI_PACKAGE)) as PiModule;

const fail = (error: string, extra: Partial<PiGenerateResult> = {}): PiGenerateResult => ({
  ok: false,
  backend: "pi",
  ...extra,
  error: error.slice(0, ERROR_MAX),
});

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const requirement = (found?: string): string =>
  `pi image backend needs ${PI_PACKAGE} >= ${PI_MIN_VERSION}` + (found ? ` (found ${found})` : "");

/** True when `version`'s numeric major.minor.patch is >= 1.0.0; a 1.0.0 prerelease and non-numeric values are below. */
export function meetsMinVersion(version: unknown): boolean {
  if (typeof version !== "string") return false;
  const m = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(version.trim());
  if (!m) return false;
  const nums = [Number(m[1]), Number(m[2]), Number(m[3])];
  const floor = PI_MIN_VERSION.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (nums[i] !== floor[i]) return nums[i] > floor[i];
  }
  return m[4] === undefined;
}

function isImageRuntime(value: unknown): value is PiImageRuntime {
  const r = value as Partial<PiImageRuntime> | null | undefined;
  return (
    typeof r?.generateImages === "function" &&
    typeof r.getModelOfType === "function" &&
    typeof r.getModelsOfType === "function"
  );
}

/** Load pi, enforce the version/shape guard, and create a static-catalogue runtime. Never throws. */
export async function acquirePiRuntime(seams: PiSeams = {}): Promise<PiRuntimeAcquisition> {
  let found: string | undefined;
  try {
    let runtime: unknown;
    if (seams.createPiRuntime) {
      runtime = await seams.createPiRuntime();
    } else {
      let mod: PiModule;
      try {
        mod = await (seams.loadPi ?? loadPi)();
      } catch (err) {
        return { ok: false, error: `${requirement()}: ${errText(err)}` };
      }
      found = typeof mod.VERSION === "string" ? mod.VERSION : undefined;
      if (!meetsMinVersion(mod.VERSION)) return { ok: false, error: requirement(found ?? "unknown version") };
      const create = mod.ModelRuntime?.create;
      if (typeof create !== "function") return { ok: false, error: `${requirement(found)}: ModelRuntime.create missing` };
      runtime = await create.call(mod.ModelRuntime, { modelsPath: null, refreshOnCreate: false });
    }
    if (!isImageRuntime(runtime)) {
      return { ok: false, error: `${requirement(found)}: runtime lacks image generation` };
    }
    return { ok: true, runtime };
  } catch (err) {
    return { ok: false, error: `${requirement(found)}: runtime creation failed: ${errText(err)}` };
  }
}

/** Map the option model to an openrouter image model, or an error listing known ids. */
function resolveModel(runtime: PiImageRuntime, opts: PiGenerateOptions): PiImageModel | string {
  const requested = opts.model ?? (opts.flash ? FLASH_PI_MODEL : DEFAULT_PI_MODEL);
  const slash = requested.includes("/");
  const id = slash ? requested : `google/${requested}`;
  const model = runtime.getModelOfType("image", PI_PROVIDER, id);
  if (model) return model;
  const known = runtime
    .getModelsOfType("image", PI_PROVIDER)
    .map((m) => m.id)
    .filter((m) => slash || m.startsWith("google/"));
  if (known.length === 0) return `unknown image model "${id}": the installed pi has no matching image models`;
  return `unknown image model "${id}". Known: ${known.join(", ")}`;
}

const INPUT_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

async function readEditInput(file: string): Promise<PiImageBlock | string> {
  const ext = path.extname(file).toLowerCase();
  const mimeType = INPUT_MIME[ext];
  if (!mimeType) return `unsupported input image type "${ext || file}" (use .png, .jpg, .jpeg, .webp or .gif)`;
  try {
    const stat = await fs.promises.stat(file);
    if (!stat.isFile()) return `input image is not a file: ${file}`;
    const data = await fs.promises.readFile(file);
    return { type: "image", mimeType, data: data.toString("base64") };
  } catch (err) {
    return `cannot read input image ${file}: ${errText(err)}`;
  }
}

const OUTPUT_EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const extFor = (mimeType: string): string => OUTPUT_EXT[mimeType] ?? "png";

function timestamp(d = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}`
  );
}

/** Exclusive-create `<stem>.<ext>` (when `startAt` is 1) or the lowest free `<stem>-<n>.<ext>` (n >= 2). */
async function writeExclusive(stem: string, ext: string, data: Buffer, startAt: number): Promise<string> {
  for (let n = startAt; ; n++) {
    const candidate = n === 1 ? `${stem}.${ext}` : `${stem}-${n}.${ext}`;
    try {
      await fs.promises.writeFile(candidate, data, { flag: "wx" });
      return candidate;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw Object.assign(err as Error, { target: candidate });
    }
  }
}

function failureMessage(res: PiImageResponse, signal: AbortSignal, timeoutMs: number): string {
  if (signal.aborted) return `timed out after ${timeoutMs} ms${res.errorMessage ? `: ${res.errorMessage}` : ""}`;
  const msg = res.errorMessage ?? `generation ${res.stopReason}`;
  if (/not configured/i.test(msg)) {
    return `${msg} — run /login openrouter in pi or set OPENROUTER_API_KEY`;
  }
  return msg;
}

type WriteResult = { ok: true; outputs: PiOutputFile[] } | { ok: false; error: string; outputs: PiOutputFile[] };

/** Write image blocks: first to the requested path (overwrite) or a generated name; extras exclusive-create. */
async function writeImages(imgs: PiImageBlock[], output: string | undefined): Promise<WriteResult> {
  const outputs: PiOutputFile[] = [];
  const requested = output ? path.resolve(output) : undefined;
  const stem = requested
    ? path.join(path.dirname(requested), path.basename(requested, path.extname(requested)))
    : path.resolve(`nano-banana-${timestamp()}`);
  try {
    for (const [i, img] of imgs.entries()) {
      const data = Buffer.from(img.data, "base64");
      let written: string;
      if (i === 0 && output) {
        written = output;
        await fs.promises.writeFile(written, data).catch((err) => {
          throw Object.assign(err as Error, { target: written });
        });
      } else {
        const file = await writeExclusive(stem, extFor(img.mimeType), data, i === 0 ? 1 : 2);
        written = output ? path.join(path.dirname(output), path.basename(file)) : file;
      }
      outputs.push({ path: written, mimeType: img.mimeType });
    }
  } catch (err) {
    const target = (err as { target?: string }).target ?? output ?? stem;
    return { ok: false, error: `cannot write ${target}: ${errText(err)}`, outputs };
  }
  return { ok: true, outputs };
}

/** Generate (or edit) one image with an acquired runtime. Never throws. */
export async function generateWithPi(runtime: PiImageRuntime, opts: PiGenerateOptions): Promise<PiGenerateResult> {
  try {
    const model = resolveModel(runtime, opts);
    if (typeof model === "string") return fail(model);
    const modelName = `${model.provider}/${model.id}`;

    const input: PiImageContent[] = [];
    if (opts.file) {
      const block = await readEditInput(opts.file);
      if (typeof block === "string") return fail(block, { model: modelName });
      input.push(block);
    }
    input.push({ type: "text", text: opts.prompt });

    const requested = opts.output ? path.resolve(opts.output) : undefined;
    if (requested) {
      try {
        await fs.promises.mkdir(path.dirname(requested), { recursive: true });
      } catch (err) {
        return fail(`cannot create output directory for ${opts.output}: ${errText(err)}`, { model: modelName });
      }
    }

    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const signal = AbortSignal.timeout(timeoutMs);
    const res = await runtime.generateImages(model, { input }, { signal, maxRetries: 0 });
    const base = { model: modelName, ...(res.usage ? { usage: res.usage } : {}) };

    if (res.stopReason !== "stop") return fail(failureMessage(res, signal, timeoutMs), base);

    const imgs = res.output.filter((b): b is PiImageBlock => b.type === "image");
    if (imgs.length === 0) {
      const text = res.output
        .filter((b): b is PiTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return fail(text || "no image returned", base);
    }

    const written = await writeImages(imgs, opts.output);
    if (!written.ok) return fail(written.error, { ...base, ...(written.outputs.length ? { outputs: written.outputs } : {}) });
    const { outputs } = written;

    return { ok: true, backend: "pi", output: outputs[0].path, outputs, ...base };
  } catch (err) {
    return fail(`pi image generation failed: ${errText(err)}`);
  }
}
