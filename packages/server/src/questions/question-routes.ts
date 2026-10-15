/**
 * REST roads for the pending-question stack (D8, D9):
 *   GET  /api/questions                 rows, no context bodies        (observe)
 *   GET  /api/questions/:id             detail incl. brief + snapshot  (observe)
 *   POST /api/questions/:id/answer      `{answer}` XOR `{cancelled}`   (control)
 *   POST /api/questions/:id/summarize   on-demand generated brief      (control)
 *
 * Visibility = the session-list predicate (`canAccessSession`): an invisible
 * question is a 404 on every road, indistinguishable from an unknown id.
 * Tiers live in `ROUTE_TIERS`; the answer claim is shared with the browser
 * `prompt_response` road (`question-answer.ts`).
 * See change: add-pending-question-stack.
 */
import { validateQuestionAnswer } from "@blackbelt-technology/pi-dashboard-shared/prompt-answer.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { canAccessSession, sessionPrincipalOf } from "../identity/session-access.js";
import type { NetworkGuard } from "../routes/route-deps.js";
import { ANSWER_SOURCE, type SendToSession, transmitClaimed } from "./question-answer.js";
import type { QuestionStore, SummarizeResult } from "./question-store.js";

type Owner = { iss: string; sub: string };

export interface QuestionRouteDeps {
  networkGuard: NetworkGuard;
  store: QuestionStore;
  sendToSession: SendToSession;
  /** Ownership resolver active? (inert → every question is visible). */
  isResolverActive: () => boolean;
  /** Owner of a live session, or undefined (ownerless / unknown). */
  ownerOf: (sessionId: string) => Owner | undefined;
}

type ParsedBody = { ok: true; answer?: string; cancelled?: true } | { ok: false; error: string };

/** `{answer: string}` XOR `{cancelled: true}`; anything else is malformed. */
function parseAnswerBody(raw: unknown): ParsedBody {
  const body = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const hasAnswer = body.answer !== undefined;
  const hasCancel = body.cancelled !== undefined;
  if (hasAnswer === hasCancel) return { ok: false, error: "send exactly one of `answer` or `cancelled: true`" };
  if (hasAnswer) {
    return typeof body.answer === "string" ? { ok: true, answer: body.answer } : { ok: false, error: "`answer` must be a string" };
  }
  return body.cancelled === true ? { ok: true, cancelled: true } : { ok: false, error: "`cancelled` must be true" };
}

const SUMMARIZE_STATUS: Record<Extract<SummarizeResult, { ok: false }>["reason"], number> = {
  "not-found": 404,
  "already-generated": 409,
  unavailable: 503,
  failed: 502,
};

export function registerQuestionRoutes(fastify: FastifyInstance, deps: QuestionRouteDeps): void {
  const { store, networkGuard } = deps;
  const guard = { preHandler: networkGuard };

  const canSee = (request: FastifyRequest, sessionId: string): boolean =>
    canAccessSession({ active: deps.isResolverActive(), principal: sessionPrincipalOf(request), owner: deps.ownerOf(sessionId) });

  const fail = (reply: FastifyReply, code: number, error: string) => {
    reply.code(code);
    return { success: false, error };
  };

  /** Open + visible record, or the 404/409 reply to send. */
  function openQuestion(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    const found = store.lookup(request.params.id);
    // Visibility first: an answered/invisible question must not reveal itself (404, not 409) to a non-owner.
    if (found.state === "unknown") return { reply: fail(reply, 404, "question not found") };
    if (!canSee(request, found.state === "answered" ? found.sessionId : found.record.sessionId)) return { reply: fail(reply, 404, "question not found") };
    if (found.state === "answered") return { reply: fail(reply, 409, "answered") };
    return { record: found.record };
  }

  fastify.get("/api/questions", guard, async (request) => ({
    success: true,
    data: store.listRows((sessionId) => canSee(request, sessionId)),
  }));

  fastify.get<{ Params: { id: string } }>("/api/questions/:id", guard, async (request, reply) => {
    const found = store.lookup(request.params.id);
    const detail = found.state === "open" && canSee(request, found.record.sessionId) ? store.getDetail(found.record.id) : undefined;
    return detail ? { success: true, data: detail } : fail(reply, 404, "question not found");
  });

  fastify.post<{ Params: { id: string }; Body: unknown }>("/api/questions/:id/answer", guard, async (request, reply) => {
    const body = parseAnswerBody(request.body);
    if (!body.ok) return fail(reply, 400, body.error);

    const open = openQuestion(request, reply);
    if (!open.record) return open.reply;
    const rec = open.record;
    if (rec.origin === "file") return fail(reply, 403, "file-access prompts are answered on the access approval surface");

    if (body.answer !== undefined) {
      const valid = validateQuestionAnswer(
        { type: rec.type, ...(rec.options ? { options: rec.options } : {}), ...(rec.questions ? { metadata: { questions: rec.questions } } : {}) },
        body.answer,
      );
      if (!valid.ok) return fail(reply, 400, valid.reason);
    }

    // Synchronous from here to the claim: concurrent answers cannot interleave.
    const claim = store.claim(rec.id);
    if (claim.status === "answered") return fail(reply, 409, "answered");
    if (claim.status === "unknown") return fail(reply, 404, "question not found");

    const message: Record<string, unknown> = {
      type: "prompt_response",
      sessionId: rec.sessionId,
      promptId: rec.promptId,
      ...(body.answer !== undefined ? { answer: body.answer } : { cancelled: true }),
      source: ANSWER_SOURCE,
    };
    const transmitted = transmitClaimed(store, rec.id, () => deps.sendToSession(rec.sessionId, message));
    return { success: true, data: { transmitted } };
  });

  fastify.post<{ Params: { id: string } }>("/api/questions/:id/summarize", guard, async (request, reply) => {
    const open = openQuestion(request, reply);
    if (!open.record) return open.reply;
    const out = await store.summarize(open.record.id);
    return out.ok ? { success: true, data: out.detail } : { ...fail(reply, SUMMARIZE_STATUS[out.reason], out.error), reason: out.reason };
  });
}
