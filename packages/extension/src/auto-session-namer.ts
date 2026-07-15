/**
 * Automatic session topic-naming (bridge-side).
 *
 * After each terminal turn (`agent_end`), an eligible session asks the `@fast`
 * model for a short topic title and applies it via `pi.setSessionName(...)`.
 * The name is the real pi session name, mirrored to the dashboard through the
 * existing `session_name_update` path. The first successful name ends the loop
 * permanently for that session.
 *
 * Placement is pure-bridge: the model call runs in-process via pi-ai's
 * `streamSimple` + the model registry's credential resolution — the same
 * primitives the server's model-proxy uses, minus the HTTP round-trip. No
 * dependency on the dashboard server being reachable.
 *
 * This file holds the PURE, unit-testable pieces (pre-filter, parse, transcript
 * window, model call, eligibility, provenance classifier) plus a small stateful
 * factory (`createAutoNamer`) that the bridge owns once per session.
 *
 * See change: add-auto-session-naming.
 */

/** Greeting / trivial-opener set skipped without a model call. */
const GREETINGS = new Set([
  "hi", "hello", "hey", "yo", "sup", "test", "ping", "thanks", "thank you", "ok", "okay",
]);

/** Pre-filter: minimum trimmed length of the first user message. */
export const MIN_FIRST_MESSAGE_LEN = 15;
/** Parse: reject titles longer than this many characters. */
export const MAX_TITLE_CHARS = 40;
/** Parse: reject titles with more than this many words. */
export const MAX_TITLE_WORDS = 6;
/** Model call: cap output — a title is a handful of tokens. */
export const TITLE_MAX_TOKENS = 16;
/** Transcript window: truncate each side so a huge turn can't blow the window. */
const TRANSCRIPT_SIDE_MAX = 2000;

/** The sentinel the model emits when there is no nameable topic yet. */
export const NULL_SENTINEL = "NULL";

export const SUMMARIZER_SYSTEM_PROMPT = `You name a coding session by its TOPIC, not by restating the user's words.
Output ONLY the title: 2-5 words, Title Case, no quotes, no punctuation, no trailing period.
If the conversation has no clear topic yet (a greeting, a test message, or a
trivial one-off command), output exactly: ${NULL_SENTINEL}`;

/**
 * Cheap pre-filter — no model call. Skip when the first user message is a pure
 * greeting, shorter than the configured minimum, or a bare slash-command.
 */
export function shouldSkipByPrefilter(firstUserMsg: string | undefined): boolean {
  const t = (firstUserMsg ?? "").trim();
  if (t.length < MIN_FIRST_MESSAGE_LEN) return true;
  if (/^\/\w+$/.test(t)) return true;
  if (GREETINGS.has(t.toLowerCase())) return true;
  return false;
}

/**
 * Parse a model title response. Trim; a `NULL` sentinel, empty, over-long, or
 * over-wordy response means "not yet — retry on a later turn".
 */
export function parseTitle(raw: string | undefined): { title?: string; wait: boolean } {
  const t = (raw ?? "").trim();
  if (!t) return { wait: true };
  if (t.toUpperCase() === NULL_SENTINEL) return { wait: true };
  if (t.length > MAX_TITLE_CHARS) return { wait: true };
  if (t.split(/\s+/).length > MAX_TITLE_WORDS) return { wait: true };
  return { title: t, wait: false };
}

/**
 * Build the bounded transcript fed to the summarizer: the first substantive
 * user message plus the first assistant reply, each truncated. Security:
 * ONLY these two bounded slices leave the process — never the full history.
 */
export function buildTranscriptWindow(
  firstUserMsg: string | undefined,
  firstAssistantReply: string | undefined,
): string {
  const u = (firstUserMsg ?? "").trim().slice(0, TRANSCRIPT_SIDE_MAX);
  const a = (firstAssistantReply ?? "").trim().slice(0, TRANSCRIPT_SIDE_MAX);
  return a ? `${u}\n\n${a}` : u;
}

/** Eligibility gate: ALL must hold to attempt naming. */
export function isEligible(state: {
  autoNameSessions: boolean;
  nameSource: "auto" | "user" | undefined;
  hasAutoName: boolean;
}): boolean {
  if (!state.autoNameSessions) return false;
  if (state.nameSource === "user") return false;
  if (state.hasAutoName) return false;
  return true;
}

