/**
 * `pi-veo export render|timeline` — write job specs for the external
 * `@amaster.ai/pi-video-gen` extension (file-format coupling only, verified
 * against 0.1.18). pi-video-gen has no dry-run and treats a job dir as an
 * immutable spec, so this module preflights everything it can locally and
 * never reuses a job dir. Pure builders (`jobIdFor`, `buildRenderSpec`,
 * `buildTimelineSpec`) are separated from the writers.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { loadShots } from "./package.js";
import type { Shot } from "./shots.js";
import { type FilmSidecar, loadSidecars, type SidecarScope, type Sidecars } from "./sidecars.js";

export const PI_VIDEO_GEN_VERIFIED = "0.1.18";
export const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const MAX_FRAME_BYTES = 20 * 1024 * 1024;

export type ExportMode = "render" | "timeline";

export interface ExportOptions {
  target: string;
  /** Export cwd — must be the pi session cwd. Default `process.cwd()`. */
  cwd?: string;
  /** Job output dir. Default `<cwd>/.video-gen`. */
  out?: string;
  job?: string;
  newJob?: boolean;
  noLastFrame?: boolean;
  /** Inclusive integer range from `video_capabilities`. */
  durations?: [number, number];
  aspect?: string[];
  /** Clip dir for `export timeline`. */
  clips?: string;
  /** Injected clock (tests). */
  now?: Date;
}

export interface ExportResult {
  specPath: string;
  jobDir: string;
  tool: "video_render" | "video_compose";
  cwd: string;
  warnings: string[];
}

export class ExportError extends Error {}

const fail = (message: string): never => {
  throw new ExportError(message);
};

function isInside(root: string, p: string): boolean {
  const rel = path.relative(root, p);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

// ── job id ───────────────────────────────────────────────────────────────

export function packageName(baseDir: string): string {
  return path.basename(baseDir) === "video_production" ? path.basename(path.dirname(baseDir)) : path.basename(baseDir);
}

function stamp(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}-` +
    `${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`
  );
}

/** Default job id `<sanitized-name>-<mode>-<UTC YYYYMMDD-HHMMSS>`, always SAFE_ID. */
export function jobIdFor(name: string, mode: ExportMode, now: Date): string {
  const suffix = `-${mode}-${stamp(now)}`;
  let clean = name.replace(/[^A-Za-z0-9_-]/g, "-").replace(/^[^A-Za-z0-9]+/, "");
  if (clean === "") clean = "package";
  return clean.slice(0, 64 - suffix.length) + suffix;
}

export function assertJobId(id: string): void {
  if (!SAFE_ID.test(id)) fail(`invalid job id "${id}" — must match ${SAFE_ID.source}`);
}

// ── shared preflight ─────────────────────────────────────────────────────

const CONSUMED: Record<ExportMode, SidecarScope[]> = {
  render: ["film", "shot"],
  timeline: ["film", "shot", "timeline"],
};

interface Prepared {
  cwd: string;
  sc: Sidecars;
  warnings: string[];
}

function prepare(opts: ExportOptions, mode: ExportMode): Prepared {
  if (opts.job !== undefined) assertJobId(opts.job);
  const cwd = fs.realpathSync(opts.cwd ?? process.cwd());
  const sc = loadSidecars(opts.target);
  if (!isInside(cwd, fs.realpathSync(sc.baseDir))) {
    fail("package must be inside the working directory (the pi session cwd)");
  }
  if (!sc.enabled) fail("package has no film.json — sidecars required for export");
  const blocking = sc.problems.filter((p) => CONSUMED[mode].includes(p.scope));
  if (blocking.length > 0) {
    fail(`sidecar problems:\n${blocking.map((p) => `  - [${p.scope}] ${p.message}`).join("\n")}`);
  }
  const warnings = sc.problems.map((p) => `[${p.scope}] ${p.message}`);
  if (mode === "timeline" && !sc.timeline) fail("timeline.json required for export timeline");
  return { cwd, sc, warnings };
}

function resolveJobDir(opts: ExportOptions, cwd: string, sc: Sidecars, mode: ExportMode): string {
  const outDir = path.resolve(cwd, opts.out ?? ".video-gen");
  const jobId = opts.job ?? jobIdFor(packageName(sc.baseDir), mode, opts.now ?? new Date());
  const jobDir = path.join(outDir, jobId);
  if (fs.existsSync(jobDir)) fail("job directory exists — exports never reuse a job");
  return jobDir;
}

function writeSpec(jobDir: string, file: string, spec: unknown): string {
  fs.mkdirSync(path.dirname(jobDir), { recursive: true });
  try {
    fs.mkdirSync(jobDir);
  } catch {
    fail("job directory exists — exports never reuse a job");
  }
  const specPath = path.join(jobDir, file);
  try {
    fs.writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`);
  } catch (e) {
    fs.rmSync(jobDir, { recursive: true, force: true });
    throw e;
  }
  return specPath;
}

