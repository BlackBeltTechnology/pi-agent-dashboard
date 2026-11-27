/**
 * Consumer-side contract with the external pi extension
 * `@blackbelt-technology/pi-dashboard-subagents` (spec `agent-teams-subagents-contract`,
 * design "Required upstream API"). Types of the bus requests/replies/events the lead bridge
 * uses, the version gate and the pure capability verdict. Nothing here imports the package.
 *
 * VERSION NOTE: the API below is targeted at upstream release **0.9.0**. That release is NOT
 * published (npm latest is 0.8.1, installed 0.6.0): until it is installed every capability probe
 * is unanswered/outdated and in-process mode fails closed (`mode_unavailable`). The numbers here are
 * the contract's own `apiVersion`, never derived from the package version string. Shapes of the
 * `subagents:*` EVENTS are the RECORDED contract (the drift test of task 2.6 compares them with the live
 * package once it exists).
 * See change: add-agent-teams-in-process.
 */

/** Upstream release that introduces the API (informational; the gate is `REQUIRED_API_VERSION`). */
export const SUBAGENTS_TARGET_RELEASE = "0.9.0";

/** `capabilities.apiVersion` this build needs (>= is accepted). */
export const REQUIRED_API_VERSION = 1;

/** Features without which in-process mode is unavailable (`subagents_extension_outdated`). */
export const REQUIRED_FEATURES = ["spawn", "steer", "managed", "loader"] as const;
/** Features that only degrade behaviour: `loader_skills` (skill grants), `interrupt` (urgent), `cwd_scope` (cwd outside the repo). */
export const OPTIONAL_FEATURES = ["loader_skills", "interrupt", "cwd_scope"] as const;

export type RequiredFeature = (typeof REQUIRED_FEATURES)[number];
export type OptionalFeature = (typeof OPTIONAL_FEATURES)[number];
export type SubagentsFeature = RequiredFeature | OptionalFeature;

const KNOWN_FEATURES: readonly string[] = [...REQUIRED_FEATURES, ...OPTIONAL_FEATURES];

/** Bus channels (names exactly as in the upstream contract / existing `subagents:*` events). */
export const SUBAGENTS_CHANNEL = {
  capabilities: "subagents:capabilities",
  spawn: "subagents:spawn",
  steerRequest: "subagents:steer_request",
  interruptRequest: "subagents:interrupt_request",
  stop: "subagents:stop",
  created: "subagents:created",
  started: "subagents:started",
  completed: "subagents:completed",
  failed: "subagents:failed",
  idle: "subagents:idle",
  disposed: "subagents:disposed",
  slot: "subagents:slot",
} as const;

/** Live limits of the subagents extension (`limits.maxConcurrent` is the only one the handshake enforces). */
export interface SubagentsLimits {
  /** Positive integer: the slot pool shared with the lead's own `Agent` calls. */
  maxConcurrent: number;
  maxBackgroundPending?: number;
  maxIdleBackground?: number;
  cwdScope?: "repo" | "any";
}

/** `subagents:capabilities` answer. `reason: "no_context"` = the extension is active but has no ExtensionContext yet (re-probe later). */
export type CapabilitiesOut =
  | { apiVersion: number; features: string[]; limits: SubagentsLimits }
  | { reason: "no_context" };

/** `subagents:capabilities` (query; the handler fills `out` before `emit` returns). */
export interface CapabilitiesQuery {
  out?: CapabilitiesOut;
}

/** Whitelisted loader pass-through of a spawn (never `extensionPaths`, `agentDir`, `additionalExtensionPaths`). */
export interface SpawnLoaderOptions {
  extensionFactories?: unknown[];
  noExtensions?: boolean;
  noContextFiles?: boolean;
  appendSystemPrompt?: string[];
  /** Skill keys need the `loader_skills` feature. */
  additionalSkillPaths?: string[];
  skillsOverride?: unknown;
  noSkills?: boolean;
}

