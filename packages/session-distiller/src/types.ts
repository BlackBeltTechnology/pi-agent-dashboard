/**
 * Shared types for the session-knowledge distiller.
 * Schema derived from pi session JSONL (see design.md → "Context").
 */

// --- Raw session events (one per JSONL line) ---

export interface RawMessage {
  role: "user" | "assistant" | "toolResult";
  content?: unknown; // string | ContentBlock[]
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
}

export interface RawEvent {
  type: string; // session | model_change | session_info | custom | message | ...
  id?: string;
  parentId?: string | null;
  timestamp?: string;
  // session header
  cwd?: string;
  version?: number;
  // model_change
  provider?: string;
  modelId?: string;
  // session_info
  name?: string;
  // custom
  customType?: string;
  data?: unknown;
  // message
  message?: RawMessage;
}

export interface ReadResult {
  events: RawEvent[];
  malformed: number;
}

// --- Normalized trajectory model ---

export interface ToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface ToolResult {
  toolCallId: string;
  toolName?: string;
  text: string;
  isError: boolean;
  timestamp?: string;
}

export interface Turn {
  role: "user" | "assistant" | "toolResult";
  timestamp?: string;
  text?: string;
  thinking?: string;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  /** session_info.name in effect at this turn (drives name-change segmentation) */
  name?: string;
}

/** A call paired to its result (result undefined => unpaired). */
export interface ToolPair {
  call: ToolCall;
  result?: ToolResult;
}

export interface Trajectory {
  sessionId: string;
  cwd: string;
  startedAt: string;
  model?: string;
  name?: string;
  turns: Turn[];
  pairs: ToolPair[];
}

// --- Episodes (segmented tasks within a trajectory) ---

export interface Episode {
  sessionId: string;
  index: number;
  name?: string;
  userPrompt?: string;
  startedAt?: string;
  turns: Turn[];
}

// --- Extracted signal candidates ---

export type SignalClass =
  | "fault"
  | "ask_user_decision"
  | "user_correction"
  | "procedure"
  | "documentation";

export interface CandidateBase {
  signal: SignalClass;
  sessionId: string;
  model?: string;
  /** signature for cross-session clustering */
  signature: string;
  /** whether the span ended in a verified-good state */
  verified: boolean;
}

export interface FaultCandidate extends CandidateBase {
  signal: "fault";
  wrongCall: ToolCall;
  error: string;
  fixCall: ToolCall;
}

export interface DecisionCandidate extends CandidateBase {
  signal: "ask_user_decision";
  question: string;
  answer: string;
}

export interface CorrectionCandidate extends CandidateBase {
  signal: "user_correction";
  correction: string;
  precededBy?: string;
  /** correction establishes a reusable rule => also patch AGENTS.md */
  rule: boolean;
}

export interface ProcedureCandidate extends CandidateBase {
  signal: "procedure";
  toolSequence: string[];
  userPrompt?: string;
}

export interface DocumentationCandidate extends CandidateBase {
  signal: "documentation";
  summary: string;
}

export type Candidate =
  | FaultCandidate
  | DecisionCandidate
  | CorrectionCandidate
  | ProcedureCandidate
  | DocumentationCandidate;
