import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  addRecordingContributions,
  centre,
  centroid,
  cohortCount,
  cohortMean,
  cosine,
  defaultStorePath,
  emptyLibrary,
  forgetByName,
  forgetRecording,
  type Library,
  l2,
  loadLibrary,
  MIN_COHORT,
  makeContribution,
  mergeVoiceprint,
  modelMismatches,
  recordingId,
  resolveStorePath,
  STORE_ENV_VAR,
  saveLibrary,
  withStoreLock,
} from "../voiceprint.js";

const tmpDirs: string[] = [];
function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vp-"));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function vec(...values: number[]): Float32Array {
  return Float32Array.from(values);
}

/** A predictable unit vector of length `dim` biased toward index `i`. */
function unit(dim: number, i: number, weight = 1): Float32Array {
  const v = new Float32Array(dim);
  v[i] = weight;
  v[(i + 1) % dim] = 0.1;
  return l2(v);
}

describe("vector math", () => {
  it("l2 normalises and guards the zero vector", () => {
    const v = l2(vec(3, 4));
    expect(v[0]).toBeCloseTo(0.6);
    expect(v[1]).toBeCloseTo(0.8);
    expect(Array.from(l2(vec(0, 0)))).toEqual([0, 0]);
  });

  it("cosine is 1 for parallel and 0 for a zero vector", () => {
    expect(cosine(unit(4, 0), unit(4, 0))).toBeCloseTo(1);
    expect(cosine(vec(0, 0, 0), unit(3, 0))).toBe(0);
  });

  it("centre subtracts the mean; a vector equal to the mean centres to zero", () => {
    const mean = unit(4, 0);
    expect(Array.from(centre(mean, mean))).toEqual([0, 0, 0, 0]);
    expect(cosine(centre(unit(4, 0), mean), unit(4, 0))).toBeDefined();
  });

  it("centroid of one vector is that vector normalised", () => {
    expect(Array.from(centroid([unit(3, 1)]))).toEqual(Array.from(unit(3, 1)));
  });
});

describe("library persistence", () => {
  it("round-trips every contribution and voiceprint field", () => {
    const lib = emptyLibrary();
    lib.contributions.push(makeContribution("rec-1", "1", [unit(4, 0), unit(4, 1)], 12.5, "m", "Alice"));
    lib.contributions[0].duration = 12.5;
    lib.voiceprints.Alice = {
      vector: Array.from(unit(4, 0)),
      dim: 4,
      model: "m",
      nSegments: 7,
      enrollSeconds: 42.2,
      coherence: 0.87,
      sources: ["a.wav", "b.wav"],
    };
    lib.contributedRecordings.push("rec-1");
    const file = path.join(tmp(), "voiceprints.json");
    saveLibrary(file, lib);
    expect(loadLibrary(file)).toEqual(lib);
  });

  it("treats an absent file as an empty library", () => {
    expect(loadLibrary(path.join(tmp(), "missing.json"))).toEqual(emptyLibrary());
  });

  it("treats invalid JSON as an empty library", () => {
    const file = path.join(tmp(), "bad.json");
    fs.writeFileSync(file, "{not json");
    expect(loadLibrary(file)).toEqual(emptyLibrary());
  });

  it("treats a wrong schema version as an empty library", () => {
    const file = path.join(tmp(), "old.json");
    fs.writeFileSync(file, JSON.stringify({ version: 2, cohort: { sum: null, count: 0 }, voiceprints: {} }));
    expect(loadLibrary(file)).toEqual(emptyLibrary());
  });

  it("treats a malformed nested record as an empty library", () => {
    const file = path.join(tmp(), "nested.json");
    fs.writeFileSync(
      file,
      JSON.stringify({ version: 3, voiceprints: { Alice: null }, contributions: [], contributedRecordings: [] }),
    );
    expect(loadLibrary(file)).toEqual(emptyLibrary());
  });
});