/** Keys of {@link SpawnLoaderOptions}: the only `loader` keys the bridge may send. */
export const LOADER_WHITELIST: readonly (keyof SpawnLoaderOptions)[] = [
  "extensionFactories",
  "noExtensions",
  "noContextFiles",
  "appendSystemPrompt",
  "additionalSkillPaths",
  "skillsOverride",
  "noSkills",
];

export const MANAGED_OWNER = "agent-teams";

export interface SpawnRequestBody {
  subagent_type: string;
  description: string;
  prompt: string;
  model?: string;
  cwd?: string;
  inline: true;
  isolated: true;
  tools?: string[];
  ask?: false;
  managed: { owner: string; keepAlive: true; idleTtlSec?: number };
  cwdScope?: "repo" | "any";
  loader?: SpawnLoaderOptions;
}

/** Failure reasons of `subagents:spawn`. */
export type SpawnFailReason = "no_context" | "cap" | "cwd_not_found" | "cwd_not_dir" | "cwd_out_of_scope" | "vetoed" | "unsupported" | "invalid";

export type SpawnOut =
  | { ok: true; id: string; agentId: string; status: "queued" | "running"; queuePosition?: number }
  | { ok: false; reason: SpawnFailReason; message: string };

/** `subagents:spawn` (request; background is implied). */
export interface SpawnRequest {
  request: SpawnRequestBody;
  out?: SpawnOut;
}

export type SteerResult = "queued" | "started" | "not_started" | "not_alive" | "not_found";

/** `subagents:steer_request`: continues an idle child or steers a running one. */
export interface SteerRequest {
  id: string;
  message: string;
  mode?: "steer" | "followUp";
  out?: Promise<SteerResult>;
}

export type InterruptResult = "interrupted" | "not_running" | "not_alive" | "not_found";

/** `subagents:interrupt_request` (feature `interrupt`): silent abort, child parks idle, the `idle` event carries `aborted:true`. */
export interface InterruptRequest {
  id: string;
  out?: Promise<InterruptResult>;
}

// ── events (recorded shapes) ─────────────────────────────────────────────────────

interface EventBase {
  agentId: string;
}
export type SubagentsStartedEvent = EventBase & { run?: number };
export type SubagentsCompletedEvent = EventBase & { result?: string; details?: { status?: string; stoppedBy?: string } };
export type SubagentsFailedEvent = EventBase & { error?: string; details?: { status?: string; stoppedBy?: string } };
/** `run` is the child's monotonic run counter (= the member's settle id). */
export type SubagentsIdleEvent = EventBase & { run: number; aborted?: boolean };
/** `reason` ∈ `ttl|cap|cancel|shutdown`; anything else is upstream drift. */
export type SubagentsDisposedEvent = EventBase & { reason?: string };

export const DISPOSED_REASONS = ["ttl", "cap", "cancel", "shutdown"] as const;
export const STOPPED_BY = ["timeout", "user", "dock", "queue-removal"] as const;

// ── capability verdict ─────────────────────────────────────────────────────────────────

export type UnavailableReason = "subagents_extension_missing" | "subagents_extension_outdated" | "no_context";

export interface CapabilityOk {
  available: true;
  apiVersion: number;
  /** Known features only; unknown strings are ignored. */
  features: SubagentsFeature[];
  limits: SubagentsLimits;
}
export interface CapabilityNo {
  available: false;
  reason: UnavailableReason;
  /** Missing required features / unusable fields, for the user-facing message. */
  missing: string[];
  /** Why the answer was rejected, one line, never echoing upstream text. */
  detail: string;
}
export type CapabilityVerdict = CapabilityOk | CapabilityNo;

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function positiveInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

const outdated = (detail: string, missing: string[] = []): CapabilityNo => ({ available: false, reason: "subagents_extension_outdated", missing, detail });

