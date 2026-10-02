/**
 * The `AuthInteraction` adapter that lets pi-ai's OAuth flows drive the
 * dashboard — plus the flow store behind the `/flow/:flowId` routes.
 *
 * One adapter serves every provider (current and future). pi-ai's `login()` is
 * the whole flow: it opens its own loopback callback listener, polls device
 * codes, and exchanges codes for tokens. The dashboard's job is to be an
 * `AuthInteraction`, then persist the credential through the existing locked,
 * backed-up `writeCredential()` path.
 *
 * Two details are load-bearing and easy to get wrong:
 *
 * 1. **The abort row.** In pi-ai's auth-code flows the outer `signal` only
 *    cancels the callback wait; the code then `await`s a `manualPromise` whose
 *    own signal is aborted in the `finally` block that closes the listener.
 *    Waiting on the prompt-level signal alone would deadlock and leave the
 *    callback port bound. So the flow's controller REJECTS every pending prompt
 *    (`"Cancelled"`), which settles `manualPromise` and lets `finally` run.
 *
 * 2. **`authUrl` and `pending` co-exist.** An `auth_url` notify and a
 *    `manual_code` prompt are issued back-to-back, so the record holds a sticky
 *    `authUrl` string *plus* the current prompt — never a single-slot union —
 *    and the UI renders the link and the paste field together.
 *
 * See change: delegate-provider-oauth-to-pi-ai (D1, D2, D6, D7).
 */

import crypto from "node:crypto";
import type {
  OAuthFlowPending,
  OAuthFlowStatus,
} from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import type {
  LoginEvent,
  LoginInteraction,
  LoginPrompt,
  OAuthCredential,
  OAuthLoginFlow,
} from "./pi-oauth-types.js";

/** Default lifetime: "A flow SHALL live at least 10 minutes from start." */
const FLOW_TTL_MS = 10 * 60 * 1000;
/** Device-code flows outlive the default by `expiresInSeconds + this`. */
const DEVICE_CODE_TTL_SLACK_MS = 60 * 1000;
/** `POST /start` waits this long for a first user-facing step. */
export const FLOW_START_TIMEOUT_MS = 15_000;
/** Background prune cadence; pruning also runs on every provider-auth request. */
const PRUNE_INTERVAL_MS = 60_000;
/** How long a supersede waits for the outgoing flow's listener to close. */
export const SUPERSEDE_SETTLE_TIMEOUT_MS = 2_000;

type OAuthFlowState = "pending" | "complete" | "error" | "expired";

/**
 * Live flow record. `resolveInput` / `rejectInput` / `preAnswers` /
 * `promptCount` / `abort` / `settled` are server-only and never serialised —
 * {@link toFlowStatus} is the only thing that crosses the wire.
 */
export interface OAuthFlow {
  id: string;
  provider: string;
  status: OAuthFlowState;
  createdAt: number;
  expiresAt: number;
  /** Set from the device code's `expiresInSeconds`; drives `expired` derivation. */
  deviceCodeDeadline?: number;
  /** Set by cancel / prune / supersede BEFORE `abort.abort()`. */
  cancelled: boolean;
  /** Sticky: set by the first `auth_url` notify, never cleared. */
  authUrl?: string;
  /** Last `progress` / `info` text. */
  message?: string;
  pending?: OAuthFlowPending;
  error?: string;
  resolveInput?: (value: string) => void;
  rejectInput?: (error: Error) => void;
  preAnswers: string[];
  /**
   * Secret-bearing fragments of every answer submitted to this flow (the
   * non-empty value and, for a pasted URL, its non-empty query/hash values). Server-only, never serialised;
   * cleared when the flow ends. Used to withhold an error message that echoes
   * the input. See change: expose-plugin-credential-and-oauth-seams.
   */
  submitted: string[];
  promptCount: number;
  abort: AbortController;
  /** Resolves once `login()` settled AND the terminal status is recorded. */
  settled: Promise<void>;
}

const flows = new Map<string, OAuthFlow>();

