/**
 * `pi-voiceid` orchestration core. Wires model resolution -> decode -> profile
 * -> store into the `enroll` / `list` / `analyze` / `label` / `forget`
 * subcommands. I/O that needs the native binding or ffmpeg is injectable so the
 * CLI is testable without real audio; the bin wires the real implementations.
 *
 * See change: add-speaker-id-enrollment.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileAsync } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { getDefaultRegistry } from "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js";
import { type AudioSource, makeEmbedWindow, decodeAudio as realDecodeAudio } from "./audio-decode.js";
import { type Embedder, loadEmbedder as realLoadEmbedder } from "./embedding.js";
import { getDurationSeconds, type Runner } from "./ffmpeg.js";
import { checkMediaDuration, resolveMediaPath } from "./media-resolve.js";
import { resolveModel as realResolveModel } from "./models.js";
import {
  type CenteringChoice,
  type ClusterDecision,
  type ClusterProfile,
  centeredCentroids,
  chooseCentering,
  clusterCoherence,
  clusterDuration,
  decideCluster,
  dominanceCheck,
  driftPairs,
  type EmbedWindow,
  GATE_DEFAULTS,
  type GateOptions,
  mapClusters,
  type PoolSpeaker,
  pickSegments,
  profileClusters,
  recordingMean,
  SEGMENT_DEFAULTS,
  type SegmentOptions,
} from "./speakerid.js";
import {
  type Cue,
  clusterCues,
  hasNamedLabels,
  normalizeLabel,
  parseSrtFile,
  renderSrt,
} from "./srt-parse.js";
import {
  addRecordingContributions,
  type Contribution,
  centre,
  centroid,
  cohortCount,
  cohortMean,
  cosine,
  forgetByName,
  forgetRecording,
  type Library,
  l2,
  loadLibrary,
  MIN_COHORT,
  type ModelMismatch,
  makeContribution,
  mergeVoiceprint,
  modelMismatches,
  recordingId,
  resolveStorePath,
  saveLibrary,
  withStoreLock,
} from "./voiceprint.js";

// ---------------------------------------------------------------- option parse

interface ParsedArgs {
  command: string;
  values: Record<string, string>;
  flags: Set<string>;
}

const VALUE_FLAGS = new Set([
  "name",
  "audio",
  "srt",
  "label",
  "start",
  "end",
  "output",
  "model",
  "store",
  "threads",
  "min-seg",
  "max-segments",
  "max-audio",
  "threshold",
  "margin",
  "min-vote",
  "drift-threshold",
  "recording",
]);
const BOOLEAN_FLAGS = new Set([
  "replace",
  "dry-run",
  "relabel",
  "force-fallback-thresholds",
  "help",
]);

function parseArgs(argv: string[]): ParsedArgs {
  const [command = "help", ...rest] = argv;
  const values: Record<string, string> = {};
  const flags = new Set<string>();
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    const name = (eq === -1 ? arg.slice(2) : arg.slice(2, eq)).trim();
    if (eq !== -1) {
      values[name] = arg.slice(eq + 1);
      continue;
    }
    if (BOOLEAN_FLAGS.has(name)) {
      flags.add(name);
      continue;
    }
    if (VALUE_FLAGS.has(name)) {
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        values[name] = next;
        i++;
      }
    }
  }
  return { command, values, flags };
}

function num(values: Record<string, string>, key: string, fallback: number): number {
  const raw = values[key];
  if (raw === undefined) return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

function segmentOptions(values: Record<string, string>): SegmentOptions {
  return {
    minSeg: num(values, "min-seg", SEGMENT_DEFAULTS.minSeg),
    maxSegments: num(values, "max-segments", SEGMENT_DEFAULTS.maxSegments),
    maxAudio: num(values, "max-audio", SEGMENT_DEFAULTS.maxAudio),
    windowSeconds: SEGMENT_DEFAULTS.windowSeconds,
  };
}

// ---------------------------------------------------------------------- deps

export interface VoiceIdDeps {
  env: NodeJS.ProcessEnv;
  home: string;
  log: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  resolveModel: (explicit?: string) => Promise<{ path: string; source: string }>;
  loadEmbedder: (modelPath: string, threads: number) => Promise<Embedder>;
  decodeAudio: (mediaPath: string) => Promise<AudioSource>;
  getDuration: (mediaPath: string) => Promise<number>;
}

function registryResolver(name: string): string | null {
  try {
    const r = getDefaultRegistry().resolve(name);
    return r.ok && r.path ? r.path : null;
  } catch {
    return null;
  }
}

function defaultDeps(): VoiceIdDeps {
  // Route through the shared wrapper: the repo forbids direct node:child_process
  // use outside platform/exec.ts (see no-direct-child-process.test.ts).
  const run: Runner = async (file, args) => {
    const { stdout, stderr } = await execFileAsync(file, args);
    return { stdout: String(stdout), stderr: String(stderr) };
  };
  return {
    env: process.env,
    home: os.homedir(),
    log: (m) => console.log(m),
    warn: (m) => console.warn(m),
    error: (m) => console.error(m),
    resolveModel: (explicit) => realResolveModel(explicit),
    loadEmbedder: (modelPath, threads) => realLoadEmbedder(modelPath, threads),
    decodeAudio: (mediaPath) => realDecodeAudio(mediaPath, run, registryResolver),
    getDuration: (mediaPath) => getDurationSeconds(mediaPath),
  };
}

// ------------------------------------------------------------------- helpers

function sliceWindows(start: number, end: number, win = 6, minTail = 2): Cue[] {
  const out: Cue[] = [];
  let t = start;
  while (t + minTail < end) {
    out.push({ index: "1", start: t, end: Math.min(t + win, end), text: "" });
    t += win;
  }
  return out.length > 0 ? out : [{ index: "1", start, end, text: "" }];
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Same file by device+inode; falls back to resolved-path equality. */
function isSameFile(a: string, b: string): boolean {
  try {
    const sa = fs.statSync(a);
    const sb = fs.statSync(b);
    return sa.dev === sb.dev && sa.ino === sb.ino;
  } catch {
    return path.resolve(a) === path.resolve(b);
  }
}

