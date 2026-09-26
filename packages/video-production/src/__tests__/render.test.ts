import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type ExportOptions, exportRender, exportTimeline } from "../export.js";
import { loadShots } from "../package.js";
import { buildRequest, planRender, renderShots, type VeoClient } from "../render.js";
import {
  cleanup,
  JPEG_BYTES,
  makePackage,
  makeProject,
  PNG_BYTES,
  type ProjectShot,
  shotMd,
  validFilm,
  validShot,
  writeFile,
  writeTimeline,
} from "./fixture.js";

afterEach(cleanup);

const pkg = () =>
  makePackage({
    shot_01: shotMd({
      title: "One",
      prompt: "first shot prompt",
      negative: "no logos",
      seed: 1000,
      firstFrame: "storyboard/shot_01.png",
      reference: "storyboard/00_world_anchor.png",
    }),
    shot_02: shotMd({ title: "Two", prompt: "second shot prompt", seed: 2000 }),
  });

/** Fake client that "renders" by writing a stub mp4. */
function fakeClient(opts: { fail?: boolean } = {}): VeoClient {
  return {
    generate: async () => {
      if (opts.fail) throw new Error("quota exceeded");
      return { done: true, response: { generatedVideos: [{ video: { id: "v" } }] } };
    },
    poll: async (op) => op,
    download: async (_video, dest) => fs.writeFileSync(dest, "mp4"),
  };
}

describe("buildRequest", () => {
  it("includes seed, negative, aspect/resolution and first-frame image", () => {
    const { shots } = loadShots(pkg());
    const req = buildRequest(shots[0], {});
    expect(req.config.seed).toBe(1000);
    expect(req.config.negativePrompt).toBe("no logos");
    expect(req.config.aspectRatio).toBe("16:9");
    expect(req.image?.mimeType).toBe("image/png");
    expect(req.config.referenceImages).toBeUndefined();
  });

  it("drops seed with noSeed and drops first frame with noFirstFrame", () => {
    const { shots } = loadShots(pkg());
    const req = buildRequest(shots[0], { noSeed: true, noFirstFrame: true });
    expect(req.config.seed).toBeUndefined();
    expect(req.image).toBeUndefined();
  });

  it("attaches reference images when withReference is set", () => {
    const { shots } = loadShots(pkg());
    const req = buildRequest(shots[0], { withReference: true });
    expect(Array.isArray(req.config.referenceImages)).toBe(true);
    expect((req.config.referenceImages as unknown[]).length).toBe(1);
  });
});

describe("planRender", () => {
  it("resolves out dir, model alias and missing prompts", () => {
    const plan = planRender({ target: pkg(), model: "fast", env: {} });
    expect(plan.model).toBe("veo-3.1-fast-generate-preview");
    expect(plan.outDir.endsWith("renders")).toBe(true);
    expect(plan.missingPrompt).toEqual([]);
    expect(plan.keyState).toBe("MISSING");
  });
});

describe("renderShots", () => {
  const clientFactory = (fail = false) => async () => fakeClient({ fail });

  it("renders all shots and is idempotent on re-run", async () => {
    const base = pkg();
    const common = { target: base, cliKey: "k", sleep: async () => {}, log: () => {} };

    const first = await renderShots({ ...common, clientFactory: clientFactory() });
    expect(first.map((r) => r.status)).toEqual(["ok", "ok"]);
    expect(fs.existsSync(path.join(base, "renders", "shot_01.mp4"))).toBe(true);

    const second = await renderShots({ ...common, clientFactory: clientFactory() });
    expect(second.every((r) => r.status === "skip")).toBe(true);

    const forced = await renderShots({ ...common, force: true, clientFactory: clientFactory() });
    expect(forced.every((r) => r.status === "ok")).toBe(true);
  });

  it("records errors per shot without throwing", async () => {
    const base = pkg();
    const results = await renderShots({
      target: base,
      cliKey: "k",
      sleep: async () => {},
      log: () => {},
      clientFactory: clientFactory(true),
    });
    expect(results.every((r) => r.status === "error")).toBe(true);
    const logLines = fs.readFileSync(path.join(base, "renders", "render_log.jsonl"), "utf8").trim().split("\n");
    expect(logLines.length).toBe(2);
    expect(JSON.parse(logLines[0]).status).toBe("error");
  });

  it("throws when no key resolves", async () => {
    await expect(
      renderShots({ target: pkg(), env: {}, sleep: async () => {}, log: () => {}, clientFactory: clientFactory() }),
    ).rejects.toThrow(/no API key/);
  });
});

