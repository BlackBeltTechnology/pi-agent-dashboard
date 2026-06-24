/**
 * Orchestrator (stages 1-7). Deterministic planner: harvest -> segment ->
 * extract -> cluster -> promote -> distill -> route. Defaults to dry-run; with
 * --apply it persists the watermark + candidates store and prints the final
 * routing plan as JSON. The actual sink writes (skill_manage / memory / docs +
 * ctx_index, AGENTS.md patch via docs subagent) are performed by the pi agent
 * following the SKILL.md using this plan — that is the haiku-class subagent path.
 */
import { readSession } from "./jsonl-reader.js";
import { buildTrajectory } from "./trajectory.js";
import { segment } from "./segment.js";
import { extractSignals } from "./signals.js";
import {
  loadStore,
  saveStore,
  mergeIntoStore,
  promote,
  candidatesPath,
  DEFAULT_RECURRENCE,
  type HeldCluster,
} from "./cluster.js";
import { distill } from "./distill.js";
import { buildRoutePlan, summarizePlan, type RoutePlan } from "./route.js";
import {
  readWatermark,
  writeWatermark,
  listNewerSessions,
  sessionsRoot,
} from "./watermark.js";
import { defaultRoot } from "./watermark.js";
import type { Candidate } from "./types.js";

export interface RunOptions {
  cwd: string;
  n?: number;
  apply?: boolean;
  root?: string; // distiller state root (watermark + candidates)
  sessionsDir?: string; // session JSONL dir
  now?: Date;
}

export interface RunResult {
  processedSessions: number;
  malformedLines: number;
  candidates: number;
  promoted: HeldCluster[];
  plan: RoutePlan;
  newWatermark: string;
}

export function run(opts: RunOptions): RunResult {
  const n = opts.n ?? DEFAULT_RECURRENCE;
  const root = opts.root ?? defaultRoot();
  const dir = opts.sessionsDir ?? sessionsRoot(opts.cwd);
  const now = opts.now ?? new Date();

  const wm = readWatermark(opts.cwd, root);
  const refs = listNewerSessions(opts.cwd, wm.lastTimestamp, dir);

  const candidates: Candidate[] = [];
  const timestamps = new Map<string, string>(); // sessionId -> session ISO time
  let malformed = 0;
  let maxTs = wm.lastTimestamp;

  for (const ref of refs) {
    const { events, malformed: m } = readSession(ref.path);
    malformed += m;
    const traj = buildTrajectory(events);
    const episodes = segment(traj);
    timestamps.set(traj.sessionId, ref.timestamp);
    candidates.push(...extractSignals(traj, episodes));
    if (Date.parse(ref.timestamp) > Date.parse(maxTs || "1970-01-01")) {
      maxTs = ref.timestamp;
    }
  }

  const storePath = candidatesPath(opts.cwd, root);
  const merged = mergeIntoStore(loadStore(storePath), candidates, timestamps);
  const { promoted, remaining } = promote(merged, n);

  const clustersBySignature = new Map(promoted.map((c) => [c.signature, c]));
  // Per-cluster recency: each artifact decays from ITS OWN newest sighting,
  // not a run-global max (avoids a recent unrelated session refreshing a stale cluster).
  const artifacts = promoted.map((c) =>
    distill(c, { n, now, lastSeen: c.lastSeen ? new Date(c.lastSeen) : now }),
  );
  const plan = buildRoutePlan(artifacts, {
    dryRun: !opts.apply,
    clustersBySignature,
  });

  if (opts.apply) {
    // Persist below-threshold clusters for later auto-promotion; advance watermark.
    saveStore(storePath, remaining);
    if (maxTs) writeWatermark(opts.cwd, maxTs, root);
  }

  return {
    processedSessions: refs.length,
    malformedLines: malformed,
    candidates: candidates.length,
    promoted,
    plan,
    newWatermark: maxTs,
  };
}

// --- CLI ---

function requireValue(flag: string, value: string | undefined): string {
  if (value === undefined) throw new Error(`Missing value for ${flag}`);
  return value;
}

export function parseArgs(argv: string[]): RunOptions & { json?: boolean } {
  const out: RunOptions & { json?: boolean } = { cwd: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") out.apply = true;
    else if (a === "--json") out.json = true;
    else if (a === "--cwd") out.cwd = requireValue(a, argv[++i]);
    else if (a === "--sessions-dir") out.sessionsDir = requireValue(a, argv[++i]);
    else if (a === "--n") {
      const n = Number(requireValue(a, argv[++i]));
      if (!Number.isInteger(n) || n < 1) throw new Error(`--n must be a positive integer, got "${n}"`);
      out.n = n;
    } else throw new Error(`Unknown argument: ${a}`);
  }
  return out;
}

export function main(argv = process.argv.slice(2)): void {
  let opts: RunOptions & { json?: boolean };
  try {
    opts = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`Error: ${(e as Error).message}\n`);
    process.exitCode = 1;
    return;
  }
  let result: ReturnType<typeof run>;
  try {
    result = run(opts);
  } catch (e) {
    process.stderr.write(`Error: ${(e as Error).message}\n`);
    process.exitCode = 1;
    return;
  }
  if (opts.json) {
    process.stdout.write(JSON.stringify(result.plan, null, 2) + "\n");
    return;
  }
  process.stdout.write(
    [
      `Processed ${result.processedSessions} session(s), ${result.malformedLines} malformed line(s).`,
      `Candidates this run: ${result.candidates}. Promoted clusters: ${result.promoted.length}.`,
      summarizePlan(result.plan),
      opts.apply ? `Watermark advanced to ${result.newWatermark}.` : "Dry-run: no sinks mutated. Re-run with --apply to persist.",
    ].join("\n") + "\n",
  );
}

const isMain = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch {
    return false;
  }
})();
if (isMain) main();
