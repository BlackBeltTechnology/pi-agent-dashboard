/**
 * E16 route gating, E17 authority + secret isolation (plugin predicate rows),
 * E18 rate limit (loopback included), X2 OBS hang / bridge death, X4
 * concurrency, X6 state read path, P2 state cache.
 * See change: add-obs-studio-plugin (test-plan E16–E18, X2, X4, X6, P2).
 */
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { type FakeChild, obsApp, okResponder } from "./helpers.js";

const apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
});
async function mk(o: Parameters<typeof obsApp>[0] = {}) {
  const r = await obsApp(o);
  apps.push(r.app);
  return r;
}
const FAKE_PASSWORD = "s3cret-obs-password-xyz";

describe("E16 route gating", () => {
  it("unregistered id → 404, 0 spawns", async () => {
    const { app, children } = await mk();
    const r = await app.inject({ method: "POST", url: "/api/plugins/obs-studio/nope/scene", payload: { sceneName: "A" } });
    expect(r.statusCode).toBe(404);
    expect(children).toHaveLength(0);
  });

  it("another ws service that is not a registered OBS → 404", async () => {
    const { app, children } = await mk({ defs: { obs: { mode: "attached", ws: "ws://127.0.0.1:4455" }, chat: { mode: "external", ws: "ws://127.0.0.1:9000" } } });
    const r = await app.inject({ method: "GET", url: "/api/plugins/obs-studio/chat/screenshot" });
    expect(r.statusCode).toBe(404);
    expect(children).toHaveLength(0);
  });

  it("registered id whose definition was removed → 404 and pruned", async () => {
    const { app, instances } = await mk({ instances: ["obs", "gone"] });
    const r = await app.inject({ method: "GET", url: "/api/plugins/obs-studio/gone/status" });
    expect(r.statusCode).toBe(404);
    expect(instances()).toEqual(["obs"]);
  });

  it("scene POST without sceneName → 400, 0 bridge calls", async () => {
    const { app, children } = await mk();
    const r = await app.inject({ method: "POST", url: "/api/plugins/obs-studio/obs/scene", payload: {} });
    expect(r.statusCode).toBe(400);
    expect(children).toHaveLength(0);
  });

  it("observe status on `stopped` → state stopped, 0 bridge spawns, 0 secret resolutions (status read only)", async () => {
    const { app, children, cli } = await mk({ states: { obs: "stopped" } });
    const r = await app.inject({ method: "GET", url: "/api/plugins/obs-studio/obs/status" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ id: "obs", state: "stopped" });
    expect(children).toHaveLength(0);
    expect(cli.calls).toEqual([["service", "status", "obs", "--json"]]);
  });

  it("observe status on healthy with no bridge → managed state only, 0 spawns", async () => {
    const { app, children } = await mk();
    const r = await app.inject({ method: "GET", url: "/api/plugins/obs-studio/obs/status" });
    expect(r.json()).toMatchObject({ state: "healthy", bridge: { open: false } });
    expect(r.json().live).toBeUndefined();
    expect(children).toHaveLength(0);
  });

  it("instances lists registered instances with state + exposure", async () => {
    const { app } = await mk();
    const r = await app.inject({ method: "GET", url: "/api/plugins/obs-studio/instances" });
    expect(r.json()).toMatchObject({ instances: [{ id: "obs", state: "healthy", exposure: "all-interfaces" }] });
  });

  it("after an operator opened the bridge, status carries live data", async () => {
    const { app, children } = await mk({ respond: okResponder({ status: { scenes: ["Webcam"], current: "Webcam" }, screenshot: { imageData: "data:image/jpeg;base64,AA==" } }) });
    expect((await app.inject({ method: "GET", url: "/api/plugins/obs-studio/obs/screenshot" })).json()).toMatchObject({ ok: true, result: { imageData: "data:image/jpeg;base64,AA==" } });
    const r = await app.inject({ method: "GET", url: "/api/plugins/obs-studio/obs/status" });
    expect(r.json()).toMatchObject({ live: { scenes: ["Webcam"] }, bridge: { open: true } });
    expect(children).toHaveLength(1);
    expect(children[0].argv).toEqual([
      "/abs/node", "/abs/cli.ts", "service", "exec", "obs", "--", "/abs/node", "/abs/pi-obs.mjs", "serve", "--stdio", "--service", "obs", "--url", "ws://127.0.0.1:4455",
    ]);
  });
});

