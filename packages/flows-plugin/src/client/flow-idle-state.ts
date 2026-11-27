/**
 * Idle (not-started) flow state for the attach-before-run panel.
 *
 * `buildIdleFlowState` maps a flow.yaml to the step payload pi-flows 0.5.0
 * `onFlowStarted` would emit (per-kind field subset + parser coercions), wraps it
 * in a fake `flow_started` event and replays it through the REAL reducer, so the
 * idle graph + cards equal what a real start shows. Mirrors every 0.5.0 parser
 * throw so a bad definition yields an error instead of a wrong panel.
 *
 * `resolveFlowSlot` decides what the flow slot renders (running → attached →
 * completed → nothing); `isAttachmentConsumed` is the replay catch-up rule.
 *
 * `{ lenient: true }` (the `flow_write` card) skips the required-field checks,
 * defaults a missing/unknown `type` to `agent` and skips invalid steps.
 * See change: attach-flow-before-run (D1, D3, D4), unify-flow-rendering (D4, D5).
 */
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { FlowState } from "../types.js";
import { parse as parseYaml } from "yaml";
import { reduceFlowEvent } from "../reducer.js";

/** One step of the pi-flows 0.5.0 `flow:flow-started` payload. */
interface StartedStep {
  id: string;
  stepType: string;
  agent?: string;
  blockedBy: string[];
  branches?: Record<string, string>;
  onError?: string;
}

type Raw = Record<string, unknown>;

/** Parse mode: strict mirrors every 0.5.0 parser throw; lenient checks nothing optional. */
interface ParseMode {
  lenient: boolean;
}

function requireField(obj: Raw, key: string, where: string, mode: ParseMode): string | undefined {
  const v = obj[key];
  if (v === undefined || v === null) {
    if (mode.lenient) return undefined;
    throw new Error(`flow.yaml: ${where} missing required field "${key}"`);
  }
  return String(v);
}

function blockedByOf(raw: Raw): string[] {
  if (!raw.blockedBy) return [];
  return Array.isArray(raw.blockedBy) ? raw.blockedBy.map(String) : [String(raw.blockedBy)];
}

/** Scalar → its string; `{ to: "<non-empty>", ... }` → `to`; anything else skipped. */
function branchTarget(v: unknown): string | undefined {
  if (v === null || v === undefined || Array.isArray(v)) return undefined;
  if (typeof v === "object") {
    const to = (v as Raw).to;
    return typeof to === "string" && to !== "" ? to : undefined;
  }
  return String(v);
}

function branchesOf(raw: Raw): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw.branches && typeof raw.branches === "object") {
    for (const [k, v] of Object.entries(raw.branches as Raw)) {
      const to = branchTarget(v);
      if (to !== undefined) out[k] = to;
    }
  }
  return out;
}

/** 0.5.0 `toInt`: an optional integer field must parse. */
function checkInt(obj: Raw, key: string, where: string, mode: ParseMode): void {
  if (mode.lenient || obj[key] === undefined) return;
  if (Number.isNaN(Number.parseInt(String(obj[key]), 10))) {
    throw new Error(`flow.yaml: ${where} "${key}" must be an integer`);
  }
}

const INPUT_TYPES = new Set(["string", "number", "boolean", "object", "array"]);

/** 0.5.0 `parseFlowInputs`: optional mapping of name → { type }. */
function checkInputs(raw: unknown): void {
  if (raw === undefined) return;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error('flow.yaml: "inputs" must be a mapping');
  for (const [k, v] of Object.entries(raw as Raw)) {
    const type = (v as Raw | null)?.type;
    if (typeof type !== "string" || !INPUT_TYPES.has(type)) {
      throw new Error(`flow.yaml: input "${k}" needs a valid "type"`);
    }
  }
}

function onErrorOf(raw: Raw): string | undefined {
  return raw.on_error ? String(raw.on_error) : undefined;
}

