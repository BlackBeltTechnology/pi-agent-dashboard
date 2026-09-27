import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildMuxArgs, type MuxPlan, type Runner, runMux } from "../mux.js";
import { cleanup, makeProject, validFilm, writeFile, writeTimeline } from "./fixture.js";

afterEach(cleanup);

interface Call {
  cmd: string;
  args: string[];
  opts: { cwd?: string };
}

interface FakeOpts {
  probes?: Record<string, { duration: number; hasAudio?: boolean }>;
  filters?: string;
  encode?: (out: string, call: Call) => { code: number; stderr?: string };
  missing?: string;
}

function fakeProbe(o: FakeOpts, file: string) {
  const p = o.probes?.[path.basename(file)] ?? { duration: /picture/.test(file) ? 10 : 3, hasAudio: true };
  const streams = [{ codec_type: "video" }, ...(p.hasAudio === false ? [] : [{ codec_type: "audio" }])];
  return { code: 0, stdout: JSON.stringify({ format: { duration: String(p.duration) }, streams }), stderr: "" };
}

function fakeEncode(o: FakeOpts, call: Call) {
  const out = call.args.at(-1) as string;
  const res = o.encode?.(out, call) ?? { code: 0 };
  if (res.code === 0) fs.writeFileSync(out, "mp4");
  return { code: res.code, stdout: "", stderr: res.stderr ?? "" };
}

const SUBTITLES_LISTING = " ... subtitles        V->V  Render text subtitles\n";

/** Fake ffmpeg/ffprobe. `probes` maps a file basename → duration/audio. */
function fakeRunner(o: FakeOpts) {
  const calls: Call[] = [];
  const runner: Runner = async (cmd, args, opts) => {
    const call = { cmd, args, opts };
    calls.push(call);
    if (o.missing === cmd) throw Object.assign(new Error(`spawn ${cmd} ENOENT`), { code: "ENOENT" });
    if (cmd === "ffprobe") return fakeProbe(o, args.at(-1) as string);
    if (args.includes("-filters")) return { code: 0, stdout: o.filters ?? SUBTITLES_LISTING, stderr: "" };
    return fakeEncode(o, call);
  };
  return { runner, calls, encodes: () => calls.filter((c) => c.cmd === "ffmpeg" && !c.args.includes("-filters")) };
}

function muxProject(timeline: Record<string, unknown> | null, files: string[] = ["audio/vo.wav", "audio/music.wav", "captions/vo.srt"]) {
  const p = makeProject({ film: validFilm(), shots: { shot_01: {} } });
  for (const f of files) writeFile(path.join(p.base, f), "x");
  if (timeline) writeTimeline(p.base, { segments: [{ shot: "shot_01" }], ...timeline });
  writeFile(path.join(p.project, "picture.mp4"), "mp4");
  return p;
}

const FULL = {
  voiceover: { path: "audio/vo.wav", offsetSec: 1.5, volume: 0.9 },
  music: { path: "audio/music.wav" },
  captions: { path: "captions/vo.srt" },
};

// ── E22 arg builder decision table ────────────────────────────────────────

