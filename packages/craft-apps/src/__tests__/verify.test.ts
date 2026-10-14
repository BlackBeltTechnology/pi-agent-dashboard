import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProvisionReport } from "../provision.js";
import { parseVerifyArgs, runVerify, type VerifyReport } from "../verify.js";
import { cleanupTmp, tmpDir } from "./helpers/fixtures.js";
import { nodeStub } from "./helpers/stubs.js";

const has = (bin: string) => spawnSync(bin, ["-version"], { encoding: "utf8" }).status === 0;
const FFMPEG = has("ffmpeg") && has("ffprobe");

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, deps: { stdout: (t: string) => out.push(t), stderr: (t: string) => err.push(t) } };
}
async function verify(argv: string[], extra: Parameters<typeof runVerify>[1] = {}) {
  const c = capture();
  const code = await runVerify(argv, { ...c.deps, ...extra });
  return { code, text: c.out.join(""), err: c.err.join(""), json: () => JSON.parse(c.out.join("")) as VerifyReport };
}

function ff(args: string[]): void {
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffmpeg ${args.join(" ")} failed: ${r.stderr}`);
}

afterAll(cleanupTmp);

describe("argument parsing (exit 2)", () => {
  it("rejects unknown assertions, malformed values, no assertion and no file", async () => {
    for (const argv of [["f.mp4"], ["--has-video"], ["f.mp4", "--bogus"], ["f.mp4", "--duration", "abc"], ["f.mp4", "--size", "10"], ["f.mp4", "--codec", "x"], ["f.mp4", "--frame-diff", "nope"], ["f.mp4", "--pages", "1.5"], ["f.mp4", "--has-video=1"], ["a", "b", "--has-video"]]) {
      const r = await verify(argv);
      expect(r.code, argv.join(" ")).toBe(2);
      expect(r.err).toContain("usage: pi-craft verify");
    }
  });

  it("--help exits 0; a negative value after a value flag is a value, not an option", async () => {
    expect((await verify(["--help"])).code).toBe(0);
    const p = parseVerifyArgs(["x.wav", "--max-peak", "-1", "--duration", "5±0.1", "--duration=3+-0.5"]);
    expect("assertions" in p && p.assertions).toEqual([
      { kind: "max-peak", value: -1 },
      { kind: "duration", value: 5, tol: 0.1, raw: "5±0.1" },
      { kind: "duration", value: 3, tol: 0.5, raw: "3+-0.5" },
    ]);
  });

  it("frame-diff grammar: default rt, explicit rt, both operators", () => {
    const p = parseVerifyArgs(["a.mp4", "--frame-diff", "3:b.mp4>0.5", "--frame-diff", "0.2:b.mp4@1.5<0.1"]);
    expect("assertions" in p && p.assertions).toMatchObject([
      { kind: "frame-diff", t: 3, ref: path.resolve("b.mp4"), rt: 3, op: ">", pct: 0.5 },
      { kind: "frame-diff", t: 0.2, ref: path.resolve("b.mp4"), rt: 1.5, op: "<", pct: 0.1 },
    ]);
  });
});

describe("missing file / tool", () => {
  it("a missing file fails with exit 1 and says so", async () => {
    const r = await verify(["/nope/missing.mp4", "--has-video"]);
    expect(r.code).toBe(1);
    expect(r.text).toContain("file not found");
  });

  it("a requested assertion whose probe tool is missing exits 3 naming the tool", async () => {
    const dir = tmpDir();
    const f = path.join(dir, "a.wav");
    fs.writeFileSync(f, "x");
    const enoent = async (file: string) => {
      throw Object.assign(new Error(`spawn ${file} ENOENT`), { code: "ENOENT" });
    };
    const r = await verify([f, "--loudness", "-23", "--json"], { exec: enoent as never });
    expect(r.code).toBe(3);
    expect(r.json()).toMatchObject({ ok: false, missingTool: "ffprobe" });
    const r2 = await verify([f, "--has-audio"], { exec: enoent as never });
    expect(r2.code).toBe(3);
    expect(r2.text).toMatch(/MISSING tool: ffprobe/);
  });

  it("loudness with ffprobe present but ffmpeg missing names ffmpeg", async () => {
    const f = path.join(tmpDir(), "a.wav");
    fs.writeFileSync(f, "x");
    const exec = async (file: string) => {
      if (file === "ffprobe") return { stdout: JSON.stringify({ streams: [{ codec_type: "audio" }], format: { duration: "1" } }), stderr: "" };
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    };
    const r = await verify([f, "--loudness", "-23"], { exec: exec as never });
    expect(r.code).toBe(3);
    expect(r.text).toContain("ffmpeg");
  });
});

describe.skipIf(!FFMPEG)("media assertions (generated fixtures)", () => {
  const dir = tmpDir();
  const p = (n: string) => path.join(dir, n);

  beforeAll(() => {
    // 5 s 320x180 h264 + aac sine at -6 dBFS-ish
    ff(["-f", "lavfi", "-i", "testsrc=size=320x180:rate=25:duration=5", "-f", "lavfi", "-i", "sine=frequency=440:duration=5", "-filter:a", "volume=0.5", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", p("good.mp4")]);
    // 10 s wrong duration
    ff(["-f", "lavfi", "-i", "testsrc=size=320x180:rate=25:duration=10", "-f", "lavfi", "-i", "sine=frequency=440:duration=10", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", p("long.mp4")]);
    // video only
    ff(["-f", "lavfi", "-i", "testsrc=size=320x180:rate=25:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", p("silent.mp4")]);
    // ProRes 4444 with alpha: a red box on a transparent background
    ff(["-f", "lavfi", "-i", "color=c=black@0.0:size=320x180:rate=25:duration=2,format=rgba,drawbox=x=20:y=20:w=100:h=50:color=red@1:t=fill", "-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", p("alpha.mov")]);
    // plain frame vs the same frame with an overlay box (~3.6% of the pixels)
    ff(["-f", "lavfi", "-i", "color=c=gray:size=320x180:rate=25:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", p("plain.mp4")]);
    ff(["-f", "lavfi", "-i", "color=c=gray:size=320x180:rate=25:duration=2,drawbox=x=0:y=0:w=60:h=36:color=white@1:t=fill", "-c:v", "libx264", "-pix_fmt", "yuv420p", p("overlay.mp4")]);
    // clipping tone: loud, peak near 0 dBFS
    ff(["-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-filter:a", "volume=0.98", p("loud.wav")]);
    ff(["-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", "2", p("mute.wav")]);
    ff(["-f", "lavfi", "-i", "color=c=red:size=64x48", "-frames:v", "1", p("still.png")]);
    ff(["-f", "lavfi", "-i", "color=c=blue:size=64x48", "-frames:v", "1", p("blue.png")]);
  }, 60_000);

  it("all pass on a 5 s h264+aac file; text and JSON reports agree", async () => {
    const r = await verify([p("good.mp4"), "--duration", "5±0.1", "--has-video", "--has-audio", "--size", "320x180", "--fps", "25", "--codec", "video=h264", "--codec", "audio=aac"]);
    expect(r.code, r.text).toBe(0);
    expect(r.text).toContain("OK:");
    const j = await verify([p("good.mp4"), "--duration", "5±0.1", "--has-video", "--json"]);
    expect(j.json()).toMatchObject({ ok: true, assertions: [{ assertion: "--duration", pass: true }, { assertion: "--has-video", pass: true }] });
  });

  it("a wrong duration is caught showing expected and actual (exit 1)", async () => {
    const r = await verify([p("long.mp4"), "--duration", "5±0.1", "--has-video", "--has-audio"]);
    expect(r.code).toBe(1);
    const dur = (await verify([p("long.mp4"), "--duration", "5±0.1", "--json"])).json().assertions[0];
    expect(dur).toMatchObject({ pass: false, expected: "5±0.1" });
    expect(Number.parseFloat(dur.actual)).toBeCloseTo(10, 1);
    expect(r.text).toMatch(/FAIL --duration.*expected 5±0\.1.*actual 10/);
  });

  it("default duration tolerance is 0.05 s", async () => {
    expect((await verify([p("good.mp4"), "--duration", "5"])).code).toBe(0);
    expect((await verify([p("good.mp4"), "--duration", "5.2"])).code).toBe(1);
  });

  it("--no-audio / --has-audio / wrong size / fps / codec fail correctly", async () => {
    expect((await verify([p("silent.mp4"), "--no-audio", "--has-video"])).code).toBe(0);
    expect((await verify([p("silent.mp4"), "--has-audio"])).code).toBe(1);
    expect((await verify([p("good.mp4"), "--size", "1280x720"])).code).toBe(1);
    expect((await verify([p("good.mp4"), "--fps", "30"])).code).toBe(1);
    expect((await verify([p("good.mp4"), "--codec", "video=hevc"])).code).toBe(1);
  });

  it("--alpha passes on ProRes 4444 with alpha and fails on opaque video", async () => {
    expect((await verify([p("alpha.mov"), "--alpha", "--size", "320x180"])).code).toBe(0);
    expect((await verify([p("good.mp4"), "--alpha"])).code).toBe(1);
  });

  it("--loudness, --max-peak and --silent-below", async () => {
    const loud = (await verify([p("loud.wav"), "--loudness", "-3", "--json"])).json().assertions[0];
    expect(loud.actual).toMatch(/LUFS/);
    const l = Number.parseFloat(loud.actual);
    expect((await verify([p("loud.wav"), "--loudness", `${l}±0.5`])).code).toBe(0);
    expect((await verify([p("loud.wav"), "--loudness", `${l - 10}`])).code).toBe(1);
    expect((await verify([p("loud.wav"), "--max-peak", "0"])).code).toBe(0);
    const peak = await verify([p("loud.wav"), "--max-peak", "-20", "--json"]);
    expect(peak.code).toBe(1);
    expect(peak.json().assertions[0].actual).toMatch(/dBFS/);
    expect((await verify([p("mute.wav"), "--silent-below", "-60"])).code).toBe(0);
    expect((await verify([p("loud.wav"), "--silent-below", "-60"])).code).toBe(1);
  });

  it("--frame-diff: overlay present, overlay absent, and still images", async () => {
    // overlay covers 60x36 of 320x180 = 3.75 % of pixels
    expect((await verify([p("overlay.mp4"), "--frame-diff", `1:${p("plain.mp4")}>3`])).code).toBe(0);
    expect((await verify([p("overlay.mp4"), "--frame-diff", `1:${p("plain.mp4")}>10`])).code).toBe(1);
    expect((await verify([p("plain.mp4"), "--frame-diff", `0.2:${p("plain.mp4")}<0.1`])).code).toBe(0);
    expect((await verify([p("overlay.mp4"), "--frame-diff", `0.2:${p("plain.mp4")}<0.1`])).code).toBe(1);
    expect((await verify([p("still.png"), "--frame-diff", `0:${p("blue.png")}>50`])).code).toBe(0);
    expect((await verify([p("still.png"), "--frame-diff", `0:${p("still.png")}<0.1`])).code).toBe(0);
  });

  it("--frame-diff beyond the end of the file fails with a clear actual", async () => {
    const r = await verify([p("plain.mp4"), "--frame-diff", `50:${p("plain.mp4")}<1`, "--json"]);
    expect(r.code).toBe(1);
    expect(r.json().assertions[0].actual).toMatch(/no frame at/);
  });
});

describe("document assertions (stub pdfcraft-cli)", () => {
  const pdfStub = () =>
    nodeStub(
      `const [cmd] = process.argv.slice(2);
if (cmd === "info") process.stdout.write(JSON.stringify({ pages: 12 }));
else if (cmd === "text") process.stdout.write("Quarterly report\\fSecond page");`,
      "pdfcraft-cli",
    );
  const prov = (binary: string) => async () => ({ app: "pdfcraft", version: "0.8.0", source: "override", asset: null, cacheHit: false, binary, durationMs: 0 }) as ProvisionReport;
  const pdf = () => {
    const f = path.join(tmpDir(), "report.pdf");
    fs.writeFileSync(f, "%PDF-1.4");
    return f;
  };

  it("--pages and --text-contains pass and fail against the provisioned pdfcraft", async () => {
    const f = pdf();
    const deps = { provisionPdfcraft: prov(pdfStub()) };
    expect((await verify([f, "--pages", "12"], deps)).code).toBe(0);
    expect((await verify([f, "--pages", "3"], deps)).code).toBe(1);
    expect((await verify([f, "--text-contains", "Quarterly"], deps)).code).toBe(0);
    expect((await verify([f, "--text-contains", "missing words"], deps)).code).toBe(1);
  });

  it("a pdfcraft provisioning failure is exit 3 naming pdfcraft", async () => {
    const r = await verify([pdf(), "--pages", "1", "--json"], {
      provisionPdfcraft: async () => {
        throw new Error("offline");
      },
    });
    expect(r.code).toBe(3);
    expect(r.json().missingTool).toBe("pdfcraft");
  });
});