describe("store path precedence", () => {
  it("prefers flag, then env, then default", () => {
    const home = "/home/example";
    expect(resolveStorePath("/flag.json", { [STORE_ENV_VAR]: "/env.json" }, home)).toBe("/flag.json");
    expect(resolveStorePath(undefined, { [STORE_ENV_VAR]: "/env.json" }, home)).toBe("/env.json");
    expect(resolveStorePath(undefined, {}, home)).toBe(defaultStorePath(home));
    expect(defaultStorePath(home)).toBe(path.join(home, ".pi", "voiceprints", "voiceprints.json"));
  });

  it("never touches the default path when overridden", () => {
    const dir = tmp();
    const override = path.join(dir, "custom.json");
    saveLibrary(override, emptyLibrary());
    const defaultPath = defaultStorePath(dir);
    expect(fs.existsSync(defaultPath)).toBe(false);
    expect(fs.existsSync(override)).toBe(true);
  });
});

describe("cohort", () => {
  /** 20 copies of axis vector `i`, so each contribution clears the count floor. */
  function axis(i: number, dim = 8): Float32Array {
    const v = new Float32Array(dim);
    v[i] = 1;
    return v;
  }
  function seededLib(): Library {
    const lib = emptyLibrary();
    for (let i = 0; i < 3; i++) {
      lib.contributions.push(
        makeContribution(`rec-${i}`, `${i}`, Array.from({ length: 20 }, () => axis(i)), 10, "m"),
      );
    }
    return lib;
  }

  it("derives the mean by summing contributions in stable order", () => {
    const lib = seededLib();
    const mean = cohortMean({ ...lib, contributions: [...lib.contributions].reverse() })!;
    // each contribution holds 20 copies of one axis vector -> mean is 1/3 each
    expect(mean[0]).toBeCloseTo(1 / 3, 6);
    expect(mean[1]).toBeCloseTo(1 / 3, 6);
    expect(mean[2]).toBeCloseTo(1 / 3, 6);
    expect(mean[3]).toBeCloseTo(0, 6);
  });

  it("yields a bit-identical mean regardless of storage order", () => {
    const lib = seededLib();
    const a = cohortMean(lib)!;
    const shuffled: Library = { ...lib, contributions: [lib.contributions[1], lib.contributions[2], lib.contributions[0]] };
    expect(Array.from(cohortMean(shuffled)!)).toEqual(Array.from(a));
  });

  it("is unavailable below the minimum size and available at it", () => {
    const lib = emptyLibrary();
    lib.contributions.push(makeContribution("r", "1", Array.from({ length: 39 }, () => unit(4, 0)), 1, "m"));
    expect(cohortMean(lib)).toBeNull();
    lib.contributions.push(makeContribution("r2", "1", Array.from({ length: 1 }, () => unit(4, 0)), 1, "m"));
    expect(cohortMean(lib)).not.toBeNull();
    expect(cohortCount(lib)).toBe(MIN_COHORT);
  });

  it("refuses to mix models rather than resetting", () => {
    const lib = emptyLibrary();
    addRecordingContributions(lib, "r1", [makeContribution("r1", "1", [unit(4, 0)], 1, "modelA")]);
    const before = JSON.parse(JSON.stringify(lib));
    expect(() =>
      addRecordingContributions(lib, "r2", [makeContribution("r2", "1", [unit(4, 0)], 1, "modelB")]),
    ).toThrow(/refusing to mix embedding models/);
    expect(lib).toEqual(before);
  });

  it("contributes a recording exactly once", () => {
    const lib = emptyLibrary();
    addRecordingContributions(lib, "r1", [makeContribution("r1", "1", [unit(4, 0)], 1, "m")]);
    expect(cohortCount(lib)).toBe(1);
    addRecordingContributions(lib, "r1", [makeContribution("r1", "2", [unit(4, 2)], 1, "m")]);
    expect(cohortCount(lib)).toBe(1);
    expect(lib.contributions).toHaveLength(1);
  });
});