function speakersFromProfiles(profiles: ClusterProfile[]): PoolSpeaker[] {
  return profiles.map((p) => ({ key: p.key, duration: p.duration }));
}

/** Cohort speakers for the dominance test: a bound name groups its recordings. */
function speakersFromLibrary(lib: Library): PoolSpeaker[] {
  const byKey = new Map<string, number>();
  for (const c of lib.contributions) {
    const key = c.name ?? `${c.recordingId}#${c.speakerKey}`;
    byKey.set(key, (byKey.get(key) ?? 0) + c.duration);
  }
  return [...byKey.entries()].map(([key, duration]) => ({ key, duration }));
}

/** Center each profile's segments and centroids with `mean`. */
function centeredRefs(lib: Library, mean: Float32Array): Map<string, Float32Array> {
  const refs = new Map<string, Float32Array>();
  for (const [name, vp] of Object.entries(lib.voiceprints)) {
    refs.set(name, centre(vp.vector, mean));
  }
  return refs;
}

function centerSegments(p: ClusterProfile, mean: Float32Array): Float32Array[] {
  return p.vectors.map((v) => {
    const out = new Float32Array(v.length);
    for (let i = 0; i < v.length; i++) out[i] = v[i] - mean[i];
    return l2(out);
  });
}

/** Resolve the configured model and load the embedder. */
async function loadModelEmbedder(p: ParsedArgs, deps: VoiceIdDeps): Promise<Embedder> {
  const model = await deps.resolveModel(p.values.model);
  return deps.loadEmbedder(model.path, num(p.values, "threads", 4));
}

