import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseShotFile, shotShort } from "../shots.js";
import { loadSidecars } from "../sidecars.js";
import {
  cleanup,
  makePackage,
  makeProject,
  type ProjectShot,
  shotMd,
  validFilm,
  validShot,
  writeFile,
  writeTimeline,
} from "./fixture.js";

afterEach(cleanup);

describe("parseShotFile", () => {
  it("extracts prompt, negative, seed, aspect, resolution, refs, first-frame, seamless", () => {
    const base = makePackage({
      shot_01: shotMd({
        title: "Opening wide",
        prompt: "A cinematic wide establishing shot of a harbour at dawn.",
        negative: "no text, no logos",
        seed: 12345,
        resolution: "1080p",
        reference: "storyboard/00_world_anchor.png",
        firstFrame: "storyboard/shot_01.png",
        seamlessTo: "shot_02",
      }),
    });
    const shot = parseShotFile(path.join(base, "shots", "shot_01.md"), base);

    expect(shot.name).toBe("shot_01");
    expect(shotShort(shot)).toBe("01");
    expect(shot.title).toBe("Opening wide");
    expect(shot.prompt).toContain("harbour at dawn");
    expect(shot.negative).toBe("no text, no logos");
    expect(shot.seed).toBe(12345);
    expect(shot.aspectRatio).toBe("16:9");
    expect(shot.resolution).toBe("1080p");
    expect(shot.enhancePrompt).toBe(false);
    expect(shot.firstFrame).toBe(path.join(base, "storyboard", "shot_01.png"));
    expect(shot.referenceImages).toEqual([path.join(base, "storyboard", "00_world_anchor.png")]);
    expect(shot.seamlessNext).toBe(true);
  });

  it("leaves seed null and prompt empty when absent", () => {
    const base = makePackage({
      shot_02: "# Bare\n\nno prompt block here\n",
    });
    const shot = parseShotFile(path.join(base, "shots", "shot_02.md"), base);
    expect(shot.seed).toBeNull();
    expect(shot.prompt).toBe("");
    expect(shot.seamlessNext).toBe(false);
  });

  it("does not flag seamless for an incoming (from) transition", () => {
    const base = makePackage({
      shot_03: `${shotMd({ title: "B", prompt: "p", seed: 1000 })}- Continuity: SEAMLESS from shot_02\n`,
    });
    const shot = parseShotFile(path.join(base, "shots", "shot_03.md"), base);
    expect(shot.seamlessNext).toBe(false);
  });
});

// ── sidecars ───────────────────────────────────────────────────────────────

const msgs = (base: string) => loadSidecars(base).problems.map((p) => p.message);

function projectWith(opts: { shots?: Record<string, ProjectShot>; film?: unknown; timeline?: unknown } = {}) {
  return makeProject({
    shots: opts.shots ?? { shot_01: {}, shot_02: {} },
    film: opts.film === undefined ? validFilm() : opts.film,
    timeline: opts.timeline,
  });
}

describe("loadSidecars — film (E2)", () => {
  it("accepts a valid film and reports one scoped problem per bad variant", () => {
    expect(loadSidecars(projectWith().base).problems).toEqual([]);

    const cases: [unknown, string][] = [
      [{ ...validFilm(), style: "" }, "film.json: style is required"],
      [{ title: "x" }, "film.json: style is required"],
      [
        { ...validFilm(), characters: [{ id: "arm", description: "a" }, { id: "arm", description: "b" }] },
        "film.json: duplicate character id arm",
      ],
      ["{not json", "film.json: invalid JSON"],
    ];
    for (const [film, message] of cases) {
      const { base } = projectWith({ film });
      expect(loadSidecars(base).problems).toEqual([{ scope: "film", message }]);
    }
  });

  it("disables sidecars without film.json (E1)", () => {
    const { base } = makeProject({ shots: { shot_01: { sidecar: null } } });
    const sc = loadSidecars(base);
    expect(sc.enabled).toBe(false);
    expect(sc.problems).toEqual([]);
  });
});

