/**
 * `pi-craft verify <file> [assertions…] [--json]` — mechanical post-step checks
 * on artefacts produced by craft apps (or any pipeline step): duration, streams,
 * alpha, loudness/peak, dimensions, page count, visible content. Catches the
 * silently wrong output the 2026-10 spike produced (a 10 s file instead of 5 s).
 *
 * Probing shells out argv-only through `platform/exec` to optional system tools
 * (`ffprobe`/`ffmpeg`) and, for PDFs, to the on-demand provisioned `pdfcraft-cli`.
 * Exit codes: 0 all pass · 1 a failure or missing file · 2 usage · 3 probe tool missing.
 *
 * See change: add-craft-apps-core (design D5, spec craft-verify).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileAsync } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { exe, type ProvisionReport, provision } from "./provision.js";

export const VERIFY_USAGE = `usage: pi-craft verify <file> <assertion…> [--json]

media:     --duration <s>[±tol]   (default tolerance 0.05 s)   --has-video  --has-audio  --no-audio
           --size <W>x<H>  --fps <n>  --codec <video|audio>=<name>  --alpha
           --loudness <LUFS>[±tol] (integrated, default tolerance 1 LU)
           --max-peak <dBFS>      (sample peak at or below)
           --silent-below <dBFS>  (maximum volume below the threshold)
visual:    --frame-diff <t>:<ref>[@<rt>]<op><pct>   op > (content must differ) or < (must match);
           pct = share of pixels whose luma differs by more than 40/255
documents: --pages <n>  --text-contains <string>   (PDF, via pdfcraft-cli)

exit: 0 all pass · 1 failed/missing file · 2 usage · 3 probe tool missing (ffprobe, ffmpeg, pdfcraft)`;

export type ExecBuf = (
  file: string,
  args: string[],
  opts?: { timeout?: number; maxBuffer?: number; encoding?: "buffer" | "utf8" },
) => Promise<{ stdout: string | Buffer; stderr: string | Buffer }>;

export interface VerifyDeps {
  exec: ExecBuf;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  provisionPdfcraft: () => Promise<ProvisionReport>;
  exists: (file: string) => boolean;
}

/** Probe time budgets: metadata is quick; loudness/peak/frame extraction decode the whole file. */
const PROBE_TIMEOUT_MS = 60_000;
const DECODE_TIMEOUT_MS = 10 * 60_000;
const MAX_FRAME_WIDTH = 1024;

function defaultVerifyDeps(): VerifyDeps {
  return {
    exec: (file, args, opts) => execFileAsync(file, args, { maxBuffer: 64 * 1024 * 1024, timeout: PROBE_TIMEOUT_MS, ...opts }),
    stdout: (t) => process.stdout.write(t),
    stderr: (t) => process.stderr.write(t),
    provisionPdfcraft: () => provision("pdfcraft"),
    exists: (f) => fs.existsSync(f),
  };
}

// ── Parsing ─────────────────────────────────────────────────────────────────

type Assertion =
  | { kind: "duration"; value: number; tol: number; raw: string }
  | { kind: "has-video" }
  | { kind: "has-audio" }
  | { kind: "no-audio" }
  | { kind: "size"; w: number; h: number }
  | { kind: "fps"; value: number }
  | { kind: "codec"; stream: "video" | "audio"; name: string }
  | { kind: "alpha" }
  | { kind: "loudness"; value: number; tol: number; raw: string }
  | { kind: "max-peak"; value: number }
  | { kind: "silent-below"; value: number }
  | { kind: "frame-diff"; t: number; ref: string; rt: number; op: "<" | ">"; pct: number; raw: string }
  | { kind: "pages"; value: number }
  | { kind: "text-contains"; value: string };

const FLAG_ONLY = new Set(["has-video", "has-audio", "no-audio", "alpha"]);
const WITH_VALUE = new Set(["duration", "size", "fps", "codec", "loudness", "max-peak", "silent-below", "frame-diff", "pages", "text-contains"]);

class UsageError extends Error {}

const NUM = "-?\\d+(?:\\.\\d+)?";
const TOL_RE = new RegExp(`^(${NUM})(?:(?:±|\\+-|\\+/-)(\\d+(?:\\.\\d+)?))?$`);

