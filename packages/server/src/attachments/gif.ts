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

  /** Skip a length-prefixed sub-block chain, terminated by a zero length. */
  const skipSubBlocks = (from: number): number => {
    let p = from;
    while (p < bytes.length) {
      const len = bytes[p];
      if (len === 0) return p + 1; // terminator consumed
      p += 1 + len;
    }
    return bytes.length; // truncated
  };

  let frames = 0;
  while (i < bytes.length) {
    const block = bytes[i];
    if (block === 0x3b) return false; // trailer: a complete, still image
    if (block === 0x21) {
      // Extension: introducer, label, then a sub-block chain.
      if (i + 2 > bytes.length) return frames > 1;
      i = skipSubBlocks(i + 2);
      continue;
    }
    if (block === 0x2c) {
      frames++;
      if (frames > 1) return true; // two descriptors is proof; stop early
      // Image Descriptor is 10 bytes; its final byte packs the Local Colour
      // Table flag and size.
      if (i + 10 > bytes.length) return false;
      const lct = bytes[i + 9];
      let p = i + 10;
      if (lct & 0x80) p += 3 * (1 << ((lct & 0x07) + 1));
      p += 1; // LZW minimum code size
      i = skipSubBlocks(p);
      continue;
    }
    // Unknown byte where a block header belongs: the stream is malformed, so
    // stop rather than resync and risk counting data as frames.
    return frames > 1;
  }
  return frames > 1;
}