/**
 * Classify an observed session-name value as self-applied (the bridge's own
 * auto-name) or external (a dashboard / in-pi rename). The bridge records the
 * exact title it self-applied; anything else is external → provenance `"user"`.
 */
export function classifyNameChange(
  observed: string,
  lastSelfApplied: string | undefined,
): "self" | "external" {
  if (lastSelfApplied !== undefined && observed === lastSelfApplied) return "self";
  return "external";
}

export type GenerateResult =
  | { ok: true; text: string }
  | { ok: false; hardError: boolean; reason: string };

/** streamSimple's minimal shape (a subset of pi-ai's export). */
export type StreamSimpleFn = (model: unknown, context: unknown, options: unknown) => AsyncIterable<any>;

/** The registry surface the namer needs (subset of pi's ModelRegistry). */
export interface NamerRegistry {
  find(provider: string, modelId: string): unknown;
  getApiKeyAndHeaders(model: unknown): Promise<{ apiKey?: string; headers?: Record<string, string> }>;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Collect concatenated text from a final pi-ai AssistantMessage. */
function collectText(message: any): string {
  const content = message?.content;
  if (!Array.isArray(content)) return "";
  let out = "";
  for (const part of content) {
    if (part?.type === "text" && typeof part.text === "string") out += part.text;
  }
  return out;
}

/**
 * Resolve credentials + call the model in-process. Mirrors the server's
 * model-proxy streamer, minus HTTP. Returns a discriminated result:
 * - `ok` with the collected text,
 * - hard error (unknown model / unauthable OAuth-only) → caller stops permanently,
 * - soft error (transient model/network) → caller retries next turn.
 */
export async function generateTitle(deps: {
  registry: NamerRegistry;
  streamSimple: StreamSimpleFn;
  modelRef: string;
  transcript: string;
}): Promise<GenerateResult> {
  const { registry, streamSimple, modelRef, transcript } = deps;
  const slash = modelRef.indexOf("/");
  if (slash <= 0) return { ok: false, hardError: true, reason: `malformed model ref '${modelRef}'` };
  const provider = modelRef.slice(0, slash);
  const modelId = modelRef.slice(slash + 1);

  const model = registry.find(provider, modelId);
  if (!model) return { ok: false, hardError: true, reason: `model '${modelRef}' not found in registry` };

  let apiKey: string | undefined;
  let headers: Record<string, string> | undefined;
  try {
    ({ apiKey, headers } = await registry.getApiKeyAndHeaders(model));
  } catch (e) {
    // OAuth-only providers need pi-ai's separate oauth module the bridge does
    // not wire → cannot authenticate → hard error (no crash, no tight loop).
    return { ok: false, hardError: true, reason: `cannot authenticate '${modelRef}': ${errMsg(e)}` };
  }
  if (!apiKey && !(headers && Object.keys(headers).length > 0)) {
    return { ok: false, hardError: true, reason: `no usable credentials for '${modelRef}' (OAuth-only?)` };
  }

  try {
    const stream = streamSimple(
      model,
      { messages: [{ role: "user", content: transcript }], systemPrompt: SUMMARIZER_SYSTEM_PROMPT },
      { apiKey, headers, maxTokens: TITLE_MAX_TOKENS },
    );
    let text = "";
    for await (const ev of stream) {
      if (ev?.type === "text_delta" && typeof ev.delta === "string") {
        text += ev.delta;
      } else if (ev?.type === "done") {
        if (!text) text = collectText(ev.message);
      } else if (ev?.type === "error") {
        return { ok: false, hardError: false, reason: ev.errorMessage ?? "model error" };
      }
    }
    return { ok: true, text };
  } catch (e) {
    // Transient (network / provider) — soft error, retry next turn.
    return { ok: false, hardError: false, reason: errMsg(e) };
  }
}

/**
 * Hooks the bridge supplies to drive one session's naming lifecycle.
 * All side-effects (pi/registry/wire) are injected so the state machine is
 * unit-testable in isolation.
 */
export interface AutoNamerHooks {
  /** Current global toggle (from the last `preferences_update`). */
  getAutoNameSessions: () => boolean;
  /** Resolve `@fast` → `{ literal }` or `{ reason }` (lookupRole). */
  resolveFastModel: () => { literal?: string; reason?: string };
  /** Captured pi ModelRegistry, or undefined before it is available. */
  getRegistry: () => NamerRegistry | undefined;
  /** Lazily acquire pi-ai's streamSimple; undefined if pi-ai is unreachable. */
  loadStreamSimple: () => Promise<StreamSimpleFn | undefined>;
  /** The first substantive user message + first assistant reply, live. */
  getTranscript: () => { firstUserMsg?: string; firstAssistantReply?: string };
  /** Apply an auto-name: `pi.setSessionName` + report provenance `"auto"`. */
  applyName: (title: string) => void;
  /** Report an externally-observed rename: provenance `"user"`. */
  reportUserRename: (name: string) => void;
  /** Emit a one-shot `auto_name_error`. */
  emitError: (reason: string) => void;
}

export interface AutoNamer {
  /** Run one naming attempt on a terminal turn. Safe to call repeatedly. */
  maybeName: () => Promise<void>;
  /** Feed an observed session-name value for self-vs-external classification. */
  onObservedName: (observed: string) => void;
  /** Seed provenance restored from `.meta.json` on (re)connect. */
  seed: (source: "auto" | "user" | undefined) => void;
  /** Test-only snapshot of internal state. */
  _state: () => { hasAutoName: boolean; hardStopped: boolean; nameSource: "auto" | "user" | undefined };
}

/**
 * Create the per-session naming state machine. The bridge owns exactly one of
 * these (a bridge is a single pi session), so plain closure state is correct
 * across reload/reconnect.
 */
export function createAutoNamer(hooks: AutoNamerHooks): AutoNamer {
  let hasAutoName = false;
  let hardStopped = false;
  let nameSource: "auto" | "user" | undefined;
  let lastSelfApplied: string | undefined;
  let inFlight = false;
  let errorEmitted = false;

  function hardStop(reason: string): void {
    hardStopped = true;
    if (!errorEmitted) {
      errorEmitted = true;
      hooks.emitError(reason);
    }
  }

  async function maybeName(): Promise<void> {
    if (hardStopped || inFlight) return;
    if (!isEligible({ autoNameSessions: hooks.getAutoNameSessions(), nameSource, hasAutoName })) return;

    const { firstUserMsg, firstAssistantReply } = hooks.getTranscript();
    if (shouldSkipByPrefilter(firstUserMsg)) return;

    const { literal, reason } = hooks.resolveFastModel();
    if (!literal) {
      hardStop(`@fast role not configured: ${reason ?? "unset"}`);
      return;
    }

    const registry = hooks.getRegistry();
    const streamSimple = await hooks.loadStreamSimple();
    // Not ready yet (registry not captured / pi-ai still loading) → retry later,
    // NOT a hard error.
    if (!registry || !streamSimple) return;

    inFlight = true;
    try {
      const transcript = buildTranscriptWindow(firstUserMsg, firstAssistantReply);
      const res = await generateTitle({ registry, streamSimple, modelRef: literal, transcript });
      if (!res.ok) {
        if (res.hardError) hardStop(res.reason);
        // soft error → silent, retry next terminal turn
        return;
      }
      const { title, wait } = parseTitle(res.text);
      if (wait || !title) return;
      lastSelfApplied = title;
      hasAutoName = true;
      nameSource = "auto";
      hooks.applyName(title);
    } finally {
      inFlight = false;
    }
  }

  function onObservedName(observed: string): void {
    if (!observed) return;
    if (classifyNameChange(observed, lastSelfApplied) === "self") return;
    if (nameSource !== "user") {
      nameSource = "user";
      hardStopped = true; // permanent lockout
      hooks.reportUserRename(observed);
    }
  }

  function seed(source: "auto" | "user" | undefined): void {
    if (source === "user") {
      nameSource = "user";
      hardStopped = true;
    } else if (source === "auto") {
      nameSource = "auto";
      hasAutoName = true;
    }
  }

  return {
    maybeName,
    onObservedName,
    seed,
    _state: () => ({ hasAutoName, hardStopped, nameSource }),
  };
}
