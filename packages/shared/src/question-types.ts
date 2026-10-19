/**
 * Pending-question stack contracts shared by server, client and the REST API.
 * Rows are light (no context bodies); detail is fetched lazily by id.
 * See change: add-pending-question-stack.
 */
import type { BatchQuestion, InteractiveMethod } from "./protocol.js";

/** Brief lifecycle: provided by the agent, generated on demand, or not available. */
export type BriefStatus = "provided" | "pending" | "ready" | "failed" | "unavailable";

/** Who/what raised the question — drives the origin marker in the stack. */
export type QuestionOrigin = "file" | "chat-gateway" | "widget-bar";

/** How the brief was produced (labelled in the dialog). */
export type BriefLabel = "provided" | "generated" | "generated-limited";

/** Maximum characters of `QuestionRow.preview`. */
export const QUESTION_PREVIEW_MAX = 140;

export interface QuestionRow {
  /** Opaque, URL-safe, unguessable id (stable across bridge re-sends). */
  id: string;
  sessionId: string;
  sessionLabel: string;
  changeName?: string;
  /** First {@link QUESTION_PREVIEW_MAX} characters of the question. */
  preview: string;
  /** Prompt type. Wire value stays a string for custom adapters. */
  type: InteractiveMethod | (string & {});
  origin?: QuestionOrigin;
  /** Epoch ms when the server first observed the question. */
  askedAt: number;
  briefStatus: BriefStatus;
}

export interface QuestionSnapshotToolCall {
  name: string;
  summary: string;
}

/** Best-effort, immutable, redacted context captured at first observation. */
export interface QuestionSnapshot {
  assistantText?: string;
  /** Why `assistantText` is absent. */
  assistantAbsentReason?: "none" | "evicted";
  toolCalls: QuestionSnapshotToolCall[];
  workflowRun?: unknown;
  /** `REDACTION_VERSION` in force when the snapshot was stored. */
  redactionVersion: number;
}

export interface QuestionDetail extends QuestionRow {
  question: string;
  options?: string[];
  /** Inline "Other" opt-in from the live prompt (never persisted). See change: add-ask-user-inline-other. */
  allowOther?: true;
  brief?: string;
  briefLabel?: BriefLabel;
  snapshot: QuestionSnapshot;
  /** False for file-access prompts (answered on their own road). */
  answerable: boolean;
  /** Sub-questions, present only when `type === "batch"`. */
  questions?: BatchQuestion[];
}

/** `POST /api/questions/:id/answer` body: exactly one of the two forms. */
export type QuestionAnswerRequest = { answer: string } | { cancelled: true };

/** Server → browser: current visible rows for this recipient (full replacement). */
export interface QuestionsUpdateMessage {
  type: "questions_update";
  questions: QuestionRow[];
}
