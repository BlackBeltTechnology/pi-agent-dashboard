/**
 * Image probing and resizing for pi-image-fit.
 *
 * Spec: Resize threshold policy, Resize implementation.
 * Design: D2 (jimp), D3 (format-adaptive PNG-in→PNG-out, else JPEG@85).
 *
 * The `jimp` library is loaded lazily so that the disabled path
 * (PI_IMAGE_FIT_DISABLE=1) and non-image read paths never pay the
 * ~50 ms jimp load cost.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Jimp, JimpMime } from "jimp";

export interface ImageDims {
  width: number;
  height: number;
}

export interface NeedsResizeInput {
  bytes: number;
  maxBytes: number;
  dims: ImageDims;
  maxEdge: number;
}

/**
 * Resize policy predicate.
 * Spec: Resize threshold policy.
 */
export function needsResize(input: NeedsResizeInput): boolean {
  const longEdge = Math.max(input.dims.width, input.dims.height);
  return input.bytes > input.maxBytes || longEdge > input.maxEdge;
}

/**
 * Output extension and mime type for the format-adaptive policy.
 *  - `.png` source  → PNG output (lossless)
 *  - everything else → JPEG output (lossy)
 *
 * Returns `{ ext, mime }` where `ext` includes the leading dot.
 */
export function outputFormatFor(srcPath: string): { ext: string; mime: string } {
  const lower = srcPath.toLowerCase();
  if (lower.endsWith(".png")) {
    return { ext: ".png", mime: JimpMime.png };
  }
  return { ext: ".jpg", mime: JimpMime.jpeg };
}

/**
 * Mime-derived output format for the buffer (`context`-seam) path.
 *  - `image/png` → PNG output (lossless)
 *  - everything else (`image/jpeg`, `image/webp`, `image/gif`) → JPEG@quality
 *
 * Mirrors `outputFormatFor` but keyed on the declared mime type, since a
 * `context`-seam `ImageContent` block carries a mimeType, not a file path.
 * Spec/Design: D2.
 */
export function outputFormatForMime(mime: string): { format: "png" | "jpeg"; mime: string } {
  if (mime.trim().toLowerCase() === "image/png") {
    return { format: "png", mime: JimpMime.png };
  }
  return { format: "jpeg", mime: JimpMime.jpeg };
}

/**
 * Estimate decoded byte size from a base64 string length without decoding.
 * Each 4 base64 chars encode 3 bytes; trailing `=` padding shrinks the last
 * group. Cheap (no allocation, no decode) — the steady-state byte gate.
 * Design: D4.
 */
export function estimateBytesFromBase64(b64: string): number {
  const len = b64.length;
  if (len === 0) return 0;
  let padding = 0;
  if (b64.charCodeAt(len - 1) === 0x3d /* = */) padding++;
  if (len > 1 && b64.charCodeAt(len - 2) === 0x3d) padding++;
  return Math.floor((len * 3) / 4) - padding;
}

/**
 * Cheap image-header dimension probe — parses PNG IHDR / JPEG SOF /
 * WEBP VP8X|VP8|VP8L / GIF logical-screen from the leading bytes without a
 * full pixel decode. Returns null when the header cannot be parsed (caller
 * falls back to a bounded jimp decode). Design: D4.
 */
export function probeDimsFromHeader(buf: Buffer): ImageDims | null {
  try {
    if (isPng(buf)) return pngDims(buf);
    if (isGif(buf)) return gifDims(buf);
    if (isWebp(buf)) return webpDims(buf);
    if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) return jpegDims(buf);
    return null;
  } catch {
    return null;
  }
}

function positiveDims(width: number, height: number): ImageDims | null {
  return width > 0 && height > 0 ? { width, height } : null;
}

// PNG: 8-byte signature, then IHDR chunk (width/height at 16/20 BE).
function isPng(buf: Buffer): boolean {
  return (
    buf.length >= 24 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  );
}
function pngDims(buf: Buffer): ImageDims | null {
  return positiveDims(buf.readUInt32BE(16), buf.readUInt32BE(20));
}

// GIF: "GIF87a"/"GIF89a", logical-screen width/height at 6/8 LE.
function isGif(buf: Buffer): boolean {
  return buf.length >= 10 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46;
}
function gifDims(buf: Buffer): ImageDims | null {
  return positiveDims(buf.readUInt16LE(6), buf.readUInt16LE(8));
}