// ── export render ─────────────────────────────────────────────────────────

const readJson = (p: string) => JSON.parse(fs.readFileSync(p, "utf8"));

function proj(shots: Record<string, ProjectShot> = { shot_01: {}, shot_02: {}, shot_03: {} }, film: unknown = validFilm()) {
  return makeProject({ film, shots });
}

function render(p: { project: string; base: string }, o: Partial<ExportOptions> = {}) {
  return exportRender({ target: p.base, cwd: p.project, ...o });
}

const jobDirs = (project: string) =>
  fs.existsSync(path.join(project, ".video-gen")) ? fs.readdirSync(path.join(project, ".video-gen")) : [];

describe("exportRender — spec mapping (E11)", () => {
  it("copies film fields and structured prompts verbatim", () => {
    const rich = {
      prompt: { visuals: "v", action: "a", scene: "s", audio: "[SFX] hum", visibleCharacters: ["arm", "host"] },
      durationSec: 6,
    };
    const p = proj({ shot_01: { sidecar: rich }, shot_02: {}, shot_03: {} });
    const r = render(p);
    expect(r.tool).toBe("video_render");
    const spec = readJson(r.specPath);
    const film = validFilm();
    for (const k of ["title", "style", "consistency", "negative", "aspectRatio", "characters"] as const) {
      expect(spec[k]).toEqual(film[k]);
    }
    expect(spec.shots.map((s: { id: string }) => s.id)).toEqual(["shot_01", "shot_02", "shot_03"]);
    expect(spec.shots[0].prompt).toEqual(rich.prompt);
    expect(spec.shots[1].prompt).toEqual(validShot().prompt);
    expect(spec.shots[0].firstFramePath).toBe("video_production/storyboard/shot_01.png");
    const text = fs.readFileSync(r.specPath, "utf8");
    expect(text).not.toMatch(/"seed"|"resolution"/);
    for (const s of spec.shots) expect(typeof s.prompt).toBe("object");
    expect(spec.shots[0].characters).toBeUndefined();
  });

  it("fails when a shot has no first frame", () => {
    const p = proj({ shot_01: { md: shotMd({ title: "x", prompt: "p" }) } });
    expect(() => render(p)).toThrow("shot_01: first frame required");
    expect(jobDirs(p.project)).toEqual([]);
  });
});

describe("exportRender — seamless continuity (E12)", () => {
  const shots = () => ({ shot_02A: { seamlessTo: "02B" }, shot_02B: {}, shot_03: { seamlessTo: "04" } });

  it("points lastFramePath at the next shot's first frame; warns on a seamless last shot", () => {
    const r = render(proj(shots()));
    const spec = readJson(r.specPath);
    expect(spec.shots[0].lastFramePath).toBe("video_production/storyboard/shot_02B.png");
    expect(spec.shots[1].lastFramePath).toBeUndefined();
    expect(spec.shots[2].lastFramePath).toBeUndefined();
    expect(r.warnings.some((w) => w.startsWith("shot_03:") && w.includes("last shot"))).toBe(true);
  });

  it("--no-last-frame drops every lastFramePath and lists the seamless shots", () => {
    const r = render(proj(shots()), { noLastFrame: true });
    const spec = readJson(r.specPath);
    expect(spec.shots.every((s: object) => !("lastFramePath" in s))).toBe(true);
    expect(r.warnings).toContain("--no-last-frame: seamless continuity not exported for shot_02A, shot_03");
  });
});