/** Current flow record, or undefined when never issued / already pruned. */
export function getFlow(flowId: string): OAuthFlow | undefined {
  return flows.get(flowId);
}

/** Live flow-record count (used by the prune / shutdown scenarios). */
export function flowStoreSize(): number {
  return flows.size;
}

/** Forget one flow record without touching the store's other entries. */
export function deleteFlow(flowId: string): void {
  flows.delete(flowId);
}

/**
 * Every record still `pending` for one provider. Used by `/start`'s supersede
 * step: a provider whose flow holds a fixed callback port cannot be started
 * twice, so the outgoing one is cancelled and awaited first.
 */
export function pendingFlowsFor(provider: string): OAuthFlow[] {
  return [...flows.values()].filter(
    (flow) => flow.provider === provider && flow.status === "pending",
  );
}

export function toFlowStatus(flow: OAuthFlow): OAuthFlowStatus {
  const status: OAuthFlowStatus = {
    flowId: flow.id,
    provider: flow.provider,
    status: flow.status,
  };
  if (flow.authUrl !== undefined) status.authUrl = flow.authUrl;
  if (flow.message !== undefined) status.message = flow.message;
  // `pending` describes what the client must render or ANSWER next; a
  // non-pending flow has no next step, and a `device_code` pending is
  // render-only, so neither is withheld here.
  if (flow.status === "pending" && flow.pending !== undefined) {
    status.pending = flow.pending;
  }
  if (flow.error !== undefined) status.error = flow.error;
  return status;
}

/**
 * Mark a flow cancelled and abort it. The record deliberately REMAINS readable
 * until it is pruned: the spec requires a cancelled flow to report
 * `status: "error", error: "Cancelled"`, which only the retained record can do
 * once `login()` settles.
 */
export function cancelFlow(flow: OAuthFlow): void {
  flow.cancelled = true;
  flow.abort.abort();
}

/**
 * Drop every flow past its lifetime. A still-pending flow is aborted before it
 * is forgotten so no listener or poll outlives its record.
 */
export function pruneFlows(now: number = Date.now()): void {
  for (const [id, flow] of [...flows]) {
    if (now < flow.expiresAt) continue;
    if (flow.status === "pending") cancelFlow(flow);
    flows.delete(id);
  }
}

/** Server shutdown: abort every flow and forget the store. */
export function abortAllFlows(): void {
  for (const flow of flows.values()) cancelFlow(flow);
  flows.clear();
}

