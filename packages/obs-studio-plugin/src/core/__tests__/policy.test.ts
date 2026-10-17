/**
 * E1 (through `pi-obs status`), E2 `call` restrictions, E3 crash deny (call +
 * serve), E4 capability gating + stream key handling.
 * See change: add-obs-studio-plugin (test-plan E1–E4).
 */
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { connectObs } from "../connection.js";
import { guard } from "../policy.js";
import { serve } from "../serve.js";
import { baseDeps, runCli, tmpHome, writeServices } from "./cli-harness.js";
import { type FakeObs, type Handler, startFakeObs } from "./fake-obs.js";

const fakes: FakeObs[] = [];
afterEach(async () => {
  for (const f of fakes.splice(0)) await f.close();
});

const INPUTS = {
  inputs: [
    { inputName: "Desktop Full", inputUuid: "u-desk", inputKind: "screen_capture", unversionedInputKind: "screen_capture" },
    { inputName: "Webcam Full", inputUuid: "u-cam", inputKind: "av_capture_input_v2", unversionedInputKind: "av_capture_input" },
  ],
};
const ok = () => ({});
const handlers: Record<string, Handler> = {
  GetInputList: () => INPUTS,
  GetSceneList: () => ({ currentProgramSceneName: "Webcam", scenes: [{ sceneName: "Webcam", sceneIndex: 0 }] }),
  GetInputPropertiesListPropertyItems: () => ({ propertyItems: [{ itemName: "MacBook Pro Camera", itemValue: "cam-1" }] }),
  GetInputSettings: () => ({ inputSettings: {} }),
  RemoveScene: ok,
  SetCurrentSceneCollection: ok,
  CreateProfile: ok,
  SetProfileParameter: ok,
  SetStreamServiceSettings: ok,
  RemoveInput: ok,
  CreateScene: ok,
  GetCurrentProgramScene: () => ({ currentProgramSceneName: "Webcam" }),
  GetVirtualCamStatus: () => ({ outputActive: false }),
  GetRecordStatus: () => ({ outputActive: false }),
  GetStreamStatus: () => ({ outputActive: false }),
};

async function fake(o: Parameters<typeof startFakeObs>[0] = {}) {
  const f = await startFakeObs({ password: "pw", handlers, ...o });
  fakes.push(f);
  return f;
}

function deps(f: FakeObs, stdin = "", env: Record<string, string> = {}) {
  const home = tmpHome();
  return baseDeps(home, { host: { home, platform: "darwin", env: { OBS_URL: f.url, OBS_PASSWORD: "pw", ...env } }, readStdin: async () => stdin });
}

describe("E1 through pi-obs status", () => {
  it("--service obs + SVC_OBS_PASSWORD authenticates with the service secret", async () => {
    const f = await fake({ password: "svc-secret" });
    const home = tmpHome();
    writeServices(home, [{ id: "obs", mode: "attached", endpoints: { ws: f.url }, health: { kind: "ws-first-message", endpoint: "ws" }, origin: "user" }]);
    const r = await runCli(["status", "--service", "obs", "--json"], baseDeps(home, { host: { home, platform: "darwin", env: { SVC_OBS_PASSWORD: "svc-secret", OBS_PASSWORD: "wrong" } } }));
    expect(r.code).toBe(0);
    expect(r.json()).toMatchObject({ ok: true, obsVersion: "32.2.2", currentScene: "Webcam", virtualCam: false, recording: false });
  });

  it("two SVC_*_PASSWORD without --service → exit 2 naming both", async () => {
    const f = await fake();
    const r = await runCli(["status"], deps(f, "", { SVC_OBS_PASSWORD: "a", SVC_OBS_STUDIO2_PASSWORD: "b" }));
    expect(r.code).toBe(2);
    expect(r.err.join("\n")).toMatch(/SVC_OBS_PASSWORD.*SVC_OBS_STUDIO2_PASSWORD/);
    expect(f.frames).toHaveLength(0);
  });

  it("only OBS_URL / OBS_PASSWORD → fallback used", async () => {
    const f = await fake();
    expect((await runCli(["status", "--json"], deps(f))).code).toBe(0);
  });

  it("--password x → exit 2 naming the channels, nothing sent", async () => {
    const f = await fake();
    const r = await runCli(["status", "--password", "x"], deps(f));
    expect(r.code).toBe(2);
    expect(r.err.join("\n")).toMatch(/service exec.*OBS_PASSWORD/);
    expect(r.err.join("\n")).not.toMatch(/\bx\b.*password/);
    expect(f.frames).toHaveLength(0);
  });
});