describe("exportRender — durations and capabilities (E13)", () => {
  it("rounds halves up and warns only on changed shots", () => {
    const p = proj({ shot_01: { sidecar: validShot(7.4) }, shot_02: { sidecar: validShot(7.5) }, shot_03: {} });
    const r = render(p);
    expect(readJson(r.specPath).shots.map((s: { durationSec: number }) => s.durationSec)).toEqual([7, 8, 8]);
    expect(r.warnings.filter((w) => w.includes("rounded"))).toEqual([
      "shot_01: durationSec 7.4 rounded to 7",
      "shot_02: durationSec 7.5 rounded to 8",
    ]);
  });

  it("--durations fails listing every out-of-range shot", () => {
    const p = proj({ shot_01: { sidecar: validShot(4) }, shot_02: { sidecar: validShot(9) }, shot_03: {} });
    expect(() => render(p, { durations: [5, 8] })).toThrow(/shot_01 \(4\), shot_02 \(9\)/);
    expect(jobDirs(p.project)).toEqual([]);
    expect(() => render(p)).not.toThrow();
  });

  it("--aspect fails naming the film aspect ratio", () => {
    const p = proj(undefined, { ...validFilm(), aspectRatio: "9:16" });
    expect(() => render(p, { aspect: ["16:9"] })).toThrow(/9:16/);
    expect(jobDirs(p.project)).toEqual([]);
  });
});

describe("exportRender — dropped-field warnings (E14)", () => {
  const RES = "per-shot resolution is not exported — the active pi-video-gen model's default resolution applies";

  it("clean package only carries the resolution note", () => {
    const p = proj();
    expect(render(p).warnings).toEqual([RES]);
  });

  it("warns on seed, reference images, differing negative and aspect", () => {
    const md = (o: Parameters<typeof shotMd>[0]) => shotMd({ firstFrame: `storyboard/${o.title}.png`, ...o });
    const p = proj({
      shot_01: { md: md({ title: "shot_01", prompt: "p", seed: 1234 }) },
      shot_02: { md: md({ title: "shot_02", prompt: "p", reference: "storyboard/shot_01.png" }) },
      shot_03: { md: md({ title: "shot_03", prompt: "p", negative: "no cats" }) },
      shot_04: { md: md({ title: "shot_04", prompt: "p" }).replace("Aspect: `16:9`", "Aspect: `9:16`") },
    });
    const w = render(p).warnings;
    expect(w[0]).toBe(RES);
    expect(w).toContain("seeds are not exported (shot_01)");
    expect(w).toContain("local reference images are not exported (shot_02)");
    expect(w).toContain("shot_03: per-shot negatives are not exported — film.json negative is used");
    expect(w).toContain("shot_04: per-shot aspect ratios are not exported (9:16 vs film 16:9)");
    expect(w).toHaveLength(5);
  });
});

describe("exportRender — unsafe shot names (E15)", () => {
  it.each(["shot_01.2", "shot_01 final"])("rejects %s", (name) => {
    const p = proj({ [name]: {} });
    expect(() => render(p)).toThrow(`${name}: shot id not accepted by pi-video-gen`);
    expect(jobDirs(p.project)).toEqual([]);
  });
});

describe("exportRender — frame preflight (X2)", () => {
  const withFrame = (setup: (base: string, project: string) => void) => {
    const p = proj({ shot_01: {} });
    setup(p.base, p.project);
    return p;
  };
  const frame = (base: string) => path.join(base, "storyboard", "shot_01.png");

  it("rejects a package outside cwd, symlinked frames, non-images and >20 MiB", () => {
    const outside = withFrame(() => {});
    const sub = path.join(outside.base, "shots");
    expect(() => exportRender({ target: outside.base, cwd: sub })).toThrow(
      "package must be inside the working directory (the pi session cwd)",
    );

    const sym = withFrame((base) => {
      fs.renameSync(frame(base), path.join(base, "storyboard", "real.png"));
      fs.symlinkSync(path.join(base, "storyboard", "real.png"), frame(base));
    });
    expect(() => render(sym)).toThrow(/shot_01: frame is a symlink/);

    const text = withFrame((base) => fs.writeFileSync(frame(base), "not an image"));
    expect(() => render(text)).toThrow(/shot_01: frame is not a PNG, JPEG or WebP image/);

    const big = withFrame((base) =>
      fs.writeFileSync(frame(base), Buffer.concat([PNG_BYTES, Buffer.alloc(20 * 1024 * 1024 + 1 - PNG_BYTES.length)])),
    );
    expect(() => render(big)).toThrow(/shot_01: frame larger than 20 MiB/);

    for (const p of [sym, text, big]) expect(jobDirs(p.project)).toEqual([]);
  });

  it("rejects a frame that resolves outside cwd via a symlinked parent dir", () => {
    const p = proj({ shot_01: {} });
    const outside = fs.mkdtempSync(path.join(path.dirname(p.project), "elsewhere-"));
    writeFile(path.join(outside, "shot_01.png"), PNG_BYTES);
    fs.rmSync(path.join(p.base, "storyboard"), { recursive: true });
    fs.symlinkSync(outside, path.join(p.base, "storyboard"));
    expect(() => render(p)).toThrow(/shot_01: frame outside working directory/);
  });

  it("accepts a valid JPEG named .jpeg", () => {
    const p = proj({ shot_01: { md: shotMd({ title: "t", prompt: "p", firstFrame: "storyboard/shot_01.jpeg" }) } });
    writeFile(path.join(p.base, "storyboard", "shot_01.jpeg"), JPEG_BYTES);
    const spec = readJson(render(p).specPath);
    expect(spec.shots[0].firstFramePath).toBe("video_production/storyboard/shot_01.jpeg");
  });
});

