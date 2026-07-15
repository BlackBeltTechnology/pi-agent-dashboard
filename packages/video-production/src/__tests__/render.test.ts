import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadShots } from "../package.js";
import { buildRequest, planRender, renderShots, type VeoClient } from "../render.js";
import { cleanup, makePackage, shotMd } from "./fixture.js";

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
