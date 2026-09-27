import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { exportRender, jobIdFor, packageName, SAFE_ID } from "../export.js";
import { loadShots, resolvePackage } from "../package.js";
import { cleanup, makePackage, makeProject, shotMd, validFilm } from "./fixture.js";

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

describe("export job ids (E10)", () => {
  const now = new Date(Date.UTC(2026, 8, 24, 10, 15, 0));
  const SUFFIX = "-render-20260924-101500";

  it("derives SAFE_ID default ids from package names", () => {
    const cases: [string, string][] = [
      ["booth-2026", `booth-2026${SUFFIX}`],
      [".Trade show v1.2", `Trade-show-v1-2${SUFFIX}`],
      ["café", `caf-${SUFFIX}`],
      ["___", `package${SUFFIX}`],
    ];
    for (const [name, id] of cases) {
      expect(jobIdFor(name, "render", now)).toBe(id);
      expect(SAFE_ID.test(id)).toBe(true);
    }
    const long = jobIdFor("a".repeat(80), "render", now);
    expect(long.length).toBeLessThanOrEqual(64);
    expect(long.endsWith(SUFFIX)).toBe(true);
    expect(SAFE_ID.test(long)).toBe(true);
  });

  it("uses the project dir name when the base dir is video_production", () => {
    expect(packageName("/x/booth-2026/video_production")).toBe("booth-2026");
    expect(packageName("/x/pkg")).toBe("pkg");
  });

  it("validates --job before creating any directory", () => {
    for (const bad of ["-abc", "a b", "x".repeat(65)]) {
      const { project, base } = makeProject({ film: validFilm(), shots: { shot_01: {} } });
      expect(() => exportRender({ target: base, cwd: project, job: bad })).toThrow(/invalid job id/);
      expect(fs.existsSync(path.join(project, ".video-gen"))).toBe(false);
    }
    for (const ok of ["take1", "y".repeat(64)]) {
      const { project, base } = makeProject({ film: validFilm(), shots: { shot_01: {} } });
      const r = exportRender({ target: base, cwd: project, job: ok });
      expect(path.basename(r.jobDir)).toBe(ok);
    }
  });
});