function num(raw: string, flag: string): number {
  if (!new RegExp(`^${NUM}$`).test(raw)) throw new UsageError(`--${flag} needs a number, got "${raw}"`);
  return Number.parseFloat(raw);
}

function withTol(raw: string, flag: string, defaultTol: number): { value: number; tol: number } {
  const m = TOL_RE.exec(raw);
  if (!m) throw new UsageError(`--${flag} needs <number>[±tolerance], got "${raw}"`);
  return { value: Number.parseFloat(m[1]), tol: m[2] === undefined ? defaultTol : Number.parseFloat(m[2]) };
}

function parseAssertion(flag: string, raw: string | undefined): Assertion {
  if (FLAG_ONLY.has(flag)) return { kind: flag } as Assertion;
  const v = raw as string;
  switch (flag) {
    case "duration":
      return { kind: "duration", ...withTol(v, flag, 0.05), raw: v };
    case "loudness":
      return { kind: "loudness", ...withTol(v, flag, 1), raw: v };
    case "size": {
      const m = /^(\d+)[xX×](\d+)$/.exec(v);
      if (!m) throw new UsageError(`--size needs <W>x<H>, got "${v}"`);
      return { kind: "size", w: Number(m[1]), h: Number(m[2]) };
    }
    case "fps":
      return { kind: "fps", value: num(v, flag) };
    case "codec": {
      const m = /^(video|audio)=(.+)$/.exec(v);
      if (!m) throw new UsageError(`--codec needs video=<name> or audio=<name>, got "${v}"`);
      return { kind: "codec", stream: m[1] as "video" | "audio", name: m[2].toLowerCase() };
    }
    case "max-peak":
      return { kind: "max-peak", value: num(v, flag) };
    case "silent-below":
      return { kind: "silent-below", value: num(v, flag) };
    case "pages": {
      if (!/^\d+$/.test(v)) throw new UsageError(`--pages needs a whole number, got "${v}"`);
      return { kind: "pages", value: Number(v) };
    }
    case "text-contains":
      if (v === "") throw new UsageError("--text-contains needs a non-empty string");
      return { kind: "text-contains", value: v };
    case "frame-diff": {
      const m = /^(\d+(?:\.\d+)?):(.+?)(?:@(\d+(?:\.\d+)?))?([<>])(\d+(?:\.\d+)?)$/.exec(v);
      if (!m) throw new UsageError(`--frame-diff needs <t>:<ref>[@<rt>]<op><pct> (op < or >), got "${v}"`);
      return { kind: "frame-diff", t: Number(m[1]), ref: m[2], rt: m[3] === undefined ? Number(m[1]) : Number(m[3]), op: m[4] as "<" | ">", pct: Number(m[5]), raw: v };
    }
    default:
      throw new UsageError(`unknown assertion --${flag}`);
  }
}

export interface ParsedVerify {
  file: string;
  assertions: Assertion[];
  json: boolean;
}

export function parseVerifyArgs(argv: string[]): ParsedVerify | { help: true } {
  let file: string | undefined;
  let json = false;
  const assertions: Assertion[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") return { help: true };
    if (a === "--json") {
      json = true;
      continue;
    }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const flag = eq === -1 ? a.slice(2) : a.slice(2, eq);
      if (!FLAG_ONLY.has(flag) && !WITH_VALUE.has(flag)) throw new UsageError(`unknown assertion --${flag}`);
      if (FLAG_ONLY.has(flag)) {
        if (eq !== -1) throw new UsageError(`--${flag} takes no value`);
        assertions.push(parseAssertion(flag, undefined));
      } else {
        // The value is the next token even when it starts with `-` (e.g. `--max-peak -1`).
        const value = eq === -1 ? argv[++i] : a.slice(eq + 1);
        if (value === undefined) throw new UsageError(`--${flag} needs a value`);
        assertions.push(parseAssertion(flag, value));
      }
      continue;
    }
    if (file !== undefined) throw new UsageError(`unexpected argument "${a}" (one file per call)`);
    file = a;
  }
  if (file === undefined) throw new UsageError("no file given");
  if (assertions.length === 0) throw new UsageError("no assertion given");
  // Absolute paths only reach the probe tools: a name starting with `-` is never an option and a `scheme:` prefix never a protocol.
  for (const a of assertions) if (a.kind === "frame-diff") a.ref = path.resolve(a.ref);
  return { file: path.resolve(file), assertions, json };
}