describe("voiceprint merge", () => {
  it("merges re-enrollment as a segment-count weighted average", () => {
    const existing = {
      vector: Array.from(l2(vec(1, 0, 0))),
      dim: 3,
      model: "m",
      nSegments: 10,
      enrollSeconds: 5,
      coherence: 0.9,
      sources: ["a.wav"],
    };
    const fresh = l2(vec(0, 1, 0));
    const merged = mergeVoiceprint(existing, fresh, 30, "b.wav", {
      dim: 3,
      model: "m",
      enrollSeconds: 6,
      coherence: 0.8,
    });
    const expected = l2(vec(0.1, 0.3, 0));
    expect(merged.vector.map((x) => Number(x.toFixed(6)))).toEqual(
      Array.from(expected).map((x) => Number(x.toFixed(6))),
    );
    expect(merged.nSegments).toBe(40);
    expect(merged.sources).toEqual(["a.wav", "b.wav"]);
  });

  it("replace discards the previous vector and sources", () => {
    const existing = {
      vector: Array.from(l2(vec(1, 0, 0))),
      dim: 3,
      model: "m",
      nSegments: 10,
      enrollSeconds: 5,
      coherence: 0.9,
      sources: ["a.wav"],
    };
    const fresh = l2(vec(0, 1, 0));
    const replaced = mergeVoiceprint(existing, fresh, 3, "b.wav", {
      dim: 3,
      model: "m",
      enrollSeconds: 2,
      coherence: 0.7,
    }, true);
    expect(replaced.vector.map((x) => Number(x.toFixed(6)))).toEqual(
      Array.from(fresh).map((x) => Number(x.toFixed(6))),
    );
    expect(replaced.sources).toEqual(["b.wav"]);
    expect(replaced.nSegments).toBe(3);
  });
});

describe("model mismatch", () => {
  it("names voiceprints whose dim differs", () => {
    const lib = emptyLibrary();
    lib.voiceprints.Alice = { vector: [1, 0], dim: 2, model: "m", nSegments: 1, enrollSeconds: 1, coherence: 1, sources: [] };
    expect(modelMismatches(lib, 4, "m").names).toEqual(["Alice"]);
  });

  it("refuses the same dim under a different model name", () => {
    const lib = emptyLibrary();
    lib.voiceprints.Alice = { vector: [1, 0], dim: 2, model: "m1", nSegments: 1, enrollSeconds: 1, coherence: 1, sources: [] };
    expect(modelMismatches(lib, 2, "m2").names).toEqual(["Alice"]);
  });

  it("counts mixed-model cohort contributions", () => {
    const lib = emptyLibrary();
    lib.contributions.push(makeContribution("r", "1", [unit(4, 0)], 1, "modelX"));
    const m = modelMismatches(lib, 4, "modelY");
    expect(m.contributions).toBe(1);
    expect(m.names).toEqual([]);
  });
});

describe("locking and atomic writes", () => {
  it("serialises concurrent enrollments so both survive", async () => {
    const file = path.join(tmp(), "store.json");
    saveLibrary(file, emptyLibrary());
    const enroll = async (name: string) =>
      withStoreLock(file, async () => {
        const lib = loadLibrary(file);
        await new Promise((r) => setTimeout(r, 20));
        lib.voiceprints[name] = {
          vector: [1, 0],
          dim: 2,
          model: "m",
          nSegments: 1,
          enrollSeconds: 1,
          coherence: 1,
          sources: [`${name}.wav`],
        };
        saveLibrary(file, lib);
      });
    await Promise.all([enroll("Alice"), enroll("Bob")]);
    const lib = loadLibrary(file);
    expect(Object.keys(lib.voiceprints).sort()).toEqual(["Alice", "Bob"]);
  });

  it("breaks a stale lock and acquires it", async () => {
    const file = path.join(tmp(), "store.json");
    saveLibrary(file, emptyLibrary());
    const lock = `${file}.lock`;
    fs.writeFileSync(lock, "");
    const old = Date.now() - 60_000;
    fs.utimesSync(lock, old / 1000, old / 1000);
    const ran = await withStoreLock(file, () => Promise.resolve("ran"));
    expect(ran).toBe("ran");
    expect(fs.existsSync(lock)).toBe(false);
  });

  it("does not release a lock another process stole and replaced", async () => {
    const file = path.join(tmp(), "store.json");
    saveLibrary(file, emptyLibrary());
    const lock = `${file}.lock`;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holding = withStoreLock(file, async () => {
      await gate;
    });
    while (!fs.existsSync(lock)) await new Promise((r) => setTimeout(r, 5));
    // simulate a thief that broke the stale lock and acquired its own
    fs.rmSync(lock, { force: true });
    fs.writeFileSync(lock, "thief-token");
    release();
    await holding;
    expect(fs.readFileSync(lock, "utf8")).toBe("thief-token");
    fs.rmSync(lock, { force: true });
  });

  it("leaves the previous store intact and no temp file when a write throws", () => {
    const dir = tmp();
    const file = path.join(dir, "store.json");
    saveLibrary(file, emptyLibrary());
    const before = fs.readFileSync(file, "utf8");
    const bad = emptyLibrary() as Library & { self?: unknown };
    bad.self = bad; // circular → JSON.stringify throws mid-write
    expect(() => saveLibrary(file, bad)).toThrow();
    expect(fs.readFileSync(file, "utf8")).toBe(before);
    expect(fs.readdirSync(dir).some((f) => f.includes(".tmp"))).toBe(false);
  });
});

