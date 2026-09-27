/**
 * `pi-veo mux` — local ffmpeg final mix of a picture-edit mp4 with the
 * timeline's official voiceover, music and SRT captions (the audio stage
 * pi-video-gen's timeline cannot express).
 *
 * Security: ffmpeg/ffprobe run via `execFile` argv arrays (never a shell).
 * Under `--burn` the SRT is copied into a fresh temp dir as `captions.srt`
 * and ffmpeg runs with that dir as cwd, so no sidecar-derived path enters the
 * filtergraph (`subtitles=captions.srt`); every other path is absolute.
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFile } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { loadSidecars, type SidecarScope } from "./sidecars.js";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Process runner seam. Must reject with `code: "ENOENT"` when the tool is missing. */
export type Runner = (cmd: string, args: string[], opts: { cwd?: string }) => Promise<RunResult>;

export const defaultRunner: Runner = (cmd, args, opts) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd: opts.cwd, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      const e = err as (NodeJS.ErrnoException & { code?: string | number }) | null;
      if (e && e.code === "ENOENT") return reject(e);
      resolve({ code: e ? (typeof e.code === "number" ? e.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });

export interface MuxPlan {
  picture: string;
  pictureHasAudio: boolean;
  pictureDurationSec: number;
  voiceover?: { path: string; volume: number; offsetSec: number };
  music?: { path: string; volume: number };
  /** Soft: absolute SRT path. Burn: ignored (the file is `captions.srt` in cwd). */
  captions?: { path: string };
  burn: boolean;
  /** Absolute temp output path. */
  output: string;
}

/** Audio filtergraph parts: picture ambient + delayed VO + music → amix → limiter → pad. */
function audioGraph(plan: MuxPlan, voIdx: number, muIdx: number): string[] {
  const graph: string[] = [];
  const labels: string[] = [];
  if (plan.pictureHasAudio) {
    graph.push("[0:a]volume=1[a0]");
    labels.push("[a0]");
  }
  if (plan.voiceover) {
    const ms = Math.round(plan.voiceover.offsetSec * 1000);
    graph.push(`[${voIdx}:a]adelay=${ms}:all=1,volume=${plan.voiceover.volume}[avo]`);
    labels.push("[avo]");
  }
  if (plan.music) {
    graph.push(`[${muIdx}:a]volume=${plan.music.volume}[amu]`);
    labels.push("[amu]");
  }
  graph.push(`${labels.join("")}amix=inputs=${labels.length}:duration=longest:normalize=0,alimiter,apad[aout]`);
  return graph;
}

/** Pure ffmpeg argv builder. Input indices / maps are derived from the declared inputs. */
export function buildMuxArgs(plan: MuxPlan): string[] {
  const burn = Boolean(plan.captions && plan.burn);
  const softSubs = plan.captions && !plan.burn ? plan.captions : undefined;
  // input 0 = picture; declared extras follow in fixed order (indices by position, not path equality)
  const extras: [string, string | undefined][] = [
    ["vo", plan.voiceover?.path],
    ["music", plan.music?.path],
    ["subs", softSubs?.path],
  ];
  const present = extras.filter((e): e is [string, string] => e[1] !== undefined);
  const inputs = [plan.picture, ...present.map((e) => e[1])];
  const idx = (key: string) => present.findIndex((e) => e[0] === key) + 1;
  const args = ["-hide_banner", "-y", ...inputs.flatMap((i) => ["-i", i])];

  const mixAudio = Boolean(plan.voiceover || plan.music);
  const graph = [
    ...(burn ? ["[0:v]subtitles=captions.srt[vout]"] : []),
    ...(mixAudio ? audioGraph(plan, idx("vo"), idx("music")) : []),
  ];
  if (graph.length > 0) args.push("-filter_complex", graph.join(";"));

  args.push("-map", burn ? "[vout]" : "0:v");
  args.push(...(mixAudio ? ["-map", "[aout]", "-c:a", "aac", "-b:a", "192k"] : ["-map", "0:a?", "-c:a", "copy"]));
  args.push(...(burn ? ["-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p"] : ["-c:v", "copy"]));
  if (softSubs) args.push("-map", `${idx("subs")}:0`, "-c:s", "mov_text");
  args.push("-t", String(plan.pictureDurationSec), plan.output);
  return args;
}

export interface MuxOptions {
  target: string;
  picture?: string;
  out?: string;
  force?: boolean;
  burn?: boolean;
  /** Base for relative `--picture` / `--out`. Default `process.cwd()`. */
  cwd?: string;
  runner?: Runner;
}

export interface MuxResult {
  output: string;
  warnings: string[];
}

export class MuxError extends Error {}

const fail = (m: string): never => {
  throw new MuxError(m);
};

const BLOCKING: SidecarScope[] = ["timeline", "audio"];

async function run(runner: Runner, tool: string, args: string[], cwd?: string): Promise<RunResult> {
  try {
    return await runner(tool, args, cwd ? { cwd } : {});
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return fail(`${tool} not found — install ffmpeg (provides ${tool}) and put it on PATH`);
    }
    throw e;
  }
}