/**
 * Map one YAML step to its started-payload shape using the pi-flows 0.5.0
 * per-kind field table (agent: blockedBy+on_error; code: blockedBy+on_error;
 * code-decision: blockedBy+branches; fork: branches (+optional agent);
 * agent-decision: agent+branches). Throws where the 0.5.0 parser throws.
 * Lenient: missing/unknown `type` → `agent`, no required-field/integer checks.
 */
const STEP_TYPES = new Set(["agent", "code", "code-decision", "fork", "agent-decision"]);

function toStartedStep(raw: unknown, index: number, mode: ParseMode): StartedStep {
  if (!raw || typeof raw !== "object") throw new Error(`flow.yaml: step ${index} is not an object`);
  const r = raw as Raw;
  const id = r.id;
  if (!id || typeof id !== "string") throw new Error(`flow.yaml: step ${index} missing "id" field`);
  let type = r.type;
  if (mode.lenient && (typeof type !== "string" || !STEP_TYPES.has(type))) type = "agent";
  if (!type || typeof type !== "string") throw new Error(`flow.yaml: step "${id}" missing required "type" field`);
  const where = `step "${id}"`;
  checkInt(r, "timeout", where, mode);
  checkInt(r, "max_iterations", where, mode);
  switch (type) {
    case "agent":
      return { id, stepType: type, agent: requireField(r, "agent", where, mode), blockedBy: blockedByOf(r), onError: onErrorOf(r) };
    case "code":
      return { id, stepType: type, blockedBy: blockedByOf(r), onError: onErrorOf(r) };
    case "code-decision":
      return { id, stepType: type, blockedBy: blockedByOf(r), branches: branchesOf(r), onError: onErrorOf(r) };
    case "fork":
      requireField(r, "question", where, mode);
      requireField(r, "options", where, mode);
      return { id, stepType: type, agent: r.agent ? String(r.agent) : undefined, blockedBy: [], branches: branchesOf(r), onError: onErrorOf(r) };
    case "agent-decision": {
      const agent = requireField(r, "agent", where, mode);
      requireField(r, "task", where, mode);
      return { id, stepType: type, agent, blockedBy: [], branches: branchesOf(r), onError: onErrorOf(r) };
    }
    default:
      throw new Error(`flow.yaml: unknown step type "${type}" for step "${id}"`);
  }
}

/** Parse a flow.yaml into the 0.5.0 started-step payload. Throws on any error. */
function flowYamlToStartedSteps(content: string, mode: ParseMode): StartedStep[] {
  const doc = parseYaml(content) as unknown;
  if (!doc || typeof doc !== "object") throw new Error("flow.yaml: empty or not a mapping");
  if (!mode.lenient) {
    requireField(doc as Raw, "name", "flow", mode);
    requireField(doc as Raw, "description", "flow", mode);
    checkInt(doc as Raw, "max_concurrent", "flow", mode);
    checkInputs((doc as Raw).inputs);
  }
  const steps = (doc as Raw).steps;
  if (!Array.isArray(steps)) throw new Error('flow.yaml: "steps" must be an array');
  if (!mode.lenient) return steps.map((s, i) => toStartedStep(s, i, mode));
  const valid = steps.filter((s): s is Raw => !!s && typeof s === "object" && typeof (s as Raw).id === "string" && (s as Raw).id !== "");
  if (valid.length === 0) throw new Error("flow.yaml: no valid steps");
  return valid.map((s, i) => toStartedStep(s, i, mode));
}

export type IdleBuildResult =
  | { kind: "ready"; flowState: FlowState }
  | { kind: "error"; message: string };