describe("loadSidecars — shots (E3/E4)", () => {
  it("reports the decision-table problems, all scope shot", () => {
    const { base } = projectWith({
      shots: {
        shot_01: {},
        shot_02: { sidecar: null },
        shot_09: { md: null },
        shot_03: { sidecar: { prompt: { visuals: "v" }, durationSec: 8 } },
        shot_04: { sidecar: { prompt: { visuals: "v", action: "a", visibleCharacters: ["ghost"] }, durationSec: 8 } },
      },
    });
    const sc = loadSidecars(base);
    expect(sc.problems.every((p) => p.scope === "shot")).toBe(true);
    expect(sc.problems.map((p) => p.message).sort()).toEqual(
      [
        "shot_02: sidecar missing",
        "shot_03: prompt.action is required",
        "shot_04: unknown visibleCharacters id ghost",
        "shot_09: sidecar has no matching shot markdown",
      ].sort(),
    );
    expect(sc.shotState.get("shot_01")).toBe("ok");
    expect(sc.shotState.get("shot_02")).toBe("missing");
    expect(sc.shotState.get("shot_03")).toBe("invalid");
  });

  it("applies durationSec boundaries 1..300", () => {
    const values: [unknown, boolean][] = [
      [undefined, false],
      ["8", false],
      [0.99, false],
      [1, true],
      [8, true],
      [300, true],
      [300.01, false],
    ];
    for (const [d, ok] of values) {
      const { base } = projectWith({ shots: { shot_01: { sidecar: { prompt: validShot().prompt, durationSec: d } } } });
      const m = msgs(base);
      if (ok) expect(m, String(d)).toEqual([]);
      else expect(m, String(d)).toEqual(["shot_01: durationSec must be a number from 1 to 300"]);
    }
  });
});

describe("loadSidecars — timeline (E5–E9)", () => {
  const tl = (segments: unknown[], extra: Record<string, unknown> = {}) =>
    msgs(projectWith({ timeline: { segments, ...extra } }).base);

  it("accepts a valid timeline with an image end-card", () => {
    const { base } = projectWith();
    writeFile(path.join(base, "endcard.png"), "x");
    writeTimeline(base, {
      segments: [{ shot: "shot_01" }, { shot: "shot_02" }, { shot: "shot_01" }, { image: "endcard.png", durationSec: 3 }],
    });
    expect(msgs(base)).toEqual([]);
  });

  it("E5: segment shape problems name the segment index", () => {
    const { base } = projectWith();
    writeFile(path.join(base, "e.png"), "x");
    writeTimeline(base, {
      segments: [{ shot: "shot_01", image: "e.png" }, {}, { shot: "shot_99" }, { image: "e.png" }],
    });
    const sc = loadSidecars(base);
    expect(sc.problems.map((p) => p.scope)).toEqual(["timeline", "timeline", "timeline", "timeline"]);
    expect(sc.problems.map((p) => p.message)).toEqual([
      "timeline.json: segment 1: needs exactly one of shot or image",
      "timeline.json: segment 2: needs exactly one of shot or image",
      "timeline.json: segment 3: unknown shot shot_99",
      "timeline.json: segment 4: image segment requires durationSec",
    ]);
  });

  it("E6: enum and key problems list allowed values", () => {
    const m = tl(
      [
        { shot: "shot_01", transitionTo: { style: "crossfade", durationSec: 1 } },
        { shot: "shot_02", overlay: { position: "top-right" } },
      ],
      { output: { codec: "vp9", extra: 1 } },
    );
    expect(m).toContain("timeline.json: output.extra is not allowed (allowed: resolution, fps, codec)");
    expect(m).toContain("timeline.json: output.codec must be one of mpeg4, h264");
    expect(m.find((x) => x.includes("segment 1"))).toContain("fade, fadeblack");
    expect(m.find((x) => x.includes("segment 2"))).toContain("bottom-left, bottom-center, top-left, center");
    expect(m).toHaveLength(4);
  });

  it("E7: output resolution / fps boundaries", () => {
    const res: [string, boolean][] = [
      ["64x64", false],
      ["100x100", true],
      ["1920x1080", true],
      ["1921x1080", false],
      ["4096x4096", true],
      ["4098x4096", false],
    ];
    for (const [resolution, ok] of res) {
      expect(tl([{ shot: "shot_01" }], { output: { resolution } }).length, resolution).toBe(ok ? 0 : 1);
    }
    const fps: [number, boolean][] = [
      [0, false],
      [1, true],
      [29.97, false],
      [120, true],
      [121, false],
    ];
    for (const [f, ok] of fps) {
      const m = tl([{ shot: "shot_01" }], { output: { fps: f } });
      expect(m.length, String(f)).toBe(ok ? 0 : 1);
      if (!ok) expect(m[0]).toContain("output.fps");
    }
  });

  it("E8: segment duration, trim and transition boundaries (8 s shot)", () => {
    const seg = (s: Record<string, unknown>) => tl([{ shot: "shot_01", ...s }, { shot: "shot_02" }]);
    const bad = (s: Record<string, unknown>) => {
      const m = seg(s);
      expect(m.length, JSON.stringify(s)).toBe(1);
      expect(m[0]).toContain("segment 1");
    };
    const good = (s: Record<string, unknown>) => expect(seg(s), JSON.stringify(s)).toEqual([]);
    bad({ durationSec: 0.49 });
    good({ durationSec: 0.5 });
    good({ durationSec: 8 });
    bad({ durationSec: 8.01 });
    bad({ trimStartSec: 7.99 });
    bad({ trimStartSec: 8 });
    good({ trimStartSec: 2, durationSec: 6 });
    bad({ trimStartSec: 2, durationSec: 6.01 });
    bad({ transitionTo: { style: "fade", durationSec: 0 } });
    good({ transitionTo: { style: "fade", durationSec: 3 } });
    bad({ transitionTo: { style: "fade", durationSec: 3.01 } });
    bad({ durationSec: 2, transitionTo: { style: "fade", durationSec: 2 } });
    const last = tl([{ shot: "shot_01" }, { shot: "shot_02", transitionTo: { style: "fade", durationSec: 1 } }]);
    expect(last).toEqual(["timeline.json: segment 2: transitionTo is not allowed on the last segment"]);
  });

  it("E9: problem scopes", () => {
    const audio = loadSidecars(
      projectWith({ timeline: { segments: [{ shot: "shot_01" }], voiceover: { path: "audio/vo.wav" } } }).base,
    ).problems;
    expect(audio).toEqual([{ scope: "audio", message: "timeline.json: voiceover.path: file not found" }]);
    expect(loadSidecars(projectWith({ timeline: { segments: [{ shot: "shot_77" }] } }).base).problems[0].scope).toBe(
      "timeline",
    );
    expect(loadSidecars(projectWith({ shots: { shot_01: { sidecar: null } } }).base).problems[0].scope).toBe("shot");
    expect(loadSidecars(projectWith({ film: {} }).base).problems[0].scope).toBe("film");
  });
});

