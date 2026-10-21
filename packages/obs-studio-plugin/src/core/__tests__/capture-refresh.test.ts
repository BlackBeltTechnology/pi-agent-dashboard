/**
 * `pi-obs capture refresh`: unfreeze macOS screen captures after sleep by
 * flipping each input's `display_uuid` to another display and restoring the
 * exact original settings (OBS 31 ScreenCaptureKit never restarts a stream that
 * stopped during sleep). Also the `parseDisplays` position fields used to pick
 * the flip target. See change: add-obs-capture-refresh.
 */
import { afterEach, describe, expect, it } from "vitest";
import { parseDisplays } from "../devices.js";
import { baseDeps, runCli, tmpHome } from "./cli-harness.js";
import { type FakeObs, startFakeObs } from "./fake-obs.js";
import { type ObsModel, obsModel } from "./obs-model.js";

const errCode = (r: { json(): Record<string, unknown> }) => (r.json().error as { code?: string } | undefined)?.code;

const fakes: FakeObs[] = [];
afterEach(async () => {
  for (const f of fakes.splice(0)) await f.close();
});

const TWO = [
  { id: "LEFT", width: 2560, height: 1440, main: true },
  { id: "RIGHT", width: 2560, height: 1440, main: false },
];

async function setup(m: ObsModel, over: { displays?: unknown; platform?: "darwin" | "win32" } = {}) {
  const f = await startFakeObs({ password: "pw", handlers: m.handlers });
  fakes.push(f);
  const home = tmpHome();
  const sleeps: number[] = [];
  const deps = baseDeps(home, {
    host: { home, platform: over.platform ?? "darwin", env: { OBS_URL: f.url, OBS_PASSWORD: "pw" } },
    listDisplays: async () => (over.displays ?? TWO) as never,
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
  });
  return { f, sleeps, run: (argv: string[]) => runCli([...argv, "--json"], deps) };
}

const setFrames = (f: FakeObs) => f.frames.filter((x) => x.type === "SetInputSettings").map((x) => x.data);

describe("capture refresh", () => {
  it("flips every screen_capture input to another display, then restores the exact original settings", async () => {
    const m = obsModel();
    m.inputs.set("Screen A", { kind: "screen_capture", settings: { display_uuid: "RIGHT", hide_obs: true } });
    m.inputs.set("Combined", { kind: "screen_capture", settings: {} });
    m.inputs.set("Webcam Box", { kind: "av_capture_input_v2", settings: { device: "cam-1" } });
    const { f, sleeps, run } = await setup(m);

    const r = await run(["capture", "refresh"]);
    expect(r.code).toBe(0);
    expect(r.json().refreshed).toEqual([
      { input: "Screen A", via: "flip" },
      { input: "Combined", via: "flip" },
    ]);
    expect(setFrames(f)).toEqual([
      { inputName: "Screen A", inputSettings: { display_uuid: "LEFT" }, overlay: true },
      { inputName: "Screen A", inputSettings: { display_uuid: "RIGHT", hide_obs: true }, overlay: false },
      // Empty settings = OBS default (main display) → flip to the non-main one, restore {} exactly.
      { inputName: "Combined", inputSettings: { display_uuid: "RIGHT" }, overlay: true },
      { inputName: "Combined", inputSettings: {}, overlay: false },
    ]);
    expect(m.inputs.get("Screen A")?.settings).toEqual({ display_uuid: "RIGHT", hide_obs: true });
    expect(m.inputs.get("Combined")?.settings).toEqual({});
    expect(m.inputs.get("Webcam Box")?.settings).toEqual({ device: "cam-1" });
    // Holds the flipped display long enough for OBS to restart the stream.
    expect(sleeps.filter((ms) => ms >= 1000)).toHaveLength(2);
  });

  it("--input refreshes only the named input; unknown names are not-found", async () => {
    const m = obsModel();
    m.inputs.set("Screen A", { kind: "screen_capture", settings: { display_uuid: "RIGHT" } });
    m.inputs.set("Screen B", { kind: "screen_capture", settings: { display_uuid: "LEFT" } });
    const { f, run } = await setup(m);

    const r = await run(["capture", "refresh", "--input", "Screen B"]);
    expect(r.code).toBe(0);
    expect(r.json().refreshed).toEqual([{ input: "Screen B", via: "flip" }]);
    expect(setFrames(f).every((d) => d.inputName === "Screen B")).toBe(true);

    const miss = await run(["capture", "refresh", "--input", "Nope"]);
    expect(miss.code).toBe(1);
    expect(errCode(miss)).toBe("not-found");
  });

  it("refuses a named input that is not a screen capture", async () => {
    const m = obsModel();
    m.inputs.set("Webcam Box", { kind: "av_capture_input_v2", settings: {} });
    const { f, run } = await setup(m);
    const r = await run(["capture", "refresh", "--input", "Webcam Box"]);
    expect(errCode(r)).toBe("refused");
    expect(setFrames(f)).toEqual([]);
  });

  it("single display: re-applies the settings instead of flipping", async () => {
    const m = obsModel();
    m.inputs.set("Screen A", { kind: "screen_capture", settings: { display_uuid: "LEFT" } });
    const { f, run } = await setup(m, { displays: [TWO[0]] });
    const r = await run(["capture", "refresh"]);
    expect(r.json().refreshed).toEqual([{ input: "Screen A", via: "reapply" }]);
    expect(setFrames(f)).toEqual([{ inputName: "Screen A", inputSettings: { display_uuid: "LEFT" }, overlay: false }]);
  });

  it("never enumerates screen_capture properties (crashes OBS)", async () => {
    const m = obsModel();
    m.inputs.set("Screen A", { kind: "screen_capture", settings: { display_uuid: "RIGHT" } });
    const { f, run } = await setup(m);
    await run(["capture", "refresh"]);
    expect(f.types()).not.toContain("GetInputPropertiesListPropertyItems");
  });

  it("restores the original settings even when the hold is interrupted", async () => {
    const m = obsModel();
    m.inputs.set("Screen A", { kind: "screen_capture", settings: { display_uuid: "RIGHT", hide_obs: true } });
    const f = await startFakeObs({ password: "pw", handlers: m.handlers });
    fakes.push(f);
    const home = tmpHome();
    const deps = baseDeps(home, {
      host: { home, platform: "darwin", env: { OBS_URL: f.url, OBS_PASSWORD: "pw" } },
      listDisplays: async () => TWO as never,
      sleep: async () => {
        throw new Error("interrupted");
      },
    });
    const r = await runCli(["capture", "refresh", "--json"], deps);
    expect(r.code).toBe(1);
    expect(m.inputs.get("Screen A")?.settings).toEqual({ display_uuid: "RIGHT", hide_obs: true });
  });

  it("is macOS-only", async () => {
    const { run } = await setup(obsModel(), { platform: "win32" });
    const r = await run(["capture", "refresh"]);
    expect(errCode(r)).toBe("refused");
  });
});

describe("parseDisplays", () => {
  it("keeps distinct ids and the x/y position", () => {
    const out = parseDisplays(
      JSON.stringify([
        { id: "A", x: 0, y: 0, width: 2560, height: 1440, main: true, mirrored: false },
        { id: "B", x: 2560, y: 0, width: 2560, height: 1440, main: false, mirrored: false },
      ]),
    );
    expect(out).toEqual([
      { id: "A", x: 0, y: 0, width: 2560, height: 1440, main: true },
      { id: "B", x: 2560, y: 0, width: 2560, height: 1440, main: false },
    ]);
  });
});
