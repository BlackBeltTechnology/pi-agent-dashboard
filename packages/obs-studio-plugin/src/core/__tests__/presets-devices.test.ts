/**
 * E5 preset repeat + preserve, E6 preset partial / plugin-missing, E7 device
 * discovery (virtual camera, output-active, probe cleanup despite a throw,
 * leftover sweep). See change: add-obs-studio-plugin (test-plan E5–E7).
 */
import { afterEach, describe, expect, it } from "vitest";
import { baseDeps, runCli, tmpHome } from "./cli-harness.js";
import { type FakeObs, startFakeObs } from "./fake-obs.js";
import { type ObsModel, obsModel } from "./obs-model.js";

const fakes: FakeObs[] = [];
afterEach(async () => {
  for (const f of fakes.splice(0)) await f.close();
});

async function setup(m: ObsModel) {
  const f = await startFakeObs({ password: "pw", handlers: m.handlers });
  fakes.push(f);
  const home = tmpHome();
  const deps = baseDeps(home, { host: { home, platform: "darwin", env: { OBS_URL: f.url, OBS_PASSWORD: "pw" } } });
  return { f, run: (argv: string[]) => runCli([...argv, "--json"], deps) };
}

const MUTATING = /^(Create|Set|Remove)/;

describe("E5 presets: repeat + preserve", () => {
  it("first apply creates, second reports all existing and sends 0 Create*/Set* frames", async () => {
    const m = obsModel();
    const { f, run } = await setup(m);
    const first = await run(["preset", "apply", "desktop-webcam-pip"]);
    expect(first.code).toBe(0);
    const items1 = first.json().items as Array<{ item: string; status: string }>;
    expect(items1.find((i) => i.item === "scene:Desktop + Webcam")?.status).toBe("created");
    expect(items1.find((i) => i.item === "input:Webcam Box")?.status).toBe("created");
    // Bound to the first NON-virtual camera and the main display.
    expect(m.inputs.get("Webcam Box")?.settings.device).toBe("cam-1");
    expect(m.inputs.get("Desktop Combined")?.settings.display_uuid).toBe("DISP-1");
    // GetSceneList precedes every CreateScene.
    const types = f.types();
    expect(types.indexOf("GetSceneList")).toBeLessThan(types.indexOf("CreateScene"));

    f.frames.length = 0;
    const second = await run(["preset", "apply", "desktop-webcam-pip"]);
    expect(second.code).toBe(0);
    const items2 = second.json().items as Array<{ status: string }>;
    expect(items2.every((i) => i.status === "existing" || i.status === "skipped")).toBe(true);
    expect(items2.filter((i) => i.status === "existing").length).toBeGreaterThanOrEqual(3);
    expect(f.types().filter((t) => MUTATING.test(t))).toEqual([]);
  });

  // Transforms are canvas pixels: a 1920-based layout on a 5120x2880 canvas lands mid-left.
  const transforms = (f: FakeObs) => f.frames.filter((x) => x.type === "SetSceneItemTransform").map((x) => x.data.sceneItemTransform);

  it("PIP box scales to the base canvas (5120\u00d72880 \u2192 bottom-right, k = 8/3)", async () => {
    const m = obsModel();
    m.canvas = { width: 5120, height: 2880 };
    const { f, run } = await setup(m);
    expect((await run(["preset", "apply", "desktop-webcam-pip"])).code).toBe(0);
    expect(transforms(f)).toEqual([
      { boundsType: "OBS_BOUNDS_SCALE_INNER", boundsWidth: 5120, boundsHeight: 2880, positionX: 0, positionY: 0 },
      { boundsType: "OBS_BOUNDS_SCALE_INNER", boundsWidth: 1280, boundsHeight: 720, positionX: 3787, positionY: 2107 },
    ]);
  });

  it("no GetVideoSettings \u2192 1920\u00d71080 layout", async () => {
    const m = obsModel();
    delete m.handlers.GetVideoSettings;
    const { f, run } = await setup(m);
    expect((await run(["preset", "apply", "desktop-webcam-pip"])).code).toBe(0);
    expect(transforms(f)[1]).toMatchObject({ boundsWidth: 480, boundsHeight: 270, positionX: 1420, positionY: 790 });
  });

  it("a user-tuned Webcam Box is never touched", async () => {
    const m = obsModel();
    m.scenes.set("Desktop + Webcam", ["Desktop Combined", "Webcam Box"]);
    m.inputs.set("Desktop Combined", { kind: "screen_capture", settings: {} });
    m.inputs.set("Webcam Box", { kind: "av_capture_input_v2", settings: { device: "X" } });
    const { f, run } = await setup(m);
    expect((await run(["preset", "apply", "desktop-webcam-pip"])).code).toBe(0);
    expect(m.inputs.get("Webcam Box")?.settings).toEqual({ device: "X" });
    expect(f.frames.filter((x) => x.type === "SetInputSettings" && x.data.inputName === "Webcam Box")).toEqual([]);
  });
});

