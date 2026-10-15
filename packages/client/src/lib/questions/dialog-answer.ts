/**
 * Encode a renderer result for the REST answer road. Answers on this road are
 * TEXT-ONLY: pasted images (`{value, images}`, batch input entries) are dropped
 * before encoding with the shared `encodePromptAnswer`, because the server
 * validator rejects them. See change: add-pending-question-stack (D8).
 */
import { encodePromptAnswer } from "@blackbelt-technology/pi-dashboard-shared/prompt-answer.js";

function withoutImages(entry: unknown): unknown {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
  const { images: _images, ...rest } = entry as Record<string, unknown>;
  return rest;
}

function textOnlyResult(result: unknown): unknown {
  if (!result || typeof result !== "object") return result;
  const r = result as Record<string, unknown>;
  if (Array.isArray(r.answers)) return { ...r, answers: r.answers.map(withoutImages) };
  return withoutImages(r);
}

/** Renderer result → `answer` string (never undefined: cancel is a separate call). */
export function encodeDialogAnswer(result: unknown): string {
  return encodePromptAnswer(textOnlyResult(result), false) ?? "";
}