// ── Probing ─────────────────────────────────────────────────────────────────

class ToolMissing extends Error {
  readonly tool: string;
  constructor(tool: string) {
    super(`required tool not available: ${tool}`);
    this.tool = tool;
  }
}

interface Stream {
  codec_type: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  pix_fmt?: string;
}
interface Probe {
  streams: Stream[];
  format: { duration?: string; format_name?: string };
}

const ALPHA_PIX_FMT = /(yuva|gbrap|rgba|bgra|argb|abgr|ya8|ya16|ayuv|pal8)/;

const fmt = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(Number(n.toFixed(3))));
const tolText = (raw: string): string => raw.replace("+/-", "±").replace("+-", "±");

export interface Result {
  assertion: string;
  expected: string;
  actual: string;
  pass: boolean;
}

export interface VerifyReport {
  file: string;
  ok: boolean;
  assertions: Result[];
  missingTool?: string;
  error?: string;
}

class ProbeTimeout extends Error {}

/** `tool` is a bare name for system tools (ffprobe/ffmpeg: `.exe` on Windows, never through cmd.exe) or an absolute binary path. */
async function run(deps: VerifyDeps, tool: string, args: string[], opts?: Parameters<ExecBuf>[2]) {
  const bare = !path.isAbsolute(tool);
  try {
    return await deps.exec(bare ? exe(tool) : tool, args, opts);
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { killed?: boolean; signal?: string };
    if (err.code === "ENOENT") throw new ToolMissing(tool);
    if (err.killed && err.signal) throw new ProbeTimeout(`${tool} timed out`);
    throw e;
  }
}

function makeProber(deps: VerifyDeps, file: string) {
  let probe: Promise<Probe> | undefined;
  let volume: Promise<number | null> | undefined;
  let loud: Promise<number | null> | undefined;
  return {
    probe: () =>
      (probe ??= run(deps, "ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file]).then(
        (r) => JSON.parse(r.stdout.toString()) as Probe,
      )),
    /** Maximum volume in dB (`null` = digital silence / `-inf`). */
    volume: () =>
      (volume ??= run(deps, "ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-vn", "-af", "volumedetect", "-f", "null", "-"], { timeout: DECODE_TIMEOUT_MS }).then((r) => {
        const m = /max_volume:\s*(-?\d+(?:\.\d+)?|-inf) dB/.exec(r.stderr.toString());
        if (!m || m[1] === "-inf") return null;
        return Number.parseFloat(m[1]);
      })),
    /** Integrated loudness in LUFS (`null` = silence). */
    loudness: () =>
      (loud ??= run(deps, "ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-vn", "-af", "ebur128", "-f", "null", "-"], { timeout: DECODE_TIMEOUT_MS }).then((r) => {
        const all = [...r.stderr.toString().matchAll(/\bI:\s+(-?\d+(?:\.\d+)?|-inf)\s+LUFS/g)];
        const last = all[all.length - 1];
        if (!last || last[1] === "-inf") return null;
        return Number.parseFloat(last[1]);
      })),
  };
}

const MOVIE_FORMAT = /mov|mp4|matroska|avi|webm/;
const isStill = (p: Probe): boolean => /image2|_pipe|png|jpeg|webp|tiff|bmp/.test(p.format.format_name ?? "") && !MOVIE_FORMAT.test(p.format.format_name ?? "");

async function grayFrame(deps: VerifyDeps, file: string, t: number, w: number, h: number, still: boolean): Promise<Buffer> {
  const args = ["-v", "error", ...(still ? [] : ["-ss", String(t)]), "-i", file, "-frames:v", "1", "-vf", `scale=${w}:${h}:flags=bilinear,format=gray`, "-f", "rawvideo", "-"];
  const r = await run(deps, "ffmpeg", args, { encoding: "buffer", timeout: DECODE_TIMEOUT_MS });
  return Buffer.isBuffer(r.stdout) ? r.stdout : Buffer.from(r.stdout);
}

// ── Evaluation ──────────────────────────────────────────────────────────────

const result = (assertion: string, expected: string, actual: string, pass: boolean): Result => ({ assertion, expected, actual, pass });

