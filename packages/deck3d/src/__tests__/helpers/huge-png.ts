/**
 * A VALID PNG of any size whose pixels are all transparent black, built by
 * streaming zeros through deflate (a few hundred KB for hundreds of MB of
 * pixels) — the shape of a decompression-bomb reference render. Test helper.
 */
import { crc32, createDeflate } from "node:zlib";

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)) >>> 0, 8 + data.length);
  return out;
}

export async function hugePng(width: number, height: number): Promise<Uint8Array> {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const deflate = createDeflate({ level: 9 });
  const parts: Buffer[] = [];
  deflate.on("data", (d: Buffer) => parts.push(d));
  const done = new Promise<void>((resolve, reject) => {
    deflate.on("end", resolve);
    deflate.on("error", reject);
  });
  const row = Buffer.alloc(width * 4 + 1); // filter 0 + zeros
  const rowsPerWrite = Math.max(1, Math.floor((1 << 20) / row.length));
  const block = Buffer.alloc(row.length * rowsPerWrite);
  for (let y = 0; y < height; y += rowsPerWrite) {
    const n = Math.min(rowsPerWrite, height - y);
    if (!deflate.write(n === rowsPerWrite ? block : block.subarray(0, row.length * n))) await new Promise((r) => deflate.once("drain", r));
  }
  deflate.end();
  await done;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return new Uint8Array(Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", Buffer.concat(parts)), chunk("IEND", Buffer.alloc(0))]));
}
