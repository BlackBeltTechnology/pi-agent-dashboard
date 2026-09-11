import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AudioSource } from "../audio-decode.js";
import type { Cue } from "../srt-parse.js";
import { parseSrtFile, renderSrt } from "../srt-parse.js";
import { runVoiceId, type VoiceIdDeps } from "../voiceid.js";
import {
  cohortCount,
  emptyLibrary,
  l2,
  loadLibrary,
  makeContribution,
  saveLibrary,
} from "../voiceprint.js";

const e0 = l2([1, 0, 0]);
const e1 = l2([0, 1, 0]);
const e2 = l2([0, 0, 1]);
const negE0 = l2([-1, 0, 0]);

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

interface Harness {
  dir: string;
  srt: string;
  media: string;
  store: string;
  vectors: Map<number, Float32Array>;
  logs: string[];
  warns: string[];
  errors: string[];
  deps: VoiceIdDeps;
  run: (argv: string[]) => Promise<number>;
}

function makeHarness(): Harness {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vid-"));
  dirs.push(dir);
  const srt = path.join(dir, "talk.srt");
  const media = path.join(dir, "talk.mp4");
  fs.writeFileSync(media, "");
  const store = path.join(dir, "store.json");
  const vectors = new Map<number, Float32Array>();
  const logs: string[] = [];
  const warns: string[] = [];
  const errors: string[] = [];
  const source: AudioSource = {
    sampleRate: 16000,
    filePath: "",
    bytes: 0,
    readWindow(start: number) {
      const audio = new Float32Array(16000).fill(0.1);
      audio[0] = start + 1000; // carries the window start back to the fake embedder
      return audio;
    },
    close() {},
  };
  const deps: VoiceIdDeps = {
    env: {},
    home: dir,
    log: (m) => logs.push(m),
    warn: (m) => warns.push(m),
    error: (m) => errors.push(m),
    resolveModel: async () => ({ path: "/fake/model.onnx", source: "explicit" }),
    loadEmbedder: async () => ({
      dim: 3,
      modelName: "fake",
      embed: (samples: Float32Array) => vectors.get(Math.round(samples[0] - 1000)) ?? null,
    }),
    decodeAudio: async () => source,
    getDuration: async () => 100000,
  };
  return { dir, srt, media, store, vectors, logs, warns, errors, deps, run: (argv) => runVoiceId(argv, deps) };
}

function writeSrt(h: Harness, clusters: { label: string; starts: number[]; vector: Float32Array }[]): void {
  const cues: Cue[] = [];
  let index = 1;
  for (const c of clusters) {
    for (const start of c.starts) {
      cues.push({ index: String(index++), start, end: start + 8, label: c.label, text: "x" });
      h.vectors.set(start, c.vector);
    }
  }
  fs.writeFileSync(h.srt, renderSrt(cues), "utf8");
}

function seedStore(h: Harness, vps: Record<string, Float32Array>): void {
  const lib = emptyLibrary();
  lib.contributions = [
    makeContribution("seedA", "1", Array.from({ length: 20 }, () => e0), 10, "fake"),
    makeContribution("seedB", "2", Array.from({ length: 20 }, () => negE0), 10, "fake"),
  ];
  lib.contributedRecordings = ["seedA", "seedB"];
  for (const [name, v] of Object.entries(vps)) {
    lib.voiceprints[name] = {
      vector: Array.from(l2(v)),
      dim: 3,
      model: "fake",
      nSegments: 3,
      enrollSeconds: 5,
      coherence: 1,
      sources: ["seed"],
    };
  }
  saveLibrary(h.store, lib);
}

describe("arg parsing and help", () => {
  it("prints help for the bare command and for --help", async () => {
    const h = makeHarness();
    expect(await h.run([])).toBe(0);
    expect(await h.run(["forget", "--help"])).toBe(0);
    expect(h.logs.join("\n")).toMatch(/enroll[\s\S]*forget/);
  });
});