async function evaluate(a: Assertion, file: string, deps: VerifyDeps, prober: ReturnType<typeof makeProber>, pdfBin: () => Promise<string>): Promise<Result> {
  const hasAudio = async () => (await prober.probe()).streams.some((s) => s.codec_type === "audio");
  switch (a.kind) {
    case "duration": {
      const p = await prober.probe();
      const d = p.format.duration === undefined ? Number.NaN : Number.parseFloat(p.format.duration);
      return result("--duration", tolText(a.raw), Number.isFinite(d) ? fmt(d) : "no duration", Number.isFinite(d) && Math.abs(d - a.value) <= a.tol + 1e-9);
    }
    case "has-video": {
      const n = (await prober.probe()).streams.filter((s) => s.codec_type === "video").length;
      return result("--has-video", "a video stream", n ? `${n} video stream(s)` : "no video stream", n > 0);
    }
    case "has-audio": {
      const n = (await prober.probe()).streams.filter((s) => s.codec_type === "audio").length;
      return result("--has-audio", "an audio stream", n ? `${n} audio stream(s)` : "no audio stream", n > 0);
    }
    case "no-audio": {
      const n = (await prober.probe()).streams.filter((s) => s.codec_type === "audio").length;
      return result("--no-audio", "no audio stream", n ? `${n} audio stream(s)` : "no audio stream", n === 0);
    }
    case "size": {
      const v = (await prober.probe()).streams.find((s) => s.codec_type === "video");
      return result("--size", `${a.w}x${a.h}`, v?.width && v?.height ? `${v.width}x${v.height}` : "no video stream", v?.width === a.w && v?.height === a.h);
    }
    case "fps": {
      const v = (await prober.probe()).streams.find((s) => s.codec_type === "video");
      const [n, d] = (v?.r_frame_rate ?? "0/1").split("/").map(Number);
      const fps = d ? n / d : 0;
      return result("--fps", fmt(a.value), fps ? fmt(fps) : "no frame rate", fps > 0 && Math.abs(fps - a.value) <= 0.01);
    }
    case "codec": {
      const s = (await prober.probe()).streams.find((x) => x.codec_type === a.stream);
      return result("--codec", `${a.stream}=${a.name}`, `${a.stream}=${s?.codec_name ?? "none"}`, s?.codec_name?.toLowerCase() === a.name);
    }
    case "alpha": {
      const v = (await prober.probe()).streams.find((s) => s.codec_type === "video");
      return result("--alpha", "an alpha channel", v?.pix_fmt ?? "no video stream", !!v?.pix_fmt && ALPHA_PIX_FMT.test(v.pix_fmt));
    }
    case "loudness": {
      const expected = `${tolText(a.raw)} LUFS`;
      if (!(await hasAudio())) return result("--loudness", expected, "no audio stream", false);
      const l = await prober.loudness();
      return result("--loudness", expected, l === null ? "silence" : `${fmt(l)} LUFS`, l !== null && Math.abs(l - a.value) <= a.tol + 1e-9);
    }
    case "max-peak": {
      const expected = `<= ${fmt(a.value)} dBFS`;
      if (!(await hasAudio())) return result("--max-peak", expected, "no audio stream", false);
      const v = await prober.volume();
      return result("--max-peak", expected, v === null ? "silence" : `${fmt(v)} dBFS`, v === null || v <= a.value + 1e-9);
    }
    case "silent-below": {
      const expected = `max volume < ${fmt(a.value)} dBFS`;
      if (!(await hasAudio())) return result("--silent-below", expected, "no audio stream (silent)", true);
      const v = await prober.volume();
      return result("--silent-below", expected, v === null ? "silence" : `${fmt(v)} dBFS`, v === null || v < a.value);
    }
    case "frame-diff": {
      const p = await prober.probe();
      const v = p.streams.find((s) => s.codec_type === "video");
      if (!v?.width || !v.height) return result("--frame-diff", `${a.op}${a.pct}%`, "no video stream", false);
      const still = isStill(p);
      // Compare at a bounded resolution: the diff is a pixel *share*, and two full-size raw frames could be hundreds of MB.
      const fw = Math.min(v.width, MAX_FRAME_WIDTH);
      const fh = Math.max(1, Math.round((v.height * fw) / v.width));
      const [x, y] = await Promise.all([grayFrame(deps, file, a.t, fw, fh, still), grayFrame(deps, a.ref, a.rt, fw, fh, still)]);
      const total = fw * fh;
      const expected = `${a.op}${a.pct}% pixels differ (${fmt(a.t)} s vs ${a.ref} @ ${fmt(a.rt)} s)`;
      if (x.length < total || y.length < total) return result("--frame-diff", expected, `no frame at ${fmt(x.length < total ? a.t : a.rt)} s`, false);
      let differing = 0;
      for (let i = 0; i < total; i++) if (Math.abs(x[i] - y[i]) > 40) differing++;
      const pct = (differing / total) * 100;
      return result("--frame-diff", expected, `${pct.toFixed(3)}%`, a.op === ">" ? pct > a.pct : pct < a.pct);
    }
    case "pages": {
      const bin = await pdfBin();
      const info = JSON.parse((await run(deps, bin, ["info", file])).stdout.toString()) as { pages?: number };
      return result("--pages", String(a.value), info.pages === undefined ? "unknown" : String(info.pages), info.pages === a.value);
    }
    case "text-contains": {
      const bin = await pdfBin();
      const text = (await run(deps, bin, ["text", file])).stdout.toString();
      const found = text.includes(a.value);
      return result("--text-contains", JSON.stringify(a.value), found ? "found" : "not found", found);
    }
  }
}

