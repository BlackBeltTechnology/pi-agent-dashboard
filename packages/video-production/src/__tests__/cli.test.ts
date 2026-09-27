import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, makeProject, validFilm, writeFile, writeTimeline } from "./fixture.js";

afterEach(cleanup);

const BIN = new URL("../bin/veo.ts", import.meta.url).pathname;
const TSX = createRequire(import.meta.url).resolve("tsx/cli");

function veo(args: string[], cwd = process.cwd()) {
  return spawnSync(process.execPath, [TSX, BIN, ...args], { cwd, encoding: "utf8", env: { ...process.env, GEMINI_API_KEY: "" } });
}

describe("pi-veo dispatch (E20)", () => {
  it("export without / with unknown mode prints usage naming both modes", () => {
    for (const args of [["export"], ["export", "foo", "x"]]) {
      const r = veo(args);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/export <render\|timeline>/);
    }
  });

  it("export render without target does not take the mode as target", () => {
    const r = veo(["export", "render"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("missing <target>");
  });

  it("export timeline without --clips", () => {
    const { project, base } = makeProject({ film: validFilm(), shots: { shot_01: {} } });
    const r = veo(["export", "timeline", base], project);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("error: --clips <dir> is required");
  });

  it("unknown subcommand lists six subcommands", () => {
    const r = veo(["bogus"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("<parse|plan|render|storyboard|export|mux>");
  });
});

describe("pi-veo flag parsing (E21)", () => {
  it("consumes the new value flags", () => {
    const { project, base } = makeProject({ film: validFilm(), shots: { shot_01: {} } });
    const r = veo(
      ["export", "render", base, "--durations", "4-15", "--aspect", "16:9,9:16", "--clips", "renders", "--job", "j", "--picture", "p.mp4", "--json"],
      project,
    );
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).jobDir).toBe(path.join(fs.realpathSync(project), ".video-gen", "j"));
  });

  it.each(["8-4", "x"])("rejects --durations %s", (d) => {
    const { project, base } = makeProject({ film: validFilm(), shots: { shot_01: {} } });
    const r = veo(["export", "render", base, "--durations", d], project);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("--durations");
  });
});

describe("pi-veo parse exit code (E19)", () => {
  it("exits 1 on a sidecar problem", () => {
    const { base } = makeProject({
      film: validFilm(),
      shots: { shot_01: { sidecar: { prompt: { visuals: "v" }, durationSec: 8 } } },
    });
    const r = veo(["parse", base]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("shot_01: prompt.action is required");
  });
});

describe("pi-veo export report (E17)", () => {
  it("human report names spec, tool, cwd, outputDir note and warnings", () => {
    const { project, base } = makeProject({ film: validFilm(), shots: { shot_01: {} } });
    const r = veo(["export", "render", base], project);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/Spec +: .*\.video-gen\/booth-2026-render-\d{8}-\d{6}\/render-input\.json/);
    expect(r.stdout).toContain("call video_render");
    expect(r.stdout).toContain(`Cwd used : ${fs.realpathSync(project)}`);
    expect(r.stdout).toContain("outputDir (default .video-gen)");
    expect(r.stdout).toContain("per-shot resolution is not exported");
  });

  it("--json report for export timeline", () => {
    const { project, base } = makeProject({ film: validFilm(), shots: { shot_01: {} } });
    writeTimeline(base, { segments: [{ shot: "shot_01" }] });
    writeFile(path.join(project, "renders", "shot_01.mp4"), "x");
    const r = veo(["export", "timeline", base, "--clips", "renders", "--json"], project);
    expect(r.status, r.stderr).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(Object.keys(j).sort()).toEqual(["jobDir", "specPath", "tool", "warnings"]);
    expect(j.tool).toBe("video_compose");
    expect(fs.existsSync(j.specPath)).toBe(true);
  });
});
