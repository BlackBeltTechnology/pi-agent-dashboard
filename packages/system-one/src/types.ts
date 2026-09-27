/**
 * Public contract of the System-1 adapter. Mirrors specs `system-one-adapter`
 * and `system-one-config`. See change: add-system-one-registry.
 */

export type Primitive = "choice" | "score" | "noul";

export interface ChoiceQuestion {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
}
export interface ScoreQuestion {
  type: "score";
  instructions: string;
  /** Ordered levels; the answer is an index in `[0, levels-1]`. */
  criteria: string[];
}
export interface NoulQuestion {
  type: "noul";
  instructions: string;
  criteria?: { true: string; false: string };
}
export type Question = ChoiceQuestion | ScoreQuestion | NoulQuestion;
export type Questions = Record<string, Question>;

export interface ChoiceAnswer {
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}
export interface ScoreAnswer {
  score: number;
  probabilities: number[];
  confidence: number;
}
export interface NoulAnswer {
  noul: number;
}
export type Answer = ChoiceAnswer | ScoreAnswer | NoulAnswer;
export type Answers = Record<string, Answer>;

export type FailurePolicy = "fail-open" | "fail-closed" | "deterministic";
export type FailReason = "no-backend" | "capability" | "off-machine" | "timeout" | "error";
export type Mode = "shadow" | "enforce";

export interface ConsumerRequires {
  minContextTokens?: number;
  maxOptions?: number;
  languages?: string[];
  primitives?: Primitive[];
}

export interface ConsumerDeclaration {
  id: string;
  label?: string;
  failurePolicy: FailurePolicy;
  requires?: ConsumerRequires;
  /** Absolute path to a JSON array of `{ state, questions, expected }`. */
  fixtures?: string;
}

export interface ProjectRef {
  cwd: string;
  /** pi's project-trust decision for `cwd`. Never hard-code `true`. */
  trusted: boolean;
}

export interface PredictRequest {
  consumer: ConsumerDeclaration;
  state: string;
  questions: Questions;
  signal?: AbortSignal;
  project?: ProjectRef;
  /** Required for `llm` chain entries; absent → such entries skip `no-backend`. */
  llmCaller?: LlmCaller;
  /**
   * Bypass the chain and try only this backend (the eval runner). Egress and
   * capability checks still apply.
   */
  onlyBackend?: string;
}

export interface Attempt {
  backendId: string;
  outcome: "ok" | FailReason;
  latencyMs: number;
}

export type PredictResult =
  | {
      ok: true;
      answers: Answers;
      backendId: string;
      model: string;
      mode: Mode;
      thresholds: Record<string, number>;
      latencyMs: number;
      attempts: Attempt[];
    }
  | { ok: false; reason: FailReason; policy: FailurePolicy; attempts: Attempt[] };

// ---------- LLM seam ----------

export interface LlmCallArgs {
  role: string;
  state: string;
  questions: Questions;
  signal: AbortSignal;
}
export interface LlmCaller {
  call(args: LlmCallArgs): Promise<{ answers: unknown; model: string }>;
  /** `true` only when the resolved provider runs inference on this machine. */
  isLocal(role: string): boolean;
}

// ---------- config ----------

/** A capability value of `null` (JSON) / `undefined` means unknown. */
export interface Capabilities {
  maxContextTokens?: number | null;
  maxOptions?: number | null;
  languages?: string[] | null;
  primitives?: Primitive[] | null;
}

export interface HttpBackend {
  kind: "http";
  url: string;
  model: string;
  keyRef?: string;
  timeoutMs?: number;
  capabilities?: Capabilities;
}
export interface ManagedBackend {
  kind: "managed";
  engine: "von" | "laya";
  checkpoint?: string;
  port?: number;
  autostart?: boolean;
  timeoutMs?: number;
  capabilities?: Capabilities;
}
export interface LlmBackend {
  kind: "llm";
  role: string;
  timeoutMs?: number;
  capabilities?: Capabilities;
}
export type Backend = HttpBackend | ManagedBackend | LlmBackend;

export interface Preset {
  chain: string[];
  consumers?: Record<string, { chain: string[] }>;
}

export interface CalibrationRecord {
  mode: Mode;
  thresholds: Record<string, number>;
  model: string;
  measuredAt: string;
}

export interface SystemOneConfig {
  version: 1;
  allowOffMachine: boolean;
  backends: Record<string, Backend>;
  presets: Record<string, Preset>;
  activePreset: string;
  calibration: Record<string, CalibrationRecord>;
}