describe("exportRender — re-billing guard (X4)", () => {
  it("refuses a second render job until --new-job, ignores stale entries", () => {
    const p = proj();
    const first = render(p);
    expect(() => render(p)).toThrow(/already exported[\s\S]*render-input\.json[\s\S]*video_render again/);
    try {
      render(p);
    } catch (e) {
      expect((e as Error).message).toContain(first.specPath);
    }
    const second = render(p, { newJob: true, job: "take2" });
    const reg = readJson(path.join(p.base, ".pi-veo", "exports.json"));
    expect(reg.renders).toEqual([first.specPath, second.specPath]);
    fs.rmSync(first.specPath);
    fs.rmSync(second.specPath);
    expect(() => render(p, { job: "take3" })).not.toThrow();
  });

  it("lists a prior spec exported with a custom id and output dir", () => {
    const p = proj();
    const vg = path.join(p.project, "vg");
    const first = render(p, { job: "take1", out: vg });
    expect(first.specPath).toBe(path.join(vg, "take1", "render-input.json"));
    expect(() => render(p)).toThrow(first.specPath);
  });
});

describe("exportRender — registry fail-closed (X5)", () => {
  const variants: [string, (f: string) => void][] = [
    ["invalid JSON", (f) => fs.writeFileSync(f, "{not json")],
    ["wrong shape", (f) => fs.writeFileSync(f, '{"x":1}')],
  ];
  if (process.platform !== "win32" && process.getuid?.() !== 0) {
    variants.push([
      "unreadable",
      (f) => {
        fs.writeFileSync(f, '{"renders":[]}');
        fs.chmodSync(f, 0o000);
      },
    ]);
  }
  it.each(variants)("%s fails naming the registry, even with --new-job", (_n, corrupt) => {
    const p = proj();
    const reg = writeFile(path.join(p.base, ".pi-veo", "exports.json"));
    corrupt(reg);
    for (const newJob of [false, true]) {
      expect(() => render(p, { newJob })).toThrow(reg);
    }
    expect(jobDirs(p.project)).toEqual([]);
    fs.chmodSync(reg, 0o600);
  });
});

describe("export preconditions (X6)", () => {
  it("requires film.json", () => {
    const p = makeProject({ shots: { shot_01: {} } });
    expect(() => render(p)).toThrow("package has no film.json — sidecars required for export");
  });

  it("fails both modes on a shot-scope problem", () => {
    const p = proj({ shot_01: {}, shot_02: { sidecar: null } });
    writeTimeline(p.base, { segments: [{ shot: "shot_01" }] });
    expect(() => render(p)).toThrow("shot_02: sidecar missing");
    expect(() => exportTimeline({ target: p.base, cwd: p.project, clips: "x" })).toThrow("shot_02: sidecar missing");
    expect(jobDirs(p.project)).toEqual([]);
  });

  it("audio-only problems are warnings", () => {
    const p = proj({ shot_01: {} });
    writeTimeline(p.base, { segments: [{ shot: "shot_01" }], voiceover: { path: "vo.wav" } });
    writeFile(path.join(p.project, "renders", "shot_01.mp4"), "mp4");
    const r = render(p);
    expect(r.warnings).toContain("[audio] timeline.json: voiceover.path: file not found");
    const t = exportTimeline({ target: p.base, cwd: p.project, clips: "renders" });
    expect(t.warnings).toContain("[audio] timeline.json: voiceover.path: file not found");
  });

  it("timeline export requires timeline.json", () => {
    const p = proj({ shot_01: {} });
    expect(() => exportTimeline({ target: p.base, cwd: p.project, clips: "renders" })).toThrow(
      "timeline.json required for export timeline",
    );
  });

  it("refuses a pre-existing job directory", () => {
    const p = proj({ shot_01: {} });
    fs.mkdirSync(path.join(p.project, ".video-gen", "take1"), { recursive: true });
    expect(() => render(p, { job: "take1" })).toThrow("job directory exists — exports never reuse a job");
    expect(fs.existsSync(path.join(p.base, ".pi-veo"))).toBe(false);
  });
});

