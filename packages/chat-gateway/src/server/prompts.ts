/**
 * chat-gateway interactive-prompt mapping (R6).
 *
 * Renders from `prompt.type` + `options` + `metadata` ONLY — the React-specific
 * `component`/`props` are ignored, so a renderer change never breaks the chat
 * surface. TOTAL: an unknown type or a non-object input yields
 * `kind:"unsupported"` instead of throwing.
 *
 * `multiselect` (F3) composes into a toggle-per-option sequence ending in a
 * confirm; `batch` (F4) flattens `metadata.questions` into an ordered sequence
 * whose answers are index-aligned.
 *
 * See change: add-chat-gateway.
 */

export interface PromptControl {
  requestId: string;
  kind:
    | "select"
    | "confirm"
    | "input"
    | "editor"
    | "multiselect"
    | "batch"
    | "notify"
    | "unsupported";
  title: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
  subPrompts?: PromptControl[];
}

const KINDS = new Set([
  "select",
  "confirm",
  "input",
  "editor",
  "multiselect",
  "batch",
  "notify",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function strArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((v): v is string => typeof v === "string");
  return out.length > 0 ? out : undefined;
}

export function toPromptControl(request: unknown): PromptControl {
  if (!isObject(request)) {
    return { requestId: "", kind: "unsupported", title: "" };
  }
  // Accept both the wrapped (`{ requestId, prompt }`) and flat shapes.
  const prompt = isObject(request.prompt) ? request.prompt : request;
  const metadata = isObject(prompt.metadata) ? prompt.metadata : {};

  const requestId = str(request.requestId) ?? str(prompt.requestId) ?? "";
  const title = str(prompt.title) ?? str(metadata.title) ?? "";
  const message = str(prompt.message) ?? str(metadata.message);
  const placeholder = str(prompt.placeholder) ?? str(metadata.placeholder);
  const prefill = str(prompt.prefill) ?? str(metadata.prefill);
  const options = strArray(prompt.options) ?? strArray(metadata.options);

  const type = typeof prompt.type === "string" ? prompt.type : "";
  if (!KINDS.has(type)) {
    return { requestId, kind: "unsupported", title };
  }
  const kind = type as PromptControl["kind"];

  const control: PromptControl = { requestId, kind, title };
  if (message !== undefined) control.message = message;
  if (options !== undefined) control.options = options;
  if (placeholder !== undefined) control.placeholder = placeholder;
  if (prefill !== undefined) control.prefill = prefill;

  if (kind === "multiselect") {
    control.subPrompts = multiselectToSequence(requestId, title, options ?? []);
  } else if (kind === "batch") {
    control.subPrompts = batchToSequence(requestId, title, normalizeQuestions(metadata.questions));
  }
  return control;
}

function normalizeQuestions(
  value: unknown,
): Array<{ title: string; options?: string[]; placeholder?: string }> {
  if (!Array.isArray(value)) return [];
  const out: Array<{ title: string; options?: string[]; placeholder?: string }> = [];
  for (const q of value) {
    if (!isObject(q)) continue;
    const entry: { title: string; options?: string[]; placeholder?: string } = {
      title: str(q.title) ?? "",
    };
    const options = strArray(q.options);
    if (options !== undefined) entry.options = options;
    const placeholder = str(q.placeholder);
    if (placeholder !== undefined) entry.placeholder = placeholder;
    out.push(entry);
  }
  return out;
}

/**
 * F3: one toggle sub-prompt per option (index-aligned with `options`), then a
 * trailing confirm that submits the accumulated selection.
 */
export function multiselectToSequence(
  requestId: string,
  title: string,
  options: string[],
): PromptControl[] {
  const opts = Array.isArray(options)
    ? options.filter((o): o is string => typeof o === "string")
    : [];
  const sequence: PromptControl[] = opts.map((option, index) => ({
    requestId: `${requestId}:${index}`,
    kind: "confirm" as const,
    title,
    message: option,
  }));
  sequence.push({
    requestId: `${requestId}:confirm`,
    kind: "confirm",
    title,
    message: "Confirm selection",
  });
  return sequence;
}

/** F4: flatten `metadata.questions` into an ordered sequence. */
export function batchToSequence(
  requestId: string,
  title: string,
  questions: Array<{ title: string; options?: string[]; placeholder?: string }>,
): PromptControl[] {
  const list = Array.isArray(questions) ? questions : [];
  return list.map((q, index) => {
    const options = strArray(q?.options);
    const control: PromptControl = {
      requestId: `${requestId}:${index}`,
      kind: options !== undefined ? "select" : "input",
      title: str(q?.title) ?? title,
    };
    if (options !== undefined) control.options = options;
    const placeholder = str(q?.placeholder);
    if (placeholder !== undefined) control.placeholder = placeholder;
    return control;
  });
}

/** F4: answers stay index-aligned with the sub-prompt sequence. */
export function composeBatchAnswer(
  index: number,
  answers: string[],
): { index: number; value: string } {
  const list = Array.isArray(answers) ? answers : [];
  const value = typeof list[index] === "string" ? list[index] : "";
  return { index, value };
}

/**
 * F3 final composition: option values whose toggle was answered "yes",
 * JSON-encoded exactly like the web UI's multiselect arm (`values[]`), so the
 * PromptBus decodes both surfaces identically. An empty selection encodes as
 * `"[]"` — distinct from cancellation.
 */
export function composeMultiselectAnswer(options: string[], toggles: boolean[]): string {
  const opts = Array.isArray(options) ? options : [];
  return JSON.stringify(opts.filter((_, i) => toggles[i] === true));
}

/**
 * F4 final composition: index-aligned batch answers, JSON-encoded (`answers[]`)
 * so a batch surfaces as one `prompt_response` carrying every sub-answer.
 */
export function composeBatchAnswers(answers: string[]): string {
  const list = Array.isArray(answers) ? answers : [];
  return JSON.stringify(list.map((a) => (typeof a === "string" ? a : "")));
}