// WEBP: "RIFF"...."WEBP", then a VP8X / VP8 / VP8L chunk.
function isWebp(buf: Buffer): boolean {
  return (
    buf.length >= 30 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  );
}
function webpDims(buf: Buffer): ImageDims | null {
  const fourcc = buf.toString("ascii", 12, 16);
  if (fourcc === "VP8X") {
    return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
  }
  if (fourcc === "VP8 " && buf[23] === 0x9d && buf[24] === 0x01 && buf[25] === 0x2a) {
    // Lossy: dims at offsets 26/28, masked to 14 bits.
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (fourcc === "VP8L" && buf[20] === 0x2f) {
    // Lossless: 14-bit (width-1) then 14-bit (height-1), little-endian bits.
    const b1 = buf[21];
    const b2 = buf[22];
    const b3 = buf[23];
    const b4 = buf[24];
    return {
      width: 1 + (((b2 & 0x3f) << 8) | b1),
      height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6)),
    };
  }
  return null;
}

// JPEG: 0xFFD8, then scan segments for a Start-Of-Frame marker.
function jpegDims(buf: Buffer): ImageDims | null {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1];
    // Padding fill byte / standalone markers with no length payload.
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    // SOF0..SOF15 (baseline/progressive/etc.), excluding DHT/JPG/DAC.
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      return positiveDims(buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5));
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

/**
 * Probe image dimensions from raw bytes via a full jimp decode.
 * Buffer-path twin of `probeDims`. Returns null on undecodable input.
 * Used only on the resize path / header-probe fallback (Design D4).
 */
export async function probeDimsFromBuffer(buf: Buffer): Promise<ImageDims | null> {
  try {
    const img = await Jimp.fromBuffer(buf);
    return { width: img.width, height: img.height };
  } catch {
    return null;
  }
}

/**
 * Image-extension allowlist used by the tool_call hook gate.
 * Spec: Tool-call mutation seam.
 */
const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif)$/i;

export function isImagePath(p: string): boolean {
  return IMAGE_EXT_RE.test(p);
}

/**
 * Probe source image dimensions by loading via jimp.
 * Returns null if the file cannot be decoded (caller falls through).
 */
export async function probeDims(srcPath: string): Promise<ImageDims | null> {
  try {
    const img = await Jimp.read(srcPath);
    return { width: img.width, height: img.height };
  } catch {
    return null;
  }
}

export interface ResizeOptions {
  maxEdge: number;
  /** JPEG quality 1–100. Ignored for PNG output. */
  quality: number;
}

export interface ResizeResult {
  srcDims: ImageDims;
  dstDims: ImageDims;
  dstBytes: number;
  outExt: string;
}

/**
 * Re-encode the source image to `dstPath` at `outExt`, scaled so the
 * long edge is at most `maxEdge` (preserving aspect ratio).
 *
 * Caller is responsible for ensuring `path.dirname(dstPath)` exists.
 * Throws on any failure; the extension hook catches at the top level
 * and falls through to the original path.
 */
export async function resizeToFile(
  srcPath: string,
  dstPath: string,
  opts: ResizeOptions,
): Promise<ResizeResult> {
  const img = await Jimp.read(srcPath);
  const srcDims: ImageDims = { width: img.width, height: img.height };

  // Long-edge scaling, aspect-ratio preserving. Jimp 1.x exposes
  // `.scaleToFit({ w, h })` which fits the image inside a w×h box.
  // Using the same value for both edges yields long-edge ≤ maxEdge.
  if (Math.max(srcDims.width, srcDims.height) > opts.maxEdge) {
    img.scaleToFit({ w: opts.maxEdge, h: opts.maxEdge });
  }

  const outExt = path.extname(dstPath).toLowerCase();
  let buffer: Buffer;
  if (outExt === ".png") {
    buffer = (await img.getBuffer(JimpMime.png)) as unknown as Buffer;
  } else {
    buffer = (await img.getBuffer(JimpMime.jpeg, {
      quality: opts.quality,
    })) as unknown as Buffer;
  }

  await fs.writeFile(dstPath, buffer);

  return {
    srcDims,
    dstDims: { width: img.width, height: img.height },
    dstBytes: buffer.length,
    outExt,
  };
}

/**
 * Buffer-path twin of `resizeToFile`: decode `buf`, long-edge scale to
 * `opts.maxEdge` (aspect-ratio preserving, never upscaling), and re-encode
 * to `outFormat`. No temp file. Throws on any jimp failure; the caller
 * catches and falls open per the fail-open contract. Design: D2.
 */
export async function resizeBuffer(
  buf: Buffer,
  opts: ResizeOptions,
  outFormat: "png" | "jpeg",
): Promise<{ data: Buffer; dims: ImageDims }> {
  const img = await Jimp.fromBuffer(buf);
  if (Math.max(img.width, img.height) > opts.maxEdge) {
    img.scaleToFit({ w: opts.maxEdge, h: opts.maxEdge });
  }
  const data =
    outFormat === "png"
      ? ((await img.getBuffer(JimpMime.png)) as unknown as Buffer)
      : ((await img.getBuffer(JimpMime.jpeg, { quality: opts.quality })) as unknown as Buffer);
  return { data, dims: { width: img.width, height: img.height } };
}
