/**
 * Shot-book JSON sidecars: `film.json`, `shots/shot_<id>.json`, `timeline.json`.
 *
 * A package is sidecar-enabled iff `film.json` exists in its base dir. Loading
 * never throws on bad content — every defect becomes a scoped problem so each
 * consumer (inspect / export / mux) fails only on the scopes it reads.
 * Timeline bounds mirror pi-video-gen 0.1.18's timeline validator.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { resolvePackage } from "./package.js";

export type SidecarScope = "film" | "shot" | "timeline" | "audio";

export interface SidecarProblem {
  scope: SidecarScope;
  message: string;
}

export interface FilmCharacter {
  id: string;
  description: string;
}

export interface FilmSidecar {
  style: string;
  title?: string;
  consistency?: string;
  negative?: string;
  aspectRatio?: string;
  characters?: FilmCharacter[];
}

export interface ShotPrompt {
  visuals: string;
  action: string;
  scene?: string;
  effects?: string;
  audio?: string;
  visibleCharacters?: string[];
}

export interface ShotSidecar {
  prompt: ShotPrompt;
  durationSec: number;
}

export type ShotSidecarState = "ok" | "missing" | "invalid";

export const TRANSITION_STYLES = [
  "fade",
  "fadeblack",
  "fadewhite",
  "wipeleft",
  "wiperight",
  "slideup",
  "slidedown",
  "circlecrop",
  "dissolve",
] as const;
export const OVERLAY_POSITIONS = ["bottom-left", "bottom-center", "top-left", "center"] as const;
export const OUTPUT_CODECS = ["mpeg4", "h264"] as const;

export interface TimelineOverlay {
  title?: string;
  subtitle?: string;
  position?: string;
}

export interface TimelineTransition {
  style: string;
  durationSec: number;
}

export interface TimelineSegment {
  shot?: string;
  /** Absolute, containment-checked path (image segments). */
  image?: string;
  trimStartSec?: number;
  durationSec?: number;
  ambientVolume?: number;
  transitionTo?: TimelineTransition;
  overlay?: TimelineOverlay;
  /** Effective duration (seconds) when computable. */
  effectiveSec?: number;
}

export interface TimelineOutput {
  resolution?: string;
  fps?: number;
  codec?: string;
}

export interface TimelineSidecar {
  segments: TimelineSegment[];
  output?: TimelineOutput;
  /** Paths are absolute and containment-checked; `undefined` when absent or invalid. */
  voiceover?: { path: string; volume: number; offsetSec: number };
  music?: { path: string; volume: number };
  captions?: { path: string };
}