describe("loadSidecars — path containment (X1)", () => {
  const vo = (setup: (base: string) => string) => {
    const { base } = projectWith();
    const rel = setup(base);
    writeTimeline(base, { segments: [{ shot: "shot_01" }], voiceover: { path: rel } });
    return msgs(base);
  };

  it("rejects escapes, symlinks and missing files naming the field", () => {
    expect(vo(() => "../../etc/passwd")).toEqual(["timeline.json: voiceover.path: path escapes package"]);
    expect(vo(() => "/etc/hosts")).toEqual(["timeline.json: voiceover.path: path escapes package"]);
    expect(
      vo((base) => {
        writeFile(path.join(base, "audio", "real.wav"), "x");
        fs.symlinkSync(path.join(base, "audio", "real.wav"), path.join(base, "audio", "link.wav"));
        return "audio/link.wav";
      }),
    ).toEqual(["timeline.json: voiceover.path: path is a symlink"]);
    expect(
      vo((base) => {
        const outside = fs.mkdtempSync(path.join(path.dirname(path.dirname(base)), "out-"));
        writeFile(path.join(outside, "vo.wav"), "x");
        fs.symlinkSync(outside, path.join(base, "audio"));
        return "audio/vo.wav";
      }),
    ).toEqual(["timeline.json: voiceover.path: path escapes package"]);
    expect(vo(() => "audio/missing.wav")).toEqual(["timeline.json: voiceover.path: file not found"]);
  });

  it("resolves a relative in-package path to an absolute file", () => {
    const { base } = projectWith();
    writeFile(path.join(base, "audio", "vo.wav"), "x");
    writeTimeline(base, { segments: [{ shot: "shot_01" }], voiceover: { path: "audio/vo.wav" } });
    const sc = loadSidecars(base);
    expect(sc.problems).toEqual([]);
    expect(sc.timeline?.voiceover).toEqual({
      path: fs.realpathSync(path.join(base, "audio", "vo.wav")),
      volume: 1,
      offsetSec: 0,
    });
  });
});
