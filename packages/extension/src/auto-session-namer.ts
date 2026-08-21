/**
 * Automatic session topic-naming (bridge-side).
 *
 * After each terminal turn (`agent_end`), an eligible session asks the naming
 * model (`@naming`, falling back to `@fast`) for a short topic title and
 * applies it via `pi.setSessionName(...)`. The name is the real pi session
 * name, mirrored to the dashboard through the existing `session_name_update`
 * path. The first successful name ends the loop permanently for that session.
 *
 * Naming is BOUNDED: a reasoning model can burn the whole output cap on
 * reasoning tokens and end truncated with no text, so truncation is a
 * first-class `starved` verdict and each session gets a total attempt budget.
 * Exhausting it stops naming permanently with an actionable error instead of
 * retrying silently forever.
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
 * See change: add-auto-session-naming, fix-auto-naming-reasoning-model.
 */

/** Greeting / trivial-opener set skipped without a model call. */
const GREETINGS = new Set([
  "hi", "hello", "hey", "yo", "sup", "test", "ping", "thanks", "thank you", "ok", "okay",
]);

/** Pre-filter: minimum trimmed length of the selected user message. */
export const MIN_FIRST_MESSAGE_LEN = 15;
/** Parse: reject titles longer than this many characters. */
export const MAX_TITLE_CHARS = 40;
/** Parse: reject titles with more than this many words. */
export const MAX_TITLE_WORDS = 6;
/**
 * Model call: base output cap. A title is a handful of tokens, but a REASONING
 * model spends its budget on reasoning tokens first and ends truncated with no
 * text at all. Measured on `deepseek/deepseek-v4-flash` with this exact prompt:
 * 16/64/256/512 all ended `length` with `''`; 1024 returned `NULL` (24
 * reasoning tokens); 2048 returned a title (724 reasoning tokens).
 *
 * The cap is a CEILING, not a charge — a non-reasoning model still bills ~2
 * output tokens — so the headroom is free on the common path.
 * See change: fix-auto-naming-reasoning-model (design D3).
 */
export const TITLE_MAX_TOKENS_BASE = 1024;
/** Model call: escalated cap, used once a session has recorded a `starved` verdict. */
export const TITLE_MAX_TOKENS_ESCALATED = 2048;
/**
 * Total naming attempts per session, shared by the `starved` and `waiting`
 * verdicts. Starvation is nondeterministic so one starved attempt must not stop
 * a session; equally `waiting` cannot retry forever against a 2048-token
 * ceiling. See design D5.
 */
const ATTEMPT_BUDGET = 3;
/** Transcript window: truncate the assistant side so a huge turn can't blow the window. */
const TRANSCRIPT_SIDE_MAX = 2000;
/** Transcript window: the user side is bounded far tighter than the assistant side. */
const TRANSCRIPT_USER_MAX = 200;

/** The sentinel the model emits when there is no nameable topic yet. */
export const NULL_SENTINEL = "NULL";

export const SUMMARIZER_SYSTEM_PROMPT = `You name a coding session by its TOPIC, not by restating the user's words.
Output ONLY the title: 2-5 words, Title Case, no quotes, no punctuation, no trailing period.
If the conversation has no clear topic yet (a greeting, a test message, or a
trivial one-off command), output exactly: ${NULL_SENTINEL}`;

/**
 * Cheap pre-filter — no model call. Skip when the selected user message is a
 * pure greeting, shorter than the configured minimum, or a bare slash-command.
 * It reads the SAME advancing window as the model call, so a session that opens
 * with "hi" is no longer skipped forever once it becomes substantive (D6).
 */
export function shouldSkipByPrefilter(userMsg: string | undefined): boolean {
  const t = (userMsg ?? "").trim();
  if (t.length < MIN_FIRST_MESSAGE_LEN) return true;
  if (/^\/\w+$/.test(t)) return true;
  if (GREETINGS.has(t.toLowerCase())) return true;
  return false;
}

/**
 * The stream's normalized stop reason, as pi-ai carries it on the `done` event
 * (`reason`, NOT `stopReason`). `aborted` / `error` arrive on the `error` event
 * instead and never reach the parser.
 */
export type StopReason = "stop" | "length" | "toolUse";