/** Decode `media`, profile every cluster, and close the temp audio. */
async function profileWithEmbedder(
  media: string,
  clusters: Map<string, Cue[]>,
  deps: VoiceIdDeps,
  embedder: Embedder,
  segOpts: SegmentOptions,
): Promise<ClusterProfile[]> {
  const source = await deps.decodeAudio(media);
  try {
    const embed: EmbedWindow = makeEmbedWindow(source, (samples, sr) => embedder.embed(samples, sr));
    return profileClusters(clusters, embed, segOpts);
  } finally {
    source.close();
  }
}

interface Prepared {
  media: string;
  cues: Cue[];
  clusters: Map<string, Cue[]>;
  profiles: ClusterProfile[];
  mean: Float32Array | null;
}

/** Resolve media, decode, and profile every cluster of an SRT. */
async function profileSrt(
  srtPath: string,
  audio: string | undefined,
  deps: VoiceIdDeps,
  embedder: Embedder,
  segOpts: SegmentOptions,
): Promise<Prepared> {
  const cues = parseSrtFile(srtPath);
  const clusters = clusterCues(cues);
  const media = resolveMediaPath(srtPath, audio);
  const duration = await deps.getDuration(media);
  const lastCueEnd = cues.reduce((m, c) => Math.max(m, c.end), 0);
  const check = checkMediaDuration(duration, lastCueEnd);
  if (!check.ok) throw new Error(check.note);
  if (check.note) deps.warn(check.note);
  const profiles = await profileWithEmbedder(media, clusters, deps, embedder, segOpts);
  return { media, cues, clusters, profiles, mean: recordingMean(profiles) };
}

// ------------------------------------------------------------------- commands

interface EnrollTarget {
  media: string;
  clusters: Map<string, Cue[]>;
  targetKey: string;
  otherClusters: boolean;
}