describe("E17 authority + secret isolation", () => {
  it("trusted-network caller (predicate false) GET screenshot → 403 operate_required, 0 spawns, 0 state reads", async () => {
    const { app, children, cli } = await mk({ authority: () => false });
    const r = await app.inject({ method: "GET", url: "/api/plugins/obs-studio/obs/screenshot", remoteAddress: "192.168.16.220" });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ error: "operate_required" });
    expect(children).toHaveLength(0);
    expect(cli.calls).toEqual([]);
  });

  it("seam absent + POST record → refused (fail closed), 0 spawns", async () => {
    const { app, children } = await mk({ authority: null });
    const r = await app.inject({ method: "POST", url: "/api/plugins/obs-studio/obs/record", payload: { on: true } });
    expect(r.statusCode).toBe(403);
    expect(children).toHaveLength(0);
  });

  it("no response body or log line contains the password", async () => {
    // The bridge child's stderr is the only place a misbehaving child could echo; the route must not forward it verbatim either.
    const { app, logs } = await mk({
      respond: (req, c) => {
        c.stderr.write("obs: connect ok\n");
        c.reply(req.id, { ok: true, result: { imageData: "data:image/jpeg;base64,AA==", scenes: ["A"] } });
      },
    });
    const bodies: string[] = [];
    for (const [method, url, payload] of [
      ["GET", "/api/plugins/obs-studio/instances"],
      ["GET", "/api/plugins/obs-studio/obs/status"],
      ["GET", "/api/plugins/obs-studio/obs/screenshot"],
      ["POST", "/api/plugins/obs-studio/obs/scene", { sceneName: "A" }],
      ["POST", "/api/plugins/obs-studio/obs/virtualcam", { on: true }],
      ["POST", "/api/plugins/obs-studio/obs/record", { on: false }],
    ] as const) {
      bodies.push((await app.inject({ method, url, payload: payload as never })).body);
    }
    expect([...bodies, ...logs].join("\n")).not.toContain(FAKE_PASSWORD);
  });
});

describe("E18 rate limit (loopback included)", () => {
  it("30 scene POSTs pass, the 31st → 429 with 0 bridge calls", async () => {
    let calls = 0;
    const { app } = await mk({
      respond: (req, c) => {
        calls++;
        c.reply(req.id, { ok: true, result: { current: "A" } });
      },
    });
    let last = 0;
    for (let i = 1; i <= 30; i++) {
      last = (await app.inject({ method: "POST", url: "/api/plugins/obs-studio/obs/scene", payload: { sceneName: "A" }, remoteAddress: "127.0.0.1" })).statusCode;
    }
    expect(last).toBe(200);
    const before = calls;
    const r31 = await app.inject({ method: "POST", url: "/api/plugins/obs-studio/obs/scene", payload: { sceneName: "A" }, remoteAddress: "127.0.0.1" });
    expect(r31.statusCode).toBe(429);
    expect(calls).toBe(before);
  });
});

describe("X2 OBS hangs / bridge dies", () => {
  it("serve never answers scene.switch → 504 obs-timeout and the bridge is terminated; next request spawns a new one", async () => {
    const { app, children } = await mk({ respond: () => {}, requestTimeoutMs: 200, disposeGraceMs: 50 });
    const t0 = Date.now();
    const r = await app.inject({ method: "POST", url: "/api/plugins/obs-studio/obs/scene", payload: { sceneName: "A" } });
    expect(r.statusCode).toBe(504);
    expect(r.json()).toEqual({ error: "obs-timeout" });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(190);
    expect(children[0].stdinEnded).toBe(true);
    await app.inject({ method: "POST", url: "/api/plugins/obs-studio/obs/scene", payload: { sceneName: "A" } });
    expect(children).toHaveLength(2);
  });

  it("exec exits 1 with a stderr line → lastError = that line, restarts 1; next request spawns a new bridge", async () => {
    const line = "obs: failed — retryAt 2026-10-15T18:00:00Z";
    const { app, children } = await mk({
      respond: (_req, c) => {
        c.stderr.write(`${line}\n`);
        setTimeout(() => c.exit(1), 20);
      },
    });
    const first = await app.inject({ method: "POST", url: "/api/plugins/obs-studio/obs/scene", payload: { sceneName: "A" } });
    expect(first.statusCode).toBe(502);
    const st = await app.inject({ method: "GET", url: "/api/plugins/obs-studio/obs/status" });
    expect(st.json().bridge).toMatchObject({ open: false, restarts: 1, lastError: line });
    await app.inject({ method: "POST", url: "/api/plugins/obs-studio/obs/scene", payload: { sceneName: "A" } });
    expect(children).toHaveLength(2);
  });
});

