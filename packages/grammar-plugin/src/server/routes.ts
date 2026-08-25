/**
 * Grammar/spell-check REST routes, mounted by the grammar plugin's server
 * entry via `ctx.fastify`. `POST /api/grammar/check` + `GET /api/grammar/health`.
 *
 * Auth is enforced globally by the dashboard's auth `onRequest` hook (same as
 * every plugin route, e.g. automation-plugin); this route intentionally does
 * NOT re-apply the per-route `networkGuard` — matching the plugin-route
 * convention. The check route is a thin mapper over `checkGrammar`; it emits
 * one structured log line per invocation with NO draft text. Config is re-read
 * per request so a settings change takes effect without a restart.
 * See change: make-grammar-fully-plugin-contained.
 */

import type {
  GrammarCheckResult,
  GrammarErrorCode,
  GrammarHealth,
} from "@blackbelt-technology/pi-dashboard-shared/grammar-types.js";
import type { ApiResponse } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { GrammarConfig } from "../grammar-config.js";
import type { LlmModelRegistry, LlmStreamFn } from "./backends/llm.js";
import {
  checkGrammar as defaultCheckGrammar,
  getGrammarHealth as defaultGetGrammarHealth,
  type GrammarCheckOutcome,
} from "./grammar-service.js";

const STATUS_BY_CODE: Record<GrammarErrorCode, number> = {
  grammar_disabled: 409,
  empty_text: 400,
  backend_unconfigured: 400,
  backend_unreachable: 502,
  backend_timeout: 504,
  backend_bad_response: 502,
};

export interface GrammarRouteDeps {
  /** Re-reads the resolved grammar config per request. */
  getGrammarConfig: () => GrammarConfig;
  /** OAuth/api_key-aware model registry for the `llm` backend (in-process). */
  getModelRegistry?: () => Promise<LlmModelRegistry | null>;
  /** pi-ai streamSimple adapter for the `llm` backend. */
  streamSimple?: LlmStreamFn;
  /** Injectable for tests; defaults to the real service. */
  check?: typeof defaultCheckGrammar;
  health?: typeof defaultGetGrammarHealth;
}

/**
 * Opt this request out of Fastify's 10s per-socket connectionTimeout (the llm
 * grammar backend, non-streaming, can take longer), restoring it on finish so
 * a keep-alive socket doesn't carry an infinite timeout forward.
 */
function relaxSocketTimeout(request: FastifyRequest, reply: FastifyReply): void {
  const socket = request.raw.socket;
  const prev = typeof socket?.timeout === "number" ? socket.timeout : undefined;
  socket?.setTimeout?.(0);
  if (typeof prev === "number") {
    reply.raw.once("finish", () => {
      if (socket && !socket.destroyed) socket.setTimeout(prev);
    });
  }
}

export function mountGrammarRoutes(fastify: FastifyInstance, deps: GrammarRouteDeps): void {
  const { getGrammarConfig } = deps;
  const check = deps.check ?? defaultCheckGrammar;
  const health = deps.health ?? defaultGetGrammarHealth;

  fastify.post<{ Body: { text?: unknown; language?: unknown } }>(
    "/api/grammar/check",
    async (request, reply) => {
      relaxSocketTimeout(request, reply);
      const config = getGrammarConfig();
      const text = typeof request.body?.text === "string" ? request.body.text : "";
      const language =
        typeof request.body?.language === "string" ? request.body.language : undefined;
      const started = Date.now();

      // Resolve the model runtime for the (only) llm backend.
      let registry: LlmModelRegistry | null = null;
      if (deps.getModelRegistry) {
        try {
          registry = await deps.getModelRegistry();
        } catch {
          registry = null;
        }
      }

      let outcome: GrammarCheckOutcome;
      try {
        outcome = await check({ text, language, config, registry, streamSimple: deps.streamSimple });
      } catch {
        outcome = { ok: false, code: "backend_unreachable", message: "grammar backend failed" };
      }

      const ms = Date.now() - started;
      if (outcome.ok) {
        console.log(
          "[grammar]",
          JSON.stringify({
            backend: outcome.result.backend,
            language: outcome.result.language,
            length: text.length,
            ms,
            suggestions: outcome.result.suggestions.length,
            truncated: outcome.result.truncated,
          }),
        );
        return { success: true, data: outcome.result } satisfies ApiResponse<GrammarCheckResult>;
      }

      console.warn(
        "[grammar]",
        JSON.stringify({ backend: "llm", length: text.length, ms, code: outcome.code }),
      );
      reply.code(STATUS_BY_CODE[outcome.code] ?? 500);
      return { success: false, error: outcome.message, code: outcome.code } satisfies ApiResponse;
    },
  );

  fastify.get(
    "/api/grammar/health",
    async (): Promise<ApiResponse<GrammarHealth>> => {
      const data = await health(getGrammarConfig());
      return { success: true, data };
    },
  );
}
