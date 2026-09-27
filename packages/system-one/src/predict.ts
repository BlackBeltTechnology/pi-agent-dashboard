/**
 * `predict` — the single System-1 entry point (spec: system-one-adapter).
 * Resolves the chain (consumer override > preset chain > empty), then for each
 * entry: egress gate → capability gate → call → validate. First success wins;
 * no backend is retried; a caller abort stops the chain. The adapter reports
 * `mode`/`thresholds`/`policy` and never allows or blocks anything itself
 * (design D4). See change: add-system-one-registry.
 */

import type { RawOutcome } from "./backends/attempt.js";
import { callHttp } from "./backends/http.js";
import { callLlm } from "./backends/llm.js";
import { fitsCapabilities } from "./capabilities.js";
import { backendModel, effectiveCapabilities, effectiveKeyRef } from "./catalog.js";
import { loadConfig } from "./config.js";
import { logDecision } from "./decision-log.js";
import { isOffMachine } from "./egress.js";
import { resolveKey } from "./keys.js";
import { CONSUMER_ID, registerConsumer } from "./registry.js";
import type { Answers, Attempt, Backend, FailReason, LlmCaller, Mode, PredictRequest, PredictResult, SystemOneConfig } from "./types.js";
import { normalizeAnswers } from "./validate.js";
import { warnOnce } from "./warn.js";

const HTTP_TIMEOUT_MS = 2_000;
const LLM_TIMEOUT_MS = 15_000;

/** The chain `predict` would try for `consumerId`, undefined ids dropped. */
export function resolveChain(cfg: SystemOneConfig, consumerId: string): string[] {
  const preset = Object.hasOwn(cfg.presets, cfg.activePreset) ? cfg.presets[cfg.activePreset] : undefined;
  const override = preset?.consumers && Object.hasOwn(preset.consumers, consumerId) ? preset.consumers[consumerId] : undefined;
  const chain = override?.chain ?? preset?.chain ?? [];
  return chain.filter((id) => {
    if (Object.hasOwn(cfg.backends, id)) return true;
    warnOnce(`chain entry "${id}" names an undefined backend; ignoring it`);
    return false;
  });
}

/** Why `b` must be skipped before any request, or null to call it. */
function gate(b: Backend, cfg: SystemOneConfig, req: PredictRequest): FailReason | null {
  if (b.kind === "llm" && !req.llmCaller) return "no-backend";
  if (!cfg.allowOffMachine && isOffMachine(b, req.llmCaller)) return "off-machine";
  if (!fitsCapabilities(effectiveCapabilities(b), req.state, req.questions)) return "capability";
  if (b.kind === "managed" && !b.port) return "no-backend";
  return null;
}

/** One network attempt against an already-gated backend. */
function call(b: Backend, req: PredictRequest): Promise<RawOutcome> {
  const { state, questions, signal } = req;
  if (b.kind === "llm") return callLlm(req.llmCaller as LlmCaller, b.role, state, questions, b.timeoutMs ?? LLM_TIMEOUT_MS, signal);
  const url = b.kind === "managed" ? `http://127.0.0.1:${b.port}/v1/systemone` : b.url;
  const keyRef = effectiveKeyRef(b);
  return callHttp({
    url,
    model: backendModel(b) ?? "",
    key: keyRef ? resolveKey(keyRef) : undefined,
    timeoutMs: b.timeoutMs ?? HTTP_TIMEOUT_MS,
    state,
    questions,
    signal,
  });
}

/** `mode` + `thresholds` from the exact `<backend>::<consumer>` record whose model matches. */
function calibrationFor(cfg: SystemOneConfig, backendId: string, consumerId: string, model: string): { mode: Mode; thresholds: Record<string, number> } {
  const key = `${backendId}::${consumerId}`;
  const rec = Object.hasOwn(cfg.calibration, key) ? cfg.calibration[key] : undefined;
  if (!rec || rec.model !== model) return { mode: "shadow", thresholds: {} };
  return { mode: rec.mode === "enforce" ? "enforce" : "shadow", thresholds: { ...rec.thresholds } };
}

type AttemptResult =
  | { ok: true; answers: Answers; model: string; latencyMs: number }
  | { ok: false; outcome: Exclude<FailReason, "no-backend">; latencyMs: number };

/** Call + validate one gated backend; a malformed answer is an `error` attempt. */
async function attempt(b: Backend, req: PredictRequest): Promise<AttemptResult> {
  const a0 = performance.now();
  const out = await call(b, req);
  const latencyMs = performance.now() - a0;
  if (!out.ok) return { ok: false, outcome: out.outcome, latencyMs };
  const answers = normalizeAnswers(req.questions, out.raw);
  return answers ? { ok: true, answers, model: out.model, latencyMs } : { ok: false, outcome: "error", latencyMs };
}

function chainFor(cfg: SystemOneConfig, req: PredictRequest): string[] {
  if (req.onlyBackend === undefined) return resolveChain(cfg, req.consumer.id);
  return Object.hasOwn(cfg.backends, req.onlyBackend) ? [req.onlyBackend] : [];
}

export async function predict(req: PredictRequest): Promise<PredictResult> {
  const t0 = performance.now();
  const { consumer, state, signal } = req;
  const policy = consumer.failurePolicy;
  const attempts: Attempt[] = [];
  const fail = (reason: FailReason): PredictResult => {
    logDecision({ consumerId: consumer.id, attempts, model: null, mode: null, answers: null, reason }, state);
    return { ok: false, reason, policy, attempts };
  };

  if (typeof consumer.id !== "string" || !CONSUMER_ID.test(consumer.id)) return { ok: false, reason: "error", policy, attempts };
  registerConsumer(consumer);
  const cfg = loadConfig({ project: req.project });

  let last: FailReason = "no-backend";
  for (const backendId of chainFor(cfg, req)) {
    if (signal?.aborted) return fail("timeout");
    const b = cfg.backends[backendId];
    const skip = gate(b, cfg, req);
    if (skip) {
      attempts.push({ backendId, outcome: skip, latencyMs: 0 });
      last = skip;
      continue;
    }
    const a = await attempt(b, req);
    attempts.push({ backendId, outcome: a.ok ? "ok" : a.outcome, latencyMs: a.latencyMs });
    if (!a.ok) {
      last = a.outcome;
      if (signal?.aborted) return fail("timeout");
      continue;
    }
    const { mode, thresholds } = calibrationFor(cfg, backendId, consumer.id, a.model);
    logDecision({ consumerId: consumer.id, attempts, model: a.model, mode, answers: a.answers }, state);
    return { ok: true, answers: a.answers, backendId, model: a.model, mode, thresholds, latencyMs: performance.now() - t0, attempts };
  }
  return fail(last);
}