describe("recording identity", () => {
  it("is content-derived, not path-derived", () => {
    const dir = tmp();
    const a = path.join(dir, "a.bin");
    const b = path.join(dir, "renamed.bin");
    fs.writeFileSync(a, Buffer.from("hello world"));
    fs.writeFileSync(b, Buffer.from("hello world"));
    expect(recordingId(a)).toBe(recordingId(b));
    fs.writeFileSync(b, Buffer.from("hello world!"));
    expect(recordingId(a)).not.toBe(recordingId(b));
  });
});

describe("erasure", () => {
  function axis(i: number, dim = 8): Float32Array {
    const v = new Float32Array(dim);
    v[i] = 1;
    return v;
  }
  function contributionFor(id: string): ReturnType<typeof makeContribution> {
    const i = id.charCodeAt(0) % 8;
    return makeContribution(id, "1", Array.from({ length: 20 }, () => axis(i)), 10, "m");
  }
  function libABC(): Library {
    const lib = emptyLibrary();
    for (const id of ["A", "B", "C"]) addRecordingContributions(lib, id, [contributionFor(id)]);
    return lib;
  }

  it("erases exactly: forgetting B equals a library built from A and C", () => {
    const lib = libABC();
    forgetRecording(lib, "B");
    const onlyAC = emptyLibrary();
    for (const id of ["A", "C"]) addRecordingContributions(onlyAC, id, [contributionFor(id)]);
    expect(Array.from(cohortMean(lib)!)).toEqual(Array.from(cohortMean(onlyAC)!));
  });

  it("forget by name drops that person's contributions but keeps co-speakers", () => {
    const lib = emptyLibrary();
    addRecordingContributions(lib, "R", [
      makeContribution("R", "1", [unit(4, 0)], 5, "m", "Alice"),
      makeContribution("R", "2", [unit(4, 1)], 5, "m"),
    ]);
    lib.voiceprints.Alice = { vector: Array.from(unit(4, 0)), dim: 4, model: "m", nSegments: 1, enrollSeconds: 5, coherence: 1, sources: ["R"] };
    forgetByName(lib, "Alice");
    expect(lib.voiceprints.Alice).toBeUndefined();
    expect(lib.contributions).toHaveLength(1);
    expect(lib.contributions[0].name).toBeUndefined();
    // the unnamed contribution survives a by-name forget
    forgetByName(lib, "Someone");
    expect(lib.contributions).toHaveLength(1);
  });

  it("a forgotten recording may contribute again", () => {
    const lib = emptyLibrary();
    addRecordingContributions(lib, "R", [makeContribution("R", "1", [unit(4, 0)], 1, "m")]);
    expect(cohortCount(lib)).toBe(1);
    forgetRecording(lib, "R");
    expect(cohortCount(lib)).toBe(0);
    addRecordingContributions(lib, "R", [makeContribution("R", "1", [unit(4, 0)], 1, "m")]);
    expect(cohortCount(lib)).toBe(1);
  });
});