/** Resolve an enroll target (clip or SRT cluster); a returned string is an error. */
async function resolveEnrollTarget(p: ParsedArgs, deps: VoiceIdDeps): Promise<EnrollTarget | string> {
  if (p.values.srt) {
    const cues = parseSrtFile(p.values.srt);
    const all = clusterCues(cues);
    let media: string;
    try {
      media = resolveMediaPath(p.values.srt, p.values.audio);
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
    if (!p.values.label) {
      return { media, clusters: new Map([["1", cues]]), targetKey: "1", otherClusters: false };
    }
    const targetKey = normalizeLabel(p.values.label);
    if (!all.has(targetKey)) {
      return `label '${p.values.label}' not in ${path.basename(p.values.srt)}; available: ${[...all.keys()].join(", ")}`;
    }
    return { media, clusters: all, targetKey, otherClusters: true };
  }
  if (!p.values.audio) return "enroll needs --audio and/or --srt";
  if (!fs.existsSync(p.values.audio)) return `audio file not found: ${p.values.audio}`;
  const end = p.values.end ? Number.parseFloat(p.values.end) : await deps.getDuration(p.values.audio);
  const start = Number.parseFloat(p.values.start ?? "0") || 0;
  return {
    media: p.values.audio,
    clusters: new Map([["1", sliceWindows(start, end)]]),
    targetKey: "1",
    otherClusters: false,
  };
}

/** Contributions for one enrollment: the subject, plus other clusters for the cohort. */
function buildContributions(
  target: ClusterProfile,
  profiles: ClusterProfile[],
  recId: string,
  model: string,
  name: string,
  otherClusters: boolean,
): Contribution[] {
  const out = [makeContribution(recId, target.key, target.vectors, target.duration, model, name)];
  if (!otherClusters) return out;
  for (const pr of profiles) {
    if (pr.key !== target.key) out.push(makeContribution(recId, pr.key, pr.vectors, pr.duration, model));
  }
  return out;
}

async function enroll(p: ParsedArgs, deps: VoiceIdDeps): Promise<number> {
  const name = p.values.name;
  if (!name) {
    deps.error("enroll needs --name");
    return 1;
  }
  const store = resolveStorePath(p.values.store, deps.env, deps.home);
  const segOpts = segmentOptions(p.values);

  const target = await resolveEnrollTarget(p, deps);
  if (typeof target === "string") {
    deps.error(target);
    return 1;
  }

  const embedder = await loadModelEmbedder(p, deps);
  const profiles = await profileWithEmbedder(target.media, target.clusters, deps, embedder, segOpts);
  const enrolled = profiles.find((pr) => pr.key === target.targetKey);
  if (!enrolled) {
    deps.error("no usable audio for enrollment");
    return 1;
  }

  const recId = recordingId(target.media);
  const contributions = buildContributions(
    enrolled,
    profiles,
    recId,
    embedder.modelName,
    name,
    target.otherClusters,
  );
  const vec = centroid(enrolled.vectors);
  const enrollSeconds = pickSegments(enrolled.cues, segOpts).reduce(
    (s, c) => s + Math.min(c.end - c.start, segOpts.windowSeconds),
    0,
  );
  const coherence = median(enrolled.vectors.map((v) => cosine(v, vec)));
  const replace = p.flags.has("replace");

  try {
    await withStoreLock(store, () => {
      const lib = loadLibrary(store);
      const prev = lib.voiceprints[name];
      if (prev && !replace && (prev.dim !== embedder.dim || prev.model !== embedder.modelName)) {
        throw new Error(
          `voiceprint '${name}' was built with ${prev.dim}-dim '${prev.model}'; ` +
            `re-enroll with --replace to move it to '${embedder.modelName}'`,
        );
      }
      addRecordingContributions(lib, recId, contributions);
      lib.voiceprints[name] = mergeVoiceprint(
        prev,
        vec,
        enrolled.vectors.length,
        path.basename(target.media),
        { dim: embedder.dim, model: embedder.modelName, enrollSeconds, coherence },
        replace,
      );
      saveLibrary(store, lib);
    });
  } catch (err) {
    deps.error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  deps.log(`enrolled '${name}' from ${path.basename(target.media)}`);
  deps.log(
    `  segments=${enrolled.vectors.length} audio=${enrollSeconds.toFixed(1)}s coherence=${coherence.toFixed(3)}`,
  );
  const count = cohortCount(loadLibrary(store));
  deps.log(
    `  cohort now ${count} embeddings (${count >= MIN_COHORT ? "ready" : `need ${MIN_COHORT} to enable centering`})`,
  );
  deps.log(`  saved to ${store}`);
  if (enrollSeconds < 20) deps.warn("  WARNING: <20 s of enrollment audio — matching will be unreliable");
  if (coherence < 0.55) deps.warn("  WARNING: low coherence — this label may cover more than one speaker");
  return 0;
}

function list(p: ParsedArgs, deps: VoiceIdDeps): number {
  const store = resolveStorePath(p.values.store, deps.env, deps.home);
  const lib = loadLibrary(store);
  const names = Object.keys(lib.voiceprints);
  if (names.length === 0) {
    deps.log(`no voiceprints yet in ${store}`);
    return 0;
  }
  const mean = cohortMean(lib);
  deps.log(`${names.length} voiceprint(s) in ${store}`);
  deps.log(
    `cohort: ${cohortCount(lib)} embeddings, centering ${mean ? "ACTIVE" : "inactive"}`,
  );
  deps.log("");
  deps.log(`${"name".padEnd(26)} ${"segs".padStart(5)} ${"sec".padStart(7)} ${"coh".padStart(6)}  model / sources`);
  deps.log("-".repeat(100));
  for (const name of [...names].sort()) {
    const vp = lib.voiceprints[name];
    deps.log(
      `${name.padEnd(26)} ${String(vp.nSegments).padStart(5)} ${vp.enrollSeconds.toFixed(1).padStart(7)} ` +
        `${vp.coherence.toFixed(3).padStart(6)}  ${vp.model.slice(0, 28)} | ${vp.sources.slice(0, 3).join(", ")}`,
    );
  }
  if (names.length > 1) {
    const sorted = [...names].sort();
    const vecs = new Map(sorted.map((n) => [n, centre(lib.voiceprints[n].vector, mean)]));
    deps.log("");
    deps.log("cross-similarity between enrolled voices (lower = better separated):");
    deps.log(`        ${sorted.map((n) => n.slice(0, 8).padStart(8)).join(" ")}`);
    for (const a of sorted) {
      deps.log(
        `${a.slice(0, 7).padEnd(8)}` +
          sorted.map((b) => cosine(vecs.get(a)!, vecs.get(b)!).toFixed(3).padStart(8)).join(" "),
      );
    }
  }
  deps.log("");
  deps.log("cohort recordings:");
  const seen = new Set<string>();
  for (const c of lib.contributions) {
    if (seen.has(c.recordingId)) continue;
    seen.add(c.recordingId);
    const bound = lib.contributions
      .filter((x) => x.recordingId === c.recordingId)
      .map((x) => (x.name ? `${x.speakerKey}=${x.name}` : `${x.speakerKey}=(unnamed)`));
    deps.log(`  ${c.recordingId.slice(0, 12)}: ${bound.join(", ")}`);
  }
  return 0;
}

async function analyze(p: ParsedArgs, deps: VoiceIdDeps): Promise<number> {
  const srtPath = p.values.srt;
  if (!srtPath) {
    deps.error("analyze needs --srt");
    return 1;
  }
  const cues = parseSrtFile(srtPath);
  const clusters = clusterCues(cues);
  if (clusters.size === 0) {
    deps.error("no [speaker] labels found in this SRT");
    return 1;
  }
  deps.log(`${path.basename(srtPath)}: ${cues.length} cues, ${clusters.size} clusters`);

  const embedder = await loadModelEmbedder(p, deps);
  const { profiles, mean } = await profileSrt(
    srtPath,
    p.values.audio,
    deps,
    embedder,
    segmentOptions(p.values),
  );
  {
    if (profiles.length < 2 || mean === null) {
      deps.log("only one cluster — nothing to compare");
      return 0;
    }
    const dominance = dominanceCheck(speakersFromProfiles(profiles));
    if (!dominance.ok) {
      deps.log("cannot compensate: the recording is dominated by one speaker");
      return 0;
    }
    const centroids = centeredCentroids(profiles, mean);
    deps.log("");
    deps.log(`${"cluster".padEnd(14)} ${"cues".padStart(5)} ${"speech".padStart(9)} ${"coherence".padStart(10)}`);
    deps.log("-".repeat(45));
    for (const pr of profiles) {
      deps.log(
        `${pr.key.padEnd(14)} ${String(pr.cues.length).padStart(5)} ${clusterDuration(pr.cues).toFixed(1).padStart(8)}s ` +
          `${clusterCoherence(pr, mean).toFixed(3).padStart(10)}`,
      );
    }
    const threshold = num(p.values, "drift-threshold", GATE_DEFAULTS.driftThreshold);
    const pairs = driftPairs(centroids, threshold);
    deps.log("");
    deps.log(`cluster-to-cluster cosine, channel-centered (>= ${threshold.toFixed(2)} = likely the SAME person):`);
    for (const pair of pairs) {
      deps.log(`  DRIFT: '${pair.a}' and '${pair.b}' look like the same speaker (cos=${pair.score.toFixed(3)})`);
    }
    if (pairs.length === 0) deps.log("  no drift detected — clusters look like distinct speakers");
    deps.log(`note: the ${GATE_DEFAULTS.driftThreshold} default is weakly calibrated (n = 2).`);
    return 0;
  }
}

function buildDecisions(
  profiles: ClusterProfile[],
  lib: Library,
  refs: Map<string, Float32Array>,
  mean: Float32Array,
  choice: CenteringChoice,
  options: GateOptions,
  relabel: boolean,
  log: (msg: string) => void,
): Map<string, ClusterDecision> {
  const decisions = new Map<string, ClusterDecision>();
  log("");
  log(
    `${ "cluster".padEnd(14)} ${"space".padEnd(9)} ${"best".padEnd(22)} ${"cos".padStart(7)} ${"2nd".padStart(7)} ${"margin".padStart(7)} ${"vote".padStart(6)}  decision`,
  );
  log("-".repeat(112));
  for (const pr of profiles) {
    // Under --relabel, a cluster whose existing name is in the library is left
    // untouched; only still-anonymous clusters are decided.
    if (relabel && lib.voiceprints[pr.key]) continue;
    const decision = decideCluster({
      segments: centerSegments(pr, mean),
      refs,
      fallback: choice.fallback,
      options,
    });
    decisions.set(pr.key, decision);
    log(
      `${pr.key.padEnd(14)} ${choice.source.padEnd(9)} ${(decision.name ?? "-").padEnd(22)} ` +
        `${decision.best.toFixed(3).padStart(7)} ${decision.second.toFixed(3).padStart(7)} ` +
        `${decision.margin.toFixed(3).padStart(7)} ${decision.vote.toFixed(2).padStart(6)}  ${decision.reason}`,
    );
  }
  return decisions;
}

interface LabelInput {
  srtPath: string;
  cues: Cue[];
  output: string;
  relabel: boolean;
}

/** Validate a label request; a returned string is an error message. */
function resolveLabelInput(p: ParsedArgs, deps: VoiceIdDeps): LabelInput | string {
  const srtPath = p.values.srt;
  if (!srtPath) return "label needs --srt";
  const cues = parseSrtFile(srtPath);
  const relabel = p.flags.has("relabel");
  if (hasNamedLabels(cues) && !relabel) {
    return "this SRT already carries names or role labels; pass --relabel to proceed";
  }
  if (clusterCues(cues).size === 0) return "no [speaker] labels found in this SRT";
  // Validate the output path (same-file check) BEFORE gate evaluation, so an
  // output collision fails rather than exiting 0 with "nothing renamed".
  const output =
    p.values.output ??
    path.join(path.dirname(srtPath), `${path.basename(srtPath).replace(/\.srt$/i, "")}.named.srt`);
  if (isSameFile(srtPath, output)) return "refusing to overwrite the source SRT";
  return { srtPath, cues, output, relabel };
}

function modelMismatchMessage(mismatch: ModelMismatch, embedder: Embedder): string {
  return (
    `the active model (${embedder.dim}-dim '${embedder.modelName}') differs from stored data` +
    (mismatch.names.length > 0 ? ` — re-enroll: ${mismatch.names.join(", ")}` : "") +
    (mismatch.contributions > 0 ? ` — ${mismatch.contributions} cohort contribution(s)` : "")
  );
}

/** Report merges, then render and write the labeled SRT (or honour --dry-run). */
function emitLabeledSrt(
  input: LabelInput,
  decisions: Map<string, ClusterDecision>,
  p: ParsedArgs,
  deps: VoiceIdDeps,
): number {
  const { mapping, merges } = mapClusters(decisions);
  for (const merge of merges) {
    deps.log(`  re-merged into '${merge.name}': ${merge.keys.join(", ")}  <- drift repaired`);
  }
  if (mapping.size === 0) {
    deps.log("no cluster passed the thresholds — nothing to rewrite");
    return 1;
  }
  if (p.flags.has("dry-run")) {
    deps.log(`[dry-run] would write ${input.output}`);
    return 0;
  }
  const rendered = input.cues.map((c) => {
    if (c.label === undefined) return c;
    const assigned = mapping.get(normalizeLabel(c.label));
    return assigned ? { ...c, label: assigned } : c;
  });
  fs.writeFileSync(input.output, renderSrt(rendered), "utf8");
  deps.log(`wrote ${input.output} (${input.cues.length} cues, source untouched)`);
  return 0;
}

async function label(p: ParsedArgs, deps: VoiceIdDeps): Promise<number> {
  const input = resolveLabelInput(p, deps);
  if (typeof input === "string") {
    deps.error(input);
    return 1;
  }
  const store = resolveStorePath(p.values.store, deps.env, deps.home);
  const lib = loadLibrary(store);
  if (Object.keys(lib.voiceprints).length === 0) {
    deps.error(`no voiceprints enrolled yet (${store}) — run 'enroll' first`);
    return 1;
  }

  const embedder = await loadModelEmbedder(p, deps);
  // Check the model before decoding: a mismatch means the run fails regardless,
  // and decoding is the expensive step.
  const mismatch = modelMismatches(lib, embedder.dim, embedder.modelName);
  if (mismatch.names.length > 0 || mismatch.contributions > 0) {
    deps.error(modelMismatchMessage(mismatch, embedder));
    return 1;
  }

  const { profiles, mean: recordingMeanValue } = await profileSrt(
    input.srtPath,
    p.values.audio,
    deps,
    embedder,
    segmentOptions(p.values),
  );

  const choice: CenteringChoice = chooseCentering({
    cohort: { mean: cohortMean(lib), speakers: speakersFromLibrary(lib) },
    recording: { mean: recordingMeanValue, speakers: speakersFromProfiles(profiles) },
  });
  if (choice.mean === null) {
    deps.error(`cannot compensate: ${choice.cannotCompensate} — nothing renamed`);
    return 1;
  }
  if (choice.fallback) {
    deps.log(
      `note: cohort < ${MIN_COHORT} embeddings — centering on this recording's mean ` +
        "(enroll more voices for a stable library-wide reference)",
    );
  }

  const refs = centeredRefs(lib, choice.mean);
  const decisions = buildDecisions(
    profiles,
    lib,
    refs,
    choice.mean,
    choice,
    {
      threshold: num(p.values, "threshold", GATE_DEFAULTS.threshold),
      margin: num(p.values, "margin", GATE_DEFAULTS.margin),
      minVote: num(p.values, "min-vote", GATE_DEFAULTS.minVote),
      minSegments: GATE_DEFAULTS.minSegments,
      forceFallbackThresholds: p.flags.has("force-fallback-thresholds"),
    },
    input.relabel,
    deps.log,
  );
  if (refs.size === 1) {
    deps.log("note: single voiceprint — the margin and vote gates were not evaluated");
  }
  return emitLabeledSrt(input, decisions, p, deps);
}

async function forget(p: ParsedArgs, deps: VoiceIdDeps): Promise<number> {
  const store = resolveStorePath(p.values.store, deps.env, deps.home);
  if (!p.values.name && !p.values.recording) {
    deps.error("forget needs --name or --recording");
    return 1;
  }
  await withStoreLock(store, () => {
    const lib = loadLibrary(store);
    if (p.values.name) forgetByName(lib, p.values.name);
    if (p.values.recording) forgetRecording(lib, p.values.recording);
    saveLibrary(store, lib);
  });
  deps.log(`updated ${store}`);
  return 0;
}

// ------------------------------------------------------------------- dispatch

const HELP = `pi-voiceid — local, offline speaker enrollment for diarized SRT files.

Usage: pi-voiceid <command> [options]

Commands:
  enroll   Build or extend a named voiceprint
  list     Show the voiceprint library
  analyze  Cluster-drift report for one SRT (no enrollment needed)
  label    Rewrite an SRT with enrolled names
  forget   Remove a voiceprint (--name) or a recording's contribution (--recording)

Options:
  --store <path>   Voiceprint library JSON (env PI_VOICEPRINT_STORE)
  --model <path>   Speaker embedding ONNX model
  --threads <n>    Embedding threads (default 4)`;

export async function runVoiceId(argv: string[], deps: VoiceIdDeps = defaultDeps()): Promise<number> {
  const parsed = parseArgs(argv);
  if (parsed.flags.has("help") || parsed.command === "help") {
    deps.log(HELP);
    return 0;
  }
  try {
    switch (parsed.command) {
      case "enroll":
        return await enroll(parsed, deps);
      case "list":
        return list(parsed, deps);
      case "analyze":
        return await analyze(parsed, deps);
      case "label":
        return await label(parsed, deps);
      case "forget":
        return await forget(parsed, deps);
      default:
        deps.error(`unknown command: ${parsed.command}`);
        deps.log(HELP);
        return 1;
    }
  } catch (err) {
    deps.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}
