import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseShotFile, shotShort } from "../shots.js";
import { cleanup, makePackage, shotMd } from "./fixture.js";

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
