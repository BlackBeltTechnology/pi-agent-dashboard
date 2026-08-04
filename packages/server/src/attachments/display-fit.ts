/**
 * Display-fit for inline image attachments.
 *
 * pi delivers pasted screenshots as full-resolution base64 inside the event
 * (`{ type:"image", data, mimeType }`). At the observed size distribution
 * (p50 126 KB, p90 757 KB, p99 2.2 MB, max 10.5 MB) those events blow the
 * per-event serialized ceiling and collapse to `{__truncated}` — taking the
 * user's whole message row with them. Fitting each block to a bounded DISPLAY
 * derivative first makes the ceiling deterministic: measured worst case for
 * 768 px / q75 output is 212 KB (n=40), comfortably inside 256 KiB.
 *
 * This module is the pure, synchronous-to-call fit primitive. It is invoked
 * from a worker so the 174–874 ms jimp decode/encode never runs on the event
 * loop (D4). It NEVER throws into its caller: an undecodable input resolves to
 * an explicit `failed` result so the attachment can render an honest failed
 * state rather than an indefinite placeholder.
 *
 * See change: fit-attachments-for-display (D1, D5, D11).
 */

import { Jimp, JimpMime } from "jimp";

/**
 * Long-edge bound for a display derivative, in pixels. Deliberately a DISPLAY
 * budget, not a model-input budget — `pi-image-fit`'s 1568 px / 4 MiB policy
 * targets what a model can ingest and is two orders of magnitude off what a
 * transcript row needs. See change: fit-attachments-for-display (D5).
 */
export const DISPLAY_MAX_EDGE = 768;

/** JPEG quality for re-encoded derivatives. Measured max output 212 KB at q75. */
export const DISPLAY_JPEG_QUALITY = 75;

export interface ImageBlockInput {
  /** Base64 payload (no data-URL prefix). */
  data: string;
  mimeType: string;
}

export interface FitResult {
  /** Base64 payload to store inline — the derivative, or the input unchanged. */
  data: string;
  mimeType: string;
  /** True when the bytes were actually re-encoded at a smaller size. */
  fitted: boolean;
  /** True when policy deliberately skipped fitting (animated GIF, D11). */
  exempt?: boolean;
  /** True when the input could not be decoded; caller renders a failed state. */
  failed?: boolean;
}

/**
 * True for a GIF carrying more than one image frame.
 *
 * Resizing an animated GIF through jimp flattens it to a single frame, so D11
 * exempts them from fitting entirely rather than silently destroying the
 * animation. Detection scans for a second Image Descriptor block (`0x2C`)
 * rather than decoding: a GIF89a stream contains one descriptor per frame.
 * Bounded by a frame-count short-circuit, so a large GIF costs a single pass.
 */
export function isAnimatedGif(bytes: Buffer): boolean {
  if (bytes.length < 6) return false;
  const header = bytes.subarray(0, 6).toString("ascii");
  if (header !== "GIF87a" && header !== "GIF89a") return false;
  let frames = 0;
  // Walk the block stream: 0x2C introduces an Image Descriptor (one per frame).
  // Two descriptors is already proof of animation, so stop there.
  for (let i = 6; i < bytes.length; i++) {
    if (bytes[i] === 0x2c) {
      frames++;
      if (frames > 1) return true;
    }
  }
  return false;
}

/** The image mime types a derivative may be served/stored as. */
const SUPPORTED_INPUT_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
]);

/**
 * Fit one image content block to the display bound.
 *
 * Returns the input UNCHANGED (byte-identical, `fitted:false`) when it is
 * already within the bound — an image is never upscaled, and a small image is
 * never re-encoded, so no quality is lost for the common case.
 */
export async function fitImageBlockForDisplay(block: ImageBlockInput): Promise<FitResult> {
  const unchanged: FitResult = { data: block.data, mimeType: block.mimeType, fitted: false };
  if (!SUPPORTED_INPUT_MIME.has(block.mimeType.toLowerCase())) return unchanged;

  let bytes: Buffer;
  try {
    bytes = Buffer.from(block.data, "base64");
  } catch {
    return { ...unchanged, failed: true };
  }
  if (bytes.length === 0) return { ...unchanged, failed: true };

  // D11: animated GIFs bypass fitting so animation is never flattened. They
  // stay subject to the existing ceiling and truncate as they always have.
  if (isAnimatedGif(bytes)) return { ...unchanged, exempt: true };

  try {
    const img = await Jimp.read(bytes);
    const longEdge = Math.max(img.bitmap.width, img.bitmap.height);
    // At or under the bound: return the ORIGINAL bytes. Re-encoding here would
    // lose quality and could even grow the payload for no benefit.
    if (longEdge <= DISPLAY_MAX_EDGE) return unchanged;

    const scale = DISPLAY_MAX_EDGE / longEdge;
    img.resize({
      w: Math.max(1, Math.round(img.bitmap.width * scale)),
      h: Math.max(1, Math.round(img.bitmap.height * scale)),
    });

    // PNG in → PNG out keeps screenshots lossless-ish; everything else goes to
    // JPEG at the measured quality. A PNG screenshot is the main use case.
    const png = block.mimeType.toLowerCase() === "image/png";
    const outBuf = png
      ? await img.getBuffer(JimpMime.png)
      : await img.getBuffer(JimpMime.jpeg, { quality: DISPLAY_JPEG_QUALITY });

    return {
      data: outBuf.toString("base64"),
      mimeType: png ? "image/png" : "image/jpeg",
      fitted: true,
    };
  } catch {
    // Undecodable / unsupported-by-jimp input. Never propagate: the caller must
    // still be able to store the message row and show an honest failed state.
    return { ...unchanged, failed: true };
  }
}
