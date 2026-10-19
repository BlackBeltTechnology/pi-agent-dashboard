/**
 * E12 confirmed install, E13 doctor log fixtures, E14 explicit stop.
 * See change: add-obs-studio-plugin (test-plan E12–E14).
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LOG_TAIL_BYTES } from "../doctor.js";
import { installPortable } from "../install.js";
import { portableRoot } from "../paths.js";
import { baseDeps, recordingCli, runCli, tmpHome, writeServices } from "./cli-harness.js";
import { type FakeObs, startFakeObs } from "./fake-obs.js";
import { obsModel } from "./obs-model.js";

/** Stored (method 0) zip; `symlink` entries get unix mode 0o120777. */
function makeZip(entries: Array<{ name: string; data?: string; symlink?: boolean }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name);
    const data = Buffer.from(e.data ?? "");
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    const local = Buffer.concat([lh, name, data]);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(e.symlink ? (0o120777 << 16) >>> 0 : 0, 38);
    ch.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([ch, name]));
    locals.push(local);
    offset += local.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

describe("E12 install", () => {
  it("no TTY, no --yes → plan printed, exit ≠ 0, 0 installer spawns", async () => {
    const home = tmpHome();
    const spawned: string[] = [];
    const r = await runCli(["install"], baseDeps(home, { exists: () => false, has: (c) => c === "brew", run: async (f) => (spawned.push(f), { code: 1, stdout: "" }) }));
    expect(r.code).not.toBe(0);
    expect(r.err.join("\n")).toMatch(/brew install --cask obs/);
    expect(spawned.filter((f) => f === "brew")).toEqual([]);
  });

  it("darwin without brew → manual obsproject.com instruction, 0 spawns", async () => {
    const home = tmpHome();
    const spawned: string[] = [];
    const r = await runCli(["install", "--yes"], baseDeps(home, { exists: () => false, has: () => false, run: async (f) => (spawned.push(f), { code: 1, stdout: "" }) }));
    expect(r.code).not.toBe(0);
    expect(r.err.join("\n")).toMatch(/obsproject\.com/);
    expect(spawned.filter((f) => f === "brew")).toEqual([]);
  });

  it("confirmed → runs exactly the planned brew command", async () => {
    const home = tmpHome();
    const spawned: string[][] = [];
    const r = await runCli(["install", "--yes"], baseDeps(home, { exists: () => false, has: () => true, run: async (f, a) => (spawned.push([f, ...a]), { code: f === "brew" ? 0 : 1, stdout: "" }) }));
    expect(r.code).toBe(0);
    expect(spawned.filter((x) => x[0] === "brew")).toEqual([["brew", "install", "--cask", "obs"]]);
  });

  it("portable asset without a digest → refused, 0 bytes extracted", async () => {
    const state = tmpHome();
    let downloaded = false;
    await expect(
      installPortable({
        state,
        fetchJson: async () => ({ assets: [{ name: "OBS-Studio-32.2.2-Windows-x64.zip", browser_download_url: "https://x/zip" }] }),
        fetchBytes: async () => {
          downloaded = true;
          return Buffer.alloc(0);
        },
      }),
    ).rejects.toMatchObject({ code: "refused" });
    expect(downloaded).toBe(false);
    expect(fs.existsSync(portableRoot(state))).toBe(false);
  });

  it.each([
    ["../../evil.dll", [{ name: "bin/64bit/obs64.exe", data: "MZ" }, { name: "../../evil.dll", data: "x" }]],
    ["a symlink entry", [{ name: "bin/64bit/obs64.exe", data: "MZ" }, { name: "bin/link", data: "/etc/passwd", symlink: true }]],
  ])("verified zip with %s → refused, nothing written", async (_l, entries) => {
    const state = tmpHome();
    const zip = makeZip(entries);
    await expect(
      installPortable({
        state,
        fetchJson: async () => ({ assets: [{ name: "OBS-Studio-32.2.2-Windows-x64.zip", browser_download_url: "https://x/zip", digest: `sha256:${sha(zip)}` }] }),
        fetchBytes: async () => zip,
      }),
    ).rejects.toMatchObject({ code: "refused" });
    expect(fs.existsSync(portableRoot(state))).toBe(false);
    expect(fs.existsSync(path.join(state, "..", "evil.dll"))).toBe(false);
  });

  it("a clean verified zip extracts + writes portable_mode.txt", async () => {
    const state = tmpHome();
    const zip = makeZip([{ name: "bin/64bit/obs64.exe", data: "MZ" }]);
    const r = await installPortable({
      state,
      fetchJson: async () => ({ assets: [{ name: "OBS-Studio-32.2.2-Windows-x64.zip", browser_download_url: "u", digest: `sha256:${sha(zip)}` }] }),
      fetchBytes: async () => zip,
    });
    expect(r.files).toBe(1);
    expect(fs.existsSync(path.join(portableRoot(state), "portable_mode.txt"))).toBe(true);
  });
});

