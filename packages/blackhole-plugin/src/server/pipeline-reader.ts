/**
 * Read the per-session blackhole pipeline state for the session route
 * (design D5). Validate-then-confine, read-only, quiet degradation:
 *
 *  1. The session id is validated against RFC 4122 syntax with an
 *     UNRESTRICTED version nibble BEFORE any filesystem access (pi emits
 *     UUIDv7; a 1–5 restriction would reject every id pi produces).
 *  2. The pending path is built from the fixed config dir + the validated id,
 *     then asserted to resolve INSIDE `<agentDir>/pi-blackhole/` (defense in
 *     depth — the validator already excludes separators, but the confinement
 *     assert does not depend on that staying true).
 *  3. Every read degrades quietly: an absent or torn file is "no recorded
 *     activity", never an error — matching `config-io.ts`' posture. A torn
 *     GLOBAL config yields null fields rather than a 500.
 *
 * SOURCE-VERSION PIN: mirrored from `pi-blackhole@0.4.10`
 * `src/om/pending.ts` (`PendingOMState`: `observation`/`reflection`/`dropped`
 * `{coversUpToId, data}`, `observationBatches`/`reflectionBatches`/
 * `droppedBatches` arrays, `cursors.{observer,reflector,dropper}` =
 * `{entryId: string, state: string}`) and `src/om/cooldown.ts`
 * (`CooldownMap = Record<"provider/id", {until: ISO string, reason: string,
 * stage: string}>`). Re-check on every blackhole upgrade. Numeric `entry` /
 * `tip` fields are accepted when present (spec E11's numeric cursor model);
 * the pinned extension records hash `entryId`s only, so they read as null.
 *
 * See change: add-blackhole-session-pipeline.
 */
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { BLACKHOLE_CONFIG_DIR, resolveAgentRoot } from "./config-path.js";

const PENDING_SUFFIX = "-pending.json";
const COOLDOWN_FILENAME = "pi-blackhole-cooldown.json";

/** RFC 4122 syntax, ANY version nibble (pi emits UUIDv7). Lowercase or uppercase hex. */
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function isValidSessionId(id: string): boolean {
  return typeof id === "string" && UUID_RE.test(id);
}

export interface PipelinePaths {
  /** Absolute path of `<agentDir>/pi-blackhole/<id>-pending.json`. */
  pendingPath: string;
  /** Absolute path of the container directory (confinement boundary). */
  containerDir: string;
}

/**
 * Build + confine the per-session pending path. Throws when the resolved
 * absolute path would escape the container — unreachable for ids that passed
 * {@link isValidSessionId}, kept as the defense-in-depth assert (spec:
 * resolved path asserted inside the blackhole directory before any read).
 */
export function resolvePipelinePaths(env: Record<string, string | undefined>, id: string): PipelinePaths {
  const containerDir = path.resolve(resolveAgentRoot(env), BLACKHOLE_CONFIG_DIR);
  const pendingPath = path.resolve(containerDir, `${id}${PENDING_SUFFIX}`);
  if (!pendingPath.startsWith(containerDir + path.sep)) {
    throw new Error("resolved pending path escaped the blackhole directory");
  }
  return { pendingPath, containerDir };
}

// ── Pinned external shapes (see SOURCE-VERSION PIN above) ────────────────────

interface PinnedCursor {
  entryId?: unknown;
  state?: unknown;
  /** Numeric position when recorded (spec E11 model; null with the pinned hash form). */
  entry?: unknown;
}

interface PinnedPendingState {
  cursors?: Record<string, PinnedCursor | undefined>;
  observationBatches?: unknown[];
  reflectionBatches?: unknown[];
  droppedBatches?: unknown[];
  tip?: unknown;
}

interface PinnedCooldownEntry {
  until: string;
  reason: string;
  stage?: string;
}

// ── Readers (all quiet-degrading) ───────────────────────────────────────────

export interface WorkerCursorView {
  /** Verbatim entry hash from the file, when present. */
  entryId: string | null;
  /** Verbatim cursor state ("recorded" | "not_due" | "empty" | "skipped" | …). */
  state: string | null;
  /** Numeric position when the file records one; null with the pinned hash form. */
  entry: number | null;
}

export interface WorkerPipelineView {
  /** Primary model as `provider/id` from the global config (chain head), when known. */
  model: string | null;
  /** Active cooldown entry for the primary model, when cooling. */
  cooldown: { until: string; reason: string } | null;
}

export interface SessionPipelineState {
  activity: "none" | "active";
  /** Total accumulated manual-mode batches (observation + reflection + dropper). */
  pendingBatches: number;
  cursors: {
    observer: WorkerCursorView | null;
    reflector: WorkerCursorView | null;
    dropper: WorkerCursorView | null;
  };
  tip: number | null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function cursorView(raw: PinnedCursor | undefined): WorkerCursorView | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  return {
    entryId: typeof rec.entryId === "string" ? rec.entryId : null,
    state: typeof rec.state === "string" ? rec.state : null,
    entry: typeof rec.entry === "number" && Number.isFinite(rec.entry) ? rec.entry : null,
  };
}