// ── re-billing guard registry ────────────────────────────────────────────

interface Registry {
  renders: string[];
}

function registryPath(baseDir: string): string {
  return path.join(baseDir, ".pi-veo", "exports.json");
}

/** Read the registry, failing closed on any unreadable / malformed content. */
export function readRegistry(baseDir: string): Registry {
  const file = registryPath(baseDir);
  if (!fs.existsSync(file)) return { renders: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fail(`export registry ${file} is unreadable or not valid JSON — fix or remove it`);
  }
  const r = raw as Partial<Registry> | null;
  const valid = Array.isArray(r?.renders) && r.renders.every((x) => typeof x === "string" && path.isAbsolute(x));
  if (!valid) {
    fail(`export registry ${file} has an unexpected shape (expected { "renders": absolute-path[] }) — fix or remove it`);
  }
  return raw as Registry;
}

function appendRegistry(baseDir: string, reg: Registry, specPath: string): void {
  const file = registryPath(baseDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ renders: [...reg.renders, specPath] }, null, 2)}\n`);
}

// ── frames ───────────────────────────────────────────────────────────────

function imageKind(file: string): boolean {
  const fd = fs.openSync(file, "r");
  try {
    const b = Buffer.alloc(12);
    const n = fs.readSync(fd, b, 0, 12, 0);
    const png = n >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const jpeg = n >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    const webp = n >= 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP";
    return png || jpeg || webp;
  } finally {
    fs.closeSync(fd);
  }
}

/** Preflight a frame; return its path relative to `cwd` (a real path). */
function checkFrame(shot: string, file: string, cwd: string): string {
  const st = fs.lstatSync(file);
  if (st.isSymbolicLink()) fail(`${shot}: frame is a symlink (${file})`);
  const real = fs.realpathSync(file);
  if (!isInside(cwd, real)) fail(`${shot}: frame outside working directory (${file})`);
  if (!st.isFile()) fail(`${shot}: frame is not a regular file (${file})`);
  if (st.size > MAX_FRAME_BYTES) fail(`${shot}: frame larger than 20 MiB (${file})`);
  if (!imageKind(real)) fail(`${shot}: frame is not a PNG, JPEG or WebP image (${file})`);
  return path.relative(cwd, real).split(path.sep).join("/");
}

// ── render ───────────────────────────────────────────────────────────────

export interface RenderSpecShot {
  id: string;
  prompt: Record<string, unknown>;
  durationSec: number;
  firstFramePath: string;
  lastFramePath?: string;
}

export interface RenderSpec {
  title?: string;
  aspectRatio?: string;
  style: string;
  consistency?: string;
  negative?: string;
  characters?: { id: string; description: string }[];
  shots: RenderSpecShot[];
}

function filmFields(film: FilmSidecar): RenderSpec {
  return {
    ...(film.title ? { title: film.title } : {}),
    ...(film.aspectRatio ? { aspectRatio: film.aspectRatio } : {}),
    style: film.style,
    ...(film.consistency ? { consistency: film.consistency } : {}),
    ...(film.negative ? { negative: film.negative } : {}),
    ...(film.characters ? { characters: film.characters.map((c) => ({ ...c })) } : {}),
    shots: [],
  };
}

type RenderOpts = Pick<ExportOptions, "noLastFrame" | "durations" | "aspect">;

interface ShotAcc {
  warnings: string[];
  seamless: string[];
  outOfRange: string[];
}

function renderShot(
  shot: Shot,
  next: Shot | undefined,
  sc: Sidecars,
  frames: Map<string, string>,
  opts: RenderOpts,
  acc: ShotAcc,
): RenderSpecShot {
  const side = sc.shots.get(shot.name) ?? fail(`${shot.name}: sidecar missing`);
  const durationSec = Math.floor(side.durationSec + 0.5);
  if (durationSec !== side.durationSec) {
    acc.warnings.push(`${shot.name}: durationSec ${side.durationSec} rounded to ${durationSec}`);
  }
  const range = opts.durations;
  if (range && (durationSec < range[0] || durationSec > range[1])) acc.outOfRange.push(`${shot.name} (${durationSec})`);
  const out: RenderSpecShot = {
    id: shot.name,
    prompt: { ...side.prompt },
    durationSec,
    firstFramePath: frames.get(shot.name) ?? fail(`${shot.name}: first frame required`),
  };
  if (!shot.seamlessNext) return out;
  acc.seamless.push(shot.name);
  if (opts.noLastFrame) return out;
  if (!next) acc.warnings.push(`${shot.name}: seamless-to-next on the last shot — no lastFramePath emitted`);
  else out.lastFramePath = frames.get(next.name) ?? fail(`${next.name}: first frame required`);
  return out;
}

function droppedFieldWarnings(shots: Shot[], film: FilmSidecar): string[] {
  const w: string[] = [];
  const seeded = shots.filter((s) => s.seed !== null).map((s) => s.name);
  if (seeded.length) w.push(`seeds are not exported (${seeded.join(", ")})`);
  const refs = shots.filter((s) => s.referenceImages.length > 0).map((s) => s.name);
  if (refs.length) w.push(`local reference images are not exported (${refs.join(", ")})`);
  for (const s of shots) {
    if (s.negative && s.negative !== (film.negative ?? "")) {
      w.push(`${s.name}: per-shot negatives are not exported — film.json negative is used`);
    }
    if (film.aspectRatio && s.aspectDeclared && s.aspectRatio !== film.aspectRatio) {
      w.push(`${s.name}: per-shot aspect ratios are not exported (${s.aspectRatio} vs film ${film.aspectRatio})`);
    }
  }
  return w;
}

/**
 * Pure mapping from sidecars + parsed markdown shots to the render spec.
 * `frames` maps shot name → cwd-relative preflighted first-frame path.
 */
export function buildRenderSpec(
  sc: Sidecars,
  shots: Shot[],
  frames: Map<string, string>,
  opts: RenderOpts,
): { spec: RenderSpec; warnings: string[] } {
  const film = sc.film ?? fail("film.json missing");
  const acc: ShotAcc = {
    warnings: ["per-shot resolution is not exported — the active pi-video-gen model's default resolution applies"],
    seamless: [],
    outOfRange: [],
  };
  const spec = filmFields(film);
  shots.forEach((shot, i) => spec.shots.push(renderShot(shot, shots[i + 1], sc, frames, opts, acc)));
  if (opts.noLastFrame && acc.seamless.length > 0) {
    acc.warnings.push(`--no-last-frame: seamless continuity not exported for ${acc.seamless.join(", ")}`);
  }
  if (acc.outOfRange.length > 0) {
    fail(`durations outside --durations ${opts.durations?.join("-")}: ${acc.outOfRange.join(", ")}`);
  }
  if (opts.aspect && film.aspectRatio && !opts.aspect.includes(film.aspectRatio)) {
    fail(`aspect ratio ${film.aspectRatio} not supported by --aspect ${opts.aspect.join(",")}`);
  }
  return { spec, warnings: [...acc.warnings, ...droppedFieldWarnings(shots, film)] };
}

export function exportRender(opts: ExportOptions): ExportResult {
  const { cwd, sc, warnings } = prepare(opts, "render");
  const reg = readRegistry(sc.baseDir);
  const live = reg.renders.filter((p) => fs.existsSync(p));
  if (live.length > 0 && !opts.newJob) {
    fail(
      `a render spec was already exported for this package:\n${live.map((p) => `  - ${p}`).join("\n")}\n` +
        "An interrupted render resumes by calling video_render again on the existing spec — re-exporting " +
        "would re-bill every shot. Pass --new-job only for a genuinely revised film.",
    );
  }
  const { shots } = loadShots(opts.target);
  for (const s of shots) {
    if (!SAFE_ID.test(s.name)) fail(`${s.name}: shot id not accepted by pi-video-gen (must match ${SAFE_ID.source})`);
  }
  const frames = new Map<string, string>();
  for (const s of shots) {
    if (!s.firstFrame) fail(`${s.name}: first frame required`);
    else frames.set(s.name, checkFrame(s.name, s.firstFrame, cwd));
  }
  const built = buildRenderSpec(sc, shots, frames, opts);
  const jobDir = resolveJobDir(opts, cwd, sc, "render");
  // Register before writing: a spec must never exist unregistered (re-billing guard).
  const specPath = path.join(jobDir, "render-input.json");
  appendRegistry(sc.baseDir, reg, specPath);
  writeSpec(jobDir, "render-input.json", built.spec);
  return { specPath, jobDir, tool: "video_render", cwd, warnings: [...warnings, ...built.warnings] };
}

// ── timeline ─────────────────────────────────────────────────────────────

export interface TimelineSpecSegment {
  id: string;
  video?: string;
  image?: string;
  durationSec: number;
  trimStartSec?: number;
  sourceAudio?: { volume: number };
  transitionTo?: { type: "xfade"; style: string; durationSec: number };
  overlay?: { title?: string; subtitle?: string; position?: string };
}

export interface TimelineSpec {
  output?: { resolution?: string; fps?: number; codec?: string };
  segments: TimelineSpecSegment[];
}

/** Pure mapping; `media` maps segment index → absolute preflighted file. */
export function buildTimelineSpec(sc: Sidecars, media: Map<number, string>): TimelineSpec {
  const tl = sc.timeline ?? fail("timeline.json required for export timeline");
  const spec: TimelineSpec = { segments: [] };
  if (tl.output) spec.output = { ...tl.output };
  tl.segments.forEach((s, i) => {
    const id = `seg-${String(i + 1).padStart(2, "0")}`;
    const file = media.get(i) ?? fail(`${id}: media unresolved`);
    const effective = s.effectiveSec ?? fail(`${id}: duration unresolved`);
    const seg: TimelineSpecSegment = s.shot ? { id, video: file, durationSec: effective } : { id, image: file, durationSec: effective };
    if (s.shot) {
      if (s.trimStartSec !== undefined) seg.trimStartSec = s.trimStartSec;
      seg.sourceAudio = { volume: s.ambientVolume ?? 1 };
    }
    if (s.transitionTo) seg.transitionTo = { type: "xfade", ...s.transitionTo };
    if (s.overlay) seg.overlay = { ...s.overlay };
    spec.segments.push(seg);
  });
  return spec;
}

function mediaCheck(label: string, file: string, cwd: string): string {
  if (fs.lstatSync(file).isSymbolicLink()) fail(`${label}: media is a symlink (${file})`);
  const real = fs.realpathSync(file);
  if (!isInside(cwd, real)) fail(`${label}: media outside working directory (${file})`);
  if (!fs.statSync(real).isFile()) fail(`${label}: media is not a regular file (${file})`);
  return real;
}

/** A clip candidate: anything but a directory (symlinks included, so preflight can reject them). */
function exists(p: string): boolean {
  try {
    return !fs.lstatSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function exportTimeline(opts: ExportOptions): ExportResult {
  if (!opts.clips) fail("--clips <dir> is required");
  const { cwd, sc, warnings } = prepare(opts, "timeline");
  const tl = sc.timeline ?? fail("timeline.json required for export timeline");
  const clipsDir = path.resolve(cwd, opts.clips as string);

  const media = new Map<number, string>();
  const missing = new Set<string>();
  const errors: string[] = [];
  tl.segments.forEach((s, i) => {
    const label = `seg-${String(i + 1).padStart(2, "0")}${s.shot ? ` (${s.shot})` : ""}`;
    let file: string | undefined;
    if (s.shot) {
      file = [path.join(clipsDir, `${s.shot}.mp4`), path.join(clipsDir, s.shot, "video.mp4")].find(exists);
      if (!file) {
        missing.add(s.shot);
        return;
      }
    } else file = s.image;
    if (!file) return;
    try {
      media.set(i, mediaCheck(label, file, cwd));
    } catch (e) {
      errors.push((e as Error).message);
    }
  });
  if (missing.size > 0) {
    errors.unshift(`missing clips in ${clipsDir} (<shot>.mp4 or <shot>/video.mp4): ${[...missing].join(", ")}`);
  }
  if (errors.length > 0) fail(errors.join("\n"));

  const spec = buildTimelineSpec(sc, media);
  const jobDir = resolveJobDir(opts, cwd, sc, "timeline");
  const specPath = writeSpec(jobDir, "timeline-input.json", spec);
  return { specPath, jobDir, tool: "video_compose", cwd, warnings };
}

/** Human-readable export report. */
export function formatExportReport(r: ExportResult): string {
  const lines = [
    `Spec     : ${r.specPath}`,
    `Next     : call ${r.tool} with ${r.specPath}`,
    `Cwd used : ${r.cwd} (must be the pi session cwd)`,
    `Note     : the job dir must lie under pi-video-gen's outputDir (default .video-gen) — pass --out if it was configured differently. Verified against pi-video-gen ${PI_VIDEO_GEN_VERIFIED}.`,
  ];
  if (r.warnings.length > 0) {
    lines.push("", `Warnings (${r.warnings.length}):`, ...r.warnings.map((w) => `  ⚠ ${w}`));
  }
  return lines.join("\n");
}