describe("buildMuxArgs (E22)", () => {
  it("indexes inputs by position even when VO and music share a file", () => {
    const a = buildMuxArgs({
      picture: "/p.mp4",
      pictureHasAudio: false,
      pictureDurationSec: 5,
      voiceover: { path: "/same.wav", volume: 1, offsetSec: 0 },
      music: { path: "/same.wav", volume: 0.3 },
      burn: false,
      output: "/o.mp4",
    });
    const g = a[a.indexOf("-filter_complex") + 1];
    expect(g).toContain("[1:a]adelay=");
    expect(g).toContain("[2:a]volume=0.3");
  });

  const base = (o: Partial<MuxPlan>): MuxPlan => ({
    picture: "/p.mp4",
    pictureHasAudio: true,
    pictureDurationSec: 12.5,
    burn: false,
    output: "/out.mp4",
    ...o,
  });
  const vo = { path: "/vo.wav", volume: 0.9, offsetSec: 1.5 };
  const mu = { path: "/mu.wav", volume: 0.3 };
  const cap = { path: "/c.srt" };

  const inputs = (a: string[]) => a.flatMap((x, i) => (x === "-i" ? [a[i + 1]] : []));
  const maps = (a: string[]) => a.flatMap((x, i) => (x === "-map" ? [a[i + 1]] : []));
  const graph = (a: string[]) => a[a.indexOf("-filter_complex") + 1] ?? "";

  type Combo = { hasAudio: boolean; withVo: boolean; withMu: boolean; captions: "soft" | "burn" | "none" };
  const combos: Combo[] = [true, false].flatMap((hasAudio) =>
    [true, false].flatMap((withVo) =>
      [true, false].flatMap((withMu) =>
        (["soft", "burn", "none"] as const)
          .filter((captions) => withVo || withMu || captions !== "none")
          .map((captions) => ({ hasAudio, withVo, withMu, captions })),
      ),
    ),
  );

  function expectAudio(a: string[], c: Combo, ins: string[]) {
    const g = graph(a);
    if (c.withVo) expect(g).toContain(`[${ins.indexOf("/vo.wav")}:a]adelay=1500:all=1,volume=0.9[avo]`);
    if (c.withMu) expect(g).toContain(`[${ins.indexOf("/mu.wav")}:a]volume=0.3[amu]`);
    if (!c.withVo && !c.withMu) {
      expect(g).not.toContain("amix");
      expect(maps(a)).toContain("0:a?");
      return;
    }
    const n = Number(c.hasAudio) + Number(c.withVo) + Number(c.withMu);
    expect(g).toContain(`amix=inputs=${n}:duration=longest:normalize=0,alimiter,apad[aout]`);
    expect(g.includes("[0:a]volume=1[a0]")).toBe(c.hasAudio);
    expect(maps(a)).toContain("[aout]");
  }

  function expectVideoAndSubs(a: string[], c: Combo, ins: string[]) {
    const burn = c.captions === "burn";
    expect(maps(a)[0]).toBe(burn ? "[vout]" : "0:v");
    expect(a[a.indexOf("-c:v") + 1]).toBe(burn ? "libx264" : "copy");
    if (burn) expect(graph(a)).toContain("[0:v]subtitles=captions.srt[vout]");
    if (c.captions === "soft") {
      expect(maps(a)).toContain(`${ins.indexOf("/c.srt")}:0`);
      expect(a[a.indexOf("-c:s") + 1]).toBe("mov_text");
    } else expect(a).not.toContain("-c:s");
  }

  it.each(combos)("audio=$hasAudio vo=$withVo music=$withMu captions=$captions", (c) => {
    const a = buildMuxArgs(
      base({
        pictureHasAudio: c.hasAudio,
        voiceover: c.withVo ? vo : undefined,
        music: c.withMu ? mu : undefined,
        captions: c.captions === "none" ? undefined : cap,
        burn: c.captions === "burn",
      }),
    );
    const ins = ["/p.mp4", ...(c.withVo ? ["/vo.wav"] : []), ...(c.withMu ? ["/mu.wav"] : []), ...(c.captions === "soft" ? ["/c.srt"] : [])];
    expect(inputs(a)).toEqual(ins);
    expectAudio(a, c, ins);
    expectVideoAndSubs(a, c, ins);
    expect(a.slice(-3)).toEqual(["-t", "12.5", "/out.mp4"]);
  });
});

// ── runMux ────────────────────────────────────────────────────────────────