function doctorSetup(log: string | Buffer, opts: { services?: unknown[]; exists?: (p: string) => boolean } = {}) {
  const home = tmpHome();
  const logs = path.join(home, "Library", "Application Support", "obs-studio", "logs");
  fs.mkdirSync(logs, { recursive: true });
  fs.writeFileSync(path.join(logs, "2026-10-15 18-00-00.txt"), log);
  if (opts.services) writeServices(home, opts.services);
  return runCli(["doctor", "--json"], baseDeps(home, { exists: opts.exists ?? ((p) => p === "/Applications/OBS.app") }));
}

const codes = (r: Awaited<ReturnType<typeof doctorSetup>>) => (r.json().issues as Array<{ code: string }>).map((i) => i.code);

describe("E13 doctor log fixtures", () => {
  it("granted + Invalid target display ID → stale-display-binding, no permission issue", async () => {
    const r = await doctorSetup("[macOS] Permission for screen capture granted.\nmac-screencapture: init_screen_stream: Invalid target display ID: 0\n");
    expect(codes(r)).toContain("stale-display-binding");
    expect(codes(r)).not.toContain("permission-denied");
  });

  it("screen capture denied → permission advice + restart note", async () => {
    const r = await doctorSetup("[macOS] Permission for screen capture denied.\n");
    const issue = (r.json().issues as Array<{ code: string; advice: string }>).find((i) => i.code === "permission-denied");
    expect(issue?.advice).toMatch(/Screen & System Audio Recording.*restart OBS/);
  });

  it("unclean shutdown line reported", async () => {
    expect(codes(await doctorSetup("Crash or unclean shutdown detected\n"))).toContain("unclean-shutdown");
  });

  it("6 MiB log with lines at both ends → both found, truncated:true", async () => {
    const head = "[macOS] Permission for screen capture denied.\n";
    const tail = "Crash or unclean shutdown detected\n";
    const filler = `${"x".repeat(99)}\n`;
    const body = Buffer.from(head + filler.repeat(Math.ceil((6 * 1024 * 1024) / 100)) + tail);
    expect(body.length).toBeGreaterThan(LOG_TAIL_BYTES);
    const r = await doctorSetup(body);
    expect((r.json().log as { truncated: boolean }).truncated).toBe(true);
    expect(codes(r)).toEqual(expect.arrayContaining(["permission-denied", "unclean-shutdown"]));
  });

  it("definition whose node path is missing → start-argv-missing", async () => {
    const r = await doctorSetup("ok\n", {
      services: [{ id: "obs", mode: "attached", lifecycle: { start: { darwin: ["/gone/node", "/abs/pi-obs.mjs", "launch"] } }, origin: "user" }],
      exists: (p) => p === "/Applications/OBS.app" || p === "/abs/pi-obs.mjs",
    });
    const issue = (r.json().issues as Array<{ code: string; message: string; advice: string }>).find((i) => i.code === "start-argv-missing");
    expect(issue?.message).toMatch(/\/gone\/node/);
    expect(issue?.advice).toMatch(/provision/);
  });

  it("runs without any secret in env (service blocked)", async () => {
    const r = await doctorSetup("Crash or unclean shutdown detected\n");
    expect(r.code).toBe(0);
  });
});