/**
 * A parse verdict. `starved` means the model could not emit a title under the
 * cap (or emitted nothing) — its text is NEVER applied. `waiting` means a
 * well-behaved model said "no nameable topic yet" or broke the shape guards.
 */
export type TitleVerdict =
  | { verdict: "title"; title: string }
  | { verdict: "waiting"; reason: string }
  | { verdict: "starved"; reason: string };

/**
 * Parse a model title response, keying on the stream's stop reason BEFORE
 * inspecting the text. With real headroom a truncated stream can carry a
 * plausible fragment ("Working On") that passes both shape guards, so the
 * emptiness of the text is NOT a sound truncation test — the stop reason is.
 * See design D4.
 */
export function parseTitle(
  raw: string | undefined,
  stopReason: StopReason = "stop",
): TitleVerdict {
  if (stopReason === "length") {
    return { verdict: "starved", reason: "output cap reached before a title was emitted" };
  }
  if (stopReason === "toolUse") {
    return { verdict: "starved", reason: "stream ended on a tool call, not a title" };
  }
  const t = (raw ?? "").trim();
  // Empty on an UNTRUNCATED stream is still starvation, not "no topic yet":
  // the NULL sentinel is how the model says "no topic". (Also covers a
  // content-filter refusal — same remedy, and the budget bounds the damage.)
  if (!t) return { verdict: "starved", reason: "model returned no text" };
  if (t.toUpperCase() === NULL_SENTINEL) {
    return { verdict: "waiting", reason: "no nameable topic yet" };
  }
  if (t.length > MAX_TITLE_CHARS) {
    return { verdict: "waiting", reason: `reply was ${t.length} chars, over the ${MAX_TITLE_CHARS}-char title bound` };
  }
  const words = t.split(/\s+/).length;
  if (words > MAX_TITLE_WORDS) {
    return { verdict: "waiting", reason: `reply was ${words} words, over the ${MAX_TITLE_WORDS}-word title bound` };
  }
  return { verdict: "title", title: t };
}

/**
 * Build the bounded transcript fed to the summarizer: the latest substantive
 * user message plus that turn's assistant reply, each truncated. Security:
 * ONLY these two bounded slices leave the process — never the full history.
 * Advancing the window to a later turn (design D6) changes WHICH turn is sent,
 * never HOW MUCH: the user side stays bounded at 200 chars and the assistant
 * side at 2000, exactly as before this change.
 */