describe("enroll", () => {
  it("6.3/6.4 builds a voiceprint and feeds the cohort with the other clusters", async () => {
    const h = makeHarness();
    writeSrt(h, [
      { label: "Speaker 1", starts: [0, 20, 40], vector: e0 },
      { label: "Speaker 2", starts: [100, 120, 140], vector: e1 },
    ]);
    const code = await h.run(["enroll", "--name", "Alice", "--srt", h.srt, "--label", "Speaker 1", "--store", h.store]);
    expect(code).toBe(0);
    const lib = loadLibrary(h.store);
    expect(lib.voiceprints.Alice).toBeDefined();
    expect(cohortCount(lib)).toBeGreaterThan(3); // own 3 + the other cluster's 3
  });

  it("6.3 enrolls from a standalone clip", async () => {
    const h = makeHarness();
    const clip = path.join(h.dir, "clip.wav");
    fs.writeFileSync(clip, "");
    for (const start of [0, 6, 12, 18]) h.vectors.set(start, e0);
    const code = await h.run(["enroll", "--name", "Bob", "--audio", clip, "--start", "0", "--end", "20", "--store", h.store]);
    expect(code).toBe(0);
    expect(loadLibrary(h.store).voiceprints.Bob).toBeDefined();
  });
});

describe("list", () => {
  it("6.6 shows the library and cohort state", async () => {
    const h = makeHarness();
    seedStore(h, { Alice: e0 });
    expect(await h.run(["list", "--store", h.store])).toBe(0);
    const out = h.logs.join("\n");
    expect(out).toMatch(/Alice/);
    expect(out).toMatch(/cohort/);
  });
});

describe("analyze", () => {
  it("6.7/6.17 runs on a two-cluster SRT", async () => {
    const h = makeHarness();
    writeSrt(h, [
      { label: "Speaker 1", starts: [0, 20, 40], vector: e0 },
      { label: "Speaker 2", starts: [100, 120, 140], vector: e1 },
    ]);
    expect(await h.run(["analyze", "--srt", h.srt, "--store", h.store])).toBe(0);
    expect(h.logs.join("\n")).toMatch(/cluster-to-cluster/);
  });

  it("E35 reports nothing to compare for a single cluster", async () => {
    const h = makeHarness();
    writeSrt(h, [{ label: "Speaker 1", starts: [0, 20, 40], vector: e0 }]);
    expect(await h.run(["analyze", "--srt", h.srt, "--store", h.store])).toBe(0);
    expect(h.logs.join("\n")).toMatch(/nothing to compare/);
  });
});