export interface Sidecars {
  enabled: boolean;
  baseDir: string;
  shotsDir: string;
  /** Markdown shot names in package order. */
  shotNames: string[];
  film: FilmSidecar | null;
  shots: Map<string, ShotSidecar>;
  shotState: Map<string, ShotSidecarState>;
  timeline: TimelineSidecar | null;
  problems: SidecarProblem[];
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const inRange = (v: unknown, min: number, max: number): v is number => isNum(v) && v >= min && v <= max;

function readJson(file: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch {
    return { ok: false };
  }
}

function isInside(root: string, p: string): boolean {
  const rel = path.relative(root, p);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Resolve a sidecar-declared path relative to `baseDir`: must be an existing,
 * non-symlink regular file whose real path stays inside the real base dir.
 */
export function containedFile(baseDir: string, rel: unknown): { path: string } | { error: string } {
  if (!nonEmpty(rel)) return { error: "path is required" };
  if (path.isAbsolute(rel)) return { error: "path escapes package" };
  const abs = path.resolve(baseDir, rel);
  if (!isInside(baseDir, abs)) return { error: "path escapes package" };
  let st: fs.Stats;
  try {
    st = fs.lstatSync(abs);
  } catch {
    return { error: "file not found" };
  }
  if (st.isSymbolicLink()) return { error: "path is a symlink" };
  const real = fs.realpathSync(abs);
  if (!isInside(fs.realpathSync(baseDir), real)) return { error: "path escapes package" };
  if (!st.isFile()) return { error: "not a regular file" };
  return { path: real };
}

type Add = (message: string) => void;

const FILM_STRINGS = ["title", "consistency", "negative", "aspectRatio"] as const;
const PROMPT_OPTIONAL = ["scene", "effects", "audio"] as const;

/** Report every present-but-empty optional string field. */
function checkOptionalStrings(o: Obj, keys: readonly string[], add: Add, prefix = ""): void {
  for (const k of keys) if (o[k] !== undefined && !nonEmpty(o[k])) add(`${prefix}${k} must be a non-empty string`);
}

/** Copy the non-empty string fields named by `keys`. */
function pickStrings(o: Obj, keys: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) if (nonEmpty(o[k])) out[k] = o[k];
  return out;
}

function validateCharacters(raw: unknown, add: Add): FilmCharacter[] {
  if (!Array.isArray(raw)) {
    add("characters must be an array");
    return [];
  }
  const seen = new Set<string>();
  const characters: FilmCharacter[] = [];
  raw.forEach((c, i) => {
    if (!isObj(c) || !nonEmpty(c.id) || !nonEmpty(c.description)) {
      add(`characters[${i}] needs non-empty id and description`);
      return;
    }
    if (seen.has(c.id)) add(`duplicate character id ${c.id}`);
    seen.add(c.id);
    characters.push({ id: c.id, description: c.description });
  });
  return characters;
}

function validateFilm(raw: unknown, problems: SidecarProblem[]): FilmSidecar | null {
  const add: Add = (message) => problems.push({ scope: "film", message: `film.json: ${message}` });
  if (!isObj(raw)) {
    add("must be a JSON object");
    return null;
  }
  if (!nonEmpty(raw.style)) add("style is required");
  checkOptionalStrings(raw, FILM_STRINGS, add);
  const film: FilmSidecar = { style: nonEmpty(raw.style) ? raw.style : "", ...pickStrings(raw, FILM_STRINGS) };
  if (raw.characters !== undefined) film.characters = validateCharacters(raw.characters, add);
  return film;
}

function validatePrompt(p: unknown, charIds: Set<string>, add: Add): p is Obj {
  if (!isObj(p)) {
    add("prompt is required");
    return false;
  }
  for (const k of ["visuals", "action"] as const) if (!nonEmpty(p[k])) add(`prompt.${k} is required`);
  checkOptionalStrings(p, PROMPT_OPTIONAL, add, "prompt.");
  const vc = p.visibleCharacters;
  if (vc === undefined) return true;
  if (!Array.isArray(vc) || !vc.every((c) => typeof c === "string")) {
    add("prompt.visibleCharacters must be a string array");
    return true;
  }
  for (const id of vc) if (!charIds.has(id)) add(`unknown visibleCharacters id ${id}`);
  return true;
}

function validateShot(name: string, raw: unknown, charIds: Set<string>, problems: SidecarProblem[]): ShotSidecar | null {
  const before = problems.length;
  const add: Add = (message) => problems.push({ scope: "shot", message: `${name}: ${message}` });
  if (!isObj(raw)) {
    add("sidecar must be a JSON object");
    return null;
  }
  const p = raw.prompt;
  const promptOk = validatePrompt(p, charIds, add);
  if (!inRange(raw.durationSec, 1, 300)) add("durationSec must be a number from 1 to 300");
  if (problems.length > before || !promptOk || !isObj(p)) return null;
  const prompt: ShotPrompt = {
    visuals: p.visuals as string,
    action: p.action as string,
    ...pickStrings(p, PROMPT_OPTIONAL),
  };
  if (Array.isArray(p.visibleCharacters)) prompt.visibleCharacters = [...(p.visibleCharacters as string[])];
  return { prompt, durationSec: raw.durationSec as number };
}

const EPS = 1e-9;

function isResolution(v: unknown): boolean {
  const m = typeof v === "string" ? v.match(/^(\d{3,4})x(\d{3,4})$/) : null;
  return m !== null && [m[1], m[2]].every((d) => Number(d) % 2 === 0 && Number(d) <= 4096);
}

const OUTPUT_CHECKS: Record<string, [(v: unknown) => boolean, string]> = {
  resolution: [isResolution, "output.resolution must be <W>x<H>, even components of 3-4 digits, at most 4096"],
  fps: [(v) => Number.isInteger(v) && inRange(v, 1, 120), "output.fps must be an integer from 1 to 120"],
  codec: [(v) => (OUTPUT_CODECS as readonly unknown[]).includes(v), `output.codec must be one of ${OUTPUT_CODECS.join(", ")}`],
};

function validateOutput(raw: unknown, add: Add): TimelineOutput | undefined {
  if (raw === undefined) return undefined;
  if (!isObj(raw)) {
    add("output must be an object");
    return undefined;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    const check = OUTPUT_CHECKS[k];
    if (!check) add(`output.${k} is not allowed (allowed: resolution, fps, codec)`);
    else if (check[0](v)) out[k] = v;
    else add(check[1]);
  }
  return out as TimelineOutput;
}

// ── timeline audio ───────────────────────────────────────────────────────

function audioFile(baseDir: string, field: string, rel: unknown, add: Add): string | undefined {
  const r = containedFile(baseDir, rel);
  if ("error" in r) {
    add(`${field}: ${r.error}`);
    return undefined;
  }
  return r.path;
}

function validateVoiceover(v: unknown, baseDir: string, add: Add): TimelineSidecar["voiceover"] {
  if (!isObj(v)) {
    add("voiceover must be an object");
    return undefined;
  }
  const volume = v.volume ?? 1;
  const offsetSec = v.offsetSec ?? 0;
  const volOk = inRange(volume, 0, 2);
  const offOk = isNum(offsetSec) && offsetSec >= 0;
  if (!volOk) add("voiceover.volume must be from 0 to 2");
  if (!offOk) add("voiceover.offsetSec must be >= 0");
  const p = audioFile(baseDir, "voiceover.path", v.path, add);
  return volOk && offOk && p ? { path: p, volume: volume as number, offsetSec: offsetSec as number } : undefined;
}

function validateMusic(m: unknown, baseDir: string, add: Add): TimelineSidecar["music"] {
  if (!isObj(m)) {
    add("music must be an object");
    return undefined;
  }
  const volume = m.volume ?? 0.3;
  const volOk = inRange(volume, 0, 2);
  if (!volOk) add("music.volume must be from 0 to 2");
  const p = audioFile(baseDir, "music.path", m.path, add);
  return volOk && p ? { path: p, volume: volume as number } : undefined;
}

function validateCaptions(c: unknown, baseDir: string, add: Add): TimelineSidecar["captions"] {
  if (!isObj(c)) {
    add("captions must be an object");
    return undefined;
  }
  if (typeof c.path === "string" && !/\.srt$/i.test(c.path)) {
    add("captions.path must be an .srt file");
    return undefined;
  }
  const p = audioFile(baseDir, "captions.path", c.path, add);
  return p ? { path: p } : undefined;
}

// ── timeline segments ────────────────────────────────────────────────────

interface SegCtx {
  baseDir: string;
  shotNames: Set<string>;
  shots: Map<string, ShotSidecar>;
}

/** Resolve the segment source; returns the shot's sidecar duration (if known) or null on a fatal problem. */
function segmentSource(s: Obj, seg: TimelineSegment, ctx: SegCtx, bad: Add): { shotDur?: number } | null {
  if ((s.shot !== undefined) === (s.image !== undefined)) {
    bad("needs exactly one of shot or image");
    return null;
  }
  if (s.shot !== undefined) {
    if (typeof s.shot !== "string" || !ctx.shotNames.has(s.shot)) {
      bad(`unknown shot ${String(s.shot)}`);
      return null;
    }
    seg.shot = s.shot;
    return { shotDur: ctx.shots.get(s.shot)?.durationSec };
  }
  if (typeof s.image !== "string" || !/\.(png|jpe?g|webp)$/i.test(s.image)) bad("image must be a png/jpg/jpeg/webp path");
  else {
    const r = containedFile(ctx.baseDir, s.image);
    if ("error" in r) bad(`image: ${r.error}`);
    else seg.image = r.path;
  }
  if (s.durationSec === undefined) bad("image segment requires durationSec");
  return {};
}

function segmentTrim(s: Obj, seg: TimelineSegment, shotDur: number | undefined, bad: Add): void {
  if (s.trimStartSec === undefined) return;
  if (!seg.shot) bad("trimStartSec is only allowed on shot segments");
  else if (!isNum(s.trimStartSec) || s.trimStartSec < 0) bad("trimStartSec must be >= 0");
  else if (shotDur !== undefined && s.trimStartSec >= shotDur) bad(`trimStartSec must be less than the shot's ${shotDur} s`);
  else seg.trimStartSec = s.trimStartSec;
}

function segmentTiming(s: Obj, seg: TimelineSegment, shotDur: number | undefined, bad: Add): void {
  segmentTrim(s, seg, shotDur, bad);
  if (s.durationSec !== undefined) {
    if (inRange(s.durationSec, 0.5, 300)) seg.durationSec = s.durationSec;
    else bad("durationSec must be from 0.5 to 300");
  }
  if (s.ambientVolume !== undefined) {
    if (!seg.shot) bad("ambientVolume is only allowed on shot segments");
    else if (inRange(s.ambientVolume, 0, 2)) seg.ambientVolume = s.ambientVolume;
    else bad("ambientVolume must be from 0 to 2");
  }
  segmentEffective(s, seg, shotDur, bad);
}

/** Effective duration = `durationSec`, else shot duration minus trim; must fit the shot. */
function segmentEffective(s: Obj, seg: TimelineSegment, shotDur: number | undefined, bad: Add): void {
  if (seg.durationSec !== undefined) seg.effectiveSec = seg.durationSec;
  else if (seg.shot && shotDur !== undefined && s.durationSec === undefined) seg.effectiveSec = shotDur - (seg.trimStartSec ?? 0);
  if (!seg.shot || shotDur === undefined || seg.effectiveSec === undefined) return;
  if (seg.effectiveSec < 0.5 || seg.effectiveSec > 300) bad("effective duration must be from 0.5 to 300");
  else if ((seg.trimStartSec ?? 0) + seg.effectiveSec > shotDur + EPS) bad(`trim plus duration exceeds the shot's ${shotDur} s`);
}

function segmentTransition(t: unknown, seg: TimelineSegment, isLast: boolean, bad: Add): void {
  if (t === undefined) return;
  if (isLast) bad("transitionTo is not allowed on the last segment");
  else if (!isObj(t)) bad("transitionTo must be an object");
  else if (!(TRANSITION_STYLES as readonly unknown[]).includes(t.style)) {
    bad(`transitionTo.style must be one of ${TRANSITION_STYLES.join(", ")}`);
  } else if (!isNum(t.durationSec) || t.durationSec <= 0 || t.durationSec > 3) bad("transitionTo.durationSec must be in (0, 3]");
  else if (seg.effectiveSec !== undefined && t.durationSec >= seg.effectiveSec) {
    bad("transitionTo.durationSec must be shorter than the segment");
  } else seg.transitionTo = { style: t.style as string, durationSec: t.durationSec };
}

function segmentOverlay(o: unknown, seg: TimelineSegment, bad: Add): void {
  if (o === undefined) return;
  if (!isObj(o)) bad("overlay must be an object");
  else if (o.position !== undefined && !(OVERLAY_POSITIONS as readonly unknown[]).includes(o.position)) {
    bad(`overlay.position must be one of ${OVERLAY_POSITIONS.join(", ")}`);
  } else if (!["title", "subtitle"].every((k) => o[k] === undefined || typeof o[k] === "string")) {
    bad("overlay.title and overlay.subtitle must be strings");
  } else {
    seg.overlay = Object.fromEntries(
      ["title", "subtitle", "position"].filter((k) => o[k] !== undefined).map((k) => [k, o[k] as string]),
    );
  }
}

function validateSegment(s: unknown, i: number, isLast: boolean, ctx: SegCtx, add: Add): TimelineSegment | null {
  const bad: Add = (m) => add(`segment ${i + 1}: ${m}`);
  if (!isObj(s)) {
    bad("must be an object");
    return null;
  }
  const seg: TimelineSegment = {};
  const src = segmentSource(s, seg, ctx, bad);
  if (!src) return null;
  segmentTiming(s, seg, src.shotDur, bad);
  segmentTransition(s.transitionTo, seg, isLast, bad);
  segmentOverlay(s.overlay, seg, bad);
  return seg;
}

function validateTimeline(raw: unknown, ctx: SegCtx, problems: SidecarProblem[]): TimelineSidecar | null {
  const add: Add = (message) => problems.push({ scope: "timeline", message: `timeline.json: ${message}` });
  const addAudio: Add = (message) => problems.push({ scope: "audio", message: `timeline.json: ${message}` });
  if (!isObj(raw)) {
    add("must be a JSON object");
    return null;
  }
  const tl: TimelineSidecar = { segments: [] };
  const output = validateOutput(raw.output, add);
  if (output) tl.output = output;
  if (raw.voiceover !== undefined) tl.voiceover = validateVoiceover(raw.voiceover, ctx.baseDir, addAudio);
  if (raw.music !== undefined) tl.music = validateMusic(raw.music, ctx.baseDir, addAudio);
  if (raw.captions !== undefined) tl.captions = validateCaptions(raw.captions, ctx.baseDir, addAudio);
  for (const k of ["voiceover", "music", "captions"] as const) if (tl[k] === undefined) delete tl[k];

  if (!Array.isArray(raw.segments) || raw.segments.length === 0) {
    add("segments must be a non-empty array");
    return tl;
  }
  const n = raw.segments.length;
  raw.segments.forEach((s, i) => {
    const seg = validateSegment(s, i, i === n - 1, ctx, add);
    if (seg) tl.segments.push(seg);
  });
  return tl;
}

// ── loader ───────────────────────────────────────────────────────────────

function loadShotSidecars(result: Sidecars, charIds: Set<string>): void {
  for (const name of result.shotNames) {
    const file = path.join(result.shotsDir, `${name}.json`);
    if (!fs.existsSync(file)) {
      result.shotState.set(name, "missing");
      result.problems.push({ scope: "shot", message: `${name}: sidecar missing` });
      continue;
    }
    const raw = readJson(file);
    if (!raw.ok) result.problems.push({ scope: "shot", message: `${name}: sidecar invalid JSON` });
    const sc = raw.ok ? validateShot(name, raw.value, charIds, result.problems) : null;
    result.shotState.set(name, sc ? "ok" : "invalid");
    if (sc) result.shots.set(name, sc);
  }
  const names = new Set(result.shotNames);
  for (const f of fs.readdirSync(result.shotsDir).filter((f) => /^shot_.*\.json$/.test(f)).sort()) {
    const name = f.slice(0, -5);
    if (!names.has(name)) result.problems.push({ scope: "shot", message: `${name}: sidecar has no matching shot markdown` });
  }
}

function loadTimeline(result: Sidecars): void {
  const tlPath = path.join(result.baseDir, "timeline.json");
  if (!fs.existsSync(tlPath)) return;
  const raw = readJson(tlPath);
  if (!raw.ok) {
    result.problems.push({ scope: "timeline", message: "timeline.json: invalid JSON" });
    return;
  }
  const ctx: SegCtx = { baseDir: result.baseDir, shotNames: new Set(result.shotNames), shots: result.shots };
  result.timeline = validateTimeline(raw.value, ctx, result.problems);
}

/** Load and validate every sidecar of the package at `target`. */
export function loadSidecars(target: string): Sidecars {
  const { shotsDir, baseDir } = resolvePackage(target);
  const shotNames = fs
    .readdirSync(shotsDir)
    .filter((f) => /^shot_.*\.md$/.test(f))
    .sort()
    .map((f) => f.slice(0, -3));
  const result: Sidecars = {
    enabled: false,
    baseDir,
    shotsDir,
    shotNames,
    film: null,
    shots: new Map(),
    shotState: new Map(),
    timeline: null,
    problems: [],
  };
  const filmPath = path.join(baseDir, "film.json");
  if (!fs.existsSync(filmPath)) return result;
  result.enabled = true;
  const filmRaw = readJson(filmPath);
  if (!filmRaw.ok) {
    result.problems.push({ scope: "film", message: "film.json: invalid JSON" });
    return result;
  }
  result.film = validateFilm(filmRaw.value, result.problems);
  loadShotSidecars(result, new Set((result.film?.characters ?? []).map((c) => c.id)));
  loadTimeline(result);
  return result;
}
