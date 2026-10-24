/**
 * `ui.screenshot` reply processing (design D4): the app answers `{width, height, pngBase64}`; the host
 * refuses an over-large image BEFORE decoding (by the PNG header), then decodes it with `createImageBitmap`
 * in an `OffscreenCanvas` and re-encodes a JPEG (q80) at a long edge of 1280 px, stepping down to 960 and
 * 640 until the reply fits the 192 KiB result cap. Browser APIs are looked up at call time (test seam).
 *
 * See change: add-craft-live-control (D4).
 */
import { REPLY_MAX_BYTES, SCREENSHOT_MAX_PIXELS } from "../shared/control-protocol.js";

/** Long-edge steps tried in order. */
export const SCREENSHOT_EDGES = [1280, 960, 640] as const;
const JPEG_QUALITY = 0.8;

export type ScreenshotOutcome =
  | { ok: true; result: { mime: "image/jpeg"; width: number; height: number; jpegBase64: string } }
  /** `too-large`: over a size cap (the agent should ask for less); `failed`: no image, not a PNG, undecodable. */
  | { ok: false; kind: "too-large" | "failed"; message: string };

/** Pixel size from a PNG header (`IHDR` at byte 16), or `null` when the bytes are not a PNG. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || sig.some((b, i) => bytes[i] !== b)) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: v.getUint32(16), height: v.getUint32(20) };
}

const fromBase64 = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Encode `png` as a JPEG with its long edge at most `edge` px (never upscaled). */
export async function encodeJpeg(png: Uint8Array, edge: number): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const size = pngSize(png) as { width: number; height: number };
  const scale = Math.min(1, edge / Math.max(size.width, size.height));
  const width = Math.max(1, Math.round(size.width * scale));
  const height = Math.max(1, Math.round(size.height * scale));
  const bitmap = await createImageBitmap(new Blob([png as BlobPart], { type: "image/png" }), { resizeWidth: width, resizeHeight: height, resizeQuality: "high" });
  try {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d canvas");
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: JPEG_QUALITY });
    return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height };
  } finally {
    bitmap.close?.();
  }
}

export interface ScreenshotDeps {
  /** Largest raw PNG the claim accepts (`maxBytes` of the app's claim). */
  maxRawBytes: number;
  encode?: typeof encodeJpeg;
}

/** Decode and vet the frame's `pngBase64` (size caps before any decode); a refusal is a short message. */
type Refusal = { kind: "too-large" | "failed"; message: string };

function vetPng(raw: unknown, maxRawBytes: number): { png: Uint8Array; size: { width: number; height: number } } | Refusal {
  const b64 = raw && typeof raw === "object" ? (raw as { pngBase64?: unknown }).pngBase64 : undefined;
  if (typeof b64 !== "string") return { kind: "failed", message: "the app's screenshot reply carries no image" };
  const tooBig: Refusal = { kind: "too-large", message: "the screenshot is larger than this app's file size limit" };
  if (b64.length > Math.ceil((maxRawBytes * 4) / 3) + 8) return tooBig;
  let png: Uint8Array;
  try {
    png = fromBase64(b64);
  } catch {
    return { kind: "failed", message: "the app's screenshot is not valid base64" };
  }
  if (png.length > maxRawBytes) return tooBig;
  const size = pngSize(png);
  if (!size) return { kind: "failed", message: "the app's screenshot is not a PNG" };
  if (size.width * size.height > SCREENSHOT_MAX_PIXELS) return { kind: "too-large", message: `the screenshot is ${size.width}×${size.height}, over 16 megapixels` };
  return { png, size };
}

/** Process the frame's `ui.screenshot` payload; any failure is a short message for a `reply_too_large` / `app_error`. */
export async function processScreenshot(raw: unknown, deps: ScreenshotDeps): Promise<ScreenshotOutcome> {
  const vetted = vetPng(raw, deps.maxRawBytes);
  if ("message" in vetted) return { ok: false, ...vetted };
  const { png, size } = vetted;
  const encode = deps.encode ?? encodeJpeg;
  let last = { width: size.width, height: size.height };
  for (const edge of SCREENSHOT_EDGES) {
    let out: Awaited<ReturnType<typeof encodeJpeg>>;
    try {
      out = await encode(png, edge);
    } catch (err) {
      return { ok: false, kind: "failed", message: `the screenshot could not be decoded (${err instanceof Error ? err.message : String(err)})` };
    }
    last = { width: out.width, height: out.height };
    const result = { mime: "image/jpeg" as const, width: out.width, height: out.height, jpegBase64: toBase64(out.bytes) };
    if (JSON.stringify(result).length <= REPLY_MAX_BYTES) return { ok: true, result };
  }
  return { ok: false, kind: "too-large", message: `the screenshot does not fit ${REPLY_MAX_BYTES / 1024} KiB even at ${last.width}×${last.height}` };
}
