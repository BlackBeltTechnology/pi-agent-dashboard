/**
 * `serve --stdio` lifetime + protocol: idle exit (P2, bridge side), EOF exit,
 * id-correlated concurrent answers, probe sweep on first connect.
 * See change: add-obs-studio-plugin (test-plan P2, X3, X4).
 */
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { connectObs } from "../connection.js";
import { guard } from "../policy.js";
import { serve } from "../serve.js";
import { type FakeObs, startFakeObs } from "./fake-obs.js";
import { obsModel } from "./obs-model.js";

const fakes: FakeObs[] = [];
afterEach(async () => {
  for (const f of fakes.splice(0)) await f.close();
});

async function harness(idleMs = 60_000) {
  const m = obsModel();
  m.scenes.set("Webcam", []);
  m.scenes.set("pi-obs-probe", []);
  const f = await startFakeObs({ password: "pw", handlers: { ...m.handlers, SetCurrentProgramScene: () => ({}), GetSourceScreenshot: () => new Promise((r) => setTimeout(() => r({ imageData: "data:image/jpeg;base64,AA==" }), 100)) } });
  fakes.push(f);
  const input = new PassThrough();
  const output = new PassThrough();
  const lines: Array<Record<string, unknown>> = [];
  output.on("data", (b) => {
    for (const l of String(b).split("\n").filter(Boolean)) lines.push(JSON.parse(l));
  });
  let connects = 0;
  const done = serve({ input, output, idleMs, connect: async () => (connects++, guard(await connectObs({ url: f.url, password: "pw", source: "env" }), { via: "serve" })) });
  return { m, f, input, lines, done, connects: () => connects };
}

describe("serve", () => {
  it("exits after the idle window without requests", async () => {
    const h = await harness(150);
    const t0 = Date.now();
    await h.done;
    expect(Date.now() - t0).toBeGreaterThanOrEqual(140);
  });

  it("exits on stdin EOF", async () => {
    const h = await harness();
    h.input.end();
    await h.done;
  });

  it("answers by id (slow screenshot after fast scene), one connection, probes swept first", async () => {
    const h = await harness();
    h.input.write(`${JSON.stringify({ id: 1, op: "screenshot" })}\n`);
    h.input.write(`${JSON.stringify({ id: 2, op: "scene.switch", args: { sceneName: "Webcam" } })}\n`);
    await new Promise((r) => setTimeout(r, 400));
    h.input.end();
    await h.done;
    expect(h.lines.map((l) => l.id)).toEqual([2, 1]);
    expect(h.lines[0]).toMatchObject({ ok: true, result: { current: "Webcam" } });
    expect(h.lines[1]).toMatchObject({ ok: true, result: { imageData: "data:image/jpeg;base64,AA==" } });
    expect(h.connects()).toBe(1);
    expect(h.m.scenes.has("pi-obs-probe")).toBe(false);
  });

  it("unknown scene → error carries the available scenes", async () => {
    const h = await harness();
    h.input.write(`${JSON.stringify({ id: 7, op: "scene.switch", args: { sceneName: "Nope" } })}\n`);
    await new Promise((r) => setTimeout(r, 200));
    h.input.end();
    await h.done;
    expect(h.lines[0]).toMatchObject({ id: 7, ok: false, error: { code: "not-found", scenes: ["Webcam"] } });
  });
});
