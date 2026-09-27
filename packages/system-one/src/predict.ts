/**
 * `predict` — the single System-1 entry point (spec: system-one-adapter).
 * Resolves the chain (consumer override > preset chain > empty), then for each
 * entry: egress gate → capability gate → call → validate. First success wins;
 * no backend is retried; a caller abort stops the chain. The adapter reports
 * `mode`/`thresholds`/`policy` and never allows or blocks anything itself
 * (design D4). See change: add-system-one-registry.
 */
import { callHttp } from "./backends/http.js";
import { callLlm } from "./backends/llm.js";
import type { RawOutcome } from "./backends/attempt.js";
import { effectiveCapabilities, effectiveKeyRef, backendModel } from "./catalog.js";
import { fitsCapabilities } from "./capabilities.js";
import { loadConfig } from "./config.js";
import { logDecision } from "./decision-log.js";
import { isOffMachine } from "./egress.js";
import { resolveKey } from "./keys.js";
import { CONSUMER_ID, registerConsumer } from "./registry.js";
import type { Attempt, FailReason, PredictRequest, PredictResult, SystemOneConfig } from "./types.js";
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

export async function predict(req: PredictRequest): Promise<PredictResult> {
  const t0 = performance.now();
  const { consumer, state, questions, signal, llmCaller } = req;
  const policy = consumer.failurePolicy;
  const attempts: Attempt[] = [];
  const fail = (reason: FailReason): PredictResult => {
    logDecision({ consumerId: consumer.id, attempts, model: null, mode: null, answers: null, reason }, state);
    return { ok: false, reason, policy, attempts };
  };

  if (typeof consumer.id !== "string" || !CONSUMER_ID.test(consumer.id)) return { ok: false, reason: "error", policy, attempts };
  registerConsumer(consumer);

  const cfg = loadConfig({ project: req.project });
  const chain = req.onlyBackend !== undefined
    ? Object.hasOwn(cfg.backends, req.onlyBackend) ? [req.onlyBackend] : []
    : resolveChain(cfg, consumer.id);

  let last: FailReason = "no-backend";
  for (const backendId of chain) {
    if (signal?.aborted) return fail("timeout");
    const b = cfg.backends[backendId];
    const skip = (outcome: FailReason) => {
      attempts.push({ backendId, outcome, latencyMs: 0 });
      last = outcome;
    };
    if (b.kind === "llm" && !llmCaller) {
      skip("no-backend");
      continue;
    }
    if (!cfg.allowOffMachine && isOffMachine(b, llmCaller)) {
      skip("off-machine");
      continue;
    }
    if (!fitsCapabilities(effectiveCapabilities(b), state, questions)) {
      skip("capability");
      continue;
    }
    if (b.kind === "managed" && !b.port) {
      skip("no-backend");
      continue;
    }

    const a0 = performance.now();
    let out: RawOutcome;
    if (b.kind === "llm") {
      out = await callLlm(llmCaller!, b.role, state, questions, b.timeoutMs ?? LLM_TIMEOUT_MS, signal);
    } else {
      const url = b.kind === "managed" ? `http://127.0.0.1:${b.port}/v1/systemone` : b.url;
      const keyRef = effectiveKeyRef(b);
      out = await callHttp({
        url,
        model: backendModel(b) ?? "",
        key: keyRef ? resolveKey(keyRef) : undefined,
        timeoutMs: b.timeoutMs ?? HTTP_TIMEOUT_MS,
        state,
        questions,
        signal,
      });
    }
    const latencyMs = performance.now() - a0;

    if (!out.ok) {
      attempts.push({ backendId, outcome: out.outcome, latencyMs });
      last = out.outcome;
      if (signal?.aborted) return fail("timeout");
      continue;
    }
    const answers = normalizeAnswers(questions, out.raw);
    if (!answers) {
      attempts.push({ backendId, outcome: "error", latencyMs });
      last = "error";
      continue;
    }
    attempts.push({ backendId, outcome: "ok", latencyMs });

    const key = `${backendId}::${consumer.id}`;
    const rec = Object.hasOwn(cfg.calibration, key) ? cfg.calibration[key] : undefined;
    const applies = rec !== undefined && rec.model === out.model;
    const mode = applies && rec.mode === "enforce" ? "enforce" : "shadow";
    const thresholds = applies ? { ...rec.thresholds } : {};
    logDecision({ consumerId: consumer.id, attempts, model: out.model, mode, answers }, state);
    return { ok: true, answers, backendId, model: out.model, mode, thresholds, latencyMs: performance.now() - t0, attempts };
  }
  return fail(last);
}