describe("X4 concurrency", () => {
  it("out-of-order answers reach their own callers", async () => {
    const { app } = await mk({
      respond: (req, c) => {
        const delay = req.op === "screenshot" ? 150 : 10;
        setTimeout(() => c.reply(req.id, { ok: true, result: req.op === "screenshot" ? { imageData: "data:image/jpeg;base64,SHOT" } : { current: req.args.sceneName } }), delay);
      },
    });
    const [shot, scene] = await Promise.all([
      app.inject({ method: "GET", url: "/api/plugins/obs-studio/obs/screenshot" }),
      app.inject({ method: "POST", url: "/api/plugins/obs-studio/obs/scene", payload: { sceneName: "Desktop" } }),
    ]);
    expect(shot.json()).toMatchObject({ result: { imageData: "data:image/jpeg;base64,SHOT" } });
    expect(scene.json()).toMatchObject({ result: { current: "Desktop" } });
  });
});

describe("X6 state read path", () => {
  it("operate screenshot on a stopped service: state via the CLI, 0 ensure/start, no bridge", async () => {
    const { app, children, cli } = await mk({ states: { obs: "stopped" } });
    const r = await app.inject({ method: "GET", url: "/api/plugins/obs-studio/obs/screenshot" });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ error: "not-healthy", state: "stopped" });
    expect(cli.calls).toEqual([["service", "status", "obs", "--json"]]);
    expect(cli.calls.flat()).not.toEqual(expect.arrayContaining(["ensure", "start", "exec"]));
    expect(children).toHaveLength(0);
  });
});

describe("P2 state cache + bridge idle", () => {
  it("10 status polls within 5 s → 1 service status read", async () => {
    let t = 0;
    const { app, cli } = await mk({ now: () => t });
    for (let i = 0; i < 10; i++) {
      t = i * 450;
      await app.inject({ method: "GET", url: "/api/plugins/obs-studio/obs/status" });
    }
    expect(cli.calls).toHaveLength(1);
    t = 5001;
    await app.inject({ method: "GET", url: "/api/plugins/obs-studio/obs/status" });
    expect(cli.calls).toHaveLength(2);
  });

  it("dispose closes stdin first; a child ignoring EOF is killed only after the grace period", async () => {
    const { app, children, bridges } = await mk({ disposeGraceMs: 120 });
    await app.inject({ method: "GET", url: "/api/plugins/obs-studio/obs/screenshot" });
    const c = children[0] as FakeChild;
    c.stdin.removeAllListeners("finish");
    c.stdin.on("finish", () => {
      c.stdinEnded = true;
    });
    const t0 = Date.now();
    const done = bridges.dispose("obs");
    await new Promise((r) => setTimeout(r, 40));
    expect(c.stdinEnded).toBe(true);
    expect(c.killed).toBe(false);
    await done;
    expect(c.killed).toBe(true);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(110);
  });
});

describe("review follow-ups (non-blocking findings of round 1)", () => {
  it("a failed state read is not cached for the window", async () => {
    const { createStateReader } = await import("../service-state.js");
    let calls = 0;
    const reader = createStateReader({
      async run() {
        calls++;
        if (calls === 1) throw new Error("spawn failed");
        return { code: 0, stdout: JSON.stringify({ ok: true, data: { state: "healthy" } }), stderr: "" };
      },
    });
    await expect(reader.read("obs")).rejects.toThrow("spawn failed");
    expect((await reader.read("obs")).state).toBe("healthy");
    expect(calls).toBe(2);
  });

  it("an endpoint change reopens the bridge", async () => {
    const { bridges, children } = await mk();
    await bridges.request("obs", "ws://127.0.0.1:4455", "status");
    await bridges.request("obs", "ws://127.0.0.1:4456", "status");
    expect(children).toHaveLength(2);
    await new Promise((r) => setTimeout(r, 30));
    expect(children[0].stdinEnded).toBe(true);
    expect(children[1].argv.at(-1)).toBe("ws://127.0.0.1:4456");
  });
});