function limitsOf(answer: Record<string, unknown>): SubagentsLimits | CapabilityNo {
  const limits = Object.hasOwn(answer, "limits") ? answer.limits : undefined;
  if (!isRecord(limits)) return outdated("limits is missing", ["limits"]);
  const maxConcurrent = Object.hasOwn(limits, "maxConcurrent") ? limits.maxConcurrent : undefined;
  if (!positiveInt(maxConcurrent)) return outdated("limits.maxConcurrent is not a positive integer", ["limits.maxConcurrent"]);
  const pick = (k: string): number | undefined => {
    const v = Object.hasOwn(limits, k) ? limits[k] : undefined;
    return positiveInt(v) ? v : undefined;
  };
  const cwdScope = Object.hasOwn(limits, "cwdScope") && (limits.cwdScope === "repo" || limits.cwdScope === "any") ? limits.cwdScope : undefined;
  const pending = pick("maxBackgroundPending");
  const idle = pick("maxIdleBackground");
  return {
    maxConcurrent,
    ...(pending !== undefined ? { maxBackgroundPending: pending } : {}),
    ...(idle !== undefined ? { maxIdleBackground: idle } : {}),
    ...(cwdScope !== undefined ? { cwdScope } : {}),
  };
}

/** Version + features of an answer: the known features present, or the verdict that rejects it. */
function featuresOf(answer: Record<string, unknown>): { apiVersion: number; features: SubagentsFeature[] } | CapabilityNo {
  const apiVersion = Object.hasOwn(answer, "apiVersion") ? answer.apiVersion : undefined;
  if (typeof apiVersion !== "number" || !Number.isInteger(apiVersion)) return outdated("apiVersion is not an integer", ["apiVersion"]);
  const featuresRaw = Object.hasOwn(answer, "features") ? answer.features : undefined;
  if (!Array.isArray(featuresRaw)) return outdated("features is not an array", ["features"]);
  const features = featuresRaw.filter((f): f is SubagentsFeature => typeof f === "string" && KNOWN_FEATURES.includes(f));
  const missing: string[] = REQUIRED_FEATURES.filter((f) => !features.includes(f));
  if (apiVersion < REQUIRED_API_VERSION) return outdated(`apiVersion ${apiVersion} < required ${REQUIRED_API_VERSION}`, missing);
  if (missing.length > 0) return outdated(`missing required features: ${missing.join(", ")}`, missing);
  return { apiVersion, features: [...new Set(features)] };
}

/**
 * The fail-closed handshake (spec "Capability handshake", decisions B95): only a well-formed answer with
 * `apiVersion >= REQUIRED_API_VERSION`, every required feature and a usable `limits.maxConcurrent` makes the mode
 * available. `undefined`/non-object (nobody answered) is `subagents_extension_missing`; every other violation is
 * `subagents_extension_outdated`; `{reason:"no_context"}` is `no_context`. Never throws.
 */
export function evaluateCapabilities(answer: unknown): CapabilityVerdict {
  if (answer === undefined || answer === null) return { available: false, reason: "subagents_extension_missing", missing: [], detail: "no answer to subagents:capabilities" };
  if (!isRecord(answer)) return outdated("capabilities answer is not an object");
  if (Object.hasOwn(answer, "reason") && answer.reason === "no_context") return { available: false, reason: "no_context", missing: [], detail: "subagents extension has no context yet" };
  const f = featuresOf(answer);
  if ("available" in f) return f;
  const limits = limitsOf(answer);
  if ("available" in limits) return limits;
  return { available: true, apiVersion: f.apiVersion, features: f.features, limits };
}

/** User-facing install/update hint of an unavailable verdict (one line; names the Packages tab). */
export function installHint(reason: UnavailableReason, missing: readonly string[] = []): string {
  switch (reason) {
    case "subagents_extension_missing":
      return `install the @blackbelt-technology/pi-dashboard-subagents package (Packages tab, release ${SUBAGENTS_TARGET_RELEASE} or newer) and reload the session`;
    case "subagents_extension_outdated":
      return `update @blackbelt-technology/pi-dashboard-subagents to ${SUBAGENTS_TARGET_RELEASE} or newer from the Packages tab${missing.length > 0 ? ` (missing: ${missing.join(", ")})` : ""}`;
    case "no_context":
      return "the subagents extension is not ready yet; retry in a moment";
  }
}