/** Lazy, memoised `pdfcraft-cli` provisioning; any failure is reported as the missing tool `pdfcraft`. */
function makePdfBin(deps: VerifyDeps): () => Promise<string> {
  let bin: Promise<string> | undefined;
  return () =>
    (bin ??= deps.provisionPdfcraft().then(
      (r) => r.binary,
      () => {
        throw new ToolMissing("pdfcraft");
      },
    ));
}

// ── Entry ───────────────────────────────────────────────────────────────────

export async function runVerify(argv: string[], partial: Partial<VerifyDeps> = {}): Promise<number> {
  const deps: VerifyDeps = { ...defaultVerifyDeps(), ...partial };
  let parsed: ReturnType<typeof parseVerifyArgs>;
  try {
    parsed = parseVerifyArgs(argv);
  } catch (e) {
    deps.stderr(`pi-craft verify: ${(e as Error).message}\n${VERIFY_USAGE}\n`);
    return 2;
  }
  if ("help" in parsed) {
    deps.stderr(`${VERIFY_USAGE}\n`);
    return 0;
  }
  const { file, assertions, json } = parsed;
  const report: VerifyReport = { file, ok: false, assertions: [] };
  const finish = (code: number): number => {
    if (json) deps.stdout(`${JSON.stringify(report)}\n`);
    else {
      if (report.error) deps.stdout(`${report.error}\n`);
      for (const r of report.assertions) deps.stdout(`${r.pass ? "PASS" : "FAIL"} ${r.assertion}  expected ${r.expected}  actual ${r.actual}\n`);
      if (report.missingTool) deps.stdout(`MISSING tool: ${report.missingTool}\n`);
      deps.stdout(`${report.ok ? "OK" : "FAILED"}: ${file}\n`);
    }
    return code;
  };

  if (!deps.exists(file)) {
    report.error = `file not found or unreadable: ${file}`;
    return finish(1);
  }

  for (const a of assertions) {
    if (a.kind === "frame-diff" && !deps.exists(a.ref)) {
      report.error = `--frame-diff reference not found or unreadable: ${a.ref}`;
      return finish(1);
    }
  }

  const prober = makeProber(deps, file);
  const pdfBin = makePdfBin(deps);
  try {
    for (const a of assertions) report.assertions.push(await evaluate(a, file, deps, prober, pdfBin));
  } catch (e) {
    if (e instanceof ToolMissing) {
      report.missingTool = e.tool;
      report.error = `${e.message} — install it (ffmpeg provides ffprobe) or set the matching *_BIN override`;
      return finish(3);
    }
    report.error = e instanceof ProbeTimeout ? `probe timed out: ${e.message}` : `probe failed: ${(e as Error).message}`;
    return finish(1);
  }
  report.ok = report.assertions.every((r) => r.pass);
  return finish(report.ok ? 0 : 1);
}