describe("E6 presets: partial", () => {
  it("existing scene lacking Webcam Box → incomplete, nothing added", async () => {
    const m = obsModel();
    m.scenes.set("Desktop + Webcam", ["Desktop Combined"]);
    m.inputs.set("Desktop Combined", { kind: "screen_capture", settings: {} });
    const { f, run } = await setup(m);
    const r = await run(["preset", "apply", "desktop-webcam-pip"]);
    expect(r.code).toBe(0);
    const items = r.json().items as Array<{ item: string; status: string }>;
    expect(items.find((i) => i.item === "scene:Desktop + Webcam")?.status).toBe("incomplete");
    expect(items.find((i) => i.item === "input:Webcam Box")?.status).toBe("incomplete");
    expect(m.scenes.get("Desktop + Webcam")).toEqual(["Desktop Combined"]);
    expect(f.types().filter((t) => MUTATING.test(t))).toEqual([]);
  });

  it("no background_removal kind → filter plugin-missing, other items applied, exit 0", async () => {
    const m = obsModel({ filterKinds: ["chroma_key_filter_v2"] });
    const { run } = await setup(m);
    const r = await run(["preset", "apply", "pip-bgremoval"]);
    expect(r.code).toBe(0);
    const items = r.json().items as Array<{ item: string; status: string }>;
    expect(items.find((i) => i.item.startsWith("filter:"))?.status).toBe("plugin-missing");
    expect(items.find((i) => i.item === "input:Webcam Box")?.status).toBe("created");
    expect(m.scenes.get("Desktop + Webcam")).toEqual(["Desktop Combined", "Webcam Box"]);
  });
});

describe("E7 device discovery", () => {
  it("(a) camera list excludes the virtual camera; binding it is refused", async () => {
    const m = obsModel();
    m.inputs.set("Webcam Full", { kind: "av_capture_input_v2", settings: {} });
    const { f, run } = await setup(m);
    const list = await run(["devices", "list", "--kind", "camera"]);
    expect(list.code).toBe(0);
    const devices = (list.json().devices as Array<{ devices: Array<{ name: string }> }>)[0].devices;
    expect(devices.map((d) => d.name)).toEqual(["MacBook Pro Camera"]);
    const bind = await run(["input", "bind", "Webcam Full", "--device", "obs-vcam"]);
    expect(bind.code).toBe(1);
    expect(JSON.stringify(bind.json())).toMatch(/feedback loop/);
    expect(f.frames.filter((x) => x.type === "SetInputSettings")).toEqual([]);
  });

  it("(b) no audio input while recording → output-active, 0 CreateInput", async () => {
    const m = obsModel();
    m.outputs.record = true;
    const { f, run } = await setup(m);
    const r = await run(["devices", "list", "--kind", "audio"]);
    expect(r.code).toBe(1);
    expect(r.json()).toMatchObject({ ok: false, error: { code: "output-active" } });
    expect(f.types()).not.toContain("CreateInput");
  });

  it("(c) probe input + pi-obs-probe scene removed despite a listing throw", async () => {
    const m = obsModel();
    m.listingThrows = true;
    const { f, run } = await setup(m);
    const r = await run(["devices", "list", "--kind", "audio"]);
    expect(r.code).toBe(1);
    const create = f.frames.find((x) => x.type === "CreateInput");
    expect(create?.data).toMatchObject({ sceneName: "pi-obs-probe", inputName: "pi-obs-probe-audio" });
    expect(f.types()).toEqual(expect.arrayContaining(["RemoveInput", "RemoveScene"]));
    expect(m.inputs.has("pi-obs-probe-audio")).toBe(false);
    expect(m.scenes.has("pi-obs-probe")).toBe(false);
  });

  it("(d) a leftover probe is removed before the verb runs", async () => {
    const m = obsModel();
    m.scenes.set("pi-obs-probe", ["pi-obs-probe-audio"]);
    m.inputs.set("pi-obs-probe-audio", { kind: "coreaudio_input_capture", settings: {} });
    const { f, run } = await setup(m);
    expect((await run(["status"])).code).toBe(0);
    const types = f.types();
    expect(types.indexOf("RemoveInput")).toBeLessThan(types.indexOf("GetCurrentProgramScene"));
    expect(m.inputs.has("pi-obs-probe-audio")).toBe(false);
    expect(m.scenes.has("pi-obs-probe")).toBe(false);
  });

  it("displays: listed with id, size and main flag", async () => {
    const { run } = await setup(obsModel());
    const r = await run(["devices", "list", "--kind", "display"]);
    expect((r.json().devices as Array<{ devices: unknown }>)[0].devices).toEqual([{ id: "DISP-1", width: 1728, height: 1117, main: true }]);
  });
});
