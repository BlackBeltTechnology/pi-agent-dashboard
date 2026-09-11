import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL,
  downloadModel,
  EXPECTED_MODEL_BYTES,
  type FetchLike,
  modelCacheDir,
  resolveModel,
} from "../models.js";

const dirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "mdl-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function fetchWith(body: Buffer, contentLength?: number): FetchLike {
  return async () => ({
    ok: true,
    status: 200,
    headers: { get: (n) => (n.toLowerCase() === "content-length" && contentLength !== undefined ? String(contentLength) : null) },
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
  });
}

describe("model defaults", () => {
  it("defaults to the campplus zh_en model, never a bigger one", () => {
    expect(DEFAULT_MODEL).toBe("3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx");
    expect(EXPECTED_MODEL_BYTES).toBe(28_281_164);
    expect(modelCacheDir("/home/example")).toBe("/home/example/.pi/models/speaker");
  });
});

describe("resolveModel", () => {
  it("uses an explicit path when present", async () => {
    const file = path.join(tmp(), "custom.onnx");
    fs.writeFileSync(file, "x");
    expect(await resolveModel(file)).toEqual({ path: file, source: "explicit" });
  });

  it("X4 fails naming the expected path and how to obtain the model", async () => {
    const dir = tmp();
    const failing: FetchLike = async () => {
      throw new Error("network down");
    };
    await expect(
      resolveModel(undefined, { cacheDir: dir, fetchFn: failing, expectedBytes: 4 }),
    ).rejects.toThrow(/how to obtain|could not obtain/);
  });

  it("uses the cache dir when the model is already there", async () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, DEFAULT_MODEL), "present");
    const res = await resolveModel(undefined, { cacheDir: dir });
    expect(res.source).toBe("cache");
    expect(res.path).toBe(path.join(dir, DEFAULT_MODEL));
  });

  it("downloads on demand and reports the source", async () => {
    const dir = tmp();
    const res = await resolveModel(undefined, {
      cacheDir: dir,
      fetchFn: fetchWith(Buffer.alloc(8, 1)),
      expectedBytes: 8,
    });
    expect(res.source).toBe("download");
    expect(fs.statSync(res.path).size).toBe(8);
  });
});

describe("downloadModel", () => {
  it("X5 refuses a truncated payload and leaves no partial file", async () => {
    const dir = tmp();
    const dest = path.join(dir, "m.onnx");
    await expect(downloadModel(dest, fetchWith(Buffer.alloc(3, 1)), 8)).rejects.toThrow(/truncated/);
    expect(fs.existsSync(dest)).toBe(false);
    expect(fs.existsSync(`${dest}.partial`)).toBe(false);
  });

  it("rejects a short body against a content-length header", async () => {
    const dir = tmp();
    const dest = path.join(dir, "m.onnx");
    await expect(downloadModel(dest, fetchWith(Buffer.alloc(3, 1), 10), 3)).rejects.toThrow(/truncated/);
  });
});
