/**
 * Animated-GIF detection, deliberately free of any image-decoding dependency.
 *
 * Lives apart from `display-fit.ts` because that module statically imports
 * jimp: the INGEST path (main thread) must ask "is this animated?" to keep the
 * two-phase admission gate aligned with the fit gate, and pulling jimp onto the
 * main thread to answer it would defeat the offload the worker pool exists for.
 *
 * See change: fit-attachments-for-display (D11).
 */

/**
 * True for a GIF carrying more than one image frame.
 *
 * Resizing an animated GIF through jimp flattens it to a single frame, so D11
 * exempts them from fitting entirely rather than silently destroying the
 * animation.
 *
 * A real block-stream WALK, not a byte scan. The previous implementation
 * counted every `0x2C` byte in the file, so a still GIF whose colour table or
 * LZW data happened to contain two of them was reported as animated and
 * silently skipped fitting. `0x2C` is only an Image Descriptor when it appears
 * at a block boundary; everywhere else it is ordinary data.
 *
 * Walking means honouring the structure that tells us where the next block
 * begins: the Global Colour Table's size, each extension's sub-block chain,
 * and each frame's Local Colour Table plus LZW sub-block chain.
 *
 * Fails SAFE on a malformed or truncated stream: the walk stops and reports
 * what it counted so far rather than guessing or looping. Under-reporting only
 * means the image is fitted normally; it can never hang the caller.
 */
export function isAnimatedGif(bytes: Buffer): boolean {
  if (bytes.length < 13) return false;
  const header = bytes.subarray(0, 6).toString("ascii");
  if (header !== "GIF87a" && header !== "GIF89a") return false;

  // Logical Screen Descriptor: 7 bytes, the last of which packs the Global
  // Colour Table flag (bit 7) and its size exponent (bits 0-2).
  const packed = bytes[10];
  let i = 13;
  if (packed & 0x80) i += 3 * (1 << ((packed & 0x07) + 1));

  /**
   * Skip a length-prefixed sub-block chain, returning the offset just past its
   * zero terminator — or -1 when the chain runs off the end.
   *
   * Reporting truncation matters: a chain that never terminates is not a
   * complete frame, and counting it as one leaves a malformed GIF inline at
   * full size (ingest declines anything it believes is animated).
   */
  const skipSubBlocks = (from: number): number => {
    let p = from;
    while (p < bytes.length) {
      const len = bytes[p];
      if (len === 0) return p + 1; // terminator consumed
      p += 1 + len;
    }
    return -1; // truncated: no terminator
  };

  /**
   * Offset of the LZW data following an Image Descriptor at `at`, or -1 when
   * the stream ends inside the descriptor, its Local Colour Table, or the LZW
   * minimum-code-size byte.
   *
   * Validating BEFORE counting matters: a stream ending at a bare `0x2C` was
   * otherwise reported animated on the strength of a separator whose frame
   * never arrives. Over-reporting is the dangerous direction now that ingest
   * DECLINES animated GIFs — a false positive keeps full-resolution bytes
   * inline in the row, where they can push the event past its ceiling. So
   * truncation answers "not animated": the image is fitted normally, and a
   * genuinely corrupt one fails honestly in the fit.
   */
  const imageDataStart = (buf: Buffer, at: number): number => {
    // Image Descriptor is 10 bytes; its final byte packs the Local Colour
    // Table flag and size.
    if (at + 10 > buf.length) return -1;
    const lct = buf[at + 9];
    let p = at + 10;
    if (lct & 0x80) p += 3 * (1 << ((lct & 0x07) + 1));
    p += 1; // LZW minimum code size
    return p > buf.length ? -1 : p;
  };

  /**
   * Offset just past a COMPLETE frame beginning at `at`, or -1 when the stream
   * is truncated anywhere inside it — descriptor, colour table, LZW byte, or an
   * unterminated sub-block chain.
   */
  const frameEnd = (at: number): number => {
    const dataStart = imageDataStart(bytes, at);
    return dataStart < 0 ? -1 : skipSubBlocks(dataStart);
  };

  let frames = 0;
  while (i < bytes.length) {
    const block = bytes[i];
    if (block === 0x3b) return false; // trailer: a complete, still image
    if (block === 0x21) {
      // Extension: introducer, label, then a sub-block chain.
      if (i + 2 > bytes.length) return frames > 1;
      const next = skipSubBlocks(i + 2);
      if (next < 0) return frames > 1; // truncated extension: stop, do not guess
      i = next;
      continue;
    }
    if (block === 0x2c) {
      // Count only COMPLETE frames: a truncated one is not evidence of
      // animation, and over-reporting leaves a malformed GIF inline at full
      // size because ingest declines anything it believes is animated.
      const end = frameEnd(i);
      if (end < 0) return false;
      frames++;
      if (frames > 1) return true; // two COMPLETE frames is proof
      i = end;
      continue;
    }
    // Unknown byte where a block header belongs: the stream is malformed, so
    // stop rather than resync and risk counting data as frames.
    return frames > 1;
  }
  return frames > 1;
}
