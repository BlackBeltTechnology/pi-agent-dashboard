/**
 * Brief generation engine (D4): one `@fast` completion per call, a global
 * concurrency cap with a FIFO queue, a hard timeout, and counters.
 *
 * Pure orchestration over injected `resolveModel` + `complete` (production
 * wiring: `brief-runtime.ts`). Never throws: every outcome is a value.
 * Resolution runs inside the slot so queue order stays arrival order.
 * A timed-out call frees its slot at once (the abort signal is best-effort;
 * a provider that ignores it must not starve the queue).
 * Logs outcome + latency only — never prompt or brief content.
 * See change: add-pending-question-stack.
 */
import type { BatchQuestion } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import type { BriefLabel, QuestionSnapshot } from "@blackbelt-technology/pi-dashboard-shared/question-types.js";
import type { BriefModelResolution } from "./brief-model.js";
import { buildBriefPrompt } from "./brief-prompt.js";

export const BRIEF_TIMEOUT_MS = 20_000;
export const BRIEF_MAX_CONCURRENT = 2;
/** Defensive ceiling on stored brief text (the prompt asks for ≤ 120 words). */
const BRIEF_MAX_CHARS = 2000;

export interface BriefRequest {
  question: string;
  type: string;
  options?: string[];
  subQuestions?: BatchQuestion[];
  message?: string;
  snapshot: QuestionSnapshot;
}

export type BriefOutcome =
  | { ok: true; text: string; label: Exclude<BriefLabel, "provided">; latencyMs: number }
  | { ok: false; kind: "unavailable" | "failed"; reason: string; latencyMs: number };

export interface BriefStats {
  ready: number;
  failed: number;
  unavailable: number;
  /** Generations that produced no brief (unavailable + failed). */
  fallbacks: number;
  queued: number;
  inFlight: number;
}

export interface BriefGeneratorDeps {
  resolveModel: () => Promise<BriefModelResolution>;
  complete: (model: unknown, prompt: { system: string; user: string }, signal: AbortSignal) => Promise<string>;
  timeoutMs?: number;
  maxConcurrent?: number;
  now?: () => number;
}

export interface BriefGenerator {
  generate(req: BriefRequest): Promise<BriefOutcome>;
  stats(): BriefStats;
}

export function createBriefGenerator(deps: BriefGeneratorDeps): BriefGenerator {
  const timeoutMs = deps.timeoutMs ?? BRIEF_TIMEOUT_MS;
  const maxConcurrent = deps.maxConcurrent ?? BRIEF_MAX_CONCURRENT;
  const now = deps.now ?? Date.now;
  const counts = { ready: 0, failed: 0, unavailable: 0 };
  const queue: Array<() => void> = [];
  let inFlight = 0;

  function release(): void {
    inFlight--;
    const next = queue.shift();
    if (next) next();
  }
  function acquire(): Promise<void> {
    if (inFlight < maxConcurrent) {
      inFlight++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      queue.push(() => {
        inFlight++;
        resolve();
      });
    });
  }

  async function run(req: BriefRequest): Promise<{ text: string } | { kind: "unavailable" | "failed"; reason: string }> {
    const resolved = await deps.resolveModel();
    if (!resolved.ok) return { kind: "unavailable", reason: resolved.reason };
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`generation timed out after ${timeoutMs} ms`));
      }, timeoutMs);
    });
    try {
      const text = await Promise.race([deps.complete(resolved.model, buildBriefPrompt(req), controller.signal), timeout]);
      const trimmed = typeof text === "string" ? text.trim() : "";
      if (!trimmed) return { kind: "failed", reason: "empty completion" };
      return { text: trimmed.slice(0, BRIEF_MAX_CHARS) };
    } catch (err) {
      return { kind: "failed", reason: (err as Error)?.message ?? String(err) };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return {
    async generate(req) {
      await acquire();
      const started = now();
      try {
        const res = await run(req);
        const latencyMs = Math.max(0, now() - started);
        if ("text" in res) {
          counts.ready++;
          console.log(`[questions] brief outcome=ready latencyMs=${latencyMs}`);
          return { ok: true, text: res.text, label: req.snapshot.assistantText ? "generated" : "generated-limited", latencyMs };
        }
        counts[res.kind]++;
        console.log(`[questions] brief outcome=${res.kind} latencyMs=${latencyMs} reason=${JSON.stringify(res.reason.slice(0, 120))}`);
        return { ok: false, kind: res.kind, reason: res.reason, latencyMs };
      } finally {
        release();
      }
    },
    stats() {
      return { ...counts, fallbacks: counts.failed + counts.unavailable, queued: queue.length, inFlight };
    },
  };
}
