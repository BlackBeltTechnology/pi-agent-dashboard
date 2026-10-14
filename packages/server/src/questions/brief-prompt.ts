/**
 * The fixed generation prompt: question, options, context message and the
 * (already redacted) snapshot → ≤ 120 words (task / why asking / per-option
 * outcome). The assembled text is redacted AGAIN here: the question, options
 * and message are not part of the stored snapshot, and this is the last point
 * before the text leaves for the `@fast` provider.
 * See change: add-pending-question-stack (D2, D4).
 */
import { redactSecrets } from "@blackbelt-technology/pi-dashboard-shared/redaction.js";
import type { BatchQuestion } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import type { QuestionSnapshot } from "@blackbelt-technology/pi-dashboard-shared/question-types.js";

export const BRIEF_MAX_WORDS = 120;

export interface BriefPromptInput {
  question: string;
  type: string;
  options?: string[];
  subQuestions?: BatchQuestion[];
  message?: string;
  snapshot: QuestionSnapshot;
}

/** Free-text prompt types have no options to explain. */
export function isOptionBearing(type: string): boolean {
  return type !== "input" && type !== "editor";
}

export function buildBriefPrompt(input: BriefPromptInput): { system: string; user: string } {
  const perOption = isOptionBearing(input.type);
  const system = [
    "You write a short situation brief so a person can answer an AI coding agent's question without reading the chat log.",
    `Write at most ${BRIEF_MAX_WORDS} words of plain prose, no preamble.`,
    "State: (1) what the agent was working on, (2) what led to this question,",
    perOption ? "(3) what each option leads to (one short clause per option)." : "(3) nothing else — this question takes free text, so do not list options.",
    "Use only the material below; if it is thin, say less rather than guess.",
  ].join(" ");

  const lines: string[] = [`Question (${input.type}): ${input.question}`];
  if (input.options?.length) lines.push(`Options: ${input.options.map((o) => JSON.stringify(o)).join(", ")}`);
  for (const [i, q] of (input.subQuestions ?? []).entries()) {
    const opts = q.options?.length ? ` options: ${q.options.map((o) => JSON.stringify(o)).join(", ")}` : "";
    lines.push(`Sub-question ${i + 1} (${q.method}): ${q.title}${q.message ? ` — ${q.message}` : ""}${opts}`);
  }
  if (input.message) lines.push(`Context message from the agent: ${input.message}`);

  const { snapshot } = input;
  if (snapshot.assistantText) lines.push(`Last assistant message:\n${snapshot.assistantText}`);
  else lines.push("No assistant text is available (limited context).");
  if (snapshot.toolCalls.length) {
    lines.push(`Recent tool calls:\n${snapshot.toolCalls.map((t) => `- ${t.name}: ${t.summary}`).join("\n")}`);
  }
  if (snapshot.workflowRun !== undefined) {
    try {
      lines.push(`Workflow run: ${JSON.stringify(snapshot.workflowRun)}`);
    } catch {
      /* unserialisable metadata is simply omitted */
    }
  }
  return { system: redactSecrets(system), user: redactSecrets(lines.join("\n\n")) };
}