// ── export timeline ───────────────────────────────────────────────────────

describe("exportTimeline — spec mapping (E16)", () => {
  function twelve(layout: "flat" | "job") {
    const p = proj({ shot_01: {}, shot_02: {}, shot_03: {} });
    writeFile(path.join(p.base, "endcard.png"), PNG_BYTES);
    const segs: Record<string, unknown>[] = [];
    for (let i = 0; i < 11; i++) segs.push({ shot: `shot_0${(i % 3) + 1}` });
    segs[0] = { shot: "shot_01", trimStartSec: 1, durationSec: 5, ambientVolume: 0.4, transitionTo: { style: "fade", durationSec: 1 } };
    segs[1] = { shot: "shot_02", overlay: { title: "Hi", position: "center" } };
    segs.push({ image: "endcard.png", durationSec: 3 });
    writeTimeline(p.base, {
      output: { resolution: "1920x1080", fps: 24 },
      segments: segs,
      voiceover: { path: "endcard.png" },
      music: { path: "endcard.png" },
      captions: { path: "c.srt" },
    });
    writeFile(path.join(p.base, "c.srt"), "1\n");
    for (const s of ["shot_01", "shot_02", "shot_03"]) {
      const f = layout === "flat" ? path.join(p.project, "renders", `${s}.mp4`) : path.join(p.project, "job", "shots", s, "video.mp4");
      writeFile(f, "mp4");
    }
    return { p, clips: layout === "flat" ? "renders" : "job/shots" };
  }

  it.each(["flat", "job"] as const)("maps segments in the %s clip layout", (layout) => {
    const { p, clips } = twelve(layout);
    const r = exportTimeline({ target: p.base, cwd: p.project, clips });
    expect(r.tool).toBe("video_compose");
    const spec = readJson(r.specPath);
    expect(spec.segments.map((s: { id: string }) => s.id)).toEqual(
      Array.from({ length: 12 }, (_, i) => `seg-${String(i + 1).padStart(2, "0")}`),
    );
    const real = fs.realpathSync(p.project);
    const clip = (s: string) =>
      layout === "flat" ? path.join(real, "renders", `${s}.mp4`) : path.join(real, "job", "shots", s, "video.mp4");
    expect(spec.segments[0]).toEqual({
      id: "seg-01",
      video: clip("shot_01"),
      durationSec: 5,
      trimStartSec: 1,
      sourceAudio: { volume: 0.4 },
      transitionTo: { type: "xfade", style: "fade", durationSec: 1 },
    });
    expect(spec.segments[1]).toEqual({
      id: "seg-02",
      video: clip("shot_02"),
      durationSec: 8,
      sourceAudio: { volume: 1 },
      overlay: { title: "Hi", position: "center" },
    });
    expect(spec.segments[11]).toEqual({ id: "seg-12", image: path.join(real, "video_production", "endcard.png"), durationSec: 3 });
    expect(spec.output).toEqual({ resolution: "1920x1080", fps: 24 });
    for (const s of spec.segments) expect(path.isAbsolute(s.video ?? s.image)).toBe(true);
    const text = fs.readFileSync(r.specPath, "utf8");
    expect(text).not.toMatch(/"(voice|narration|bgm|subtitles)"/);
  });
});