describe("runMux — burn path safety (E23)", () => {
  it("copies the SRT to captions.srt in a temp cwd; filter never sees the path", async () => {
    const p = muxProject({ captions: { path: "captions/vo,a:b;'c.srt" } }, ["captions/vo,a:b;'c.srt"]);
    fs.writeFileSync(path.join(p.base, "captions", "vo,a:b;'c.srt"), "1\n00:00:01,000 --> 00:00:02,000\nhi\n");
    let seenSrt = "";
    const f = fakeRunner({
      encode: (_out, call) => {
        seenSrt = fs.readFileSync(path.join(call.opts.cwd as string, "captions.srt"), "utf8");
        return { code: 0 };
      },
    });
    await runMux({ target: p.base, picture: "picture.mp4", cwd: p.project, burn: true, runner: f.runner });
    const [enc] = f.encodes();
    expect(enc.opts.cwd).toBeDefined();
    expect(seenSrt).toContain("hi");
    expect(enc.args[enc.args.indexOf("-filter_complex") + 1]).toBe("[0:v]subtitles=captions.srt[vout]");
    const paths = enc.args.filter((x, i) => enc.args[i - 1] === "-i" || i === enc.args.length - 1);
    for (const x of paths) expect(path.isAbsolute(x)).toBe(true);
    expect(fs.existsSync(enc.opts.cwd as string)).toBe(false);
  });
});

describe("runMux — output location and overwrite (E24)", () => {
  it("defaults to video_production/master/master.mp4", async () => {
    const p = muxProject(FULL);
    const r = await runMux({ target: p.base, picture: "picture.mp4", cwd: p.project, runner: fakeRunner({}).runner });
    expect(r.output).toBe(path.join(p.base, "master", "master.mp4"));
    expect(fs.existsSync(r.output)).toBe(true);
  });

  it("--out is relative to the invoking cwd; no mp4 left in temp dirs", async () => {
    const p = muxProject(FULL);
    const f = fakeRunner({});
    const r = await runMux({ target: p.base, picture: "picture.mp4", out: "renders/final.mp4", burn: true, cwd: p.project, runner: f.runner });
    expect(r.output).toBe(path.join(p.project, "renders", "final.mp4"));
    expect(fs.readdirSync(path.join(p.project, "renders"))).toEqual(["final.mp4"]);
    expect(fs.existsSync(f.encodes()[0].opts.cwd as string)).toBe(false);
  });

  it("refuses to overwrite without --force; replaces with --force", async () => {
    const p = muxProject(FULL);
    const out = writeFile(path.join(p.base, "master", "master.mp4"), "old");
    await expect(runMux({ target: p.base, picture: "picture.mp4", cwd: p.project, runner: fakeRunner({}).runner })).rejects.toThrow(
      "output exists — pass --force to overwrite",
    );
    expect(fs.readFileSync(out, "utf8")).toBe("old");
    await runMux({ target: p.base, picture: "picture.mp4", cwd: p.project, force: true, runner: fakeRunner({}).runner });
    expect(fs.readFileSync(out, "utf8")).toBe("mp4");
  });
});

describe("runMux — no-clobber commit", () => {
  it("refuses when the output appears during encoding (no --force)", async () => {
    const p = muxProject(FULL);
    const out = path.join(p.base, "master", "master.mp4");
    const f = fakeRunner({
      encode: () => {
        fs.writeFileSync(out, "racer");
        return { code: 0 };
      },
    });
    await expect(runMux({ target: p.base, picture: "picture.mp4", cwd: p.project, runner: f.runner })).rejects.toThrow(
      "output exists — pass --force to overwrite",
    );
    expect(fs.readFileSync(out, "utf8")).toBe("racer");
    expect(fs.readdirSync(path.dirname(out))).toEqual(["master.mp4"]);
  });
});