async function probe(runner: Runner, file: string): Promise<{ duration: number; hasAudio: boolean }> {
  const r = await run(runner, "ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration:stream=codec_type",
    "-of",
    "json",
    file,
  ]);
  if (r.code !== 0) fail(`ffprobe failed on ${file}: ${r.stderr.trim().split("\n").slice(-3).join(" | ")}`);
  let j: { format?: { duration?: string }; streams?: { codec_type?: string }[] };
  try {
    j = JSON.parse(r.stdout);
  } catch {
    return fail(`ffprobe returned unparseable output for ${file}`);
  }
  const duration = Number(j.format?.duration);
  if (!Number.isFinite(duration)) fail(`ffprobe reported no duration for ${file}`);
  return { duration, hasAudio: (j.streams ?? []).some((s) => s.codec_type === "audio") };
}

interface Prepared {
  tl: NonNullable<ReturnType<typeof loadSidecars>["timeline"]>;
  picture: string;
  output: string;
  warnings: string[];
}

/** Package / input / output checks — everything decidable without ffmpeg. */
function prepareMux(opts: MuxOptions): Prepared {
  const cwd = opts.cwd ?? process.cwd();
  const sc = loadSidecars(opts.target);
  if (!sc.enabled) fail("package has no film.json — sidecars required for mux");
  const blocking = sc.problems.filter((p) => BLOCKING.includes(p.scope));
  if (blocking.length > 0) {
    fail(`sidecar problems:\n${blocking.map((p) => `  - [${p.scope}] ${p.message}`).join("\n")}`);
  }
  const tl = sc.timeline ?? fail("timeline.json required for mux");
  if (!tl.voiceover && !tl.music && !tl.captions) fail("timeline.json declares no voiceover, music or captions");
  const picture = path.resolve(cwd, opts.picture ?? fail("--picture <mp4> is required"));
  if (!fs.existsSync(picture) || !fs.statSync(picture).isFile()) fail(`picture not found: ${picture}`);
  const output = opts.out ? path.resolve(cwd, opts.out) : path.join(sc.baseDir, "master", "master.mp4");
  if (fs.existsSync(output) && !opts.force) fail("output exists — pass --force to overwrite");
  return { tl, picture, output, warnings: sc.problems.map((p) => `[${p.scope}] ${p.message}`) };
}

async function assertVoiceoverFits(runner: Runner, tl: Prepared["tl"], pictureSec: number): Promise<void> {
  if (!tl.voiceover) return;
  const vo = await probe(runner, tl.voiceover.path);
  if (tl.voiceover.offsetSec + vo.duration > pictureSec + 1e-6) {
    fail(
      `voiceover (${vo.duration} s) at offset ${tl.voiceover.offsetSec} s exceeds the picture duration ` +
        `(${pictureSec} s) — the official voiceover is never cut`,
    );
  }
}

async function assertBurnable(runner: Runner): Promise<void> {
  const f = await run(runner, "ffmpeg", ["-hide_banner", "-filters"]);
  if (!/ subtitles /.test(f.stdout)) fail("ffmpeg lacks the subtitles filter (libass) — omit --burn for soft captions");
}

/** Atomic no-clobber commit: `link` fails if another process created `output` meanwhile. */
function commitNoClobber(temp: string, output: string): void {
  try {
    fs.linkSync(temp, output);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") fail("output exists — pass --force to overwrite");
    throw e;
  }
  fs.unlinkSync(temp);
}

export async function runMux(opts: MuxOptions): Promise<MuxResult> {
  const runner = opts.runner ?? defaultRunner;
  const { tl, picture, output, warnings } = prepareMux(opts);
  const pic = await probe(runner, picture);
  await assertVoiceoverFits(runner, tl, pic.duration);
  const burn = Boolean(opts.burn && tl.captions);
  if (burn) await assertBurnable(runner);

  fs.mkdirSync(path.dirname(output), { recursive: true });
  const temp = path.join(path.dirname(output), `.${path.basename(output, ".mp4")}.tmp-${randomUUID()}.mp4`);
  const subsDir = burn ? fs.mkdtempSync(path.join(os.tmpdir(), "pi-veo-mux-")) : undefined;
  try {
    if (subsDir && tl.captions) fs.copyFileSync(tl.captions.path, path.join(subsDir, "captions.srt"));
    const args = buildMuxArgs({
      picture,
      pictureHasAudio: pic.hasAudio,
      pictureDurationSec: pic.duration,
      voiceover: tl.voiceover,
      music: tl.music,
      captions: tl.captions,
      burn,
      output: temp,
    });
    const r = await run(runner, "ffmpeg", args, subsDir);
    if (r.code !== 0) {
      const tail = r.stderr.replace(/\n+$/, "").split("\n").slice(-10).join("\n");
      fail(`ffmpeg exited with code ${r.code}:\n${tail}`);
    }
    if (opts.force) fs.renameSync(temp, output);
    else commitNoClobber(temp, output);
  } finally {
    fs.rmSync(temp, { force: true });
    if (subsDir) fs.rmSync(subsDir, { recursive: true, force: true });
  }
  return { output, warnings };
}