describe("E14 stop", () => {
  const local = { id: "obs", mode: "attached", process: { name: "OBS" }, origin: "user" };
  const remote = { id: "obs-studio2", mode: "external", origin: "user" };

  function stopSetup(aliveFor: number) {
    const home = tmpHome();
    writeServices(home, [local, remote]);
    let t = 0;
    const runs: string[][] = [];
    const killed: number[] = [];
    const cli = recordingCli();
    const deps = baseDeps(home, {
      cli,
      now: () => t,
      sleep: async (ms) => {
        t += ms;
      },
      findObs: async () => [4242],
      run: async (f, a) => (runs.push([f, ...a]), { code: 1, stdout: "" }),
      isAlive: (pid) => pid === 4242 && t < aliveFor,
      forceKill: async (pid) => {
        killed.push(pid);
      },
    });
    return { deps, runs, killed, cli };
  }

  it("quit rc 1 while the pid exits in 2 s → success; service status refreshed", async () => {
    const s = stopSetup(2000);
    const r = await runCli(["stop", "--yes", "--json"], s.deps);
    expect(r.code).toBe(0);
    expect(r.json()).toMatchObject({ stopped: true, pid: 4242 });
    expect(r.err.join("\n")).toMatch(/may crash/);
    expect(s.cli.calls.map((c) => c.args)).toContainEqual(["service", "status", "obs"]);
  });

  it("pid alive after 15 s → failure, 0 SIGKILL", async () => {
    const s = stopSetup(Number.POSITIVE_INFINITY);
    const r = await runCli(["stop", "--yes", "--json"], s.deps);
    expect(r.json()).toMatchObject({ stopped: false });
    expect(s.killed).toEqual([]);
  });

  it("--service obs-studio2 (external) → refused, 0 signals", async () => {
    const s = stopSetup(0);
    const r = await runCli(["stop", "--yes", "--service", "obs-studio2", "--json"], s.deps);
    expect(r.code).toBe(1);
    expect(r.json()).toMatchObject({ ok: false, error: { code: "refused" } });
    expect(s.runs).toEqual([]);
  });

  // OBS shows an exit-confirm modal while an output is active; an outside quit
  // is then cancelled (osascript -128) and the modal can sit off-screen.
  describe("stops active outputs before quitting", () => {
    const fakes: FakeObs[] = [];
    afterEach(async () => {
      for (const f of fakes.splice(0)) await f.close();
    });

    async function liveStop(active: Array<"stream" | "record" | "vcam">, stuck: Array<"stream" | "record" | "vcam"> = []) {
      const m = obsModel();
      for (const o of active) m.outputs[o] = true;
      m.stuckOutputs = stuck;
      const f = await startFakeObs({ password: "pw", handlers: m.handlers });
      fakes.push(f);
      const s = stopSetup(2000);
      let typesAtQuit: string[] | null = null;
      const deps = {
        ...s.deps,
        host: { ...s.deps.host, env: { OBS_URL: f.url, OBS_PASSWORD: "pw" } },
        run: async (file: string, a: string[]) => {
          typesAtQuit = f.types();
          s.runs.push([file, ...a]);
          return { code: 1, stdout: "" };
        },
      };
      const r = await runCli(["stop", "--yes", "--json"], deps);
      return { r, m, f, s, typesAtQuit: () => typesAtQuit };
    }

    it("vcam + record + stream active → all stopped over websocket before the quit is sent", async () => {
      const { r, m, typesAtQuit } = await liveStop(["stream", "record", "vcam"]);
      expect(r.code).toBe(0);
      expect(r.json()).toMatchObject({ stopped: true, outputsStopped: ["stream", "record", "vcam"] });
      expect(m.outputs).toEqual({ stream: false, record: false, vcam: false });
      expect(typesAtQuit()).toEqual(expect.arrayContaining(["StopStream", "StopRecord", "StopVirtualCam"]));
    });

    it("nothing active → no Stop* request, quit proceeds", async () => {
      const { r, f } = await liveStop([]);
      expect(r.json()).toMatchObject({ stopped: true, outputsStopped: [] });
      expect(f.types().filter((t) => t.startsWith("Stop"))).toEqual([]);
    });

    it("an output stays active → output-active, quit NOT sent", async () => {
      const { r, s } = await liveStop(["vcam"], ["vcam"]);
      expect(r.code).toBe(1);
      expect(r.json()).toMatchObject({ ok: false, error: { code: "output-active" } });
      expect(s.runs).toEqual([]);
    });
  });

  it("websocket unreachable → warns to stop outputs in OBS, still quits", async () => {
    const s = stopSetup(1000);
    const r = await runCli(["stop", "--yes", "--json"], s.deps);
    expect(r.json()).toMatchObject({ stopped: true });
    expect(r.err.join("\n")).toMatch(/stop (streaming|outputs).*in OBS/i);
    expect(s.runs.length).toBe(1);
  });

  it("linux targets only the matched pid", async () => {
    const s = stopSetup(1000);
    const home = tmpHome();
    writeServices(home, [local]);
    await runCli(["stop", "--yes"], { ...s.deps, host: { home, platform: "linux", env: {} } });
    expect(s.runs).toEqual([["kill", "-TERM", "4242"]]);
  });
});