/** Register the background prune timer; returns its stopper. */
export function startFlowPruneTimer(): () => void {
  const timer = setInterval(() => pruneFlows(), PRUNE_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

// ── Interaction adapter ──────────────────────────────────────────────────────

/** Resolve a pending prompt, clearing `pending` first so a later status read
 * can never echo the submitted value. */
function clearPending(flow: OAuthFlow): void {
  flow.pending = undefined;
  flow.resolveInput = undefined;
  flow.rejectInput = undefined;
}

function toPending(prompt: LoginPrompt): OAuthFlowPending {
  switch (prompt.type) {
    case "manual_code":
      return prompt.placeholder === undefined
        ? { kind: "manual_code", message: prompt.message }
        : {
            kind: "manual_code",
            message: prompt.message,
            placeholder: prompt.placeholder,
          };
    case "text":
      return prompt.placeholder === undefined
        ? { kind: "text", message: prompt.message }
        : { kind: "text", message: prompt.message, placeholder: prompt.placeholder };
    case "select":
      return {
        kind: "select",
        message: prompt.message,
        options: prompt.options.map((o) =>
          o.description === undefined
            ? { id: o.id, label: o.label }
            : { id: o.id, label: o.label, description: o.description },
        ),
      };
    default:
      // `secret` is rejected before reaching here; no bundled provider issues
      // it. Kept total for the type, and reachable only by a pi-ai release
      // adding a kind, which the flow's rejection surfaces as an error.
      return { kind: "text", message: prompt.message };
  }
}

/**
 * Device-code bookkeeping. `expiresInSeconds` is optional upstream: a missing
 * or non-numeric value leaves BOTH `expiresAt` and `deviceCodeDeadline`
 * untouched (never `NaN`), so such a flow can only end `error`, never
 * `expired`. Every bundled device flow today supplies a number.
 */
function applyDeviceCode(
  flow: OAuthFlow,
  event: Extract<LoginEvent, { type: "device_code" }>,
): void {
  flow.pending = {
    kind: "device_code",
    userCode: event.userCode,
    verificationUri: event.verificationUri,
    ...(typeof event.intervalSeconds === "number"
      ? { intervalSeconds: event.intervalSeconds }
      : {}),
    ...(typeof event.expiresInSeconds === "number"
      ? { expiresInSeconds: event.expiresInSeconds }
      : {}),
  };
  if (
    typeof event.expiresInSeconds === "number" &&
    Number.isFinite(event.expiresInSeconds) &&
    event.expiresInSeconds > 0
  ) {
    const deadline = Date.now() + event.expiresInSeconds * 1000;
    flow.deviceCodeDeadline = deadline;
    flow.expiresAt = Math.max(flow.expiresAt, deadline + DEVICE_CODE_TTL_SLACK_MS);
  }
}

interface InteractionHooks {
  /** Called on the flow's first renderable step, resolving `/start`'s wait. */
  onFirstStep: () => void;
  openInBrowser?: (url: string) => void;
}

function createFlowInteraction(flow: OAuthFlow, hooks: InteractionHooks): LoginInteraction {
  // The abort row (see the module header): the flow controller must REJECT the
  // pending prompt, not merely stop waiting, or pi-ai's `finally` never runs.
  flow.abort.signal.addEventListener(
    "abort",
    () => {
      flow.rejectInput?.(new Error("Cancelled"));
    },
    { once: true },
  );

  const notify = (event: LoginEvent): void => {
    if (event.type === "auth_url") {
      const first = flow.authUrl === undefined;
      flow.authUrl = event.url;
      if (first && !flow.cancelled) hooks.openInBrowser?.(event.url);
      hooks.onFirstStep();
      return;
    }
    if (event.type === "device_code") {
      applyDeviceCode(flow, event);
      hooks.onFirstStep();
      return;
    }
    // progress / info: message only — deliberately NOT a first step, so a
    // leading `progress` cannot end `/start`'s wait with nothing to render.
    flow.message = event.message;
  };

  const prompt = (p: LoginPrompt): Promise<string> => {
    // `secret` has no bundled provider; rejecting (rather than hanging) is what
    // lets the flow's own error path close its listener.
    if (p.type === "secret") {
      return Promise.reject(new Error(`unsupported prompt: ${p.type}`));
    }

    flow.promptCount += 1;
    const isFirst = flow.promptCount === 1;

    // `preAnswers` answers the flow's first free-text prompt without it ever
    // becoming pending; it is discarded after the first prompt of ANY kind.
    if (isFirst) {
      const preAnswers = flow.preAnswers;
      flow.preAnswers = [];
      if (p.type === "text" && preAnswers.length > 0) {
        return Promise.resolve(preAnswers[0]);
      }
    }

    const pending = toPending(p);
    const promptSignal = p.signal;

    return new Promise<string>((resolve, reject) => {
      let done = false;

      const settleResolve = (value: string): void => {
        if (done) return;
        done = true;
        recordSubmitted(flow, value);
        cleanup();
        resolve(value);
      };
      const settleReject = (error: Error): void => {
        if (done) return;
        done = true;
        cleanup();
        reject(error);
      };
      const onPromptAbort = (): void => {
        // Per-prompt cancellation (pi-ai aborts the `manual_code` prompt when
        // its callback server wins): the whole login continues, so only this
        // prompt is dropped.
        settleReject(new Error("Cancelled"));
      };
      function cleanup(): void {
        if (flow.resolveInput === settleResolve) flow.resolveInput = undefined;
        if (flow.rejectInput === settleReject) flow.rejectInput = undefined;
        if (flow.pending === pending) flow.pending = undefined;
        promptSignal?.removeEventListener("abort", onPromptAbort);
      }

      flow.pending = pending;
      flow.resolveInput = settleResolve;
      flow.rejectInput = settleReject;

      if (promptSignal) {
        if (promptSignal.aborted) {
          settleReject(new Error("Cancelled"));
          return;
        }
        promptSignal.addEventListener("abort", onPromptAbort, { once: true });
      }

      hooks.onFirstStep();
    });
  };

  return { signal: flow.abort.signal, notify, prompt };
}

// ── Input echo guard ─────────────────────────────────────────────────────────

/** Message reported instead of an error that contains submitted input. */
export const WITHHELD_ERROR_MESSAGE = "Sign-in failed (details withheld: the error echoed submitted input)";

function recordSubmitted(flow: OAuthFlow, value: string): void {
  const fragments = [value.trim()];
  try {
    const url = new URL(value.trim());
    for (const v of url.searchParams.values()) fragments.push(v);
    if (url.hash.length > 1) {
      for (const v of new URLSearchParams(url.hash.slice(1)).values()) fragments.push(v);
    }
  } catch { /* not a URL */ }
  // Every non-empty fragment, however short: over-withholding only hides error
  // detail, under-withholding leaks a code.
  for (const f of fragments) if (f.length > 0) flow.submitted.push(f);
}

/**
 * A login error may quote what the operator pasted (an authorization code, a
 * redirect URL carrying one). Status responses must never echo that input, so
 * such an error is replaced whole — no partial redaction.
 */
export function withholdEchoedInput(error: string, submitted: readonly string[]): string {
  return submitted.some((f) => quotes(error, f)) ? WITHHELD_ERROR_MESSAGE : error;
}

/** Fragments at least this long match as plain substrings. */
const SUBSTRING_MATCH_MIN = 4;

/**
 * Does `error` quote `fragment`? Long fragments match anywhere; a short one
 * (e.g. a 3-char code) only as a whole token — otherwise a one-letter URL
 * param such as `state=s` would withhold every message containing an `s`.
 */
function quotes(error: string, fragment: string): boolean {
  if (fragment.length >= SUBSTRING_MATCH_MIN) return error.includes(fragment);
  const escaped = fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![A-Za-z0-9_-])${escaped}(?![A-Za-z0-9_-])`).test(error);
}

// ── Flow start ───────────────────────────────────────────────────────────────

export interface StartedFlow {
  flow: OAuthFlow;
  /** Resolves on the first user-facing step (`auth_url`, `device_code`, or an
   * answerable prompt). `progress` / `info` deliberately do not count. */
  firstEvent: Promise<void>;
  /** Resolves once `login()` settled and the terminal status is recorded. */
  settled: Promise<void>;
}

export interface StartFlowParams {
  provider: string;
  /** The registry entry's `auth` — pi-ai's own flow. */
  loginFlow: OAuthLoginFlow;
  /** Answers the flow's first free-text prompt (e.g. `enterpriseDomain`). */
  preAnswers: string[];
  /** The dashboard's locked, backed-up `auth.json` writer. */
  writeCredential: (provider: string, credential: OAuthCredential) => Promise<void>;
  /** Told to reload credentials once one is persisted. */
  notifyBridges: () => void;
  openInBrowser?: (url: string) => void;
  /**
   * Stable installation id for `login(interaction, { getDeviceId })`. Defaults
   * to pi's own `SettingsManager.getOrCreateDeviceId()` (the id the pi TUI
   * uses), resolved by {@link loadPiDeviceId} before the flow starts.
   * See change: update-pi-core-1-0-adopt-apis.
   */
  getDeviceId?: () => string;
}

let piDeviceIdReader: (() => string) | undefined;

/**
 * Pre-load pi's device-id reader (`SettingsManager.create(cwd)
 * .getOrCreateDeviceId`), so `startFlow` stays synchronous. Best effort: a
 * failure leaves the reader unset and only flows that need a device id
 * (Sign in with ChatGPT) fail, with pi-ai's own message.
 */
export async function loadPiDeviceId(): Promise<void> {
  if (piDeviceIdReader) return;
  try {
    const mod = (await import("@earendil-works/pi-coding-agent")) as {
      SettingsManager?: { create(cwd: string): { getOrCreateDeviceId(): string } };
    };
    const sm = mod.SettingsManager?.create(process.cwd());
    if (sm && typeof sm.getOrCreateDeviceId === "function") {
      piDeviceIdReader = () => sm.getOrCreateDeviceId();
    }
  } catch {
    /* leave unset */
  }
}

/**
 * Create a flow record and start pi-ai's login against it. Synchronous: the
 * login runs detached, and `firstEvent` / `settled` let the route decide what
 * to answer.
 */
export function startFlow(params: StartFlowParams): StartedFlow {
  let resolveSettled: () => void = () => {};
  const settled = new Promise<void>((resolve) => {
    resolveSettled = resolve;
  });

  const createdAt = Date.now();
  const flow: OAuthFlow = {
    id: crypto.randomUUID(),
    provider: params.provider,
    status: "pending",
    createdAt,
    expiresAt: createdAt + FLOW_TTL_MS,
    cancelled: false,
    preAnswers: [...params.preAnswers],
    submitted: [],
    promptCount: 0,
    abort: new AbortController(),
    settled,
  };
  flows.set(flow.id, flow);

  let resolveFirstEvent: () => void = () => {};
  let firstEventSeen = false;
  const firstEvent = new Promise<void>((resolve) => {
    resolveFirstEvent = resolve;
  });
  const onFirstStep = (): void => {
    if (firstEventSeen) return;
    firstEventSeen = true;
    resolveFirstEvent();
  };

  const finish = (status: OAuthFlowState, error?: string): void => {
    flow.status = status;
    if (error !== undefined) flow.error = withholdEchoedInput(error, flow.submitted);
    flow.submitted = [];
    clearPending(flow);
  };

  const loginCall = (() => {
    try {
      return Promise.resolve(
        params.loginFlow.login(
          createFlowInteraction(flow, {
            onFirstStep,
            openInBrowser: params.openInBrowser,
          }),
          { getDeviceId: params.getDeviceId ?? piDeviceIdReader },
        ),
      );
    } catch (err) {
      return Promise.reject(err);
    }
  })();

  loginCall
    .then(async (credential) => {
      // A cancel that raced a late resolve: the credential must be DISCARDED,
      // never written. See test-plan X6.
      //
      // Deliberately checked BEFORE the write, and NOT again after it: a cancel
      // that lands while the locked, atomic `writeCredential` is already in
      // flight cannot un-write anything. Reporting `Cancelled` at that point
      // would tell the operator the credential was not stored while `auth.json`
      // holds it, and the pane would offer a re-login for a provider that is
      // already connected. The honest terminal state is `complete` — it IS.
      if (flow.cancelled) {
        finish("error", "Cancelled");
        return;
      }
      try {
        await params.writeCredential(flow.provider, credential);
      } catch (err) {
        finish("error", err instanceof Error ? err.message : String(err));
        return;
      }
      params.notifyBridges();
      finish("complete");
    })
    .catch((err: unknown) => {
      finish(
        deriveFailureState(flow),
        flow.cancelled ? "Cancelled" : err instanceof Error ? err.message : String(err),
      );
    })
    .finally(() => {
      resolveSettled();
    });

  return { flow, firstEvent, settled };
}

/**
 * `expired` is derived from the elapsed device-code DEADLINE, never from
 * pi-ai's message text — the runtime's own wording is not a contract.
 */
function deriveFailureState(flow: OAuthFlow): OAuthFlowState {
  if (flow.cancelled) return "error";
  if (flow.deviceCodeDeadline !== undefined && Date.now() >= flow.deviceCodeDeadline) {
    return "expired";
  }
  return "error";
}
