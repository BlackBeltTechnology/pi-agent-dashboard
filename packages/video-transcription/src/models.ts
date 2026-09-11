/**
 * Speaker-embedding model resolution: an explicit path, then the cache dir,
 * then an on-demand download verified by size. The 28 MB ONNX model is never
 * vendored into the npm package.
 *
 * Default model: `3dspeaker_campplus_sv_zh_en_16k-common_advanced`. Do **not**
 * "upgrade" to a bigger model — on the benchmark's Hungarian meeting audio the
 * 114 MB VoxCeleb leader scored worse than this 28 MB one.
 *
 * See change: add-speaker-id-enrollment.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const DEFAULT_MODEL = "3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx";

/** Release asset for the default model. */
const MODEL_URL =
  "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/" +
  DEFAULT_MODEL;

/** Byte length of the default model, used to detect a truncated download. */
export const EXPECTED_MODEL_BYTES = 28_281_164;

/** Model cache directory: `<home>/.pi/models/speaker`. */
export function modelCacheDir(home: string = os.homedir()): string {
  return path.join(home, ".pi", "models", "speaker");
}

interface FetchResponseLike {
  ok: boolean;
  status: number;
  headers?: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type FetchLike = (url: string) => Promise<FetchResponseLike>;

export interface ResolveModelOptions {
  home?: string;
  cacheDir?: string;
  fetchFn?: FetchLike;
  expectedBytes?: number;
}

export interface ModelResolution {
  path: string;
  source: "explicit" | "cache" | "download";
}

function howToObtain(file: string): string {
  return (
    `Download it into ${file} — for example:\n` +
    `  mkdir -p ${path.dirname(file)}\n  curl -L -o ${file} ${MODEL_URL}`
  );
}

/**
 * Download the model to `dest`, verifying the payload length against the
 * `content-length` header (when present) or `expectedBytes`. A truncated
 * download is rejected and leaves no partial file behind.
 */
export async function downloadModel(
  dest: string,
  fetchFn: FetchLike = fetch as unknown as FetchLike,
  expectedBytes: number = EXPECTED_MODEL_BYTES,
): Promise<void> {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.partial`;
  try {
    const res = await fetchFn(MODEL_URL);
    if (!res.ok) throw new Error(`download failed with HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const header = res.headers?.get("content-length");
    const expected = header ? Number.parseInt(header, 10) : expectedBytes;
    if (Number.isFinite(expected) && expected > 0 && buffer.byteLength !== expected) {
      throw new Error(
        `model download truncated: got ${buffer.byteLength} bytes, expected ${expected}`,
      );
    }
    fs.writeFileSync(tmp, buffer);
    fs.renameSync(tmp, dest);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // ignore cleanup failure
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`could not obtain the speaker-embedding model: ${msg}\n${howToObtain(dest)}`);
  }
}

/**
 * Resolve the model path: explicit -> cache -> download. Throws a message
 * naming the expected path and how to obtain the model when it cannot be
 * resolved or fetched.
 */
export async function resolveModel(
  explicit?: string,
  opts: ResolveModelOptions = {},
): Promise<ModelResolution> {
  if (explicit) {
    if (!fs.existsSync(explicit)) {
      throw new Error(`embedding model not found: ${explicit}\n${howToObtain(explicit)}`);
    }
    return { path: explicit, source: "explicit" };
  }
  const cache = path.join(opts.cacheDir ?? modelCacheDir(opts.home), DEFAULT_MODEL);
  if (fs.existsSync(cache)) return { path: cache, source: "cache" };

  await downloadModel(
    cache,
    opts.fetchFn ?? (fetch as unknown as FetchLike),
    opts.expectedBytes ?? EXPECTED_MODEL_BYTES,
  );
  return { path: cache, source: "download" };
}