describe("runMux — inputs (E25)", () => {
  const mux = (p: { base: string; project: string }, picture: string | null = "picture.mp4") =>
    runMux({ target: p.base, picture: picture ?? undefined, cwd: p.project, runner: fakeRunner({}).runner });

  it("requires timeline.json", async () => {
    await expect(mux(muxProject(null))).rejects.toThrow("timeline.json required for mux");
  });
  it("requires voiceover, music or captions", async () => {
    await expect(mux(muxProject({}))).rejects.toThrow("timeline.json declares no voiceover, music or captions");
  });
  it("names a missing picture", async () => {
    const p = muxProject(FULL);
    await expect(mux(p, "nope.mp4")).rejects.toThrow(path.join(p.project, "nope.mp4"));
    await expect(mux(p, null)).rejects.toThrow("--picture");
  });
  it("proceeds with a warning on a shot-scope problem", async () => {
    const p = muxProject(FULL);
    fs.rmSync(path.join(p.base, "shots", "shot_01.json"));
    writeFile(path.join(p.base, "end.png"), "x");
    writeTimeline(p.base, { segments: [{ image: "end.png", durationSec: 1 }], ...FULL });
    const r = await mux(p);
    expect(r.warnings).toEqual(["[shot] shot_01: sidecar missing"]);
  });
});

describe("runMux — tools (X7)", () => {
  it.each(["ffmpeg", "ffprobe"])("names missing %s and writes nothing", async (tool) => {
    const p = muxProject(FULL);
    await expect(
      runMux({ target: p.base, picture: "picture.mp4", cwd: p.project, runner: fakeRunner({ missing: tool }).runner }),
    ).rejects.toThrow(`${tool} not found`);
    expect(fs.existsSync(path.join(p.base, "master", "master.mp4"))).toBe(false);
  });
});

describe("runMux — VO fit (X8)", () => {
  it.each([
    [1.99, true],
    [2, true],
    [2.01, false],
  ])("offset %s", async (offsetSec, ok) => {
    const p = muxProject({ voiceover: { path: "audio/vo.wav", offsetSec } });
    const f = fakeRunner({ probes: { "picture.mp4": { duration: 10 }, "vo.wav": { duration: 8 } } });
    const run = runMux({ target: p.base, picture: "picture.mp4", cwd: p.project, runner: f.runner });
    if (ok) await expect(run).resolves.toBeDefined();
    else {
      await expect(run).rejects.toThrow(/voiceover \(8 s\).*picture duration \(10 s\)/);
      expect(f.encodes()).toEqual([]);
      expect(fs.existsSync(path.join(p.base, "master"))).toBe(false);
    }
  });
});

describe("runMux — burn capability (X9)", () => {
  it("fails naming the subtitles filter before any encode", async () => {
    const p = muxProject(FULL);
    const f = fakeRunner({ filters: " ... scale  V->V\n" });
    await expect(runMux({ target: p.base, picture: "picture.mp4", cwd: p.project, burn: true, runner: f.runner })).rejects.toThrow(
      "subtitles filter",
    );
    expect(f.encodes()).toEqual([]);
  });
});

describe("runMux — ffmpeg failure (X10)", () => {
  it("removes the partial temp, reports the last 10 stderr lines", async () => {
    const p = muxProject(FULL);
    const lines = Array.from({ length: 25 }, (_, i) => `line ${i + 1}`);
    let temp = "";
    const f = fakeRunner({
      encode: (out) => {
        temp = out;
        fs.writeFileSync(out, "partial");
        return { code: 1, stderr: `${lines.join("\n")}\n` };
      },
    });
    const err = await runMux({ target: p.base, picture: "picture.mp4", cwd: p.project, runner: f.runner }).catch((e) => e as Error);
    expect(err).toBeInstanceOf(Error);
    const tail = (err as Error).message.split("\n").slice(1);
    expect(tail).toEqual(lines.slice(-10));
    expect(fs.existsSync(temp)).toBe(false);
    expect(fs.existsSync(path.join(p.base, "master", "master.mp4"))).toBe(false);
  });
});

