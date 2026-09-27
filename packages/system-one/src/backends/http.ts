/**
 * `http` backend: `POST <url>` with the TypeSafe `/v1/systemone` body
 * (`model`, `state`, `questions`). Redirects are errors (`redirect: "error"`),
 * so a loopback server cannot bounce state to a remote host (design D6).
 * Only http:/https: URLs are accepted. See change: add-system-one-registry.
 */
import { parseBackendUrl } from "../egress.js";
import type { Questions } from "../types.js";
import { attemptScope, type RawOutcome } from "./attempt.js";

export interface HttpCall {
  url: string;
  model: string;
  key?: string;
  timeoutMs: number;
  state: string;
  questions: Questions;
  signal?: AbortSignal;
}

export async function callHttp(c: HttpCall): Promise<RawOutcome> {
  if (!parseBackendUrl(c.url)) return { ok: false, outcome: "error" };
  const scope = attemptScope(c.timeoutMs, c.signal);
  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (c.key) headers.authorization = `Bearer ${c.key}`;
    const work = (async (): Promise<RawOutcome> => {
      const res = await fetch(c.url, {
        method: "POST",
        headers,
        body: JSON.stringify({ model: c.model, state: c.state, questions: c.questions }),
        redirect: "error",
        signal: scope.signal,
      });
      if (!res.ok) return { ok: false, outcome: "error" };
      const body = (await res.json()) as { model?: unknown; answers?: unknown } | null;
      const model = typeof body?.model === "string" && body.model ? body.model : c.model;
      return { ok: true, raw: body?.answers, model };
    })().catch((): RawOutcome => ({ ok: false, outcome: scope.timedOut() ? "timeout" : "error" }));
    const r = await Promise.race([work, scope.aborted]);
    return r === "timeout" ? { ok: false, outcome: "timeout" } : r;
  } finally {
    scope.dispose();
  }
}