describe("E2 call restrictions", () => {
  it.each([
    ["RemoveScene", /OBS UI/],
    ["SetCurrentSceneCollection", /OBS UI/],
    ["CreateProfile", /OBS UI/],
    ["SetProfileParameter", /OBS UI/],
    ["SetStreamServiceSettings", /stream target/],
  ])("%s on stdin → denied, 0 frames of it, names the alternative", async (type, alt) => {
    const f = await fake();
    const r = await runCli(["call", type], deps(f, '{"sceneName":"Webcam"}'));
    expect(r.code).toBe(1);
    expect(r.err.join("\n")).toMatch(/denied/);
    expect(r.err.join("\n")).toMatch(alt);
    expect(f.types()).not.toContain(type);
  });

  it("GetSceneList is sent", async () => {
    const f = await fake();
    const r = await runCli(["call", "GetSceneList", "--json"], deps(f));
    expect(r.code).toBe(0);
    expect(f.types()).toContain("GetSceneList");
  });

  it("JSON as argv → exit 2 naming stdin and --json-file, nothing connected", async () => {
    const f = await fake();
    const r = await runCli(["call", "GetInputSettings", '{"inputName":"x"}'], deps(f));
    expect(r.code).toBe(2);
    expect(r.err.join("\n")).toMatch(/stdin.*--json-file/);
    expect(f.frames).toHaveLength(0);
  });
});

describe("E3 crash deny", () => {
  const CRASH = "GetInputPropertiesListPropertyItems";

  it("screen_capture by name → 0 frames + devices list hint", async () => {
    const f = await fake();
    const r = await runCli(["call", CRASH], deps(f, '{"inputName":"Desktop Full","propertyName":"display_uuid"}'));
    expect(r.code).toBe(1);
    expect(r.err.join("\n")).toMatch(/pi-obs devices list --kind display/);
    expect(f.types()).not.toContain(CRASH);
  });

  it("unknown inputUuid → 0 frames + unresolved-target", async () => {
    const f = await fake();
    const r = await runCli(["call", CRASH, "--json"], deps(f, '{"inputUuid":"nope","propertyName":"device"}'));
    expect(r.code).toBe(1);
    expect(r.json()).toMatchObject({ ok: false, error: { code: "unresolved-target" } });
    expect(f.types()).not.toContain(CRASH);
  });

  it("camera input → sent and items returned", async () => {
    const f = await fake();
    const r = await runCli(["call", CRASH, "--json"], deps(f, '{"inputName":"Webcam Full","propertyName":"device"}'));
    expect(r.code).toBe(0);
    expect(r.json()).toMatchObject({ propertyItems: [{ itemValue: "cam-1" }] });
    expect(f.types()).toContain(CRASH);
  });

  it("the serve bridge applies the same policy (no raw request op)", async () => {
    const f = await fake();
    const input = new PassThrough();
    const output = new PassThrough();
    const lines: string[] = [];
    output.on("data", (b) => lines.push(...String(b).split("\n").filter(Boolean)));
    const done = serve({ input, output, connect: async () => guard(await connectObs({ url: f.url, password: "pw", source: "env" }), { via: "serve" }) });
    input.write(`${JSON.stringify({ id: 1, op: CRASH, args: { inputName: "Desktop Full" } })}\n`);
    await new Promise((r) => setTimeout(r, 300));
    input.end();
    await done;
    expect(JSON.parse(lines[0])).toMatchObject({ id: 1, ok: false, error: { code: "usage" } });
    expect(f.types()).not.toContain(CRASH);
  });
});

describe("E4 capability gating + stream key", () => {
  it("availableRequests without CreateScene → unsupported-request, 0 CreateScene frames", async () => {
    const f = await fake({ availableRequests: ["GetVersion", "GetInputList", "GetSceneList", "RemoveInput", "RemoveScene"] });
    const r = await runCli(["scene", "create", "X", "--json"], deps(f));
    expect(r.code).toBe(1);
    expect(r.json()).toMatchObject({ ok: false, error: { code: "unsupported-request" } });
    expect(f.types()).not.toContain("CreateScene");
  });

  it("loopback: stream settings sent; key never in stdout/stderr/argv", async () => {
    const f = await fake();
    const argv = ["stream", "target", "rtmp://h/app", "--key-stdin", "--json"];
    const r = await runCli(argv, deps(f, "sk-123\n"));
    expect(r.code).toBe(0);
    const sent = f.frames.find((x) => x.type === "SetStreamServiceSettings");
    expect(sent?.data).toMatchObject({ streamServiceSettings: { server: "rtmp://h/app", key: "sk-123" } });
    expect([...r.out, ...r.err, ...argv].join("\n")).not.toContain("sk-123");
  });

  it("ws://10.0.0.5 without --allow-insecure-remote → refused before connect", async () => {
    const home = tmpHome();
    let stdinRead = false;
    const r = await runCli(
      ["stream", "target", "rtmp://h/app", "--key-stdin", "--url", "ws://10.0.0.5:4455", "--json"],
      baseDeps(home, {
        host: { home, platform: "darwin", env: { OBS_PASSWORD: "pw" } },
        readStdin: async () => {
          stdinRead = true;
          return "sk-123";
        },
        connect: async () => {
          throw new Error("must not connect");
        },
      }),
    );
    expect(r.code).toBe(1);
    expect(r.json()).toMatchObject({ ok: false, error: { code: "insecure-remote" } });
    expect(stdinRead).toBe(false);
  });
});
