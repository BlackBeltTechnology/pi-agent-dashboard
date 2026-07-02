import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  discoverFiles,
  isTranscribed,
  resolveInputs,
  srtPath,
} from "../discover.js";

function touch(file: string, mtimeMs?: number): void {
  fs.writeFileSync(file, "x");
  if (mtimeMs !== undefined) {
    const t = mtimeMs / 1000;
    fs.utimesSync(file, t, t);
  }
}

describe("srtPath", () => {
  it("derives the SRT from the original stem", () => {
    expect(srtPath("/a/clip.mkv")).toBe("/a/clip.srt");
    expect(srtPath("/a/clip.m4a")).toBe("/a/clip.srt");
  });
});

describe("discovery", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "vt-discover-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("scans a directory for supported media, oldest-first", () => {
    touch(path.join(dir, "b.mp3"), 2000);
    touch(path.join(dir, "a.m4a"), 1000);
    touch(path.join(dir, "notes.txt"), 3000);
    const found = discoverFiles(dir).map((f) => path.basename(f));
    expect(found).toEqual(["a.m4a", "b.mp3"]);
  });

  it("resolveInputs with no args scans the target dir", () => {
    touch(path.join(dir, "x.mp4"), 1000);
    const found = resolveInputs([], dir).map((f) => path.basename(f));
    expect(found).toEqual(["x.mp4"]);
  });

  it("resolveInputs with a single directory scans it", () => {
    touch(path.join(dir, "x.mkv"), 1000);
    const found = resolveInputs([dir]).map((f) => path.basename(f));
    expect(found).toEqual(["x.mkv"]);
  });

  it("resolveInputs treats explicit files as the input set", () => {
    const a = path.join(dir, "a.m4a");
    const b = path.join(dir, "b.mp3");
    touch(a, 2000);
    touch(b, 1000);
    const found = resolveInputs([a, b]).map((f) => path.basename(f));
    expect(found).toEqual(["b.mp3", "a.m4a"]);
  });

  it("resolveInputs rejects unsupported extensions", () => {
    const bad = path.join(dir, "notes.txt");
    touch(bad);
    expect(() => resolveInputs([bad])).toThrow(/Unsupported file type/);
  });

  it("resolveInputs rejects missing paths", () => {
    expect(() => resolveInputs([path.join(dir, "nope.mp3")])).toThrow(/Not a file/);
  });

  it("isTranscribed detects a sibling .srt", () => {
    const media = path.join(dir, "clip.m4a");
    touch(media);
    expect(isTranscribed(media)).toBe(false);
    fs.writeFileSync(srtPath(media), "1\n");
    expect(isTranscribed(media)).toBe(true);
  });
});
