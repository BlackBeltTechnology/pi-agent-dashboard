/**
 * Transport for the question stack dialog. Server routes:
 * `packages/server/src/questions/question-routes.ts`.
 *
 * - `fetchQuestionDetail`  GET  /api/questions/:id
 * - `answerQuestion`       POST /api/questions/:id/answer  ({answer} XOR {cancelled:true})
 * - `summarizeQuestion`    POST /api/questions/:id/summarize
 *
 * Failures never throw: `{ ok:false, status, error, reason? }`. A 409 on answer
 * carries `error: "answered"`; summarize failures carry `reason`
 * (`failed` 502, `unavailable` 503, `already-generated` 409).
 * See change: add-pending-question-stack.
 */
import type { QuestionAnswerRequest, QuestionDetail } from "@blackbelt-technology/pi-dashboard-shared/question-types.js";
import { getApiBase } from "../api/api-context.js";

export type QuestionApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; reason?: string };

interface Envelope<T> {
  success?: boolean;
  data?: T;
  error?: string;
  reason?: string;
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<QuestionApiResult<T>> {
  try {
    const res = await fetch(`${getApiBase()}${path}`, {
      method,
      ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
    const json = (await res.json().catch(() => null)) as Envelope<T> | null;
    if (res.ok && json?.success === true && json.data !== undefined) return { ok: true, data: json.data };
    return { ok: false, status: res.status, error: json?.error ?? `HTTP ${res.status}`, reason: json?.reason };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : "network error" };
  }
}

const q = (id: string) => `/api/questions/${encodeURIComponent(id)}`;

export function fetchQuestionDetail(id: string): Promise<QuestionApiResult<QuestionDetail>> {
  return call<QuestionDetail>("GET", q(id));
}

export function answerQuestion(id: string, body: QuestionAnswerRequest): Promise<QuestionApiResult<{ transmitted: boolean }>> {
  return call<{ transmitted: boolean }>("POST", `${q(id)}/answer`, body);
}

export function summarizeQuestion(id: string): Promise<QuestionApiResult<QuestionDetail>> {
  return call<QuestionDetail>("POST", `${q(id)}/summarize`);
}
