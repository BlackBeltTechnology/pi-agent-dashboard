import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkMediaDuration,
  findSiblingMedia,
  MEDIA_EXTENSIONS,
  mediaCandidates,
  mediaStem,
  resolveMediaPath,
} from "../media-resolve.js";

const dirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "mr-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("media resolution", () => {
  it("E28 picks .mp4 over .m4a/.mp3 by fixed precedence", () => {
    const dir = tmp();
    const srt = path.join(dir, "talk.srt");
    for (const p of ["talk.mp4", "talk.m4a", "talk.mp3", "talk.srt"]) fs.writeFileSync(path.join(dir, p), "");
    expect(findSiblingMedia(srt)).toBe(path.join(dir, "talk.mp4"));
  });

  it("strips .diarize.srt and .named.srt suffixes", () => {
    expect(mediaStem("/a/talk.diarize.srt")).toBe("talk");
    expect(mediaStem("/a/talk.named.srt")).toBe("talk");
    expect(mediaStem("/a/talk.srt")).toBe("talk");
  });

  it("declares a fixed precedence order", () => {
    expect(mediaCandidates("/a/talk.srt")).toEqual(
      MEDIA_EXTENSIONS.map((e) => `/a/talk${e}`),
    );
  });

  it("E29 an explicit --audio overrides discovery", () => {
    const dir = tmp();
    const srt = path.join(dir, "talk.srt");
    const other = path.join(dir, "other.wav");
    fs.writeFileSync(path.join(dir, "talk.mp4"), "");
    fs.writeFileSync(other, "");
    expect(resolveMediaPath(srt, other)).toBe(other);
  });

  it("X6 fails naming every path tried", () => {
    const dir = tmp();
    const srt = path.join(dir, "talk.srt");
    expect(() => resolveMediaPath(srt)).toThrow(/Tried:[\s\S]*talk\.mkv[\s\S]*talk\.mp3/);
  });
});

describe("duration check", () => {
  it("X7 refuses media shorter than the last cue", () => {
    expect(checkMediaDuration(600, 2400).ok).toBe(false);
  });
  it("X8 accepts longer media (trailing silence)", () => {
    expect(checkMediaDuration(5400, 5220).ok).toBe(true);
  });
  it("X9 skips the check when duration is unknown", () => {
    const r = checkMediaDuration(0, 2400);
    expect(r.ok).toBe(true);
    expect(r.note).toMatch(/unknown/);
  });
});
