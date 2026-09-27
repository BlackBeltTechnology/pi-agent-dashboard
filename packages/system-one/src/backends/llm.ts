/**
 * `llm` backend: delegates to an injected `LlmCaller` (design D3). The adapter
 * enforces the timeout with its own timer and signal whether or not the caller
 * honours the signal. See change: add-system-one-registry.
 */
import type { LlmCaller, Questions } from "../types.js";
import { attemptScope, type RawOutcome } from "./attempt.js";

export async function callLlm(
  caller: LlmCaller,
  role: string,
  state: string,
  questions: Questions,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<RawOutcome> {
  const scope = attemptScope(timeoutMs, signal);
  try {
    const work = Promise.resolve()
      .then(() => caller.call({ role, state, questions, signal: scope.signal }))
      .then(
        (r): RawOutcome => ({ ok: true, raw: r?.answers, model: typeof r?.model === "string" && r.model ? r.model : role }),
        (): RawOutcome => ({ ok: false, outcome: scope.timedOut() ? "timeout" : "error" }),
      );
    const r = await Promise.race([work, scope.aborted]);
    return r === "timeout" ? { ok: false, outcome: "timeout" } : r;
  } finally {
    scope.dispose();
  }
}