describe("exportTimeline — media preflight (X3)", () => {
  function tp() {
    const p = proj({ shot_01: {}, shot_02: {} });
    writeTimeline(p.base, { segments: [{ shot: "shot_01" }, { shot: "shot_02" }] });
    return p;
  }

  it("rejects clips outside cwd", () => {
    const p = tp();
    const elsewhere = fs.mkdtempSync(path.join(path.dirname(p.project), "elsewhere-"));
    writeFile(path.join(elsewhere, "shot_01.mp4"), "x");
    writeFile(path.join(elsewhere, "shot_02.mp4"), "x");
    expect(() => exportTimeline({ target: p.base, cwd: p.project, clips: elsewhere })).toThrow(
      /seg-01 \(shot_01\): media outside working directory[\s\S]*seg-02 \(shot_02\): media outside/,
    );
    expect(jobDirs(p.project)).toEqual([]);
  });

  it("rejects a symlinked clip", () => {
    const p = tp();
    writeFile(path.join(p.project, "renders", "real.mp4"), "x");
    fs.symlinkSync(path.join(p.project, "renders", "real.mp4"), path.join(p.project, "renders", "shot_01.mp4"));
    writeFile(path.join(p.project, "renders", "shot_02.mp4"), "x");
    expect(() => exportTimeline({ target: p.base, cwd: p.project, clips: "renders" })).toThrow(
      /seg-01 \(shot_01\): media is a symlink/,
    );
  });

  it("lists missing clips", () => {
    const p = tp();
    writeFile(path.join(p.project, "renders", "shot_01.mp4"), "x");
    expect(() => exportTimeline({ target: p.base, cwd: p.project, clips: "renders" })).toThrow(/missing clips.*shot_02/);
    expect(jobDirs(p.project)).toEqual([]);
  });
});

// ── external contract (opt-in): PI_VIDEO_GEN_DIR=<pi-video-gen>/dist (E27) ──

const PVG = process.env.PI_VIDEO_GEN_DIR;

describe.skipIf(!PVG)("pi-video-gen contract (E27, verified 0.1.18)", () => {
  const load = async (rel: string) => import(path.join(PVG as string, rel));

  it.each(["seedance-2.0", "kling-3.0"])("render spec passes %s preflight up to the rate-limiter gate", async (model) => {
    const { runRender } = await load("render.js");
    const { findBuiltInModel } = await load("providers/models.js");
    const { ActiveJobs } = await load("jobs/store.js");
    const p = proj({ shot_02A: { seamlessTo: "02B" }, shot_02B: {}, shot_03: {} });
    const r = render(p);
    const entry = findBuiltInModel(model);
    expect(entry).toBeDefined();
    const boom = () => {
      throw new Error("adapter must not be reached");
    };
    await expect(
      runRender({
        renderSpecPath: r.specPath,
        settings: { outputDir: path.join(r.cwd, ".video-gen") },
        cwd: r.cwd,
        resolved: {
          entry,
          remoteId: entry.remoteId ?? entry.id,
          provider: { style: entry.provider, apiKey: "test", baseUrl: "http://127.0.0.1:9" },
        },
        adapter: { submit: boom, inspect: boom, downloadTo: boom },
        activeJobs: new ActiveJobs(),
        rateLimiter: {
          acquire: async () => {
            throw new Error("PREFLIGHT_OK");
          },
        },
        ffmpegPath: "ffmpeg",
      }),
    ).rejects.toThrow("PREFLIGHT_OK");
  });

  it("timeline spec parses with parseTimelineSpec", async () => {
    const { parseTimelineSpec } = await load("timeline.js");
    const p = proj({ shot_01: {}, shot_02: {} });
    writeFile(path.join(p.base, "endcard.png"), PNG_BYTES);
    writeTimeline(p.base, {
      segments: [
        { shot: "shot_01", trimStartSec: 1, transitionTo: { style: "fade", durationSec: 1 }, overlay: { title: "A" } },
        { shot: "shot_02", ambientVolume: 0.5 },
        { image: "endcard.png", durationSec: 3 },
      ],
      output: { resolution: "1920x1080", fps: 24, codec: "h264" },
    });
    writeFile(path.join(p.project, "renders", "shot_01.mp4"), "x");
    writeFile(path.join(p.project, "renders", "shot_02.mp4"), "x");
    const t = exportTimeline({ target: p.base, cwd: p.project, clips: "renders" });
    const parsed = parseTimelineSpec(fs.readFileSync(t.specPath, "utf8"));
    expect(parsed.segments).toHaveLength(3);
  });
});