/** Build the idle FlowState by replaying a fake 0.5.0 `flow_started`. */
export function buildIdleFlowState(
  content: string,
  flow: { name: string; source?: string },
  opts: { lenient?: boolean } = {},
): IdleBuildResult {
  let steps: StartedStep[];
  try {
    steps = flowYamlToStartedSteps(content, { lenient: opts.lenient === true });
  } catch (err) {
    return { kind: "error", message: err instanceof Error ? err.message : String(err) };
  }
  const event = {
    seq: 0,
    timestamp: 0,
    eventType: "flow_started",
    data: { flowName: flow.name, task: "", source: flow.source, autonomousMode: true, steps },
  } as unknown as DashboardEvent;
  // flow_started always seeds a state from null.
  return { kind: "ready", flowState: reduceFlowEvent(null, event) as FlowState };
}

/** Coerce an event timestamp (number or ISO string) to epoch ms; non-finite → 0. */
export function toEventTime(ts: unknown): number {
  const n = typeof ts === "string" ? Date.parse(ts) : Number(ts);
  return Number.isFinite(n) ? n : 0;
}

/** Replay catch-up: a `flow_started` strictly newer than the attach baseline. */
export function isAttachmentConsumed(baselineStartedAt: number | null, lastFlowStartedAt: unknown): boolean {
  if (baselineStartedAt === null) return false;
  if (lastFlowStartedAt === undefined || lastFlowStartedAt === null) return false;
  return toEventTime(lastFlowStartedAt) > baselineStartedAt;
}

/** Stored per-session attachment (see flow-attach-store.ts). */
export interface FlowAttachment {
  /** Random per-attach token (conditional delete). */
  id: string;
  name: string;
  source?: string;
  baselineStartedAt: number | null;
  /**
   * Path-opened by the agent's `flow_open` (not in the catalog): view-only
   * panel, never "unavailable". See change: add-flow-open-tool (D7).
   */
  viewOnly?: true;
}

export type IdleLoad =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; flowState: FlowState };

type FlowSlotError = { kind: "unavailable" } | { kind: "load"; message: string };

export interface FlowSlot {
  mode: "live" | "idle" | "loading" | "error" | "none";
  flowState?: FlowState;
  error?: FlowSlotError;
  /** True when an attachment exists and has been consumed (caller deletes it). */
  attachmentConsumed: boolean;
}

function findRunning(
  live: FlowState | null,
  liveStates: ReadonlyMap<string, FlowState>,
): FlowState | undefined {
  if (live?.status === "running") return live;
  let running: FlowState | undefined;
  for (const s of liveStates.values()) if (s.status === "running") running = s;
  return running;
}

/**
 * Slot priority: running flow → attached (unconsumed) flow → completed flow →
 * nothing. The idle state is only ever returned in `idle` mode; it never enters
 * the live path.
 */
export function resolveFlowSlot(input: {
  live: FlowState | null;
  liveStates: ReadonlyMap<string, FlowState>;
  attachment: FlowAttachment | null;
  idle: IdleLoad;
  lastFlowStartedAt?: unknown;
  /** The session's flow catalog (plugin `flow_catalog`). */
  flows: ReadonlyArray<{ name: string }>;
}): FlowSlot {
  const { live, liveStates, attachment, idle, lastFlowStartedAt, flows } = input;
  const running = findRunning(live, liveStates);
  if (running) return { mode: "live", flowState: running, attachmentConsumed: !!attachment };

  if (attachment && !isAttachmentConsumed(attachment.baselineStartedAt, lastFlowStartedAt)) {
    if (!attachment.viewOnly && flows.length > 0 && !flows.some((f) => f.name === attachment.name)) {
      return { mode: "error", error: { kind: "unavailable" }, attachmentConsumed: false };
    }
    if (idle.kind === "loading") return { mode: "loading", attachmentConsumed: false };
    if (idle.kind === "error") {
      return { mode: "error", error: { kind: "load", message: idle.message }, attachmentConsumed: false };
    }
    return { mode: "idle", flowState: idle.flowState, attachmentConsumed: false };
  }

  const consumed = !!attachment;
  if (live) return { mode: "live", flowState: live, attachmentConsumed: consumed };
  return { mode: "none", attachmentConsumed: consumed };
}
