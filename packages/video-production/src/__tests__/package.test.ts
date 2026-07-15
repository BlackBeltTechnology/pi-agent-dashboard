import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadShots, resolvePackage } from "../package.js";
import { cleanup, makePackage, shotMd } from "./fixture.js";

afterEach(cleanup);

const twoShots = () =>
  makePackage({
    shot_01: shotMd({ title: "One", prompt: "first", seed: 1000 }),
    shot_02: shotMd({ title: "Two", prompt: "second", seed: 2000 }),
  });

describe("resolvePackage", () => {
  it("accepts a project dir (finds video_production/shots)", () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "veo-proj-"));
    const shotsDir = path.join(project, "video_production", "shots");
    fs.mkdirSync(shotsDir, { recursive: true });
    fs.writeFileSync(path.join(shotsDir, "shot_01.md"), shotMd({ title: "One", prompt: "p", seed: 1000 }));
    try {
      const resolved = resolvePackage(project);
      expect(resolved.shotsDir).toBe(shotsDir);
      expect(resolved.baseDir).toBe(path.join(project, "video_production"));
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it("accepts a shots dir directly", () => {
    const base = twoShots();
    const { shotsDir, baseDir } = resolvePackage(path.join(base, "shots"));
    expect(shotsDir).toBe(path.join(base, "shots"));
    expect(baseDir).toBe(base);
  });

  it("throws on a dir with no shots", () => {
    const empty = makePackage({});
    expect(() => resolvePackage(empty)).toThrow(/could not find shot_/);
  });
});

describe("loadShots", () => {
  it("loads all shots sorted", () => {
    const { shots } = loadShots(twoShots());
    expect(shots.map((s) => s.name)).toEqual(["shot_01", "shot_02"]);
  });

  it("filters by short id", () => {
    const { shots } = loadShots(twoShots(), ["02"]);
    expect(shots.map((s) => s.name)).toEqual(["shot_02"]);
  });

  it("filters by full name", () => {
    const { shots } = loadShots(twoShots(), ["shot_01"]);
    expect(shots.map((s) => s.name)).toEqual(["shot_01"]);
  });
});