export function buildTranscriptWindow(
  userMsg: string | undefined,
  assistantReply: string | undefined,
): string {
  const u = (userMsg ?? "").trim().slice(0, TRANSCRIPT_USER_MAX);
  const a = (assistantReply ?? "").trim().slice(0, TRANSCRIPT_SIDE_MAX);
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
 * Normalize a name with pi's own session-name sanitization: collapse internal
 * newlines to single spaces and trim. pi applies this before it stores /
 * broadcasts a name, so `session_info_changed` carries the sanitized form. The
 * bridge records the raw title it self-applied, so both sides MUST be
 * normalized before comparison or a newline-bearing self-title would look
 * external. See change: adopt-pi-074-080-features (A.2).
 */
export function sanitizeSessionName(name: string): string {
  return name.replace(/[\r\n]+/g, " ").trim();
}

/**
 * Classify an observed session-name value as self-applied (the bridge's own
 * auto-name) or external (a dashboard / in-pi rename). The bridge records the
 * exact title it self-applied; anything else is external → provenance `"user"`.
 * Both sides are sanitized (newline-collapsed + trimmed) so a self-applied
 * title containing internal newlines still matches the sanitized name pi
 * carries in `session_info_changed`. See change: adopt-pi-074-080-features (A.2).
 */
export function classifyNameChange(
  observed: string,
  lastSelfApplied: string | undefined,
): "self" | "external" {
  if (lastSelfApplied !== undefined && sanitizeSessionName(observed) === sanitizeSessionName(lastSelfApplied)) {
    return "self";
  }
  return "external";
}

export type GenerateResult =
  | { ok: true; text: string; stopReason: StopReason }
  | { ok: false; hardError: boolean; reason: string };

/** streamSimple's minimal shape (a subset of pi-ai's export). */
export type StreamSimpleFn = (model: unknown, context: unknown, options: unknown) => AsyncIterable<any>;

/**
 * Provider headers as pi 0.84.0+ returns them: a `null` value is a deletion
 * MARKER, not a missing header. pi-ai consumes markers to suppress a header it
 * would otherwise inject (e.g. a placeholder OpenAI key that must not reach
 * Cloudflare AI Gateway), so markers are forwarded unchanged rather than
 * stripped or stringified. See change: update-pi-core-0-84-adopt-apis.
 */
export type ProviderHeaders = Record<string, string | null>;

/**
 * True when at least one header carries a usable value. Distinct from
 * `Object.keys(headers).length > 0`, which counts deletion markers as
 * credentials and stays true for a null-only map. See design D4.
 */
export function hasUsableHeaders(headers: ProviderHeaders | undefined): boolean {
  if (!headers) return false;
  return Object.values(headers).some((v) => typeof v === "string" && v.length > 0);
}

/** The registry surface the namer needs (subset of pi's ModelRegistry). */
export interface NamerRegistry {
  find(provider: string, modelId: string): unknown;
  getApiKeyAndHeaders(model: unknown): Promise<{ apiKey?: string; headers?: ProviderHeaders }>;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Read a soft-error reason out of a pi-ai `error` stream event. The message
 * lives in the event's payload (`error.message` / `message.message`), NOT in a
 * top-level `errorMessage` field on every provider path, so a top-level-only
 * read silently degrades every soft error to "model error".
 * See change: fix-auto-naming-reasoning-model (test-plan #X5).
 */
function softErrorReason(ev: any): string {
  const candidates = [ev?.errorMessage, ev?.error?.message, ev?.message?.message, ev?.error, ev?.reason];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c;
  }
  return "model error";
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
  /** Adaptive output ceiling (design D3). Defaults to the base cap. */
  maxTokens?: number;
}): Promise<GenerateResult> {
  const { registry, streamSimple, modelRef, transcript } = deps;
  const maxTokens = deps.maxTokens ?? TITLE_MAX_TOKENS_BASE;
  const slash = modelRef.indexOf("/");
  if (slash <= 0) return { ok: false, hardError: true, reason: `malformed model ref '${modelRef}'` };
  const provider = modelRef.slice(0, slash);
  const modelId = modelRef.slice(slash + 1);

  const model = registry.find(provider, modelId);
  if (!model) return { ok: false, hardError: true, reason: `model '${modelRef}' not found in registry` };

  let apiKey: string | undefined;
  let headers: ProviderHeaders | undefined;
  try {
    ({ apiKey, headers } = await registry.getApiKeyAndHeaders(model));
  } catch (e) {
    // OAuth-only providers need pi-ai's separate oauth module the bridge does
    // not wire → cannot authenticate → hard error (no crash, no tight loop).
    return { ok: false, hardError: true, reason: `cannot authenticate '${modelRef}': ${errMsg(e)}` };
  }
  if (!apiKey && !hasUsableHeaders(headers)) {
    return { ok: false, hardError: true, reason: `no usable credentials for '${modelRef}' (OAuth-only?)` };
  }

  try {
    const stream = streamSimple(
      model,
      { messages: [{ role: "user", content: transcript }], systemPrompt: SUMMARIZER_SYSTEM_PROMPT },
      // No `reasoning` option is passed: pi-ai's SimpleStreamOptions accepts
      // only ThinkingLevel (`minimal`..`xhigh`) — there is no "off", and an
      // unsupported level can be clamped UP, re-starving the budget (design D2).
      { apiKey, headers, maxTokens },
    );
    let text = "";
    // pi-ai carries the normalized stop reason as `reason` on the done event.
    let stopReason: StopReason = "stop";
    for await (const ev of stream) {
      if (ev?.type === "text_delta" && typeof ev.delta === "string") {
        text += ev.delta;
      } else if (ev?.type === "done") {
        if (ev.reason === "length" || ev.reason === "toolUse" || ev.reason === "stop") {
          stopReason = ev.reason;
        }
        if (!text) text = collectText(ev.message);
      } else if (ev?.type === "error") {
        return { ok: false, hardError: false, reason: softErrorReason(ev) };
      }
    }
    return { ok: true, text, stopReason };
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
  /**
   * Resolve the naming model: `@naming`, falling back to `@fast`. `slot` names
   * which role actually supplied the reference so the error text can name it.
   */
  resolveNamingModel: () => { literal?: string; reason?: string; slot?: string };
  /** Captured pi ModelRegistry, or undefined before it is available. */
  getRegistry: () => NamerRegistry | undefined;
  /** Lazily acquire pi-ai's streamSimple; undefined if pi-ai is unreachable. */
  loadStreamSimple: () => Promise<StreamSimpleFn | undefined>;
  /** The latest substantive user message + that turn's assistant reply, live. */
  getTranscript: () => { userMsg?: string; assistantReply?: string };
  /** Apply an auto-name: `pi.setSessionName` + report provenance `"auto"`. */
  applyName: (title: string) => void;
  /** Report an externally-observed rename: provenance `"user"`. */
  reportUserRename: (name: string) => void;
  /** Emit a one-shot `auto_name_error`. */
  emitError: (reason: string) => void;
  /** Report this attempt's single outcome (already deduplicated by the namer). */
  reportOutcome?: (o: { outcome: NameOutcome; reason: string; modelRef?: string }) => void;
  /** Persist the durable stop state so it survives a PROCESS restart (design D7). */
  persistState?: (state: PersistedNamerState) => void;
  /** Attempt budget override — tests only; production uses `ATTEMPT_BUDGET`. */
  attemptBudget?: number;
}

/**
 * Every terminal exit path of one attempt reports exactly one of these. The
 * `inFlight` re-entrancy guard is NOT an attempt and is exempt. See design D9.
 */
type NameOutcome =
  | "applied"
  | "waiting"
  | "starved"
  | "skipped-prefilter"
  | "locked-out"
  | "disabled"
  | "already-named"
  | "not-ready"
  | "retrying"
  | "stopped";

/** Why a session stopped — decides whether re-resolution alone can clear it. */
type StopCause = "budget" | "role" | "registry" | "credentials" | "other";

/**
 * The explicitly enumerated state set carried across a reload and persisted
 * across a process restart. The namer OBJECT is deliberately not carried: its
 * closures would retain a stale connection, session id and ctx (design D7).
 */
export interface PersistedNamerState {
  hardStopped: boolean;
  errorEmitted: boolean;
  attemptsUsed: number;
  starvedCount: number;
  waitingCount: number;
  sawStarved: boolean;
  stoppedModelRef?: string;
  stopCause?: StopCause;
  nameSource?: "auto" | "user";
  hasAutoName: boolean;
  lastSelfApplied?: string;
}

export interface AutoNamer {
  /** Run one naming attempt on a terminal turn. Safe to call repeatedly. */
  maybeName: () => Promise<void>;
  /** Feed an observed session-name value for self-vs-external classification. */
  onObservedName: (observed: string) => void;
  /** Seed provenance restored from `.meta.json` on (re)connect. */
  seed: (source: "auto" | "user" | undefined) => void;
  /** The carry/persist state set (design D7). */
  exportState: () => PersistedNamerState;
  /** Test-only snapshot of internal state. */
  _state: () => {
    hasAutoName: boolean;
    hardStopped: boolean;
    nameSource: "auto" | "user" | undefined;
    attemptsUsed: number;
    sawStarved: boolean;
  };
}

/**
 * Create the per-session naming state machine. The bridge owns exactly one of
 * these (a bridge is a single pi session), so plain closure state is correct
 * across reload/reconnect.
 */
export function createAutoNamer(hooks: AutoNamerHooks, restored?: PersistedNamerState): AutoNamer {
  let hasAutoName = restored?.hasAutoName ?? false;
  let hardStopped = restored?.hardStopped ?? false;
  let nameSource: "auto" | "user" | undefined = restored?.nameSource;
  let lastSelfApplied: string | undefined = restored?.lastSelfApplied;
  let inFlight = false;
  let errorEmitted = restored?.errorEmitted ?? false;
  let attemptsUsed = restored?.attemptsUsed ?? 0;
  let starvedCount = restored?.starvedCount ?? 0;
  let waitingCount = restored?.waitingCount ?? 0;
  let sawStarved = restored?.sawStarved ?? false;
  let stoppedModelRef: string | undefined = restored?.stoppedModelRef;
  let stopCause: StopCause | undefined = restored?.stopCause;
  let lastSent: { outcome: NameOutcome; reason: string } | undefined;

  const budget = hooks.attemptBudget ?? ATTEMPT_BUDGET;

  function exportState(): PersistedNamerState {
    return {
      hardStopped, errorEmitted, attemptsUsed, starvedCount, waitingCount, sawStarved,
      stoppedModelRef, stopCause, nameSource, hasAutoName, lastSelfApplied,
    };
  }

  function persist(): void {
    hooks.persistState?.(exportState());
  }

  /**
   * Report one outcome, DEDUPLICATED on the wire: terminal states such as
   * `already-named` recur on every terminal turn for the life of the session,
   * so unconditional reporting would trade a bounded model cost for an
   * unbounded wire cost (design D9).
   */
  function report(outcome: NameOutcome, reason: string, modelRef?: string): void {
    if (lastSent && lastSent.outcome === outcome && lastSent.reason === reason) return;
    lastSent = { outcome, reason };
    hooks.reportOutcome?.({ outcome, reason, modelRef });
  }

  function hardStop(reason: string, cause: StopCause, modelRef?: string): void {
    hardStopped = true;
    stopCause = cause;
    stoppedModelRef = modelRef;
    if (!errorEmitted) {
      errorEmitted = true;
      hooks.emitError(reason);
    }
    report("stopped", reason, modelRef);
    persist();
  }

  /**
   * Clearing the stop MUST also reset the spent budget AND re-arm error
   * emission. Clearing the flag alone makes the operator's remedy vacuous: the
   * session retries once, instantly re-exhausts the already-spent budget, and
   * re-stops with NO error because the one-shot flag is still latched (D7).
   */
  function clearStop(): void {
    hardStopped = false;
    errorEmitted = false;
    attemptsUsed = 0;
    starvedCount = 0;
    waitingCount = 0;
    sawStarved = false;
    stoppedModelRef = undefined;
    stopCause = undefined;
    persist();
  }

  /** Spend one budget unit for a verdict that consumed a model completion. */
  function spendAttempt(verdict: "starved" | "waiting", modelRef: string, slot: string): void {
    attemptsUsed += 1;
    if (verdict === "starved") {
      starvedCount += 1;
      sawStarved = true;
    } else {
      waitingCount += 1;
    }
    if (attemptsUsed < budget) {
      persist();
      return;
    }
    // The remedy must match the DOMINANT cause: telling an operator whose
    // well-behaved model kept saying "no topic yet" to change that model is
    // wrong advice. A tie goes to `starved` — the more actionable remedy (D5).
    const reason = starvedCount >= waitingCount
      ? `auto-naming stopped after ${attemptsUsed} attempts: the model could not emit a title under the output cap (role @${slot} → ${modelRef}). Assign a different model to the naming role.`
      : `auto-naming stopped after ${attemptsUsed} attempts: no nameable topic emerged for this session (role @${slot} → ${modelRef}). The model behaved correctly.`;
    hardStop(reason, "budget", modelRef);
  }

  /**
   * Re-resolution clearing, evaluated BEFORE the stop short-circuits an attempt
   * (or the stop could never clear). Deliberately NOT driven by a roles-change
   * event: a role write is routed to ONE session's bridge, so a listener would
   * clear the stop only there and strand every other stopped session (D7).
   */
  async function maybeClearStop(literal: string | undefined): Promise<void> {
    if (!hardStopped) return;
    // A `user` lockout is not a naming stop and is never cleared by a model
    // reassignment (design D10).
    if (nameSource === "user") return;
    if (literal !== stoppedModelRef) {
      clearStop();
      return;
    }
    // The reference is unchanged, so a pure ref-comparison would strand a stop
    // whose cause was credentials or a missing registry entry. Re-probe it.
    if (stopCause !== "credentials" && stopCause !== "registry") return;
    if (!literal) return;
    const registry = hooks.getRegistry();
    if (!registry) return;
    const slash = literal.indexOf("/");
    if (slash <= 0) return;
    const model = registry.find(literal.slice(0, slash), literal.slice(slash + 1));
    if (!model) return;
    try {
      const { apiKey, headers } = await registry.getApiKeyAndHeaders(model);
      if (apiKey || hasUsableHeaders(headers)) clearStop();
    } catch {
      /* still unresolvable → the stop stands */
    }
  }

  async function maybeName(): Promise<void> {
    // The re-entrancy guard is NOT an attempt and reports no outcome (D9).
    if (inFlight) return;

    // The toggle is evaluated HERE, not at the bridge call site that used to
    // return before the namer was consulted, so `disabled` is reachable (D9).
    if (!hooks.getAutoNameSessions()) {
      report("disabled", "auto-naming is turned off");
      return;
    }
    if (nameSource === "user") {
      report("locked-out", "the session was renamed externally");
      return;
    }
    if (hasAutoName) {
      report("already-named", "the session already has an auto-name");
      return;
    }

    // Latched BEFORE the first await, so two adjacent terminal turns cannot
    // both start a model call and both spend budget (design D8).
    inFlight = true;
    try {
      const { literal, reason, slot } = hooks.resolveNamingModel();
      await maybeClearStop(literal);
      if (hardStopped) {
        report("stopped", "auto-naming is stopped for this session", stoppedModelRef);
        return;
      }

      const { userMsg, assistantReply } = hooks.getTranscript();
      if (shouldSkipByPrefilter(userMsg)) {
        report("skipped-prefilter", "no substantive user message yet");
        return;
      }

      if (!literal) {
        hardStop(
          `auto-naming stopped: neither the @naming role nor the @fast role is configured (${reason ?? "unset"})`,
          "role",
        );
        return;
      }
      const roleSlot = slot ?? "naming";

      const registry = hooks.getRegistry();
      const streamSimple = await hooks.loadStreamSimple();
      // Not ready yet (registry not captured / pi-ai still loading) → retry
      // later. Not an error, and it spends no budget.
      if (!registry || !streamSimple) {
        report("not-ready", "the model registry or pi-ai is not available yet", literal);
        return;
      }

      const transcript = buildTranscriptWindow(userMsg, assistantReply);
      // Adaptive ceiling: escalate only for a session that PROVED it starves,
      // so the headroom is targeted rather than paid globally (design D3).
      const maxTokens = sawStarved ? TITLE_MAX_TOKENS_ESCALATED : TITLE_MAX_TOKENS_BASE;
      const res = await generateTitle({ registry, streamSimple, modelRef: literal, transcript, maxTokens });

      if (!res.ok) {
        if (res.hardError) {
          const cause: StopCause = /credential|authenticate/i.test(res.reason)
            ? "credentials"
            : /not found in registry/i.test(res.reason)
              ? "registry"
              : "other";
          hardStop(res.reason, cause, literal);
          return;
        }
        // Soft error (transient / aborted): spends NO budget, and reports
        // `retrying` rather than `waiting` — conflating a transient failure
        // with "no topic yet" destroys the diagnostic value of both (D9).
        report("retrying", res.reason, literal);
        return;
      }

      const verdict = parseTitle(res.text, res.stopReason);
      if (verdict.verdict !== "title") {
        report(verdict.verdict, verdict.reason, literal);
        spendAttempt(verdict.verdict, literal, roleSlot);
        return;
      }

      // Re-check eligibility AFTER the await: an external rename can land
      // mid-stream and latch provenance `user`, and applying now would
      // overwrite both the user's name and its provenance (design D8).
      if (hardStopped || !isEligible({ autoNameSessions: hooks.getAutoNameSessions(), nameSource, hasAutoName })) {
        report("locked-out", "the session changed while the naming call was in flight", literal);
        return;
      }

      // Ordered so the one-shot guard holds even if `applyName` throws.
      lastSelfApplied = verdict.title;
      hasAutoName = true;
      nameSource = "auto";
      report("applied", verdict.title, literal);
      persist();
      hooks.applyName(verdict.title);
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
      persist();
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
    exportState,
    _state: () => ({ hasAutoName, hardStopped, nameSource, attemptsUsed, sawStarved }),
  };
}