/** Read the pending file. Absent, torn, or shape-incompatible → no activity. */
function readPendingState(pendingPath: string): SessionPipelineState {
  const none: SessionPipelineState = {
    activity: "none",
    pendingBatches: 0,
    cursors: { observer: null, reflector: null, dropper: null },
    tip: null,
  };
  if (!existsSync(pendingPath)) return none;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(pendingPath, "utf-8"));
  } catch {
    return none; // torn / malformed file — a normal state, never an error
  }
  const rec = asRecord(parsed);
  if (!rec) return none;
  const state = rec as unknown as PinnedPendingState;
  const cursors = asRecord(state.cursors);
  const batchCount =
    (Array.isArray(state.observationBatches) ? state.observationBatches.length : 0) +
    (Array.isArray(state.reflectionBatches) ? state.reflectionBatches.length : 0) +
    (Array.isArray(state.droppedBatches) ? state.droppedBatches.length : 0);
  const anyCursor =
    cursors && ["observer", "reflector", "dropper"].some((w) => asRecord(cursors[w]));
  const hasBatches = batchCount > 0;
  return {
    activity: anyCursor || hasBatches ? "active" : "none",
    pendingBatches: batchCount,
    cursors: {
      observer: cursorView(cursors?.observer as PinnedCursor | undefined),
      reflector: cursorView(cursors?.reflector as PinnedCursor | undefined),
      dropper: cursorView(cursors?.dropper as PinnedCursor | undefined),
    },
    tip:
      typeof state.tip === "number" && Number.isFinite(state.tip) ? state.tip : null,
  };
}

/** Read the cooldown map. Absent or garbage → {} (advisory-free render path). */
function readCooldownMap(cooldownPath: string): Record<string, PinnedCooldownEntry> {
  if (!existsSync(cooldownPath)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(cooldownPath, "utf-8"));
    const rec = asRecord(parsed);
    if (!rec) return {};
    const out: Record<string, PinnedCooldownEntry> = {};
    for (const [key, value] of Object.entries(rec)) {
      const entry = asRecord(value);
      if (!entry || typeof entry.until !== "string" || typeof entry.reason !== "string") continue;
      out[key] = { until: entry.until, reason: entry.reason };
    }
    return out;
  } catch {
    return {};
  }
}

function activeCooldown(
  map: Record<string, PinnedCooldownEntry>,
  key: string | null,
  now: number,
): { until: string; reason: string } | null {
  if (!key) return null;
  const entry = map[key];
  if (!entry) return null;
  const until = Date.parse(entry.until);
  if (Number.isNaN(until) || until <= now) return null;
  return { until: entry.until, reason: entry.reason };
}

export interface GlobalConfigFields {
  compactAfterTokens: number | null;
  memory: boolean | null;
  compaction: "auto" | "manual" | "off" | null;
}

export interface WorkersPipelineView {
  observer: WorkerPipelineView;
  reflector: WorkerPipelineView;
  dropper: WorkerPipelineView;
}

/**
 * Derive per-worker views: the primary model (chain head from the global
 * config: `<worker>Model ?? model`) and its active cooldown entry.
 * `workersConfig` carries the three chain heads pre-resolved by the caller
 * from a parsed config; null model → no advisory.
 */
function deriveWorkerViews(
  workersConfig: { observer: string | null; reflector: string | null; dropper: string | null },
  cooldowns: Record<string, PinnedCooldownEntry>,
  now: number,
): WorkersPipelineView {
  const view = (model: string | null): WorkerPipelineView => ({
    model,
    cooldown: activeCooldown(cooldowns, model, now),
  });
  return {
    observer: view(workersConfig.observer),
    reflector: view(workersConfig.reflector),
    dropper: view(workersConfig.dropper),
  };
}

/** Assemble everything the session route responds with. */
export function readSessionPipeline(
  env: Record<string, string | undefined>,
  sessionId: string,
  configFields: GlobalConfigFields,
  workersConfig: { observer: string | null; reflector: string | null; dropper: string | null },
  now: number = Date.now(),
): SessionPipelineState & {
  sessionId: string;
  config: GlobalConfigFields;
  workers: WorkersPipelineView;
} {
  const { pendingPath, containerDir } = resolvePipelinePaths(env, sessionId);
  const pending = readPendingState(pendingPath);
  const cooldowns = readCooldownMap(path.join(containerDir, COOLDOWN_FILENAME));
  return {
    sessionId,
    ...pending,
    config: configFields,
    workers: deriveWorkerViews(workersConfig, cooldowns, now),
  };
}