describe("runMux — no shell interpolation (X11)", () => {
  it("passes metacharacter paths as literal argv entries", async () => {
    const vo = "audio/$(touch pwned); x.wav";
    const p = muxProject({ voiceover: { path: vo } }, [vo]);
    const f = fakeRunner({});
    await runMux({ target: p.base, picture: "picture.mp4", cwd: p.project, runner: f.runner });
    expect(f.encodes()[0].args).toContain(fs.realpathSync(path.join(p.base, vo)));
    expect(fs.existsSync(path.join(p.project, "pwned"))).toBe(false);
    expect(fs.existsSync("pwned")).toBe(false);
  });
});

// ── E26 opt-in real ffmpeg ────────────────────────────────────────────────

const hasFfmpeg = ["ffmpeg", "ffprobe"].every((t) => spawnSync(t, ["-version"]).status === 0);

describe.skipIf(!hasFfmpeg)("runMux — real ffmpeg (E26)", () => {
  const ff = (args: string[]) => {
    const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
    if (r.status !== 0) throw new Error(String(r.stderr));
  };
  const probeJson = (file: string, extra: string[]) =>
    JSON.parse(spawnSync("ffprobe", ["-v", "error", ...extra, "-of", "json", file], { encoding: "utf8" }).stdout);
  const rms = (file: string, start: number, dur: number) => {
    const r = spawnSync(
      "ffmpeg",
      ["-hide_banner", "-ss", String(start), "-t", String(dur), "-i", file, "-map", "0:a", "-af", "volumedetect", "-f", "null", "-"],
      { encoding: "utf8" },
    );
    return Number(/mean_volume: (-?[\d.]+) dB/.exec(r.stderr)?.[1]);
  };

  it("mixes VO + music + soft captions over a 6 s picture", async () => {
    const p = muxProject(null, []);
    const pic = path.join(p.project, "picture.mp4");
    ff(["-f", "lavfi", "-i", "testsrc=size=320x240:rate=24:duration=6", "-f", "lavfi", "-i", "sine=frequency=200:duration=6", "-filter:a", "volume=0.05", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", pic]);
    fs.mkdirSync(path.join(p.base, "audio"), { recursive: true });
    ff(["-f", "lavfi", "-i", "sine=frequency=800:duration=3", path.join(p.base, "audio", "vo.wav")]);
    ff(["-f", "lavfi", "-i", "sine=frequency=400:duration=10", "-filter:a", "volume=0.01", path.join(p.base, "audio", "music.wav")]);
    writeFile(path.join(p.base, "captions", "vo.srt"), "1\n00:00:02,500 --> 00:00:04,000\nHello\n");
    writeTimeline(p.base, {
      segments: [{ shot: "shot_01" }],
      voiceover: { path: "audio/vo.wav", offsetSec: 2 },
      music: { path: "audio/music.wav", volume: 1 },
      captions: { path: "captions/vo.srt" },
    });
    const r = await runMux({ target: p.base, picture: "picture.mp4", cwd: p.project });
    const info = probeJson(r.output, ["-show_entries", "format=duration:stream=codec_type,codec_name,width,height"]);
    expect(Math.abs(Number(info.format.duration) - 6)).toBeLessThanOrEqual(0.05);
    const v = info.streams.find((s: { codec_type: string }) => s.codec_type === "video");
    expect([v.codec_name, v.width, v.height]).toEqual(["h264", 320, 240]);
    expect(info.streams.filter((s: { codec_type: string }) => s.codec_type === "subtitle")).toHaveLength(1);
    const pkts = probeJson(r.output, ["-select_streams", "s", "-show_packets", "-show_entries", "packet=pts_time,size"]);
    const first = pkts.packets.find((k: { size: string }) => Number(k.size) > 2);
    expect(Number(first.pts_time)).toBeCloseTo(2.5, 1);
    expect(rms(r.output, 2.2, 1.5)).toBeGreaterThan(rms(r.output, 0, 1.8) + 6);
  }, 60_000);
});