describe("label", () => {
  function twoClusters(h: Harness): void {
    writeSrt(h, [
      { label: "Speaker 1", starts: [0, 20, 40], vector: e0 },
      { label: "Speaker 2", starts: [100, 120, 140], vector: e1 },
    ]);
  }

  it("6.8/6.9 writes a sibling and preserves unmatched labels", async () => {
    const h = makeHarness();
    seedStore(h, { Alice: e0, Bob: e2 });
    twoClusters(h);
    const before = fs.readFileSync(h.srt, "utf8");
    expect(await h.run(["label", "--srt", h.srt, "--store", h.store])).toBe(0);
    const output = path.join(h.dir, "talk.named.srt");
    const cues = parseSrtFile(output);
    expect(cues.filter((c) => c.label === "Alice")).toHaveLength(3);
    expect(cues.filter((c) => c.label === "Speaker 2")).toHaveLength(3);
    expect(fs.readFileSync(h.srt, "utf8")).toBe(before);
  });

  it("6.11/6.13 --dry-run writes nothing; --output writes an explicit path", async () => {
    const h = makeHarness();
    seedStore(h, { Alice: e0, Bob: e2 });
    twoClusters(h);
    expect(await h.run(["label", "--srt", h.srt, "--store", h.store, "--dry-run"])).toBe(0);
    expect(fs.existsSync(path.join(h.dir, "talk.named.srt"))).toBe(false);
    const explicit = path.join(h.dir, "out.srt");
    expect(await h.run(["label", "--srt", h.srt, "--store", h.store, "--output", explicit])).toBe(0);
    expect(fs.existsSync(explicit)).toBe(true);
  });

  it("6.12/X19 exits non-zero and writes nothing when no cluster qualifies", async () => {
    const h = makeHarness();
    seedStore(h, { Alice: e2 });
    twoClusters(h);
    expect(await h.run(["label", "--srt", h.srt, "--store", h.store])).toBe(1);
    expect(fs.existsSync(path.join(h.dir, "talk.named.srt"))).toBe(false);
    expect(h.logs.join("\n")).toMatch(/nothing to rewrite/);
  });

  it("X16 refuses an output that resolves to the input (path, hard link, case alias)", async () => {
    const h = makeHarness();
    seedStore(h, { Alice: e0, Bob: e2 });
    twoClusters(h);
    expect(await h.run(["label", "--srt", h.srt, "--store", h.store, "--output", h.srt])).toBe(1);
    expect(h.errors.join("\n")).toMatch(/source SRT/);
    const link = path.join(h.dir, "link.srt");
    fs.linkSync(h.srt, link);
    expect(await h.run(["label", "--srt", h.srt, "--store", h.store, "--output", link])).toBe(1);
    // case-only alias is only a collision on a case-insensitive filesystem
    const alias = path.join(h.dir, "TALK.srt");
    if (fs.existsSync(alias)) {
      expect(await h.run(["label", "--srt", h.srt, "--store", h.store, "--output", alias])).toBe(1);
    }
  });

  it("X17 the collision check precedes 'nothing renamed'", async () => {
    const h = makeHarness();
    seedStore(h, { Alice: e2 }); // nothing matches
    twoClusters(h);
    expect(await h.run(["label", "--srt", h.srt, "--store", h.store, "--output", h.srt])).toBe(1);
    expect(h.errors.join("\n")).toMatch(/source SRT/);
  });

  it("6.15 refuses an already-named transcript without --relabel", async () => {
    const h = makeHarness();
    seedStore(h, { Alice: e0 });
    writeSrt(h, [{ label: "Alice", starts: [0, 20, 40], vector: e0 }]);
    expect(await h.run(["label", "--srt", h.srt, "--store", h.store])).toBe(1);
    expect(h.errors.join("\n")).toMatch(/--relabel/);
  });

  it("6.19/E25 --relabel leaves an assigned name untouched and decides the rest", async () => {
    const h = makeHarness();
    seedStore(h, { Alice: e0, Bob: e2 });
    writeSrt(h, [
      { label: "Alice", starts: [0, 20, 40], vector: e0 },
      { label: "Speaker 3", starts: [100, 120, 140], vector: e2 },
    ]);
    expect(await h.run(["label", "--srt", h.srt, "--store", h.store, "--relabel"])).toBe(0);
    const cues = parseSrtFile(path.join(h.dir, "talk.named.srt"));
    expect(cues.filter((c) => c.label === "Alice")).toHaveLength(3);
    expect(cues.filter((c) => c.label === "Bob")).toHaveLength(3);
  });
});

describe("forget", () => {
  it("6.14 removes a voiceprint by name and a recording's contribution", async () => {
    const h = makeHarness();
    seedStore(h, { Alice: e0 });
    expect(await h.run(["forget", "--name", "Alice", "--store", h.store])).toBe(0);
    expect(loadLibrary(h.store).voiceprints.Alice).toBeUndefined();
    expect(await h.run(["forget", "--recording", "seedA", "--store", h.store])).toBe(0);
    const lib = loadLibrary(h.store);
    expect(lib.contributions.some((c) => c.recordingId === "seedA")).toBe(false);
    expect(lib.contributedRecordings).not.toContain("seedA");
  });
});
